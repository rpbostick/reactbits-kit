import { Node, SyntaxKind } from 'ts-morph'
import { callStatement, effectDeclaring, functionBody, ShapeError, statementOf, variableNamed } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '11-container-pointer-listeners',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'mousemove is heard on the container, not the window; touchmove goes',
  description:
    "The `mousemove` listener of 03-intersection-observer is on the component's container instead of the window, like the other backgrounds', so it hears only the moves the page hands it (a drag on bare background); the window `touchmove` listener is gone, since a finger's drag reaches the container as those moves too.",
  apply(file) {
    const effect = effectDeclaring(file, 'tick')
    variableNamed(effect, 'container')
    // 03-intersection-observer's start() and stop().
    const start = functionBody(effect, 'start')
    const stop = functionBody(effect, 'stop')
    const touchHandler = statementOf(effect, 'function onTouchMove', (_text, statement) => Node.isFunctionDeclaration(statement) && statement.getName() === 'onTouchMove')

    callStatement(start, 'window.addEventListener', "'touchmove'").remove()
    callStatement(stop, 'window.removeEventListener', "'touchmove'").remove()
    touchHandler.remove()
    if (effect.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => identifier.getText() === 'onTouchMove')) {
      throw new ShapeError('onTouchMove is used outside start() and stop()')
    }
    for (const [block, method] of [
      [start, 'addEventListener'],
      [stop, 'removeEventListener'],
    ] as const) {
      const call = callStatement(block, `window.${method}`, "'mousemove'").getExpressionIfKindOrThrow(SyntaxKind.CallExpression)
      // Optional: TypeScript does not carry the effect's null check into start() and stop().
      call.getExpression().replaceWithText(`container?.${method}`)
    }
  },
}

export default transform
