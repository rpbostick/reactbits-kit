// The package as a consumer gets it: packed from a copy of the sources with
// no dist/ (so `prepare` has to build it, as npm does for a git dependency),
// installed into a throwaway project, and run with plain node and type
// stripping off, which is what Node does under node_modules anyway.
// Deliberate: the copy, not the checkout, is packed: `prepare` empties dist/,
// and other test files run bin/rbx.js from the checkout's dist/ meanwhile.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { after, before, test } from 'node:test'
import { ROOT } from './support/upstream.ts'

const NO_STRIP = '--no-experimental-strip-types'
const NOT_COPIED = new Set(['node_modules', 'dist', '.git', '.upstream', '.ws-evidence', '.worktrees'])

const scratch = mkdtempSync(join(tmpdir(), 'rbx-package-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
const consumer = join(scratch, 'consumer')

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')} exited ${result.status ?? result.signal}\n${result.stdout}${result.stderr}`)
  return result.stdout
}

before(() => {
  const source = join(scratch, 'source')
  cpSync(ROOT, source, { recursive: true, filter: (path) => !NOT_COPIED.has(basename(path)) })
  // The build's own tools (tsc), without copying them.
  symlinkSync(join(ROOT, 'node_modules'), join(source, 'node_modules'), 'dir')
  const packed: { filename: string }[] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', scratch], source))
  const tarball = join(scratch, packed[0].filename)

  mkdirSync(consumer)
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }))
  run('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund', tarball], consumer)

  // React is the site's own, so the kit does not install it; a stand-in with
  // the hooks KitBackground imports lets plain node load the adapter.
  const react = join(consumer, 'node_modules/react')
  mkdirSync(react)
  writeFileSync(join(react, 'package.json'), JSON.stringify({ name: 'react', version: '0.0.0', type: 'module', main: 'index.js' }))
  writeFileSync(join(react, 'index.js'), ['createElement', 'useEffect', 'useRef', 'useState'].map((name) => `export function ${name}() {}\n`).join(''))
}, { timeout: 300_000 })

test('the tarball holds the compiled JavaScript and types, not the TypeScript sources', () => {
  const kit = join(consumer, 'node_modules/@rpbostick/reactbits-kit')
  const files = readdirSync(kit, { recursive: true, encoding: 'utf8' })
  assert.ok(!files.includes('src'), `src/ is in the package: ${files.join(', ')}`)
  for (const file of ['dist/cli.js', 'dist/modules/palette.js', 'dist/modules/palette.d.ts', 'dist/modules/pointerFeed.css', 'dist/react/wiring.js', 'dist/react/KitBackground.d.ts']) {
    assert.ok(files.includes(file), `${file} is missing from the package`)
  }
})

test('rbx list runs from node_modules without type stripping', () => {
  const output = run(process.execPath, [NO_STRIP, join(consumer, 'node_modules/.bin/rbx'), 'list'], consumer)
  assert.match(output, /Waves/)
  assert.match(output, /RippleGrid/)
})

test('a module, the wiring and the React adapter import by their extensionless paths', () => {
  const script = [
    "import { colorAt, stopsByTheme } from '@rpbostick/reactbits-kit/modules/palette'",
    "import { BackgroundWiring } from '@rpbostick/reactbits-kit/react/wiring'",
    "import { KitBackground, useKitBackground } from '@rpbostick/reactbits-kit/react/KitBackground'",
    "import { main } from '@rpbostick/reactbits-kit'",
    "const css = import.meta.resolve('@rpbostick/reactbits-kit/modules/pointerFeed.css')",
    'console.log(JSON.stringify({ color: colorAt(stopsByTheme.light, 0), wiring: typeof BackgroundWiring, adapter: typeof KitBackground, hook: typeof useKitBackground, main: typeof main, css }))',
  ].join('\n')
  const loaded = JSON.parse(run(process.execPath, [NO_STRIP, '--input-type=module', '-e', script], consumer))
  assert.match(loaded.color, /^rgb\(/)
  assert.deepEqual([loaded.wiring, loaded.adapter, loaded.hook, loaded.main], ['function', 'function', 'function', 'function'])
  assert.match(loaded.css, /dist\/modules\/pointerFeed\.css$/)
})

test('a TypeScript consumer type-checks against the shipped declarations', () => {
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext', lib: ['es2023', 'dom'], types: [], strict: true, noEmit: true },
    files: ['consumer.ts'],
  }))
  writeFileSync(join(consumer, 'consumer.ts'), [
    "import { colorAt, stopsByTheme } from '@rpbostick/reactbits-kit/modules/palette'",
    "import { BackgroundWiring, type WiringOptions } from '@rpbostick/reactbits-kit/react/wiring'",
    'const options: WiringOptions = { pointer: "drag" }',
    'export const color: string = colorAt(stopsByTheme.dark, 1)',
    'export const wiring: typeof BackgroundWiring = BackgroundWiring',
    'export { options }',
  ].join('\n'))
  run(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', consumer], consumer)
})
