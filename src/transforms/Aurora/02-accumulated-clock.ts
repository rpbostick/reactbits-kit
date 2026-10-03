import { Node, SyntaxKind } from 'ts-morph'
import { insertStatements } from '../../ast/edit.ts'
import { assignmentsTo, effectDeclaring, exactlyOne, functionBody, ShapeError } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const UNIFORM = 'program.uniforms.uTime.value'

const transform: TsxTransform = {
  id: '02-accumulated-clock',
  file: 'Aurora.tsx',
  kind: 'tsx',
  summary: 'Without a time prop, the shader clock is accumulated per frame at the same rate',
  description:
    'Without a `time` prop, the shader\'s clock is accumulated each frame (frame time × speed, with a frame counted as at most 100 ms) instead of computed as `t * 0.01 * speed * 0.1`, so a speed change or a pause does not jump the aurora elsewhere. The rate is the same.',
  apply(file) {
    const update = functionBody(file, 'update')
    const loop = update.getParentOrThrow()
    if (!Node.isArrowFunction(loop) && !Node.isFunctionExpression(loop)) throw new ShapeError('update is not a function expression')
    const frameTime = loop.getParameters()[0]?.getName()
    if (!frameTime) throw new ShapeError('update takes no frame time')

    // `const { time = …, speed = … } = <props>`: the time default goes, the
    // clock takes its place.
    const time = exactlyOne(
      update.getDescendantsOfKind(SyntaxKind.BindingElement).filter((element) => element.getName() === 'time'),
      'time read in update',
    )
    const pattern = time.getParentIfKindOrThrow(SyntaxKind.ObjectBindingPattern)
    const others = pattern.getElements().filter((element) => element !== time)
    if (!others.some((element) => element.getName() === 'speed')) throw new ShapeError('update does not read speed with time')
    const declaration = pattern.getParentIfKindOrThrow(SyntaxKind.VariableDeclaration)
    const source = declaration.getInitializerOrThrow().getText()
    const index = declaration.getVariableStatementOrThrow().getChildIndex()

    const uniform = () => exactlyOne(assignmentsTo(update, UNIFORM), `assignment to ${UNIFORM}`)
    const timeReads = uniform()
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter((identifier) => identifier.getText() === 'time')
    if (timeReads.length === 0) throw new ShapeError(`${UNIFORM} is not set from time`)
    for (const read of timeReads.reverse()) read.replaceWithText(`${source}.time`)
    const value = uniform().getExpressionIfKindOrThrow(SyntaxKind.BinaryExpression).getRight()
    value.replaceWithText(`${source}.time === undefined ? clock.value : ${value.getText()}`)

    pattern.replaceWithText(`{ ${others.map((element) => element.getText()).join(', ')} }`)
    insertStatements(
      update,
      { after: update.getStatements()[index] },
      `const frameMs = clock.last === null ? 0 : Math.min(100, Math.max(0, ${frameTime} - clock.last));\nclock.last = ${frameTime};\nclock.value += frameMs * 0.001 * speed;`,
    )
    const effect = effectDeclaring(file, 'update')
    const loopStatement = functionBody(file, 'update').getFirstAncestor((ancestor) => ancestor.getParent() === effect)
    if (!loopStatement || !Node.isStatement(loopStatement)) throw new ShapeError('update is not declared directly in its effect')
    insertStatements(
      effect,
      { before: loopStatement },
      'const clock = { value: 0, last: null as number | null };',
      'Without a `time` prop the clock is accumulated frame by frame (a frame\ncounted as at most 100 ms), so a speed change or a pause does not jump\nthe aurora elsewhere.',
    )
  },
}

export default transform
