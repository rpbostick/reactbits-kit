// rbx add / update / check / list against a temporary project, reading React
// Bits from the local checkout (no network). A throwaway git repository
// stands in for later upstream commits: one where a transform's shape is
// gone, and one with an unrelated upstream edit.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createdFiles, forProfile } from '../src/transform.ts'
import { COMPONENTS } from '../src/transforms/index.ts'
import { PINNED_COMMIT, readUpstreamFile } from '../src/upstream.ts'
import { UPSTREAM_CHECKOUT, UPSTREAM_SKIP } from './support/upstream.ts'

const RBX = fileURLToPath(new URL('../bin/rbx.js', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'rbx-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

function rbx(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [RBX, ...args], { cwd, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function project(name: string): string {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function manifest(dir: string) {
  return JSON.parse(readFileSync(join(dir, 'src/reactbits/reactbits-kit.json'), 'utf8'))
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, '-c', 'user.name=rbx test', '-c', 'user.email=rbx@example.invalid', ...args], { encoding: 'utf8' }).trim()
}

// A git repository holding the upstream files rbx reads, at the pinned
// commit's content; returns it and its first commit.
async function fakeUpstream(): Promise<{ repo: string; first: string }> {
  const repo = join(scratch, 'upstream')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '--quiet')
  const paths = ['LICENSE.md', ...Object.values(COMPONENTS).flatMap((spec) => spec.files.map((file) => `${spec.upstreamDir}/${file}`))]
  for (const path of paths) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), await readUpstreamFile({ commit: PINNED_COMMIT, checkout: UPSTREAM_CHECKOUT }, path))
  }
  git(repo, 'add', '.')
  git(repo, 'commit', '--quiet', '-m', 'upstream as pinned')
  return { repo, first: git(repo, 'rev-parse', 'HEAD') }
}

function commitEdit(repo: string, path: string, edit: (text: string) => string, message: string): string {
  const file = join(repo, path)
  writeFileSync(file, edit(readFileSync(file, 'utf8')))
  git(repo, 'commit', '--quiet', '-am', message)
  return git(repo, 'rev-parse', 'HEAD')
}

test('rbx list names every component and transform, with the profiles that apply it', () => {
  const result = rbx(scratch, 'list')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(Object.keys(COMPONENTS).length, 10)
  for (const spec of Object.values(COMPONENTS)) {
    assert.match(result.stdout, new RegExp(`^${spec.name} `, 'm'))
    for (const transform of spec.transforms) assert.ok(result.stdout.includes(transform.id), `${spec.name} ${transform.id}`)
  }
  assert.match(result.stdout, /^ {2}08-pointer-getter {2}Waves\.tsx {2}\[site\] /m)
  assert.match(result.stdout, /^ {2}11-container-pointer-listeners {2}Waves\.tsx {2}\[sheet\] /m)
  assert.match(result.stdout, /^ {2}01-params-getter {2}Threads\.tsx {2}\[site sheet\] /m)
})

test('usage errors exit 2 and say what is wrong', () => {
  const dir = project('usage')
  assert.equal(rbx(dir, 'add', 'Waves').status, 2)
  const unknown = rbx(dir, 'add', 'Ribbons', '--to', 'src/reactbits')
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /no component Ribbons; available: Waves, Aurora, Iridescence, Threads, Balatro, LiquidChrome, Galaxy, Plasma, SoftAurora, RippleGrid/)
  assert.match(rbx(dir, 'check', '--to', 'src/reactbits').stderr, /no .*reactbits-kit\.json; add a component first/)
  assert.equal(rbx(dir, 'frobnicate').status, 2)
})

test('a short --commit without a local checkout is refused rather than fetched', () => {
  const result = rbx(project('short-sha'), 'add', 'Waves', '--to', 'src/reactbits', '--commit', '4d6a46d')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /full 40-character commit SHA/)
})

