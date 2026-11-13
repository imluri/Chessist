import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
let sha = ''
try {
  sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString().trim()
} catch {
  // Source archives do not carry a Git commit.
}

const outdir = join(root, 'dist')
if (dirname(outdir) !== root) throw new Error('Invalid renderer output directory')
rmSync(outdir, { recursive: true, force: true })

const { outputs } = await Bun.build({
  entrypoints: [join(root, 'index.html')],
  outdir,
  target: 'browser',
  minify: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __BUILD_SHA__: JSON.stringify(sha),
  },
  // Use the app's React instance even when the standalone preview has its own install.
  plugins: [{
    name: 'shared-react',
    setup(build) {
      build.onResolve({ filter: /^react(?:\/jsx(?:-dev)?-runtime)?$/ }, ({ path }) => ({
        path: Bun.resolveSync(path, root),
      }))
    },
  }],
})

console.log(`Built Chessist renderer with Bun (${outputs.length} files).`)
