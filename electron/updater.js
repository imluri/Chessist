const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { installerAsset, installerPath, clearInstallerFiles, downloadInstaller, launchInstaller } = require('./installer-updater')

const ROOT = path.join(__dirname, '..')        // repo root (when run from source)
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const REPO = 'imluri/Chessist'
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`
const UPDATE_VERSION_CHANGED = 'The available version changed. Check for updates again.'

function isGitRepo() {
  return fs.existsSync(path.join(ROOT, '.git'))
}

function appVersion() {
  try { return require('electron').app.getVersion() }
  catch { try { return require('../package.json').version } catch { return '' } }
}

function installedOnWindows() {
  const { app } = require('electron')
  // An unpacked build also has app.isPackaged. NSIS adds the adjacent uninstaller.
  return process.platform === 'win32' && app?.isPackaged &&
    fs.existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall Chessist.exe'))
}

function githubFetch(url, options = {}) {
  const { net } = require('electron')
  const request = {
    ...options,
    credentials: 'omit',
    headers: { 'User-Agent': 'Chessist', ...options.headers },
  }
  return net ? net.fetch(url, request) : fetch(url, request)
}

async function httpJson(url) {
  const response = await githubFetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw Object.assign(new Error(`GitHub returned HTTP ${response.status}`), { status: response.status })
  return response.json()
}

// Numeric semver compare; true when `remote` is strictly newer than `installed`.
function isNewer(remote, installed) {
  const norm = (s) => String(s || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const a = norm(remote), b = norm(installed)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true
    if ((a[i] || 0) < (b[i] || 0)) return false
  }
  return false
}

function withReleaseNotes(status, body) {
  const releaseNotes = typeof body === 'string' ? body.trim() : ''
  return releaseNotes ? { ...status, releaseNotes } : status
}

async function checkInstallerUpdate() {
  const version = appVersion()
  const status = { installer: true, channel: 'stable', version }
  try {
    const release = await httpJson(LATEST_RELEASE)
    const tag = release.tag_name
    const available = /^v\d+\.\d+\.\d+$/.test(tag) && !release.draft && !release.prerelease && isNewer(tag, version)
    if (!available) return { status: { ...status, tag, available: false } }
    const asset = installerAsset(release, process.arch)
    return {
      status: withReleaseNotes({ ...status, tag, available, canApply: !!asset, manual: !asset }, release.body),
      asset,
    }
  } catch (error) {
    if (error.status === 404) return { status: { ...status, noReleases: true } }
    return { status: { ...status, error: 'Could not check for updates on GitHub. Try again.' } }
  }
}

async function applyInstallerUpdate(onLog, expectedTag) {
  const { status, asset } = await checkInstallerUpdate()
  if (status.error) return { ok: false, error: status.error }
  if (expectedTag && expectedTag !== status.tag) return { ok: false, error: UPDATE_VERSION_CHANGED }
  if (!status.available) return { ok: false, error: 'There is no newer release available.' }
  if (!asset) return { ok: false, error: 'The release does not have a compatible installer that Chessist can verify.' }

  const { app } = require('electron')
  const file = installerPath(app.getPath('userData'))
  // Build the URL from the official repository and the selected asset name.
  const url = `https://github.com/${REPO}/releases/download/${status.tag}/${encodeURIComponent(asset.name)}`
  try {
    await downloadInstaller(githubFetch, url, asset, file, onLog)
  } catch (error) {
    return { ok: false, error: error.message }
  }
  onLog?.('Starting the installer…\n')
  try {
    await launchInstaller(file)
    return { ok: true, installer: true }
  } catch {
    await clearInstallerFiles(file)
    return { ok: false, error: 'Windows could not start the update installer. Try again or open the release.' }
  }
}

async function clearInstallerCache() {
  if (!installedOnWindows()) return
  const { app } = require('electron')
  await clearInstallerFiles(installerPath(app.getPath('userData')))
}

// ZIP and unpacked builds check GitHub for updates and link to the Releases page.
//   stable → newest release tag vs installed version
//   beta   → tip-of-main commit SHA (UI compares to the baked build SHA)
async function checkRemote(beta) {
  const installed = appVersion()
  try {
    if (beta) {
      const c = await httpJson(`https://api.github.com/repos/${REPO}/commits/main`)
      return { channel: 'beta', manual: true, latestSha: String(c.sha || '').slice(0, 7), version: installed }
    }
    let tag, releaseNotes
    try {
      const release = await httpJson(LATEST_RELEASE)
      tag = release.tag_name
      releaseNotes = release.body
    }
    catch { const tags = await httpJson(`https://api.github.com/repos/${REPO}/tags`); tag = tags && tags[0] && tags[0].name }
    if (!tag) return { channel: 'stable', manual: true, noReleases: true, version: installed }
    const status = { channel: 'stable', manual: true, tag, available: isNewer(tag, installed), version: installed }
    return status.available ? withReleaseNotes(status, releaseNotes) : status
  } catch (e) {
    return { manual: true, error: 'Could not reach GitHub.' }
  }
}