test('rbx add writes the transformed files, CHANGES.md and the manifest', { skip: UPSTREAM_SKIP }, () => {
  const dir = project('add')
  const added = rbx(dir, 'add', 'Waves', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT)
  assert.equal(added.status, 0, added.stderr)
  assert.equal(rbx(dir, 'add', 'Iridescence', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)

  assert.deepEqual(manifest(dir), {
    version: 2,
    commit: PINNED_COMMIT,
    profile: 'site',
    components: {
      Iridescence: { transforms: COMPONENTS.Iridescence.profiles.site },
      Waves: { transforms: COMPONENTS.Waves.profiles.site },
    },
  })
  const waves = readFileSync(join(dir, 'src/reactbits/Waves/Waves.tsx'), 'utf8')
  assert.match(waves, /paused\?: boolean;/)
  assert.match(readFileSync(join(dir, 'src/reactbits/Waves/Waves.css'), 'utf8'), /var\(--x, -0\.5rem\)/)
  const changes = readFileSync(join(dir, 'src/reactbits/Waves/CHANGES.md'), 'utf8')
  assert.ok(changes.includes(PINNED_COMMIT))
  for (const id of COMPONENTS.Waves.profiles.site) assert.ok(changes.includes(`**${id}**`), id)
  assert.ok(!changes.includes('11-container-pointer-listeners'), "the sheet's changes stay out of the site's copy")
  assert.match(changes, /MIT \+ Commons Clause/, "React Bits' licence goes with the copy")
  assert.match(readFileSync(join(dir, 'src/reactbits/Waves/noise.ts'), 'utf8'), /export function noisePeriod/, 'the site profile writes noise.ts')
  assert.match(waves, /from '\.\/noise\.ts';/)
  assert.ok(changes.includes('`noise.ts` is code moved out of `Waves.tsx` by 13-noise-module.'), 'CHANGES.md says where noise.ts came from')

  const again = rbx(dir, 'add', 'Waves', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT)
  assert.equal(again.status, 2)
  assert.match(again.stderr, /already in .*; use rbx update/)
})

for (const profile of ['site', 'sheet'] as const) {
  test(`rbx add puts all ten components in one project with the ${profile} profile, and rbx check passes`, { skip: UPSTREAM_SKIP }, () => {
    const dir = project(`all-ten-${profile}`)
    for (const name of Object.keys(COMPONENTS)) {
      const added = rbx(dir, 'add', name, '--to', 'src/reactbits', '--profile', profile, '--source', UPSTREAM_CHECKOUT)
      assert.equal(added.status, 0, `${name}: ${added.stderr}`)
      const spec = COMPONENTS[name]
      for (const file of [...spec.files, ...createdFiles(forProfile(spec, profile)).map(([created]) => created), 'CHANGES.md']) {
        readFileSync(join(dir, 'src/reactbits', name, file), 'utf8')
      }
      const changes = readFileSync(join(dir, 'src/reactbits', name, 'CHANGES.md'), 'utf8')
      for (const id of spec.profiles[profile]) assert.ok(changes.includes(`**${id}**`), `${name} CHANGES.md lists ${id}`)
    }
    assert.deepEqual(
      manifest(dir).components,
      Object.fromEntries(Object.keys(COMPONENTS).map((name) => [name, { transforms: COMPONENTS[name].profiles[profile] }])),
    )
    const checked = rbx(dir, 'check', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT)
    assert.equal(checked.status, 0, checked.stderr)
  })
}

test('rbx check passes on a fresh copy, reports edits and missing files, and rbx update restores them', { skip: UPSTREAM_SKIP }, () => {
  const dir = project('check')
  assert.equal(rbx(dir, 'add', 'Aurora', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)
  const clean = rbx(dir, 'check', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT)
  assert.equal(clean.status, 0, clean.stderr)

  appendFileSync(join(dir, 'src/reactbits/Aurora/Aurora.tsx'), '// a local edit\n')
  rmSync(join(dir, 'src/reactbits/Aurora/CHANGES.md'))
  const drifted = rbx(dir, 'check', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT)
  assert.equal(drifted.status, 1)
  assert.match(drifted.stderr, /drift: Aurora\/Aurora\.tsx differs/)
  assert.match(drifted.stderr, /drift: Aurora\/CHANGES\.md is missing/)

  assert.equal(rbx(dir, 'update', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)
  assert.equal(rbx(dir, 'check', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)
})

test('rbx update moves to a new commit, or reports the changes that no longer apply and writes nothing', { skip: UPSTREAM_SKIP }, async () => {
  const { repo, first } = await fakeUpstream()
  const wavesPath = `${COMPONENTS.Waves.upstreamDir}/Waves.tsx`
  const broken = commitEdit(repo, wavesPath, (text) => text.replaceAll('updateMouse', 'trackPointer'), 'rename updateMouse')
  const edited = commitEdit(repo, wavesPath, (text) => text.replaceAll('trackPointer', 'updateMouse').replace("'use client';", "'use client';\n// upstream edit"), 'restore and annotate')

  const dir = project('update')
  assert.equal(rbx(dir, 'add', 'Waves', '--to', 'src/reactbits', '--source', repo, '--commit', first).status, 0)
  assert.equal(rbx(dir, 'add', 'Iridescence', '--to', 'src/reactbits', '--source', repo).status, 0, 'later adds use the manifest commit')
  const before = readFileSync(join(dir, 'src/reactbits/Waves/Waves.tsx'), 'utf8')

  const failed = rbx(dir, 'update', '--to', 'src/reactbits', '--source', repo, '--commit', broken)
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /Waves 04-pointer-position-fix no longer applies: .*updateMouse/)
  assert.match(failed.stderr, /nothing written/)
  assert.equal(manifest(dir).commit, first)
  assert.equal(readFileSync(join(dir, 'src/reactbits/Waves/Waves.tsx'), 'utf8'), before)

  const mismatch = rbx(dir, 'add', 'Aurora', '--to', 'src/reactbits', '--source', repo, '--commit', edited)
  assert.equal(mismatch.status, 2)
  assert.match(mismatch.stderr, /rbx update --commit/)

  const moved = rbx(dir, 'update', '--to', 'src/reactbits', '--source', repo, '--commit', edited)
  assert.equal(moved.status, 0, moved.stderr)
  assert.equal(manifest(dir).commit, edited)
  assert.match(readFileSync(join(dir, 'src/reactbits/Waves/Waves.tsx'), 'utf8'), /\/\/ upstream edit/)
  assert.match(readFileSync(join(dir, 'src/reactbits/Waves/CHANGES.md'), 'utf8'), new RegExp(edited))
  assert.equal(rbx(dir, 'check', '--to', 'src/reactbits', '--source', repo).status, 0)
})

test('rbx keeps one profile per project: add records it, a different or unknown one is refused, update switches it', { skip: UPSTREAM_SKIP }, () => {
  const dir = project('profiles')
  const added = rbx(dir, 'add', 'Iridescence', '--to', 'src/reactbits', '--profile', 'sheet', '--source', UPSTREAM_CHECKOUT)
  assert.equal(added.status, 0, added.stderr)
  assert.equal(manifest(dir).profile, 'sheet')
  assert.deepEqual(manifest(dir).components.Iridescence.transforms, COMPONENTS.Iridescence.profiles.sheet)
  assert.match(readFileSync(join(dir, 'src/reactbits/Iridescence/CHANGES.md'), 'utf8'), /profile `sheet`/)
  assert.equal(rbx(dir, 'add', 'Aurora', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0, 'later adds use the manifest profile')
  assert.equal(manifest(dir).profile, 'sheet')

  const other = rbx(dir, 'add', 'Waves', '--to', 'src/reactbits', '--profile', 'site', '--source', UPSTREAM_CHECKOUT)
  assert.equal(other.status, 2)
  assert.match(other.stderr, /uses profile sheet; .*rbx update --profile site/)
  const unknown = rbx(dir, 'add', 'Waves', '--to', 'src/reactbits', '--profile', 'blog', '--source', UPSTREAM_CHECKOUT)
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /no profile blog; available: site, sheet/)

  const switched = rbx(dir, 'update', '--to', 'src/reactbits', '--profile', 'site', '--source', UPSTREAM_CHECKOUT)
  assert.equal(switched.status, 0, switched.stderr)
  assert.equal(manifest(dir).profile, 'site')
  assert.deepEqual(manifest(dir).components.Iridescence.transforms, COMPONENTS.Iridescence.profiles.site)
  assert.equal(rbx(dir, 'check', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)
})

test('rbx check reports a component built with another set of transforms than its profile has', { skip: UPSTREAM_SKIP }, () => {
  const dir = project('stale-set')
  assert.equal(rbx(dir, 'add', 'Aurora', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)
  const path = join(dir, 'src/reactbits/reactbits-kit.json')
  const data = manifest(dir)
  data.components.Aurora.transforms = ['01-params-getter']
  writeFileSync(path, JSON.stringify(data))
  const result = rbx(dir, 'check', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /drift: Aurora was built with 01-params-getter; profile site now has 01-params-getter, 02-accumulated-clock, 03-paused-prop/)
})

test('a version 1 manifest from reactbits-kit 0.1.0 is read as the site profile and rewritten as version 2', { skip: UPSTREAM_SKIP }, () => {
  const dir = project('v1')
  assert.equal(rbx(dir, 'add', 'Aurora', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)
  const path = join(dir, 'src/reactbits/reactbits-kit.json')
  const { profile: _profile, ...rest } = manifest(dir)
  writeFileSync(path, JSON.stringify({ ...rest, version: 1 }))
  assert.equal(rbx(dir, 'check', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)
  assert.equal(rbx(dir, 'update', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT).status, 0)
  assert.equal(manifest(dir).version, 2)
  assert.equal(manifest(dir).profile, 'site')
})

test('a manifest of another shape or a held lock stops rbx with the reason', { skip: UPSTREAM_SKIP }, () => {
  const dir = project('manifest')
  mkdirSync(join(dir, 'src/reactbits'), { recursive: true })
  writeFileSync(join(dir, 'src/reactbits/reactbits-kit.json'), JSON.stringify({ version: 3, commit: PINNED_COMMIT, profile: 'site', components: {} }))
  const newer = rbx(dir, 'add', 'Waves', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT)
  assert.equal(newer.status, 1)
  assert.match(newer.stderr, /version 3, this rbx reads versions 1 and 2/)

  rmSync(join(dir, 'src/reactbits/reactbits-kit.json'))
  writeFileSync(join(dir, 'src/reactbits/reactbits-kit.json.lock'), '')
  const locked = rbx(dir, 'add', 'Waves', '--to', 'src/reactbits', '--source', UPSTREAM_CHECKOUT)
  assert.equal(locked.status, 1)
  assert.match(locked.stderr, /another rbx run is working/)
})
