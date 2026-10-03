// A component as a project gets it: the upstream files at a commit with our
// transforms applied, plus a CHANGES.md that lists the changes in our words
// and carries React Bits' licence, which its MIT terms require with copies.
import { readFileSync } from 'node:fs'
import { applyTransforms, createdFiles, forProfile, type ComponentSpec, type Profile } from './transform.ts'
import { readUpstreamFile, UPSTREAM_URL, type UpstreamSource } from './upstream.ts'

export const CHANGES_FILE = 'CHANGES.md'

const KIT_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

// `spec` is already narrowed to `profile`'s transforms.
export function renderChanges(spec: ComponentSpec, profile: Profile, commit: string, license: string): string {
  const files = spec.files.map((file) => `\`${file}\``).join(' and ')
  const unchanged = spec.files.filter((file) => !spec.transforms.some((transform) => transform.file === file))
  const created = createdFiles(spec).map(([file, transform]) => `\`${file}\` is code moved out of \`${transform.file}\` by ${transform.id}.`)
  const lines = [
    `# ${spec.name}: changes from React Bits`,
    '',
    `${files} are React Bits' \`${spec.upstreamDir}/\` (${UPSTREAM_URL}) at commit \`${commit}\`, with the changes below (profile \`${profile}\`) applied by reactbits-kit ${KIT_VERSION}. \`rbx update\` re-applies them; \`rbx check\` reports any edit since.`,
    '',
    ...(unchanged.length > 0 ? [`${unchanged.map((file) => `\`${file}\``).join(' and ')} ${unchanged.length > 1 ? 'are' : 'is'} unchanged.`, ''] : []),
    ...(created.length > 0 ? [created.join(' '), ''] : []),
    '## Changes',
    '',
    ...spec.transforms.map((transform, index) => `${index + 1}. **${transform.id}** (\`${transform.file}\`): ${transform.description}`),
    '',
    '## License',
    '',
    "React Bits' `LICENSE.md` at that commit, verbatim:",
    '',
    '---',
    '',
    license.trimEnd(),
    '',
  ]
  return lines.join('\n')
}

// File name → content, for `<dir>/<Component>/`, with `profile`'s changes.
export async function buildComponent(component: ComponentSpec, profile: Profile, source: UpstreamSource): Promise<Map<string, string>> {
  const spec = forProfile(component, profile)
  const sources = new Map<string, string>()
  for (const file of spec.files) sources.set(file, await readUpstreamFile(source, `${spec.upstreamDir}/${file}`))
  const output = applyTransforms(spec, sources)
  output.set(CHANGES_FILE, renderChanges(spec, profile, source.commit, await readUpstreamFile(source, 'LICENSE.md')))
  return output
}
