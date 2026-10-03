import { SyntaxKind } from 'ts-morph'
import { addDestructuredProp, addSyncedRef } from '../../ast/component.ts'
import { addMember, insertStatements } from '../../ast/edit.ts'
import { compact, exactlyOne, frameRequest, functionBody, interfaceNamed, ShapeError } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '08-pointer-getter',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'A pointer prop: a per-frame getter that replaces the mousemove/touchmove listeners',
  description:
    "A `pointer` prop, a getter called once per frame in `tick` that returns the pointer in client coordinates or null. When it is given, the `mousemove`/`touchmove` listeners of 03-intersection-observer are not attached and the waves follow only what the getter returns; a null resets the mouse's `set` flag, so the ripples settle as when the pointer leaves and the next pointer starts where it is instead of jumping from the last one.",
  apply(file) {
    if (!interfaceNamed(file, 'Mouse').getProperty('set')) throw new ShapeError('interface Mouse has no set flag')
    functionBody(file, 'updateMouse')
    // 03-intersection-observer's start(), which attaches the listeners.
    const start = functionBody(file, 'start')

    const tick = functionBody(file, 'tick')
    const mouse = exactlyOne(
      tick.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((declaration) => compact(declaration.getInitializer()?.getText() ?? '') === 'mouseRef.current'),
      'variable read from mouseRef.current in tick',
    )
    const name = mouse.getName()
    insertStatements(
      tick,
      { after: mouse.getVariableStatementOrThrow() },
      `if (pointerRef.current) {\n  const point = pointerRef.current();\n  // The next pointer starts afresh where it is, not with a jump from here.\n  if (point) updateMouse(point.x, point.y);\n  else ${name}.set = false;\n}`,
    )
    insertStatements(start, { after: frameRequest(start) }, 'if (pointerRef.current) return;')

    // Last: these insert text, which leaves earlier node handles stale.
    addMember(file, 'WavesProps', {
      name: 'pointer',
      type: '() => { x: number; y: number } | null',
      optional: true,
      before: 'backgroundColor',
      comment:
        'Replaces the mousemove/touchmove listeners: called once per frame, it\nreturns the pointer in client coordinates, or null when there is none to\nfollow, which settles the ripples as when the pointer leaves.',
    })
    addDestructuredProp(file, 'Waves', 'pointer', 'style')
    addSyncedRef(file, 'Waves', 'pointerRef', 'pointer')
  },
}

export default transform
