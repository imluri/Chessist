import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickWindowsAsset, readWindowsExecutableArch } from './stockfish.js'

describe('pickWindowsAsset', () => {
  const assets = [
    { name: 'stockfish-windows-arm64-universal.zip', browser_download_url: 'arm64' },
    { name: 'stockfish-windows-x86-64-universal.zip', browser_download_url: 'x64' },
  ]

  it('selects the x64 archive even when the release lists ARM64 first', () => {
    expect(pickWindowsAsset(assets, 'x64')).toBe('x64')
  })

  it('selects the ARM64 archive on ARM64', () => {
    expect(pickWindowsAsset([...assets].reverse(), 'arm64')).toBe('arm64')
  })

  it('selects the generic x64 build on older releases without assuming AVX2', () => {
    expect(pickWindowsAsset([
      { name: 'stockfish-windows-x86-64-avx2.zip', browser_download_url: 'avx2' },
      { name: 'stockfish-windows-x86-64.zip', browser_download_url: 'w' },
    ], 'x64')).toBe('w')
  })

  it('returns null instead of downloading a different architecture', () => {
    expect(pickWindowsAsset(assets.slice(0, 1), 'x64')).toBeNull()
  })
})

describe('cached Stockfish executable', () => {
  it.each([[0x8664, 'x64'], [0xaa64, 'arm64']])('identifies Windows executable architecture %s', (machine, arch) => {
    const dir = mkdtempSync(join(tmpdir(), 'chessist-pe-test-'))
    const file = join(dir, 'stockfish.exe')
    const stub = Buffer.alloc(134)
    stub.write('MZ')
    stub.writeUInt32LE(128, 0x3c)
    stub.write('PE', 128)
    stub.writeUInt16LE(machine, 132)
    try {
      writeFileSync(file, stub)
      expect(readWindowsExecutableArch(file)).toBe(arch)
    } finally {
      rmSync(file, { force: true })
      rmdirSync(dir)
    }
  })
})
