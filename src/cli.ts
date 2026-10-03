// rbx: fetch React Bits components at a pinned commit, apply our transforms,
// and keep a project's copies in step with them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildComponent } from './build.ts'
import { MANIFEST_VERSION, manifestPath, readManifest, withManifestLock, writeManifest, type Manifest } from './manifest.ts'
import { DEFAULT_PROFILE, forProfile, isProfile, PROFILES, TransformError, type ComponentSpec, type Profile } from './transform.ts'
import { COMPONENTS } from './transforms/index.ts'
import { PINNED_COMMIT, resolveCommit, type UpstreamSource } from './upstream.ts'

const USAGE = `Usage:
  rbx add <Component> --to <dir> [--profile <${PROFILES.join('|')}>] [--commit <sha>] [--source <react-bits checkout>]
  rbx update --to <dir> [--profile <${PROFILES.join('|')}>] [--commit <sha>] [--source <react-bits checkout>]
  rbx check --to <dir> [--source <react-bits checkout>]
  rbx list

Components live in <dir>/<Component>/; <dir>/reactbits-kit.json records the
React Bits commit, the profile (whose set of changes is applied; ${DEFAULT_PROFILE}
unless given) and the transforms applied. Without --source, files are
fetched from raw.githubusercontent.com.`

class UsageError extends Error {}

