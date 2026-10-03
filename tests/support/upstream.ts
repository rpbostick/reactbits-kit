import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PINNED_COMMIT } from '../../src/upstream.ts'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const UPSTREAM_CHECKOUT = fileURLToPath(new URL('../../.upstream', import.meta.url))

function hasPinnedCommit(): boolean {
  if (!existsSync(`${UPSTREAM_CHECKOUT}/.git`)) return false
  try {
    execFileSync('git', ['-C', UPSTREAM_CHECKOUT, 'cat-file', '-e', `${PINNED_COMMIT}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// For `test(name, { skip: UPSTREAM_SKIP }, …)`: false when the checkout is
// there, else the reason the test is skipped.
export const UPSTREAM_SKIP: string | false = hasPinnedCommit()
  ? false
  : `needs React Bits at ${PINNED_COMMIT} in .upstream/; run bash scripts/fetch-upstream.sh (npm test does)`
