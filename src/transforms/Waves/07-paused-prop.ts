import { addDestructuredProp, insertBeforeFirstEffect } from '../../ast/component.ts'
import { addMember, insertStatements } from '../../ast/edit.ts'
import { assignmentSides, cleanupBody, effectDeclaring, frameRequest, functionBody, statementOf, variableNamed } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '07-paused-prop',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'A paused prop: draw one more frame and stop; re-renders and resizes draw one frame',
  description:
    'A `paused` prop. While it is true, the loop draws one more frame and stops; every re-render and every resize draws one frame, and turning it off starts the loop again. The frame after a pause counts as the first, so the pattern does not jump.',
  apply(file) {
    // 03-intersection-observer's start flag and 06-accumulated-clock's phase.
    const runningFlag = () =>
      statementOf(effectDeclaring(file, 'tick'), 'let running = false (03-intersection-observer)', (text) => text === 'letrunning=false;')
    runningFlag()
    variableNamed(effectDeclaring(file, 'tick'), 'phase')

    addMember(file, 'WavesProps', {
      name: 'paused',
      type: 'boolean',
      optional: true,
      before: 'style',
      comment: 'Draws one more frame and stops the loop; every re-render draws one frame.',
    })
    addDestructuredProp(file, 'Waves', 'paused = false', 'style')
    insertBeforeFirstEffect(
      file,
      'Waves',
      'const pausedRef = useRef(paused);\nconst requestFrameRef = useRef<(() => void) | null>(null);\n\nuseEffect(() => {\n  pausedRef.current = paused;\n  requestFrameRef.current?.();\n});',
    )

    const tick = functionBody(file, 'tick')
    const request = frameRequest(tick)
    const { left, right } = assignmentSides(request)
    const frameRef = left.getText()
    const nextFrame = right.getText()
    right.replaceWithText(`pausedRef.current ? null : ${nextFrame}`)
    insertStatements(tick, { after: request }, 'if (pausedRef.current) phase.last = null;', 'The next frame after a pause counts as the first, not as a long one.')

    insertStatements(functionBody(file, 'onResize'), 'end', 'requestFrameRef.current?.();', 'Resizing clears the canvas, which a paused loop would leave blank.')
    const effect = effectDeclaring(file, 'tick')
    insertStatements(
      effect,
      { after: runningFlag() },
      `requestFrameRef.current = () => {\n  if (running && ${frameRef} === null) ${frameRef} = ${nextFrame};\n};`,
    )
    insertStatements(cleanupBody(effect), 'start', 'requestFrameRef.current = null;')
  },
}

export default transform
