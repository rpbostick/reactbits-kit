// The kit's own TypeScript (src, tests, scripts) type-checks. Node runs it
// by stripping the types, so only tsc catches a type error.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { ROOT } from './support/upstream.ts'

test('tsc -p . reports no errors', () => {
  const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', ROOT], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})
