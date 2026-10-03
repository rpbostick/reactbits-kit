import { effectDeclaring, functionBody } from '../../ast/find.ts'
import { addFrameRef, addParamsProp, requireUniform, writeFrameParams } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

const COLORS = ['color1', 'color2', 'color3']

const transform: TsxTransform = {
  id: '01-params-getter',
  file: 'Balatro.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding color1, color2 and color3',
  description:
    'A `params` prop, a getter called once per frame whose `color1`, `color2` and `color3` override the props, written to their uniforms each frame.',
  apply(file) {
    functionBody(file, 'hexToVec4')
    const effect = effectDeclaring(file, 'update')
    for (const index of [1, 2, 3]) requireUniform(effect, `uColor${index}`)
    writeFrameParams(
      functionBody(effect, 'update'),
      'colorsRef',
      'colors',
      [1, 2, 3].map((index) => `program.uniforms.uColor${index}.value = hexToVec4(colors.color${index});`),
    )
    addFrameRef(file, 'Balatro', 'colorsRef', `{ ${[...COLORS, 'params'].join(', ')} }`)

    // Last: this inserts text, which leaves earlier node handles stale.
    addParamsProp(file, {
      component: 'Balatro',
      propsType: 'BalatroProps',
      fields: COLORS,
      style: 'pick',
      comment: 'Called once per frame; what it returns overrides the matching props, so the colors can change\ncontinuously without rebuilding the WebGL context.',
    })
  },
}

export default transform
