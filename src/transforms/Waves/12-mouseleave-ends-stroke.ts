import { Node } from 'ts-morph'
import { insertStatements } from '../../ast/edit.ts'
import { callStatement, effectDeclaring, functionBody, interfaceNamed, ShapeError, statementOf } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '12-mouseleave-ends-stroke',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'A mouseleave on the container clears mouse.set, ending the stroke',
  description:
    'A `mouseleave` on the container clears `mouse.set`, so the next move starts from where the pointer comes back instead of one long stroke from where it left. Needs 11-container-pointer-listeners.',
  apply(file) {
    if (!interfaceNamed(file, 'Mouse').getProperty('set')) throw new ShapeError('interface Mouse has no set flag')
    const effect = effectDeclaring(file, 'tick')
    const start = functionBody(effect, 'start')
    const stop = functionBody(effect, 'stop')
    insertStatements(start, { after: callStatement(start, 'container?.addEventListener', "'mousemove'") }, "container?.addEventListener('mouseleave', onMouseLeave);")
    insertStatements(stop, { after: callStatement(stop, 'container?.removeEventListener', "'mousemove'") }, "container?.removeEventListener('mouseleave', onMouseLeave);")
    const onMove = statementOf(effect, 'function onMouseMove', (_text, statement) => Node.isFunctionDeclaration(statement) && statement.getName() === 'onMouseMove')
    insertStatements(
      effect,
      { after: onMove },
      'function onMouseLeave() {\n  mouseRef.current.set = false;\n}',
      'The next move starts afresh where the pointer comes back, instead of one long\nstroke from where it left, which would swirl every line along the way.',
    )
  },
}

export default transform
