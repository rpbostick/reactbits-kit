// Structural lookups for transforms. Each finds exactly what it is asked for
// or throws a ShapeError saying what it looked for, so a transform stops with
// a clear message when the upstream file no longer has the shape it expects.
import { Node, SyntaxKind, type Block, type ExpressionStatement, type InterfaceDeclaration, type SourceFile, type Statement, type TypeLiteralNode } from 'ts-morph'

export class ShapeError extends Error {}

// Text with all whitespace removed, so `a . b( c )` compares equal to `a.b(c)`.
export function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

export function exactlyOne<T>(nodes: T[], what: string): T {
  if (nodes.length === 0) throw new ShapeError(`no ${what}`)
  if (nodes.length > 1) throw new ShapeError(`${nodes.length} matches for ${what}, expected one`)
  return nodes[0]
}

export function interfaceNamed(file: SourceFile, name: string): InterfaceDeclaration {
  const found = file.getInterface(name)
  if (!found) throw new ShapeError(`no interface ${name}`)
  return found
}

// The members of the interface `name`, or of `type name = { … }`: some
// components declare their props one way, some the other.
export function objectTypeNamed(file: SourceFile, name: string): InterfaceDeclaration | TypeLiteralNode {
  const declared = file.getInterface(name)
  if (declared) return declared
  const literal = file.getTypeAlias(name)?.getTypeNode()
  if (literal && Node.isTypeLiteral(literal)) return literal
  throw new ShapeError(`no interface or object type ${name}`)
}

// The body of a function called `name` anywhere under `scope`: a function
// declaration, or a variable initialized with an arrow or function expression.
export function functionBody(scope: Node, name: string): Block {
  const candidates: Block[] = []
  for (const declaration of scope.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const body = declaration.getBody()
    if (declaration.getName() === name && body && Node.isBlock(body)) candidates.push(body)
  }
  for (const variable of scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = variable.getInitializer()
    if (variable.getName() !== name || !initializer) continue
    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      const body = initializer.getBody()
      if (Node.isBlock(body)) candidates.push(body)
    }
  }
  return exactlyOne(candidates, `function ${name} with a block body`)
}

// The function a component is: `function Name(…)` or `const Name = (…) => …`.
export function componentFunction(file: SourceFile, name: string) {
  const declaration = file.getFunction(name)
  if (declaration) return declaration
  const variable = file.getVariableDeclaration(name)
  const initializer = variable?.getInitializer()
  if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) return initializer
  throw new ShapeError(`no component function ${name}`)
}

// The body of the `useEffect` callback under `scope` that declares a
// function called `marker`, which tells the effects apart.
export function effectDeclaring(scope: Node, marker: string): Block {
  const bodies: Block[] = []
  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callback = call.getArguments()[0]
    if (call.getExpression().getText() !== 'useEffect' || !callback || !Node.isArrowFunction(callback)) continue
    const body = callback.getBody()
    if (Node.isBlock(body) && body.getStatements().some((statement) => isFunctionNamed(statement, marker))) bodies.push(body)
  }
  return exactlyOne(bodies, `useEffect that declares ${marker}`)
}

function isFunctionNamed(statement: Statement, name: string): boolean {
  if (Node.isFunctionDeclaration(statement)) return statement.getName() === name
  if (Node.isVariableStatement(statement)) return statement.getDeclarations().some((declaration) => declaration.getName() === name)
  return false
}

// A direct statement of `block` whose compacted text satisfies `test`.
export function statementOf(block: Block, what: string, test: (compactText: string, statement: Statement) => boolean): Statement {
  return exactlyOne(
    block.getStatements().filter((statement) => test(compact(statement.getText()), statement)),
    what,
  )
}

