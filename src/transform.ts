// What a transform is, and how a component's transforms are run over the
// upstream files. Transforms describe changes structurally; the upstream
// text they work on is only ever what the caller fetched.
import postcss, { type Root } from 'postcss'
import { IndentationText, Project, QuoteKind, type SourceFile } from 'ts-morph'

interface TransformInfo {
  // `NN-name`, numbered as in the component's change list.
  id: string
  // The upstream file it changes, e.g. `Waves.tsx`.
  file: string
  // One line for `rbx list`.
  summary: string
  // The change in full, for CHANGES.md.
  description: string
}

export interface TsxTransform extends TransformInfo {
  kind: 'tsx'
  // Files the change adds next to the upstream ones (code it moves out of
  // `file`); `apply` creates each in `file`'s project as `/<name>`.
  creates?: string[]
  apply(file: SourceFile): void
}

export interface CssTransform extends TransformInfo {
  kind: 'css'
  apply(root: Root): void
}

export type Transform = TsxTransform | CssTransform

// Each project that uses the kit gets its own set of a component's changes:
// `site` is our website's, `sheet` the character sheet's. A project records
// its profile in reactbits-kit.json.
export const PROFILES = ['site', 'sheet'] as const
export type Profile = (typeof PROFILES)[number]
// What 0.1.0 applied, before there were profiles.
export const DEFAULT_PROFILE: Profile = 'site'

export function isProfile(name: string): name is Profile {
  return (PROFILES as readonly string[]).includes(name)
}

export interface ComponentSpec {
  name: string
  // The component's directory in the React Bits repository.
  upstreamDir: string
  // The files fetched from it; a project's copy has these and the files its
  // profile's transforms create.
  files: string[]
  // Every change the kit has for the component, numbered in order.
  transforms: Transform[]
  // The ids each profile applies, in the order of `transforms`.
  profiles: Record<Profile, string[]>
}

// The spec with only `profile`'s transforms, as applyTransforms and
// buildComponent take it.
export function forProfile(spec: ComponentSpec, profile: Profile): ComponentSpec {
  const ids = spec.profiles[profile]
  const transforms = ids.map((id) => {
    const transform = spec.transforms.find((candidate) => candidate.id === id)
    if (!transform) throw new Error(`${spec.name} profile ${profile} names ${id}, which is not one of its transforms`)
    return transform
  })
  const order = transforms.map((transform) => spec.transforms.indexOf(transform))
  if (order.some((index, position) => position > 0 && index <= order[position - 1])) {
    throw new Error(`${spec.name} profile ${profile} lists its transforms out of order: ${ids.join(', ')}`)
  }
  return { ...spec, transforms }
}

export class TransformError extends Error {
  readonly component: string
  readonly transform: string

  constructor(component: string, transform: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`${component} ${transform} no longer applies: ${reason}`, { cause })
    this.component = component
    this.transform = transform
  }
}

function tsxProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    manipulationSettings: { indentationText: IndentationText.TwoSpaces, quoteKind: QuoteKind.Single },
  })
}

// The files `spec`'s transforms add, in order, with the transform adding each.
export function createdFiles(spec: ComponentSpec): [string, TsxTransform][] {
  return spec.transforms.flatMap((transform) => (transform.kind === 'tsx' ? (transform.creates ?? []).map((file): [string, TsxTransform] => [file, transform]) : []))
}

// Applies every transform of `spec` to `sources` (file name → upstream text)
// in order, and returns the changed files followed by the files the
// transforms added. Throws a TransformError naming the first transform whose
// expected shape is missing.
export function applyTransforms(spec: ComponentSpec, sources: Map<string, string>): Map<string, string> {
  for (const file of spec.files) {
    if (!sources.has(file)) throw new Error(`${spec.name}: no source for ${file}`)
  }
  const project = tsxProject()
  const tsxFiles = new Map<string, SourceFile>()
  const cssRoots = new Map<string, Root>()
  for (const [file, text] of sources) {
    if (file.endsWith('.tsx')) tsxFiles.set(file, project.createSourceFile(`/${file}`, text))
    else if (file.endsWith('.css')) cssRoots.set(file, postcss.parse(text, { from: file }))
    else throw new Error(`${spec.name}: no parser for ${file}`)
  }
  for (const transform of spec.transforms) {
    try {
      if (transform.kind === 'tsx') {
        const target = tsxFiles.get(transform.file)
        if (!target) throw new Error(`no ${transform.file} to change`)
        for (const created of transform.creates ?? []) {
          if (sources.has(created) || project.getSourceFile(`/${created}`)) throw new Error(`${created} already exists`)
        }
        transform.apply(target)
        for (const created of transform.creates ?? []) {
          if (!project.getSourceFile(`/${created}`)) throw new Error(`it did not create ${created}`)
        }
      } else {
        const target = cssRoots.get(transform.file)
        if (!target) throw new Error(`no ${transform.file} to change`)
        transform.apply(target)
      }
    } catch (error) {
      throw new TransformError(spec.name, transform.id, error)
    }
  }
  const output = new Map<string, string>()
  for (const file of spec.files) {
    output.set(file, tsxFiles.get(file)?.getFullText() ?? cssRoots.get(file)!.toString())
  }
  for (const [file] of createdFiles(spec)) output.set(file, project.getSourceFileOrThrow(`/${file}`).getFullText())
  return output
}
