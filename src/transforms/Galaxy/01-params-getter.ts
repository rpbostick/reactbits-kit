import { effectDeclaring, functionBody } from '../../ast/find.ts'
import { addFrameRef, addParamsProp, requireUniform, writeFrameParams } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

export const FRAME_FIELDS = ['hueShift', 'saturation', 'lightMode']

const transform: TsxTransform = {
  id: '01-params-getter',
  file: 'Galaxy.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding hueShift, saturation and lightMode',
  description:
    'A `params` prop, a getter called once per frame whose `hueShift`, `saturation` and `lightMode` override the props, written to their uniforms each frame.',
  apply(file) {
    const effect = effectDeclaring(file, 'update')
    for (const uniform of ['uHueShift', 'uSaturation', 'uLightMode']) requireUniform(effect, uniform)
    writeFrameParams(functionBody(effect, 'update'), 'frameRef', 'current', [
      'program.uniforms.uHueShift.value = current.hueShift;',
      'program.uniforms.uSaturation.value = current.saturation;',
      'program.uniforms.uLightMode.value = current.lightMode ? 1 : 0;',
    ])
    addFrameRef(file, 'Galaxy', 'frameRef', `{ ${[...FRAME_FIELDS, 'params'].join(', ')} }`)

    // Last: this inserts text, which leaves earlier node handles stale.
    addParamsProp(file, {
      component: 'Galaxy',
      propsType: 'GalaxyProps',
      fields: FRAME_FIELDS,
      style: 'pick',
      comment: 'Called once per frame; what it returns overrides the matching props, so the hue and the\nlight mode can change continuously without rebuilding the WebGL context.',
    })
  },
}

export default transform
