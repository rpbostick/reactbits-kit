import { SyntaxKind } from 'ts-morph'
import { insertStatements } from '../../ast/edit.ts'
import { assignmentsTo, effectDeclaring, exactlyOne, functionBody, ShapeError } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const UNIFORM = 'program.uniforms.uTime.value'

const transform: TsxTransform = {
  id: '01-accumulated-clock',
  file: 'Iridescence.tsx',
  kind: 'tsx',
  summary: 'The shader clock is accumulated per frame at the same rate, so a pause resumes in place',
  description:
    'The clock is accumulated each frame (a frame counted as at most 100 ms) instead of read from the `requestAnimationFrame` timestamp, so resuming after a pause continues where it stopped. The rate is the same.',
  apply(file) {
    const update = functionBody(file, 'update')
    const declaration = update.getParentIfKindOrThrow(SyntaxKind.FunctionDeclaration)
    const frameTime = declaration.getParameters()[0]?.getName()
    if (!frameTime) throw new ShapeError('update takes no frame time')
    const statement = exactlyOne(
      assignmentsTo(update, UNIFORM).filter((found) => found.getParent() === update),
      `assignment to ${UNIFORM} in update`,
    )
    const value = statement.getExpressionIfKindOrThrow(SyntaxKind.BinaryExpression).getRight()
    // The upstream clock is the frame time in seconds; the accumulated one keeps that rate.
    if (!value.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => identifier.getText() === frameTime)) {
      throw new ShapeError(`${UNIFORM} is not set from the frame time ${frameTime}`)
    }
    value.replaceWithText('clock.value')
    insertStatements(
      update,
      { before: statement },
      `const frameMs = clock.last === null ? 0 : Math.min(100, Math.max(0, ${frameTime} - clock.last));\nclock.last = ${frameTime};\nclock.value += frameMs * 0.001;`,
    )
    insertStatements(
      effectDeclaring(file, 'update'),
      { before: declaration },
      'const clock = { value: 0, last: null as number | null };',
      'The clock is accumulated frame by frame (a frame counted as at most\n100 ms), so resuming after a pause continues where it stopped.',
    )
  },
}

export default transform
