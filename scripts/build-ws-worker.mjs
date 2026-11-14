import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const release = join(root, 'release')
const output = join(release, 'bun-ws-worker.exe')
mkdirSync(release, { recursive: true })
// Bun creates a .bun-cache beside the current directory for its target binary.
process.chdir(release)

// The Windows installer targets x64. Use Bun's baseline build for older CPUs.
await Bun.build({
  entrypoints: [join(root, 'electron', 'bun-ws-worker.cjs')],
  compile: {
    target: 'bun-windows-x64-baseline',
    outfile: output,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
})

console.log(`Built Chessist WebSocket worker: ${output}`)
