// Compares what rbx builds with hand-customized copies of the same components
// (a directory of <Component>/<Component>.tsx and .css, and any file a
// transform adds, such as Waves/noise.ts), on structure rather than text: each
// interface's members, top-level constants, and for every named function and
// class method its parameters and the calls it makes. Used when moving a
// project's own copies onto the kit, to show that the transforms reproduce
// them. Exits 1 on any difference.
//
// Run: node scripts/compare-copies.ts <copies dir> [--profile <site|sheet>] [--source <react-bits checkout>]
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Node, Project, SyntaxKind, type ParameterDeclaration, type SourceFile } from 'ts-morph'
import { compact } from '../src/ast/find.ts'
import { buildComponent, CHANGES_FILE } from '../src/build.ts'
import { DEFAULT_PROFILE, isProfile, PROFILES } from '../src/transform.ts'
import { COMPONENTS } from '../src/transforms/index.ts'
import { PINNED_COMMIT } from '../src/upstream.ts'

type Fingerprint = Map<string, string>

function fingerprint(text: string): Fingerprint {
  const file: SourceFile = new Project({ useInMemoryFileSystem: true }).createSourceFile('/component.tsx', text)
  const entries: Fingerprint = new Map()
  for (const declaration of file.getInterfaces()) {
    for (const property of declaration.getProperties()) {
      entries.set(`${declaration.getName()}.${property.getName()}${property.hasQuestionToken() ? '?' : ''}`, compact(property.getTypeNode()?.getText() ?? ''))
    }
  }
  for (const statement of file.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer()
      if (initializer && !Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) {
        entries.set(`const ${declaration.getName()}`, compact(initializer.getText()))
      }
    }
  }
  const functionLike = (node: Node): node is Node & { getParameters(): ParameterDeclaration[] } => 'getParameters' in node
  // A destructured parameter as the set of props it takes: their order is not behaviour.
  const parameterText = (parameter: ParameterDeclaration) => {
    const pattern = parameter.getNameNode()
    if (!Node.isObjectBindingPattern(pattern)) return compact(parameter.getText())
    return `{${pattern
      .getElements()
      .map((element) => compact(element.getText()))
      .sort()
      .join(',')}}${compact(parameter.getTypeNode()?.getText() ?? '')}`
  }
  const named: [string, Node][] = [
    ...file.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).map((declaration): [string, Node] => [declaration.getName() ?? '(anonymous)', declaration]),
    ...file
      .getDescendantsOfKind(SyntaxKind.MethodDeclaration)
      .map((declaration): [string, Node] => [`${declaration.getParentIfKind(SyntaxKind.ClassDeclaration)?.getName() ?? '?'}.${declaration.getName()}`, declaration]),
    ...file
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .flatMap((declaration): [string, Node][] => {
        const initializer = declaration.getInitializer()
        return initializer !== undefined && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) ? [[declaration.getName(), initializer]] : []
      }),
  ]
  for (const [name, node] of named) {
    const parameters = functionLike(node) ? node.getParameters().map(parameterText).join(',') : ''
    const calls = new Set(node.getDescendantsOfKind(SyntaxKind.CallExpression).map((call) => compact(call.getExpression().getText())))
    entries.set(`${name}(${parameters})`, [...calls].sort().join(' '))
  }
  return entries
}

function differences(label: string, ours: Fingerprint, theirs: Fingerprint): string[] {
  const found: string[] = []
  for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
    if (ours.get(key) !== theirs.get(key)) found.push(`${label} ${key}\n    rbx:  ${ours.get(key) ?? '(none)'}\n    copy: ${theirs.get(key) ?? '(none)'}`)
  }
  return found
}

const { values, positionals } = parseArgs({ options: { source: { type: 'string' }, profile: { type: 'string' } }, allowPositionals: true })
const profile = values.profile ?? DEFAULT_PROFILE
if (positionals.length !== 1 || !isProfile(profile)) {
  console.error(`usage: node scripts/compare-copies.ts <copies dir> [--profile <${PROFILES.join('|')}>] [--source <react-bits checkout>]`)
  process.exit(2)
}
const copies = resolve(positionals[0])
const problems: string[] = []
let compared = 0
for (const spec of Object.values(COMPONENTS)) {
  if (!existsSync(join(copies, spec.name))) continue
  compared++
  const built = await buildComponent(spec, profile, { commit: PINNED_COMMIT, checkout: values.source && resolve(values.source) })
  for (const [file, text] of built) {
    if (file === CHANGES_FILE) continue
    const path = join(copies, spec.name, file)
    if (!existsSync(path)) {
      problems.push(`${spec.name}/${file} is not in the copies`)
      continue
    }
    const copy = readFileSync(path, 'utf8')
    if (/\.tsx?$/.test(file)) problems.push(...differences(`${spec.name}/${file}`, fingerprint(text), fingerprint(copy)))
    else if (compact(text) !== compact(copy)) problems.push(`${spec.name}/${file} differs`)
  }
}
if (compared === 0) {
  console.error(`no component folders (${Object.keys(COMPONENTS).join(', ')}) in ${copies}`)
  process.exit(1)
}
for (const problem of problems) console.log(problem)
console.log(problems.length === 0 ? `${compared} components match on props and calls` : `${problems.length} differences`)
process.exit(problems.length === 0 ? 0 : 1)
