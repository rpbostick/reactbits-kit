// Where React Bits code comes from: raw GitHub URLs at a pinned commit, or a
// local git checkout of the repository (tests, offline work). The kit never
// stores upstream code; it reads it here, for the caller's project.
import { execFileSync } from 'node:child_process'

export const UPSTREAM_REPO = 'DavidHDev/react-bits'
export const UPSTREAM_URL = `https://github.com/${UPSTREAM_REPO}`
// The React Bits commit the transforms were written and tested against.
export const PINNED_COMMIT = '4d6a46d3f401736695c495f1e72ed429e0ed1b93'

const FULL_SHA = /^[0-9a-f]{40}$/

export interface UpstreamSource {
  commit: string
  // A local clone of React Bits to read from instead of GitHub.
  checkout?: string
}

function git(checkout: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    throw new Error(`git ${args.join(' ')} in ${checkout} failed${stderr ? `: ${stderr}` : ''}`)
  }
}

// A full commit SHA for `ref`: any ref the checkout knows, or, reading from
// GitHub, a full SHA as given (a short one or a branch would not pin anything).
export function resolveCommit(ref: string, checkout?: string): string {
  if (checkout) return git(checkout, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  if (!FULL_SHA.test(ref)) throw new Error(`--commit must be a full 40-character commit SHA, not "${ref}"`)
  return ref
}

export async function readUpstreamFile(source: UpstreamSource, path: string): Promise<string> {
  if (source.checkout) return git(source.checkout, ['show', `${source.commit}:${path}`])
  const url = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${source.commit}/${path}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetching ${url} failed: ${response.status} ${response.statusText}`)
  return response.text()
}