function run(cmd, args, onLog) {
  return new Promise((resolve) => {
    let out = ''
    let proc
    try {
      proc = spawn(cmd, args, { cwd: ROOT, windowsHide: true })
    } catch (e) {
      onLog?.(String(e.message) + '\n')
      resolve({ code: -1, out: String(e.message) })
      return
    }
    const onData = (d) => { const s = d.toString(); out += s; onLog?.(s) }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('error', (e) => { onLog?.(String(e.message) + '\n'); resolve({ code: -1, out: out + e.message }) })
    proc.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

async function latestTag() {
  const tags = (await run('git', ['tag', '--list', 'v*', '--sort=-v:refname'])).out.trim()
  return tags ? tags.split(/\r?\n/)[0].trim() : ''
}

async function changelogNotes(tag) {
  const changelog = await run('git', ['show', `${tag}:CHANGELOG.md`])
  if (changelog.code !== 0) return

  const version = tag.replace(/^v/i, '')
  for (const section of changelog.out.split(/^##[ \t]+/m).slice(1)) {
    const heading = section.match(/^(?:\[([^\]]+)\]|(\S+))[^\r\n]*(?:\r?\n|$)/)
    const headingVersion = (heading?.[1] ?? heading?.[2])?.replace(/^v/i, '')
    if (headingVersion === version) return section.slice(heading[0].length)
  }
}

// beta  → track origin/main (any new commit is an update).
// stable→ track the newest release tag (v*); no tags yet = nothing to update to.
// Returns { unsupported } | { error } | { channel, available, behind?, tag?, noReleases? }.
async function checkForUpdate(beta = false) {
  if (installedOnWindows()) return (await checkInstallerUpdate()).status
  if (!isGitRepo()) return checkRemote(beta)
  if ((await run('git', ['rev-parse', 'HEAD'])).code !== 0) return { error: 'Not a git checkout.' }
  const fetch = await run('git', ['fetch', '--quiet', '--tags', 'origin', 'main'])
  if (fetch.code !== 0) return { error: 'Could not reach GitHub: ' + fetch.out.trim() }
  const head = (await run('git', ['rev-parse', 'HEAD'])).out.trim()
  const headShort = (await run('git', ['rev-parse', '--short', 'HEAD'])).out.trim() || head.slice(0, 7)

  if (beta) {
    const remote = (await run('git', ['rev-parse', 'origin/main'])).out.trim()
    const behind = parseInt(((await run('git', ['rev-list', '--count', 'HEAD..origin/main'])).out || '').trim() || '0', 10)
    return { channel: 'beta', available: !!remote && remote !== head, behind, head: headShort }
  }

  const tag = await latestTag()
  if (!tag) return { channel: 'stable', available: false, noReleases: true, head: headShort }
  const tagSha = (await run('git', ['rev-list', '-n', '1', tag])).out.trim()
  const status = { channel: 'stable', available: !!tagSha && tagSha !== head, tag, head: headShort }
  return status.available ? withReleaseNotes(status, await changelogNotes(tag)) : status
}

// Checks out the channel target, reinstalls, rebuilds. Returns { ok } | { ok:false, step, code }.
async function applyUpdate(beta, onLog, expectedTag) {
  if (installedOnWindows()) return applyInstallerUpdate(onLog, expectedTag)
  if (!isGitRepo()) return { ok: false, error: 'Open the release to download the update.' }

  onLog?.('\n$ git fetch --tags origin main\n')
  let r = await run('git', ['fetch', '--tags', 'origin', 'main'], onLog)
  if (r.code !== 0) return { ok: false, step: 'git fetch', code: r.code }

  // beta stays on the main branch; stable detaches at the release tag.
  let checkout
  if (beta) {
    checkout = ['checkout', '-B', 'main', 'origin/main']
  } else {
    const tag = await latestTag()
    if (expectedTag && expectedTag !== tag) return { ok: false, error: UPDATE_VERSION_CHANGED }
    if (!tag) { onLog?.('\nNo release tag to update to.\n'); return { ok: false, step: 'no release tag', code: -1 } }
    checkout = ['checkout', '--force', tag]
  }

  const steps = [
    ['git', checkout],
    [NPM, ['install']],
    [NPM, ['run', 'build:overlay']],
    [NPM, ['run', 'build']],
    [NPM, ['run', 'build:firefox']],
  ]
  for (const [cmd, args] of steps) {
    onLog?.(`\n$ ${cmd} ${args.join(' ')}\n`)
    r = await run(cmd, args, onLog)
    if (r.code !== 0) {
      onLog?.(`\nStep failed (exit ${r.code}).\n`)
      return { ok: false, step: `${cmd} ${args.join(' ')}`, code: r.code }
    }
  }
  onLog?.('\nUpdate complete — restarting…\n')
  return { ok: true }
}

module.exports = { isGitRepo, latestTag, checkForUpdate, applyUpdate, clearInstallerCache }
