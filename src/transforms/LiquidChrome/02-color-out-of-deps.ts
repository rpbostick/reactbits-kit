import { effectDeclaring } from '../../ast/find.ts'
import { removeDependencies } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '02-color-out-of-deps',
  file: 'LiquidChrome.tsx',
  kind: 'tsx',
  summary: "baseColor leaves the effect's dependencies",
  description:
    "`baseColor` is no longer in the effect's dependencies: the frame reads it through 01-params-getter's ref, so a new colour does not rebuild the WebGL context.",
  apply(file) {
    removeDependencies(effectDeclaring(file, 'update'), ['baseColor'])
  },
}

export default transform
