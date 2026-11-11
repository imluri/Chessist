import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadInstaller, installerAsset, launchInstaller } from './installer-updater.js'

const content = Buffer.from('test installer contents')
const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`
const asset = { name: 'Chessist.Setup.2.1.0-x64.exe', state: 'uploaded', size: content.length, digest }

describe('Windows release asset selection', () => {
  const arm = { ...asset, name: 'Chessist.Setup.2.1.0-arm64.exe' }
  const legacy = { ...asset, name: 'Chessist.Setup.2.1.0.exe' }
  const release = { tag_name: 'v2.1.0', assets: [arm, legacy, asset] }

  it('prefers the installer for the running app architecture', () => {
    expect(installerAsset(release, 'x64')).toBe(asset)
    expect(installerAsset(release, 'arm64')).toBe(arm)
  })

  it('only uses the old unqualified installer name for x64', () => {
    const oldRelease = { ...release, assets: [legacy] }
    expect(installerAsset(oldRelease, 'x64')).toBe(legacy)
    expect(installerAsset(oldRelease, 'arm64')).toBeNull()
  })

  it.each([
    { digest: null },
    { name: 'Chessist.Setup.2.0.0-x64.exe' },
    { name: 'Uninstall.Chessist.exe' },
    { state: 'starter' },
  ])('rejects a mismatched or unverifiable installer (%o)', (override) => {
    expect(installerAsset({ ...release, assets: [{ ...asset, ...override }] }, 'x64')).toBeNull()
  })
})

describe('staging the update installer', () => {
  let directory, file
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'chessist-update-test-'))
    file = path.join(directory, 'update.exe')
  })
  afterEach(async () => {
    await rm(file, { force: true })
    await rm(file + '.partial', { force: true })
    await rmdir(directory)
  })

  it('stages a complete verified download and reports progress', async () => {
    const log = vi.fn()
    await downloadInstaller(async () => new Response(content), 'https://example.invalid', asset, file, log)
    expect(await readFile(file)).toEqual(content)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('100%'))
  })

  it.each([
    [Buffer.alloc(content.length, 0), 'incorrect checksum'],
    [content.subarray(1), 'truncated body'],
    [Buffer.concat([content, content]), 'oversized body'],
  ])('leaves no executable on an invalid download (%s, %s)', async (body) => {
    await expect(downloadInstaller(async () => new Response(body), 'https://example.invalid', asset, file)).rejects.toThrow()
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(file + '.partial')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('starting the verified installer', () => {
  const file = path.resolve('update.exe')

  it('waits for NSIS to start and lets it restart the app', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const start = vi.fn(() => child)
    const launched = launchInstaller(file, start)
    expect(start).toHaveBeenCalledWith(file, ['--updated', '--force-run'], {
      cwd: path.dirname(file), detached: true, stdio: 'ignore',
    })
    expect(child.unref).not.toHaveBeenCalled()
    child.emit('spawn')
    await launched
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('propagates launch failures so the app can stay open', async () => {
    const child = new EventEmitter()
    const launched = launchInstaller(file, () => child)
    child.emit('error', new Error('Installer blocked'))
    await expect(launched).rejects.toThrow('Installer blocked')
  })
})
