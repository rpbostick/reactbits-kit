import { componentBody } from '../../ast/component.ts'
import { addMember, insertStatements } from '../../ast/edit.ts'
import { assignmentsTo, exactlyOne } from '../../ast/find.ts'
import { makeLoopPausable } from '../../ast/loop.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '03-paused-prop',
  file: 'Aurora.tsx',
  kind: 'tsx',
  summary: 'A paused prop: draw one more frame and stop; re-renders and resizes draw one frame',
  description: 'A `paused` prop, as in Waves 07-paused-prop: the loop draws one more frame and stops; every re-render and every resize draws one frame.',
  apply(file) {
    // The props are read through propsRef, kept current on every render.
    const body = componentBody(file, 'Aurora')
    const latest = exactlyOne(
      assignmentsTo(body, 'propsRef.current').filter((statement) => statement.getParent() === body),
      'propsRef.current = props in Aurora',
    )
    makeLoopPausable(file, 'update', 'propsRef.current.paused')
    insertStatements(
      body,
      { after: latest },
      'const requestFrameRef = useRef<(() => void) | null>(null);\n\nuseEffect(() => {\n  requestFrameRef.current?.();\n});',
    )

    // Last: this inserts text, which leaves earlier node handles stale.
    addMember(file, 'AuroraProps', {
      name: 'paused',
      type: 'boolean',
      optional: true,
      comment: 'Draws one more frame and stops the loop; every re-render draws one frame.',
    })
  },
}

export default transform
