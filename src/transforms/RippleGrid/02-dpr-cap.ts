import { effectDeclaring } from '../../ast/find.ts'
import { capDevicePixelRatio } from '../../ast/renderer.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '02-dpr-cap',
  file: 'RippleGrid.tsx',
  kind: 'tsx',
  summary: 'The device pixel ratio is capped at 1.5 instead of 2',
  description: 'The device pixel ratio is capped at 1.5 instead of 2.',
  apply(file) {
    capDevicePixelRatio(effectDeclaring(file, 'render'), '2', '1.5')
  },
}

export default transform
