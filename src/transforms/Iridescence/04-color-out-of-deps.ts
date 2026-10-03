import { effectDeclaring } from '../../ast/find.ts'
import { removeDependencies } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '04-color-out-of-deps',
  file: 'Iridescence.tsx',
  kind: 'tsx',
  summary: "color leaves the effect's dependencies",
  description:
    "`color` is no longer in the effect's dependencies (the frame reads it through 03-params-getter's ref), so a new color array does not rebuild the WebGL context.",
  apply(file) {
    removeDependencies(effectDeclaring(file, 'update'), ['color'])
  },
}

export default transform
