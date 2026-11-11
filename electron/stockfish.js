const fs = require('fs')
const path = require('path')
const https = require('https')
const os = require('os')
const extract = require('extract-zip')
const { pipeline } = require('node:stream/promises')

const RELEASES_API = 'https://api.github.com/repos/official-stockfish/Stockfish/releases/latest'
const WINDOWS_BUILDS = {
  x64: ['x86-64-universal', 'x86-64'],
  arm64: ['arm64-universal', 'armv8'],
}

function pickWindowsAsset(assets, arch = process.arch) {
  for (const build of WINDOWS_BUILDS[arch] || []) {
    const asset = assets.find(a => a.name === `stockfish-windows-${build}.zip`)
    if (asset?.browser_download_url) return asset.browser_download_url
  }
  return null
}

function getResponse(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Chessist/2.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy()
        if (!redirects) return reject(new Error('Too many redirects while downloading Stockfish'))
        try { return resolve(getResponse(new URL(res.headers.location, url), redirects - 1)) }
        catch (e) { return reject(e) }
      }
      if (res.statusCode !== 200) {
        res.destroy()
        return reject(new Error(`GitHub returned HTTP ${res.statusCode}`))
      }
      resolve(res)
    }).on('error', reject)
    request.setTimeout(30000, () => request.destroy(new Error('Stockfish download timed out')))
  })
}

async function httpsJson(url) {
  const res = await getResponse(url)
  res.setEncoding('utf8')
  let body = ''
  for await (const chunk of res) body += chunk
  return JSON.parse(body)
}

async function download(url, dest, onProgress) {
  const res = await getResponse(url)
  const total = Number(res.headers['content-length'])
  let got = 0, progress = -1
  res.on('data', (chunk) => {
    got += chunk.length
    if (!total) return
    const next = Math.floor(got * 100 / total)
    if (next !== progress) onProgress(next)
    progress = next
  })
  await pipeline(res, fs.createWriteStream(dest))
}

// Read the machine field from the PE header without loading the whole executable.
function readWindowsExecutableArch(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const stub = Buffer.alloc(64)
    if (fs.readSync(fd, stub, 0, stub.length, 0) !== stub.length || stub.toString('ascii', 0, 2) !== 'MZ') return null
    const pe = Buffer.alloc(6)
    const offset = stub.readUInt32LE(0x3c)
    if (fs.readSync(fd, pe, 0, pe.length, offset) !== pe.length || pe.readUInt32LE(0) !== 0x00004550) return null
    return { 0x8664: 'x64', 0xaa64: 'arm64' }[pe.readUInt16LE(4)] ?? null
  } finally {
    fs.closeSync(fd)
  }
}

// Resolve an existing stockfish path, or download one. userDataDir is app.getPath('userData').
async function ensureStockfish(userDataDir, onStatus) {
  const dest = path.join(userDataDir, 'stockfish.exe')
  if (fs.existsSync(dest) && readWindowsExecutableArch(dest) === process.arch) return dest

  onStatus?.({ status: 'downloading', message: 'Stockfish: connecting...' })
  const release = await httpsJson(RELEASES_API)
  const url = pickWindowsAsset(release.assets || [])
  if (!url) throw new Error(`No Windows Stockfish build for ${process.arch}`)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chessist-stockfish-'))
  try {
    const tmpZip = path.join(tmpDir, 'stockfish.zip')
    await download(url, tmpZip, pct => onStatus?.({ status: 'downloading', message: `Stockfish: ${pct}%` }))
    const extracted = path.join(tmpDir, 'extracted')
    await extract(tmpZip, { dir: extracted })
    const exe = findExe(extracted)
    if (!exe || readWindowsExecutableArch(exe) !== process.arch) throw new Error('The Stockfish archive did not contain a compatible executable')
    fs.copyFileSync(exe, dest)
    return dest
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

function findExe(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { const r = findExe(full); if (r) return r }
    else if (/stockfish.*\.exe$/i.test(entry.name)) return full
  }
  return null
}

module.exports = { pickWindowsAsset, readWindowsExecutableArch, ensureStockfish }
