// The `paused` change shared by the WebGL backgrounds, whose effect runs a
// `requestAnimationFrame` loop in a function (`update`) and cancels it in the
// cleanup. Paused, the loop draws the frame it is in and does not ask for
// another; `requestFrameRef.current()` asks for one frame (re-renders and
// resizes call it), and the accumulated clock's next frame counts as the
// first, so resuming does not jump.
import type { SourceFile } from 'ts-morph'
import { insertStatements } from './edit.ts'
import { assignedValue, assignmentSides, callStatement, cleanupBody, effectDeclaring, frameRequest, functionBody, variableNamed } from './find.ts'

export function makeLoopPausable(file: SourceFile, loop: string, paused: string) {
  const effect = effectDeclaring(file, loop)
  const body = functionBody(effect, loop)
  const request = frameRequest(body)
  const { left, right } = assignmentSides(request)
  const frameId = left.getText()
  const nextFrame = right.getText()
  right.replaceWithText(`${paused} ? null : ${nextFrame}`)
  // The accumulated clock's last frame time.
  const last = assignedValue(body, 'clock.last')
  last.replaceWithText(`${paused} ? null : ${last.getText()}`)

  const id = variableNamed(effect, frameId)
  id.setType('number | null')
  id.setInitializer('null')

  const start = frameRequest(effect)
  insertStatements(
    effect,
    { before: start },
    `requestFrameRef.current = () => {\n  if (${frameId} === null) ${frameId} = ${assignmentSides(start).right.getText()};\n};\nrequestFrameRef.current();`,
  )
  start.remove()

  insertStatements(functionBody(effect, 'resize'), 'end', 'requestFrameRef.current?.();', 'Resizing clears the canvas, which a paused loop would leave blank.')

  const cleanup = cleanupBody(effect)
  callStatement(cleanup, 'cancelAnimationFrame', frameId).replaceWithText(`if (${frameId} !== null) cancelAnimationFrame(${frameId});`)
  insertStatements(cleanup, 'start', 'requestFrameRef.current = null;')
}
