// The `params` change shared by the WebGL backgrounds that take colours as
// props: a getter called once per frame whose fields override the matching
// props, read through a ref the component keeps current on every render, so
// a colour that changes every frame needs no re-render and, once the props
// leave the effect's dependencies, no new WebGL context.
import { Node, SyntaxKind, type Block, type SourceFile } from 'ts-morph'
import { addDestructuredProp, componentBody } from './component.ts'
import { addMember, insertStatements } from './edit.ts'
import { callStatement, exactlyOne, objectTypeNamed, ShapeError } from './find.ts'

// How the `params` member is typed: `Partial<Pick<Props, …>>`, or an object
// type spelling out each field with the type the props give it.
type ParamsTypeStyle = 'pick' | 'literal'

// Adds the optional `params` member to the props type and destructures it.
// Its fields must be props already. Leaves earlier node handles stale.
export function addParamsProp(
  file: SourceFile,
  options: { component: string; propsType: string; fields: string[]; style: ParamsTypeStyle; comment: string },
) {
  const props = objectTypeNamed(file, options.propsType)
  const types = options.fields.map((field) => {
    const member = props.getProperty(field)
    if (!member) throw new ShapeError(`${options.propsType} has no ${field}`)
    return `${field}?: ${member.getTypeNodeOrThrow().getText()}`
  })
  const type =
    options.style === 'pick'
      ? `() => Partial<Pick<${options.propsType}, ${options.fields.map((field) => `'${field}'`).join(' | ')}>>`
      : `() => { ${types.join('; ')} }`
  addMember(file, options.propsType, { name: 'params', type, optional: true, comment: options.comment })
  addDestructuredProp(file, options.component, 'params')
}

// `const <ref> = useRef(<value>);` and `<ref>.current = <value>;` after the
// component's first ref, so the effect's loop reads this render's value.
// `value` reads destructured props, e.g. `{ color, params }`.
export function addFrameRef(file: SourceFile, component: string, ref: string, value: string) {
  const body = componentBody(file, component)
  if (body.getDescendantsOfKind(SyntaxKind.VariableDeclaration).some((declaration) => declaration.getName() === ref)) {
    throw new ShapeError(`component ${component} already declares ${ref}`)
  }
  const firstRef = body.getStatements().find((statement) => {
    if (!Node.isVariableStatement(statement)) return false
    return statement.getDeclarations().some((declaration) => {
      const initializer = declaration.getInitializer()
      return initializer !== undefined && Node.isCallExpression(initializer) && initializer.getExpression().getText() === 'useRef'
    })
  })
  if (!firstRef) throw new ShapeError(`component ${component} declares no ref to place ${ref} by`)
  insertStatements(body, { after: firstRef }, `const ${ref} = useRef(${value});\n${ref}.current = ${value};`)
}

// Checks that the uniforms set up under `scope` include `name`, so a write
// to `program.uniforms.<name>` targets a uniform the shader has.
export function requireUniform(scope: Node, name: string) {
  exactlyOne(
    scope.getDescendantsOfKind(SyntaxKind.PropertyAssignment).filter((assignment) => {
      const value = assignment.getInitializer()
      return assignment.getName() === name && value !== undefined && Node.isObjectLiteralExpression(value) && value.getProperty('value') !== undefined
    }),
    `uniform ${name} set up with a value`,
  )
}

// `const <local> = { ...<ref>.current, ...<ref>.current.params?.() };` and
// `writes`, just before the frame's `renderer.render(…)` in `loop`.
export function writeFrameParams(loop: Block, ref: string, local: string, writes: string[]) {
  const render = callStatement(loop, 'renderer.render')
  insertStatements(loop, { before: render }, [`const ${local} = { ...${ref}.current, ...${ref}.current.params?.() };`, ...writes].join('\n'))
}

// The `useEffect` call whose callback body is `effect`.
function effectCall(effect: Block) {
  const callback = effect.getParent()
  const call = callback?.getParent()
  if (!callback || !Node.isArrowFunction(callback) || !call || !Node.isCallExpression(call) || call.getExpression().getText() !== 'useEffect') {
    throw new ShapeError('the block is not the body of a useEffect callback')
  }
  return call
}

// Takes `names` out of the dependency list of the effect whose body is
// `effect`, so a change to those props no longer re-runs it.
export function removeDependencies(effect: Block, names: string[]) {
  const dependencies = effectCall(effect).getArguments()[1]
  if (!dependencies || !Node.isArrayLiteralExpression(dependencies)) throw new ShapeError('the effect has no dependency list')
  for (const name of names) {
    const element = exactlyOne(
      dependencies.getElements().filter((candidate) => candidate.getText() === name),
      `${name} in the effect's dependencies`,
    )
    dependencies.removeElement(element)
  }
}
