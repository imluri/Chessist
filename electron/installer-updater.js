const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { createWriteStream } = require('node:fs')
const { rename, rm } = require('node:fs/promises')
const path = require('node:path')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')

function installerAsset(release, arch) {
  const version = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1]
  if (!version || !['x64', 'arm64', 'ia32'].includes(arch)) return null

  const base = `Chessist Setup ${version}`
  const names = [`${base}-${arch}.exe`]
  // Releases before the filename included the architecture shipped x64 installers.
  if (arch === 'x64') names.push(`${base}.exe`)
  for (const name of names) {
    const asset = release.assets?.find(a => a.name === name || a.name === name.replaceAll(' ', '.'))
    if (asset?.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0 &&
        /^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return asset
  }
  return null
}

function installerPath(userData) {
  return path.join(userData, 'chessist-update.exe')
}

async function clearInstallerFiles(file) {
  // Windows may still have the installer open when it starts the updated app.
  await Promise.allSettled([rm(file, { force: true }), rm(file + '.partial', { force: true })])
}

async function downloadInstaller(fetch, url, asset, file, onLog) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('The update download timed out.')), 30000)
  const hash = createHash('sha256')
  let bytes = 0
  let lastProgress = 0
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      timeout.refresh()
      bytes += chunk.length
      if (bytes > asset.size) return callback(new Error('The installer download size did not match the release.'))
      hash.update(chunk)
      const percent = Math.floor(bytes * 100 / asset.size)
      if (percent >= lastProgress + 10 || percent === 100) {
        lastProgress = percent
        onLog?.(`Downloading update… ${percent}%\n`)
      }
      callback(null, chunk)
    },
  })

  await clearInstallerFiles(file)
  try {
    onLog?.('Downloading update…\n')
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`GitHub could not provide the installer (HTTP ${response.status}).`)
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(file + '.partial', { flags: 'wx' }), {
      signal: controller.signal,
    })
    if (bytes !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest.toLowerCase()) {
      throw new Error('The installer download could not be verified. Try downloading it again.')
    }
    await rename(file + '.partial', file)
  } catch (error) {
    await clearInstallerFiles(file)
    throw controller.signal.reason || error
  } finally {
    clearTimeout(timeout)
  }
}

function launchInstaller(file, start = spawn) {
  return new Promise((resolve, reject) => {
    // NSIS updates the registered installation and relaunches once it has replaced the app.
    const child = start(file, ['--updated', '--force-run'], {
      cwd: path.dirname(file), detached: true, stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

module.exports = { installerAsset, installerPath, clearInstallerFiles, downloadInstaller, launchInstaller }
