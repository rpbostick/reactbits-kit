// `reactbits-kit.json`, in the directory a project's components live in:
// the upstream commit they were built from, the project's profile and the
// transforms applied to each. Anything else in the file is an error, so a
// hand edit or a newer format is caught rather than half-read.
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isProfile, PROFILES, type Profile } from './transform.ts'

export const MANIFEST_FILE = 'reactbits-kit.json'
export const MANIFEST_VERSION = 2

export interface Manifest {
  version: typeof MANIFEST_VERSION
  commit: string
  profile: Profile
  components: Record<string, { transforms: string[] }>
}

function invalid(path: string, reason: string): never {
  throw new Error(`${path}: ${reason}`)
}

// Version 1 (reactbits-kit 0.1.0) had no profile; it only ever applied the
// site set, so it reads as profile `site` and is written back as version 2.
export function parseManifest(text: string, path: string): Manifest {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    invalid(path, `not JSON (${(error as Error).message})`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) invalid(path, 'not a JSON object')
  const { version, commit, profile, components, ...rest } = data as Record<string, unknown>
  if (Object.keys(rest).length > 0) invalid(path, `unknown keys ${Object.keys(rest).join(', ')}`)
  if (version !== 1 && version !== MANIFEST_VERSION) invalid(path, `version ${JSON.stringify(version)}, this rbx reads versions 1 and ${MANIFEST_VERSION}`)
  if (version === 1 && profile !== undefined) invalid(path, 'a version 1 manifest has no profile')
  const readProfile = version === 1 ? 'site' : profile
  if (typeof readProfile !== 'string' || !isProfile(readProfile)) invalid(path, `profile ${JSON.stringify(profile)} is not one of ${PROFILES.join(', ')}`)
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) invalid(path, `commit ${JSON.stringify(commit)} is not a full SHA`)
  if (typeof components !== 'object' || components === null || Array.isArray(components)) invalid(path, 'components is not an object')
  for (const [name, entry] of Object.entries(components)) {
    const transforms = (entry as { transforms?: unknown } | null)?.transforms
    if (!Array.isArray(transforms) || !transforms.every((id) => typeof id === 'string')) {
      invalid(path, `components.${name}.transforms is not a list of transform ids`)
    }
  }
  return { version: MANIFEST_VERSION, commit, profile: readProfile, components: components as Manifest['components'] }
}

export function manifestPath(dir: string): string {
  return join(dir, MANIFEST_FILE)
}

export function readManifest(dir: string): Manifest | null {
  const path = manifestPath(dir)
  if (!existsSync(path)) return null
  return parseManifest(readFileSync(path, 'utf8'), path)
}

export function writeManifest(dir: string, manifest: Manifest) {
  const path = manifestPath(dir)
  const sorted = Object.fromEntries(Object.entries(manifest.components).sort(([a], [b]) => a.localeCompare(b)))
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ ...manifest, components: sorted }, null, 2)}\n`)
  renameSync(temporary, path)
}

// Runs `work` holding a lock file next to the manifest, so two rbx runs in
// one project cannot both read it and then overwrite each other's changes.
export async function withManifestLock<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const lock = `${manifestPath(dir)}.lock`
  let handle: number
  try {
    handle = openSync(lock, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`${lock} exists: another rbx run is working in ${dir} (delete the file if none is)`)
    }
    throw error
  }
  try {
    return await work()
  } finally {
    closeSync(handle)
    rmSync(lock)
  }
}
