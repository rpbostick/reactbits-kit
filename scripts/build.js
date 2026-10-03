// Compiles src/ to dist/ (JavaScript and .d.ts) and copies the files tsc does
// not emit (pointerFeed.css). Plain JavaScript because npm runs it as the
// `prepare` script, and Node refuses to strip types under node_modules.
import { spawnSync } from 'node:child_process'
import { cpSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = fileURLToPath(new URL('../src', import.meta.url))
const dist = fileURLToPath(new URL('../dist', import.meta.url))

// A removed or renamed source file must not leave its old output behind.
rmSync(dist, { recursive: true, force: true })

// typescript exports only its package.json, not bin/tsc.
const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc')
const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' })
if (result.status !== 0) {
  console.error(`build: tsc exited with ${result.status ?? result.signal}`)
  process.exit(1)
}

for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.css')) continue
  const from = join(entry.parentPath, entry.name)
  cpSync(from, join(dist, relative(src, from)))
}
