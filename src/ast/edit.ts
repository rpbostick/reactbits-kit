// Edits that keep the upstream file's own layout: list items go in on their
// own line when the list is one item per line and inline otherwise, and
// comments go above what they describe. Every edit is an insertion or a
// replacement of one node, so the result differs from upstream only where a
// change says it should.
import { Node, type Block, type InterfaceDeclaration, type SourceFile, type Statement, type TypeLiteralNode } from 'ts-morph'
import { objectTypeNamed, ShapeError } from './find.ts'

// Whether `node` starts its own line, i.e. its list is laid out one per line.
function startsLine(node: Node): boolean {
  const text = node.getSourceFile().getFullText()
  return text.slice(node.getStartLinePos(), node.getStart()).trim() === ''
}

function separator(node: Node): string {
  return startsLine(node) ? `\n${node.getIndentationText()}` : ' '
}

// Inserts `text` as a new item after `node` in a comma-separated list
// (parameters, binding elements, object properties, array elements).
export function insertItemAfter(node: Node, text: string) {
  node.getSourceFile().insertText(node.getEnd(), `,${separator(node)}${text}`)
}

export function insertItemBefore(node: Node, text: string) {
  node.getSourceFile().insertText(node.getStart(), `${text},${separator(node)}`)
}

function commentLines(comment: string | undefined, indentation: string): string {
  if (!comment) return ''
  return comment
    .split('\n')
    .map((line) => `${indentation}// ${line}\n`)
    .join('')
}

function memberNamed(target: InterfaceDeclaration | TypeLiteralNode, typeName: string, name: string) {
  const anchor = target.getProperty(name)
  if (!anchor) throw new ShapeError(`${typeName} has no ${name}`)
  return anchor
}

// Where a member starts, its leading `//` comments included.
function startWithComments(node: Node): number {
  const comments = node.getLeadingCommentRanges()
  return comments.length > 0 ? comments[0].getPos() : node.getStart()
}

// Adds an optional or required member to an interface (or an object type
// alias), after the member `after` or before the member `before` (and its
// comments) when given, else at the end. Inserted as text: ts-morph's own
// member insertion splits a neighbour's multi-line `//` comment. Leaves
// earlier node handles stale.
export function addMember(
  file: SourceFile,
  typeName: string,
  member: { name: string; type: string; optional?: boolean; comment?: string; after?: string; before?: string },
) {
  const target = objectTypeNamed(file, typeName)
  if (target.getProperty(member.name)) throw new ShapeError(`${typeName} already has ${member.name}`)
  const members = target.getMembers()
  if (members.length === 0) throw new ShapeError(`${typeName} has no members to place ${member.name} by`)
  const indentation = members[0].getIndentationText()
  const comment = commentLines(member.comment, indentation)
  const declaration = `${member.name}${member.optional ? '?' : ''}: ${member.type};`
  if (member.before !== undefined) {
    const anchor = memberNamed(target, typeName, member.before)
    // The anchor's line already carries the indentation for what goes first.
    const text = comment ? `${comment.trimStart()}${indentation}${declaration}` : declaration
    file.insertText(startWithComments(anchor), `${text}\n${indentation}`)
  } else {
    const anchor = member.after !== undefined ? memberNamed(target, typeName, member.after) : members[members.length - 1]
    file.insertText(anchor.getEnd(), `\n${comment}${indentation}${declaration}`)
  }
}

// Puts `//` comment lines above `node`, at its indentation. Inserting text
// leaves earlier node handles stale, so callers look nodes up again after.
export function addCommentBefore(node: Node, comment: string) {
  const indentation = node.getIndentationText()
  const lines = comment.split('\n').map((line) => `// ${line}\n${indentation}`)
  node.getSourceFile().insertText(node.getStart(), lines.join(''))
}

// Changes the type of an interface member, which must currently be `from`.
export function retypeMember(target: InterfaceDeclaration, name: string, from: string, to: string) {
  const member = target.getProperty(name)
  if (!member) throw new ShapeError(`interface ${target.getName()} has no ${name}`)
  const current = member.getTypeNode()?.getText()
  if (current !== from) throw new ShapeError(`${target.getName()}.${name} is ${current}, expected ${from}`)
  member.setType(to)
}

// Inserts top-level code (types, constants) just before `anchor`, with a
// blank line between. Leaves earlier node handles stale.
export function insertBeforeStatement(file: SourceFile, anchor: Statement, text: string) {
  file.insertText(anchor.getStartLinePos(true), `${text}\n\n`)
}

export function insertAfterStatement(file: SourceFile, anchor: Statement, text: string) {
  file.insertText(anchor.getEnd(), `\n\n${text}`)
}

// Inserts statements into `block` before or after one of its statements,
// or at its start or end, with an optional `//` comment above them.
export function insertStatements(
  block: Block,
  where: { before: Statement } | { after: Statement } | 'start' | 'end',
  code: string,
  comment?: string,
) {
  let index: number
  if (where === 'start') index = 0
  else if (where === 'end') index = block.getStatements().length
  else if ('before' in where) index = where.before.getChildIndex()
  else index = where.after.getChildIndex() + 1
  block.insertStatements(index, `${commentLines(comment, '')}${code}`)
}

// A statement's text with its own indentation taken off every line, so it
// can be moved into a block at another depth.
export function movableText(node: Node): string {
  const indentation = node.getIndentationText()
  return node
    .getText()
    .split('\n')
    .map((line, index) => (index > 0 && line.startsWith(indentation) ? line.slice(indentation.length) : line))
    .join('\n')
}

// Indents every line after the first by `indentation`, for nesting moved
// text inside new code.
export function nested(text: string, indentation = '  '): string {
  return text.split('\n').join(`\n${indentation}`)
}

// Appends ` + extra` (or another operator) to an expression, keeping it intact.
export function extendExpression(expression: Node, suffix: string) {
  expression.replaceWithText(`${expression.getText()}${suffix}`)
}
