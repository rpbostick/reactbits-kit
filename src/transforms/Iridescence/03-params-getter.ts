import { effectDeclaring, functionBody } from '../../ast/find.ts'
import { addFrameRef, addParamsProp, requireUniform, writeFrameParams } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '03-params-getter',
  file: 'Iridescence.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding color',
  description: 'A `params` prop, a getter called once per frame whose `color` overrides the prop, written to the `uColor` uniform each frame.',
  apply(file) {
    const effect = effectDeclaring(file, 'update')
    requireUniform(effect, 'uColor')
    writeFrameParams(functionBody(effect, 'update'), 'colorRef', 'current', ['program.uniforms.uColor.value.set(...current.color);'])
    addFrameRef(file, 'Iridescence', 'colorRef', '{ color, params }')

    // Last: this inserts text, which leaves earlier node handles stale.
    addParamsProp(file, {
      component: 'Iridescence',
      propsType: 'IridescenceProps',
      fields: ['color'],
      style: 'literal',
      comment: 'Called once per frame; what it returns overrides the matching props, so the color can change\ncontinuously without rebuilding the WebGL context.',
    })
  },
}

export default transform
