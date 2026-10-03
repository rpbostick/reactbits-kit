import { addDestructuredProp, insertBeforeFirstEffect } from '../../ast/component.ts'
import { addMember } from '../../ast/edit.ts'
import { makeLoopPausable } from '../../ast/loop.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '02-paused-prop',
  file: 'Iridescence.tsx',
  kind: 'tsx',
  summary: 'A paused prop: draw one more frame and stop; re-renders and resizes draw one frame',
  description: 'A `paused` prop, as in Waves 07-paused-prop: the loop draws one more frame and stops; every re-render and every resize draws one frame.',
  apply(file) {
    makeLoopPausable(file, 'update', 'pausedRef.current')
    insertBeforeFirstEffect(
      file,
      'Iridescence',
      'const pausedRef = useRef(paused);\nconst requestFrameRef = useRef<(() => void) | null>(null);\n\nuseEffect(() => {\n  pausedRef.current = paused;\n  requestFrameRef.current?.();\n});',
    )

    // Last: these insert text, which leaves earlier node handles stale.
    addMember(file, 'IridescenceProps', {
      name: 'paused',
      type: 'boolean',
      optional: true,
      comment: 'Draws one more frame and stops the loop; every re-render draws one frame.',
    })
    addDestructuredProp(file, 'Iridescence', 'paused = false')
  },
}

export default transform
