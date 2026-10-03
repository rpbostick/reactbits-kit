import { Node } from 'ts-morph'
import { insertStatements, movableText, nested } from '../../ast/edit.ts'
import { assignmentSides, callStatement, cleanupBody, effectDeclaring, frameRequest, ShapeError, statementOf, variableNamed } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '03-intersection-observer',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'The loop and pointer listeners run only while the waves are on screen',
  description:
    'An `IntersectionObserver` on the container starts the animation loop and the `mousemove`/`touchmove` listeners when the waves are on screen and stops them when they are not. The `resize` listener stays attached throughout.',
  apply(file) {
    const effect = effectDeclaring(file, 'tick')
    variableNamed(effect, 'container')
    const request = frameRequest(effect)
    const frameRef = assignmentSides(request).left.getText()
    const listens = ["'mousemove'", "'touchmove'"].map((type) => callStatement(effect, 'window.addEventListener', type))
    callStatement(effect, 'window.addEventListener', "'resize'")
    const firstSetup = callStatement(effect, 'setSize')

    const cleanup = cleanupBody(effect)
    const unlistens = ["'mousemove'", "'touchmove'"].map((type) => callStatement(cleanup, 'window.removeEventListener', type))
    const cancel = statementOf(cleanup, 'cancelAnimationFrame in the cleanup', (text) => text.includes('cancelAnimationFrame('))
    if (!Node.isIfStatement(cancel)) throw new ShapeError('the cleanup cancels the frame outside an if')
    const cancelled = cancel.getThenStatement()
    if (!Node.isBlock(cancelled)) throw new ShapeError('the cleanup cancels the frame without a block')
    // Cleared once cancelled, so the loop can be started again.
    cancelled.addStatements(`${frameRef} = null;`)

    const start = ['if (running) return;', 'running = true;', movableText(request), ...listens.map(movableText)]
    const stop = ['if (!running) return;', 'running = false;', ...unlistens.map(movableText), movableText(cancel)]
    insertStatements(
      effect,
      { before: firstSetup },
      [
        'let running = false;',
        `function start() {\n  ${start.map((line) => nested(line)).join('\n  ')}\n}`,
        `function stop() {\n  ${stop.map((line) => nested(line)).join('\n  ')}\n}`,
        'const observer = new IntersectionObserver(entries => {\n  if (entries[entries.length - 1].isIntersecting) start();\n  else stop();\n});',
      ].join('\n'),
      'Run the loop and pointer listeners only while the waves are on screen.',
    )
    request.replaceWithText('observer.observe(container);')
    for (const statement of [...listens, ...unlistens, cancel]) statement.remove()
    insertStatements(cleanup, 'start', 'observer.disconnect();')
    insertStatements(cleanup, 'end', 'stop();')
  },
}

export default transform
