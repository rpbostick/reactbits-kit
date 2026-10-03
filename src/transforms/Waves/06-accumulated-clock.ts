import { Node, SyntaxKind } from 'ts-morph'
import { insertStatements } from '../../ast/edit.ts'
import { effectDeclaring, exactlyOne, functionBody, ShapeError, statementOf } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '06-accumulated-clock',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'The noise offset is accumulated per frame, so a speed change does not jump the pattern',
  description:
    'The noise offset is accumulated each frame (frame time × speed, with a frame counted as at most 100 ms) instead of computed as `time * waveSpeedX` and `time * waveSpeedY`, so changing the speed changes how fast the pattern flows rather than jumping it elsewhere in the noise.',
  apply(file) {
    const effect = effectDeclaring(file, 'tick')
    const move = functionBody(file, 'movePoints')
    const declaration = move.getParentIfKindOrThrow(SyntaxKind.FunctionDeclaration)
    const time = declaration.getParameters()[0]?.getName()
    if (!time) throw new ShapeError('movePoints takes no time parameter')

    // `time * waveSpeedX` and `time * waveSpeedY` become the accumulated phase.
    for (const [speed, phase] of [
      ['waveSpeedX', 'phase.x'],
      ['waveSpeedY', 'phase.y'],
    ]) {
      const product = exactlyOne(
        move.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((expression) => {
          const operands = [expression.getLeft().getText(), expression.getRight().getText()]
          return expression.getOperatorToken().getKind() === SyntaxKind.AsteriskToken && operands.includes(time) && operands.includes(speed)
        }),
        `${time} * ${speed} in movePoints`,
      )
      product.replaceWithText(phase)
    }

    const speeds = statementOf(move, 'destructuring of waveSpeedX in movePoints', (_, statement) => {
      if (!Node.isVariableStatement(statement)) return false
      return statement.getDeclarations().some((variable) => {
        const pattern = variable.getNameNode()
        return Node.isObjectBindingPattern(pattern) && pattern.getElements().some((element) => element.getName() === 'waveSpeedX')
      })
    })
    insertStatements(
      move,
      { after: speeds },
      `const frameMs = phase.last === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, ${time} - phase.last));\nphase.last = ${time};\nphase.x += frameMs * waveSpeedX;\nphase.y += frameMs * waveSpeedY;`,
    )
    insertStatements(
      effect,
      { before: declaration },
      'const phase = { x: 0, y: 0, last: null as number | null };\n// A longer gap (a paused, off-screen loop) counts as this long.\nconst MAX_FRAME_MS = 100;',
      'The noise offset is accumulated frame by frame rather than computed as\ntime × speed, so a speed change alters how fast the pattern flows from\nhere on instead of jumping it to a different place in the noise.',
    )
  },
}

export default transform
