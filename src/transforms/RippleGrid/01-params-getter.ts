import { insertStatements } from '../../ast/edit.ts'
import { callStatement, effectDeclaring, functionBody, variableNamed } from '../../ast/find.ts'
import { addFrameRef, addParamsProp, requireUniform } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '01-params-getter',
  file: 'RippleGrid.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding gridColor and lightMode',
  description: 'A `params` prop, a getter called once per frame whose `gridColor` and `lightMode` override the props.',
  apply(file) {
    // Upstream writes the props to the uniforms in an effect of their own,
    // so the getter only overrides the fields it returns.
    const effect = effectDeclaring(file, 'render')
    variableNamed(effect, 'hexToRgb')
    for (const uniform of ['gridColor', 'lightMode']) requireUniform(effect, uniform)
    const render = functionBody(effect, 'render')
    insertStatements(
      render,
      { before: callStatement(render, 'renderer.render') },
      [
        'const frame = paramsRef.current?.();',
        'if (frame?.gridColor !== undefined) uniforms.gridColor.value = hexToRgb(frame.gridColor);',
        'if (frame?.lightMode !== undefined) uniforms.lightMode.value = frame.lightMode;',
      ].join('\n'),
    )
    addFrameRef(file, 'RippleGrid', 'paramsRef', 'params')

    // Last: this inserts text, which leaves earlier node handles stale.
    addParamsProp(file, {
      component: 'RippleGrid',
      propsType: 'Props',
      fields: ['gridColor', 'lightMode'],
      style: 'literal',
      comment: 'Called once per frame; what it returns overrides the matching props, so the color and the\nlight mode can change continuously without re-rendering.',
    })
  },
}

export default transform
