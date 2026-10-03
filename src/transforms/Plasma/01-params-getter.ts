import { insertStatements } from '../../ast/edit.ts'
import { callStatement, effectDeclaring, functionBody, variableNamed } from '../../ast/find.ts'
import { addFrameRef, addParamsProp, requireUniform } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

export const FRAME_FIELDS = ['color', 'lightMode']

const transform: TsxTransform = {
  id: '01-params-getter',
  file: 'Plasma.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding color and lightMode',
  description:
    'A `params` prop, a getter called once per frame (and for the single reduced-motion frame) whose `color` and `lightMode` override the props, written to `uCustomColor` and `uLightMode`.',
  apply(file) {
    variableNamed(file, 'hexToRgb')
    const effect = effectDeclaring(file, 'loop')
    for (const uniform of ['uCustomColor', 'uLightMode']) requireUniform(effect, uniform)
    // Both the loop and the reduced-motion frame draw with this frame's params.
    const loop = functionBody(effect, 'loop')
    insertStatements(loop, { before: callStatement(loop, 'renderer.render') }, 'applyFrameParams();')
    const staticFrame = functionBody(effect, 'renderStaticFrame')
    insertStatements(staticFrame, 'start', 'applyFrameParams();')
    insertStatements(
      effect,
      { before: variableNamed(effect, 'renderStaticFrame').getVariableStatementOrThrow() },
      [
        'const applyFrameParams = () => {',
        '  const current = { ...frameRef.current, ...frameRef.current.params?.() };',
        '  (program.uniforms.uCustomColor.value as Float32Array).set(hexToRgb(current.color));',
        '  program.uniforms.uLightMode.value = current.lightMode ? 1 : 0;',
        '};',
      ].join('\n'),
    )
    addFrameRef(file, 'Plasma', 'frameRef', `{ ${[...FRAME_FIELDS, 'params'].join(', ')} }`)

    // Last: this inserts text, which leaves earlier node handles stale.
    addParamsProp(file, {
      component: 'Plasma',
      propsType: 'PlasmaProps',
      fields: FRAME_FIELDS,
      style: 'pick',
      comment: 'Called once per frame; what it returns overrides the matching props, so the color and the\nlight mode can change continuously without rebuilding the WebGL context.',
    })
  },
}

export default transform
