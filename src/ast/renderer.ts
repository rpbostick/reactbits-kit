// Edits to how a WebGL background sizes its drawing buffer.
import { SyntaxKind, type Node } from 'ts-morph'
import { compact, exactlyOne, ShapeError } from './find.ts'

// Changes the cap in the one `Math.min(window.devicePixelRatio…, <from>)`
// under `scope` to `to`. The shaders cost per pixel drawn, so a lower cap
// trades sharpness on high-density screens for frame time.
export function capDevicePixelRatio(scope: Node, from: string, to: string) {
  const call = exactlyOne(
    scope.getDescendantsOfKind(SyntaxKind.CallExpression).filter((candidate) => {
      const [ratio] = candidate.getArguments()
      return compact(candidate.getExpression().getText()) === 'Math.min' && ratio !== undefined && compact(ratio.getText()).startsWith('window.devicePixelRatio')
    }),
    'Math.min(window.devicePixelRatio…, cap)',
  )
  const cap = call.getArguments()[1]
  if (!cap || cap.getText() !== from) throw new ShapeError(`the device pixel ratio is capped at ${cap?.getText() ?? 'nothing'}, expected ${from}`)
  cap.replaceWithText(to)
}
