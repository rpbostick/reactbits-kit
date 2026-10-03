import { Node, SyntaxKind } from 'ts-morph'
import { insertBeforeStatement, insertStatements, retypeMember } from '../../ast/edit.ts'
import { assignedValue, functionBody, interfaceNamed, ShapeError } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '02-line-color-getter',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'lineColor also accepts a getter, called once per frame',
  description:
    '`lineColor` also accepts a function, called once per frame in `drawLines`, so the color can change continuously without re-rendering or re-initializing the waves.',
  apply(file) {
    const config = interfaceNamed(file, 'Config')
    retypeMember(config, 'lineColor', 'string', 'LineColor')
    retypeMember(interfaceNamed(file, 'WavesProps'), 'lineColor', 'string', 'LineColor')
    insertBeforeStatement(
      file,
      config,
      '// A getter is called once per frame, so the color can change without re-rendering.\ntype LineColor = string | (() => string);',
    )

    const draw = functionBody(file, 'drawLines')
    const value = assignedValue(draw, 'ctx.strokeStyle')
    if (!Node.isPropertyAccessExpression(value) || value.getName() !== 'lineColor') {
      throw new ShapeError(`ctx.strokeStyle is set from ${value.getText()}, expected a lineColor property`)
    }
    const source = value.getExpression().getText()
    const statement = value.getFirstAncestorByKindOrThrow(SyntaxKind.ExpressionStatement)
    value.replaceWithText("typeof lineColor === 'function' ? lineColor() : lineColor")
    insertStatements(draw, { before: statement }, `const { lineColor } = ${source};`)
  },
}

export default transform
