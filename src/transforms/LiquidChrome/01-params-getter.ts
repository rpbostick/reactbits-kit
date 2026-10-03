import { effectDeclaring, functionBody } from '../../ast/find.ts'
import { addFrameRef, addParamsProp, requireUniform, writeFrameParams } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '01-params-getter',
  file: 'LiquidChrome.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding baseColor',
  description: 'A `params` prop, a getter called once per frame whose `baseColor` overrides the prop, written to `uBaseColor` each frame.',
  apply(file) {
    const effect = effectDeclaring(file, 'update')
    requireUniform(effect, 'uBaseColor')
    writeFrameParams(functionBody(effect, 'update'), 'colorRef', 'current', ['(program.uniforms.uBaseColor.value as Float32Array).set(current.baseColor);'])
    addFrameRef(file, 'LiquidChrome', 'colorRef', '{ baseColor, params }')

    // Last: this inserts text, which leaves earlier node handles stale.
    addParamsProp(file, {
      component: 'LiquidChrome',
      propsType: 'LiquidChromeProps',
      fields: ['baseColor'],
      style: 'literal',
      comment: 'Called once per frame; what it returns overrides the matching props, so the color can change\ncontinuously without rebuilding the WebGL context.',
    })
  },
}

export default transform
