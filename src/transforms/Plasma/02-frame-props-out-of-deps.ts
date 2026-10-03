import { effectDeclaring } from '../../ast/find.ts'
import { removeDependencies } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'
import { FRAME_FIELDS } from './01-params-getter.ts'

const transform: TsxTransform = {
  id: '02-frame-props-out-of-deps',
  file: 'Plasma.tsx',
  kind: 'tsx',
  summary: "color and lightMode leave the effect's dependencies",
  description:
    "`color` and `lightMode` are no longer in the effect's dependencies: the frame reads them through 01-params-getter's ref, so a change does not rebuild the WebGL context.",
  apply(file) {
    removeDependencies(effectDeclaring(file, 'loop'), FRAME_FIELDS)
  },
}

export default transform