const OPTIONS = {
  to: { type: 'string' },
  profile: { type: 'string' },
  commit: { type: 'string' },
  source: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const

interface Values {
  to?: string
  profile?: string
  commit?: string
  source?: string
}

function componentSpec(name: string): ComponentSpec {
  const spec = COMPONENTS[name]
  if (!spec) throw new UsageError(`no component ${name}; available: ${Object.keys(COMPONENTS).join(', ')}`)
  return spec
}

function profileOption(profile: string | undefined): Profile | undefined {
  if (profile === undefined) return undefined
  if (!isProfile(profile)) throw new UsageError(`no profile ${profile}; available: ${PROFILES.join(', ')}`)
  return profile
}

function transformIds(name: string, profile: Profile): string[] {
  return forProfile(componentSpec(name), profile).transforms.map((transform) => transform.id)
}

function requiredDir(to: string | undefined): string {
  if (!to) throw new UsageError('--to <dir> is required')
  return resolve(to)
}

function source(commit: string, checkout: string | undefined): UpstreamSource {
  return checkout ? { commit, checkout: resolve(checkout) } : { commit }
}

function requireManifest(dir: string): Manifest {
  const manifest = readManifest(dir)
  if (!manifest) throw new UsageError(`no ${manifestPath(dir)}; add a component first with rbx add`)
  return manifest
}

function writeComponent(dir: string, name: string, files: Map<string, string>) {
  const target = join(dir, name)
  mkdirSync(target, { recursive: true })
  for (const [file, text] of files) writeFileSync(join(target, file), text)
}

async function add(name: string | undefined, values: Values) {
  if (!name) throw new UsageError('rbx add needs a component name')
  const dir = requiredDir(values.to)
  const requested = profileOption(values.profile)
  mkdirSync(dir, { recursive: true })
  await withManifestLock(dir, async () => {
    const manifest = readManifest(dir)
    const profile = requested ?? manifest?.profile ?? DEFAULT_PROFILE
    if (manifest && manifest.profile !== profile) {
      throw new UsageError(`${dir} uses profile ${manifest.profile}; move every component with rbx update --profile ${profile} first`)
    }
    const spec = componentSpec(name)
    const commit = resolveCommit(values.commit ?? manifest?.commit ?? PINNED_COMMIT, values.source && resolve(values.source))
    if (manifest && manifest.commit !== commit) {
      throw new UsageError(`${dir} is at React Bits ${manifest.commit}; move every component with rbx update --commit ${commit} first`)
    }
    if (manifest?.components[name]) throw new UsageError(`${name} is already in ${dir}; use rbx update`)
    if (existsSync(join(dir, name))) throw new UsageError(`${join(dir, name)} exists but is not in the manifest; move it away first`)
    const files = await buildComponent(spec, profile, source(commit, values.source))
    writeComponent(dir, name, files)
    const transforms = transformIds(name, profile)
    const components = { ...manifest?.components, [name]: { transforms } }
    writeManifest(dir, { version: MANIFEST_VERSION, commit, profile, components })
    console.log(`added ${name} at ${commit} with ${transforms.length} changes (profile ${profile}): ${[...files.keys()].join(', ')}`)
  })
}

async function update(values: Values): Promise<number> {
  const dir = requiredDir(values.to)
  const requested = profileOption(values.profile)
  return withManifestLock(dir, async () => {
    const manifest = requireManifest(dir)
    const profile = requested ?? manifest.profile
    const commit = resolveCommit(values.commit ?? manifest.commit, values.source && resolve(values.source))
    const built = new Map<string, Map<string, string>>()
    const failures: TransformError[] = []
    for (const name of Object.keys(manifest.components)) {
      try {
        built.set(name, await buildComponent(componentSpec(name), profile, source(commit, values.source)))
      } catch (error) {
        if (!(error instanceof TransformError)) throw error
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      for (const failure of failures) console.error(`rbx: ${failure.message}`)
      console.error(`rbx: nothing written; ${dir} stays at ${manifest.commit} with profile ${manifest.profile}`)
      return 1
    }
    for (const [name, files] of built) writeComponent(dir, name, files)
    const components = Object.fromEntries([...built.keys()].map((name) => [name, { transforms: transformIds(name, profile) }]))
    writeManifest(dir, { version: MANIFEST_VERSION, commit, profile, components })
    console.log(`updated ${[...built.keys()].join(', ')} to ${commit} with profile ${profile}`)
    return 0
  })
}

async function check(values: Values): Promise<number> {
  const dir = requiredDir(values.to)
  const manifest = requireManifest(dir)
  const drift: string[] = []
  for (const [name, entry] of Object.entries(manifest.components)) {
    const expectedIds = transformIds(name, manifest.profile)
    if (expectedIds.join(' ') !== entry.transforms.join(' ')) {
      drift.push(`${name} was built with ${entry.transforms.join(', ') || 'no changes'}; profile ${manifest.profile} now has ${expectedIds.join(', ')}`)
    }
    const files = await buildComponent(componentSpec(name), manifest.profile, source(manifest.commit, values.source))
    for (const [file, expected] of files) {
      const path = join(dir, name, file)
      if (!existsSync(path)) drift.push(`${name}/${file} is missing`)
      else if (readFileSync(path, 'utf8') !== expected) drift.push(`${name}/${file} differs from a fresh rbx update`)
    }
  }
  for (const line of drift) console.error(`drift: ${line}`)
  if (drift.length > 0) return 1
  console.log(`${Object.keys(manifest.components).join(', ')} match React Bits ${manifest.commit} with our changes (profile ${manifest.profile})`)
  return 0
}

// Each component's transforms, with the profiles that apply each.
function list() {
  for (const spec of Object.values(COMPONENTS)) {
    console.log(`${spec.name} (${spec.upstreamDir})`)
    for (const transform of spec.transforms) {
      const profiles = PROFILES.filter((profile) => spec.profiles[profile].includes(transform.id))
      console.log(`  ${transform.id}  ${transform.file}  [${profiles.join(' ')}]  ${transform.summary}`)
    }
  }
}

export async function main(argv: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
    const [command, ...rest] = positionals
    if (values.help || !command) {
      console.log(USAGE)
      return values.help ? 0 : 2
    }
    if (command !== 'add' && rest.length > 0) throw new UsageError(`unexpected ${rest.join(' ')}`)
    if (command === 'add' && rest.length > 1) throw new UsageError(`unexpected ${rest.slice(1).join(' ')}`)
    switch (command) {
      case 'add':
        await add(rest[0], values)
        return 0
      case 'update':
        return await update(values)
      case 'check':
        if (values.commit) throw new UsageError('rbx check compares against the manifest commit; it takes no --commit')
        return await check(values)
      case 'list':
        list()
        return 0
      default:
        throw new UsageError(`no command ${command}`)
    }
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`rbx: ${(error as Error).message}\n\n${USAGE}`)
      return 2
    }
    console.error(`rbx: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
