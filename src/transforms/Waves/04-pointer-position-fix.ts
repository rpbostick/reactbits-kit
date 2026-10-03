import { SyntaxKind } from 'ts-morph'
import { addCommentBefore, insertStatements } from '../../ast/edit.ts'
import { compact, effectDeclaring, exactlyOne, functionBody, variableNamed } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '04-pointer-position-fix',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'updateMouse reads the container rect on each move, not the one cached on resize',
  description:
    "`updateMouse` reads the container's `getBoundingClientRect()` on each move instead of the `left`/`top` cached on resize, which went stale once the page scrolled and put the ripples off the pointer.",
  apply(file) {
    variableNamed(effectDeclaring(file, 'tick'), 'container')
    const body = functionBody(file, 'updateMouse')
    const cached = exactlyOne(
      body
        .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
        .filter((declaration) => compact(declaration.getInitializer()?.getText() ?? '') === 'boundingRef.current'),
      'variable read from boundingRef.current in updateMouse',
    )
    cached.setInitializer('container.getBoundingClientRect()')
    // A function declaration does not see the effect's narrowing of container.
    insertStatements(body, 'start', 'if (!container) return;')
    addCommentBefore(
      cached.getVariableStatementOrThrow(),
      'Read the rect here rather than the one cached on resize: the cached\nleft/top go stale as soon as the page scrolls.',
    )
  },
}

export default transform
