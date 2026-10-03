import { effectDeclaring, functionBody } from '../../ast/find.ts'
import { capDevicePixelRatio } from '../../ast/renderer.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '02-dpr-cap',
  file: 'Threads.tsx',
  kind: 'tsx',
  summary: 'The device pixel ratio is capped at 1.5 instead of 2',
  description: 'The device pixel ratio is capped at 1.5 instead of 2.',
  apply(file) {
    capDevicePixelRatio(functionBody(effectDeclaring(file, 'resize'), 'resize'), '2', '1.5')
  },
}

export default transform
