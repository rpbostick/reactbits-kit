// React Bits code must never be in this repository (its Commons Clause
// forbids redistributing the components), so no line of an upstream
// component file may appear in any file the repository tracks or would add.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { COMPONENTS } from '../src/transforms/index.ts'
import { PINNED_COMMIT, readUpstreamFile } from '../src/upstream.ts'
import { ROOT, UPSTREAM_CHECKOUT, UPSTREAM_SKIP } from './support/upstream.ts'

// Shorter lines (`});`, `const gl = renderer.gl;`) are too generic to tell
// copied code from code that merely names the same things.
const MIN_LINE_LENGTH = 30

// Every background the kit customizes; the guard reads each one's files.
const GUARDED = ['Aurora', 'Balatro', 'Galaxy', 'Iridescence', 'LiquidChrome', 'Plasma', 'RippleGrid', 'SoftAurora', 'Threads', 'Waves']

test('no line of an upstream component file is in the repository', { skip: UPSTREAM_SKIP }, async () => {
  assert.deepEqual(Object.keys(COMPONENTS).sort(), GUARDED)
  const upstreamLines = new Map<string, string>()
  for (const spec of Object.values(COMPONENTS)) {
    for (const file of spec.files) {
      const text = await readUpstreamFile({ commit: PINNED_COMMIT, checkout: UPSTREAM_CHECKOUT }, `${spec.upstreamDir}/${file}`)
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length >= MIN_LINE_LENGTH) upstreamLines.set(trimmed, `${spec.name}/${file}`)
      }
    }
  }
  assert.ok(upstreamLines.size > 100, `only ${upstreamLines.size} upstream lines to look for`)

  const files = execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => path && path !== 'package-lock.json')
  const found: string[] = []
  for (const path of files) {
    let text: string
    try {
      text = readFileSync(join(ROOT, path), 'utf8')
    } catch {
      continue // listed by git but deleted in the working tree
    }
    for (const line of text.split('\n')) {
      const origin = upstreamLines.get(line.trim())
      if (origin) found.push(`${path}: "${line.trim()}" (from ${origin})`)
    }
  }
  assert.deepEqual(found, [])
})