// A statement `left = …;` anywhere under `scope`, `left` compared compacted.
export function assignmentsTo(scope: Node, left: string): ExpressionStatement[] {
  return scope.getDescendantsOfKind(SyntaxKind.ExpressionStatement).filter((statement) => {
    const expression = statement.getExpression()
    return (
      Node.isBinaryExpression(expression) &&
      expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
      compact(expression.getLeft().getText()) === compact(left)
    )
  })
}

// The right-hand side of the one `left = …` directly in `block`.
export function assignedValue(block: Block, left: string) {
  const statement = exactlyOne(
    assignmentsTo(block, left).filter((found) => found.getParent() === block),
    `assignment to ${left}`,
  )
  const expression = statement.getExpression()
  if (!Node.isBinaryExpression(expression)) throw new ShapeError(`assignment to ${left} is not a binary expression`)
  return expression.getRight()
}

// The calls under `scope` whose callee is `callee` (compacted) and, when
// given, whose first argument is `firstArgument` (compacted).
export function callsTo(scope: Node, callee: string, firstArgument?: string) {
  return scope.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    if (compact(call.getExpression().getText()) !== compact(callee)) return false
    if (firstArgument === undefined) return true
    const first = call.getArguments()[0]
    return first !== undefined && compact(first.getText()) === compact(firstArgument)
  })
}

// The expression statement directly in `block` that is a call to `callee`
// with `firstArgument`.
export function callStatement(block: Block, callee: string, firstArgument?: string): ExpressionStatement {
  const statements = block.getStatements().filter((statement): statement is ExpressionStatement => {
    if (!Node.isExpressionStatement(statement)) return false
    const expression = statement.getExpression()
    return Node.isCallExpression(expression) && callsTo(statement, callee, firstArgument).includes(expression)
  })
  return exactlyOne(statements, `call ${callee}(${firstArgument ?? '…'})`)
}

// The body of the cleanup function an effect returns.
export function cleanupBody(effect: Block): Block {
  const returned = exactlyOne(
    effect
      .getStatements()
      .filter(Node.isReturnStatement)
      .map((statement) => statement.getExpression())
      .filter((expression) => expression !== undefined && Node.isArrowFunction(expression)),
    'cleanup function returned by the effect',
  )
  const body = Node.isArrowFunction(returned) ? returned.getBody() : undefined
  if (!body || !Node.isBlock(body)) throw new ShapeError('the cleanup function has no block body')
  return body
}

// The statement directly in `block` that assigns `requestAnimationFrame(…)`
// to something, e.g. `frameIdRef.current = requestAnimationFrame(tick)`.
export function frameRequest(block: Block): ExpressionStatement {
  return exactlyOne(
    block.getStatements().filter((statement): statement is ExpressionStatement => {
      if (!Node.isExpressionStatement(statement)) return false
      const expression = statement.getExpression()
      if (!Node.isBinaryExpression(expression) || expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return false
      const right = expression.getRight()
      return Node.isCallExpression(right) && right.getExpression().getText() === 'requestAnimationFrame'
    }),
    'assignment of requestAnimationFrame(…)',
  )
}

// The left and right sides of an assignment statement.
export function assignmentSides(statement: ExpressionStatement) {
  const expression = statement.getExpression()
  if (!Node.isBinaryExpression(expression)) throw new ShapeError(`${statement.getText()} is not an assignment`)
  return { left: expression.getLeft(), right: expression.getRight() }
}

// The variable declaration `name` under `scope`.
export function variableNamed(scope: Node, name: string) {
  return exactlyOne(
    scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((declaration) => declaration.getName() === name),
    `variable ${name}`,
  )
}

// The object destructuring under `scope` whose initializer is `source` (compacted).
export function destructuringOf(scope: Node, source: string) {
  const declarations = scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((declaration) => {
    const initializer = declaration.getInitializer()
    return Node.isObjectBindingPattern(declaration.getNameNode()) && initializer !== undefined && compact(initializer.getText()) === compact(source)
  })
  return exactlyOne(declarations, `destructuring of ${source}`)
}
