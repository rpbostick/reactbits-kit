import { effectDeclaring } from '../../ast/find.ts'
import { removeDependencies } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '02-colors-out-of-deps',
  file: 'Balatro.tsx',
  kind: 'tsx',
  summary: "color1, color2 and color3 leave the effect's dependencies",
  description:
    "`color1`, `color2` and `color3` are no longer in the effect's dependencies: the frame reads them through 01-params-getter's ref, so a new colour does not rebuild the WebGL context.",
  apply(file) {
    removeDependencies(effectDeclaring(file, 'update'), ['color1', 'color2', 'color3'])
  },
}

export default transform
