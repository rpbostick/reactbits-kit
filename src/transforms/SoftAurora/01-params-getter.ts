import { effectDeclaring, functionBody } from '../../ast/find.ts'
import { addFrameRef, addParamsProp, requireUniform, writeFrameParams } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

export const FRAME_FIELDS = ['color1', 'color2', 'lightMode']

const transform: TsxTransform = {
  id: '01-params-getter',
  file: 'SoftAurora.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding color1, color2 and lightMode',
  description:
    'A `params` prop, a getter called once per frame whose `color1`, `color2` and `lightMode` override the props, written to their uniforms each frame.',
  apply(file) {
    functionBody(file, 'hexToVec3')
    const effect = effectDeclaring(file, 'update')
    for (const uniform of ['uColor1', 'uColor2', 'uLightMode']) requireUniform(effect, uniform)
    writeFrameParams(functionBody(effect, 'update'), 'frameRef', 'current', [
      'program.uniforms.uColor1.value = hexToVec3(current.color1);',
      'program.uniforms.uColor2.value = hexToVec3(current.color2);',
      'program.uniforms.uLightMode.value = current.lightMode ? 1 : 0;',
    ])
    addFrameRef(file, 'SoftAurora', 'frameRef', `{ ${[...FRAME_FIELDS, 'params'].join(', ')} }`)

    // Last: this inserts text, which leaves earlier node handles stale.
    addParamsProp(file, {
      component: 'SoftAurora',
      propsType: 'SoftAuroraProps',
      fields: FRAME_FIELDS,
      style: 'pick',
      comment: 'Called once per frame; what it returns overrides the matching props, so the colors and the\nlight mode can change continuously without rebuilding the WebGL context.',
    })
  },
}

export default transform
