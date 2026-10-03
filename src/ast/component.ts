// Edits to a React function component: its destructured props and the refs
// that hand a prop to a long-lived effect without re-running it.
import { Node, SyntaxKind, type Block, type SourceFile } from 'ts-morph'
import { componentFunction, exactlyOne, ShapeError } from './find.ts'
import { insertItemAfter, insertItemBefore } from './edit.ts'

export function componentBody(file: SourceFile, name: string): Block {
  const body = componentFunction(file, name).getBody()
  if (!body || !Node.isBlock(body)) throw new ShapeError(`component ${name} has no block body`)
  return body
}

// The object pattern the component destructures its props with.
function propsPattern(file: SourceFile, name: string) {
  const parameter = componentFunction(file, name).getParameters()[0]
  const pattern = parameter?.getNameNode()
  if (!pattern || !Node.isObjectBindingPattern(pattern)) throw new ShapeError(`component ${name} does not destructure its props`)
  return pattern
}

// Adds `text` (e.g. `paused = false`) to the destructured props, before the
// prop `before` when given, else before a `...rest` element, else last.
export function addDestructuredProp(file: SourceFile, name: string, text: string, before?: string) {
  const elements = propsPattern(file, name).getElements()
  const propName = text.split('=')[0].trim()
  if (elements.some((element) => element.getName() === propName)) throw new ShapeError(`${name} already destructures ${propName}`)
  if (before !== undefined) {
    const anchor = exactlyOne(elements.filter((element) => element.getName() === before), `destructured prop ${before}`)
    insertItemBefore(anchor, text)
    return
  }
  const rest = elements.find((element) => element.getDotDotDotToken() !== undefined)
  if (rest) insertItemBefore(rest, text)
  else insertItemAfter(elements[elements.length - 1], text)
}

// The binding element `prop` of the destructured props.
export function destructuredProp(file: SourceFile, name: string, prop: string) {
  return exactlyOne(
    propsPattern(file, name)
      .getElements()
      .filter((element) => element.getName() === prop),
    `destructured prop ${prop}`,
  )
}

// Inserts `code` just before the component's first top-level useEffect.
export function insertBeforeFirstEffect(file: SourceFile, name: string, code: string) {
  const body = componentBody(file, name)
  const first = body.getStatements().find((statement) => {
    if (!Node.isExpressionStatement(statement)) return false
    const expression = statement.getExpression()
    return Node.isCallExpression(expression) && expression.getExpression().getText() === 'useEffect'
  })
  if (!first) throw new ShapeError(`component ${name} has no top-level useEffect`)
  body.insertStatements(first.getChildIndex(), code)
}

// `const <ref> = useRef(<value>)`, kept current by an effect, so a loop set
// up once can call the latest getter without re-running its effect.
export function addSyncedRef(file: SourceFile, name: string, ref: string, value: string) {
  if (componentBody(file, name).getDescendantsOfKind(SyntaxKind.VariableDeclaration).some((declaration) => declaration.getName() === ref)) {
    throw new ShapeError(`component ${name} already declares ${ref}`)
  }
  insertBeforeFirstEffect(file, name, `const ${ref} = useRef(${value});\n\nuseEffect(() => {\n  ${ref}.current = ${value};\n}, [${value}]);`)
}
