import { SyntaxKind } from 'ts-morph'
import { componentBody, destructuredProp } from '../../ast/component.ts'
import { addMember, extendExpression, insertItemAfter, insertStatements, movableText } from '../../ast/edit.ts'
import { exactlyOne, functionBody, ShapeError, variableNamed } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

// Object literals in the component listing the config shorthand (`xGap,
// yGap`) that do not yet carry the overscan.
function configLiteralsWithoutOverscan(file: Parameters<TsxTransform['apply']>[0]) {
  return componentBody(file, 'Waves')
    .getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)
    .filter((literal) => literal.getProperty('xGap') && literal.getProperty('yGap') && !literal.getProperty('overscanX'))
}

const transform: TsxTransform = {
  id: '10-overscan',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'overscanX and overscanY props widen and lengthen the grid beyond the edges',
  description:
    'An `overscanX` prop (default 0) that widens the grid in `setLines` by that many pixels on each side, so a displacement can shift the lines sideways without the outermost ones coming into view, and an `overscanY` prop (default 0) that lengthens every line by that many pixels at each end, so a displacement can shift them up or down without their ends coming into view.',
  apply(file) {
    addMember(file, 'Config', { name: 'overscanY', type: 'number', after: 'yGap' })
    addMember(file, 'Config', { name: 'overscanX', type: 'number', after: 'yGap' })
    addMember(file, 'WavesProps', {
      name: 'overscanY',
      type: 'number',
      optional: true,
      after: 'yGap',
      comment: 'Likewise above and below, beyond the 15 px the grid already has.',
    })
    addMember(file, 'WavesProps', {
      name: 'overscanX',
      type: 'number',
      optional: true,
      after: 'yGap',
      comment: 'Extra lines this many pixels beyond each side, for a displacement that\nshifts the lines sideways further than the 100 px the grid already has.',
    })
    insertItemAfter(destructuredProp(file, 'Waves', 'yGap'), 'overscanY = 0')
    insertItemAfter(destructuredProp(file, 'Waves', 'yGap'), 'overscanX = 0')

    // The config ref's first value and the effect that keeps it current.
    const literals = configLiteralsWithoutOverscan(file).length
    if (literals !== 2) throw new ShapeError(`${literals} config object literals, expected 2`)
    for (let remaining = literals; remaining > 0; remaining--) {
      const yGap = configLiteralsWithoutOverscan(file)[0].getPropertyOrThrow('yGap')
      insertItemAfter(yGap, 'overscanY')
      insertItemAfter(configLiteralsWithoutOverscan(file)[0].getPropertyOrThrow('yGap'), 'overscanX')
    }
    const dependencies = exactlyOne(
      componentBody(file, 'Waves')
        .getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)
        .filter((array) => array.getElements().some((element) => element.getText() === 'yGap')),
      'effect dependencies listing yGap',
    )
    insertItemAfter(dependencies.getElements().find((element) => element.getText() === 'yGap')!, 'overscanX, overscanY')

    // setLines reads the gaps, and now the overscan with them, and sizes the
    // grid with the overscan added.
    const yGap = exactlyOne(
      functionBody(file, 'setLines')
        .getDescendantsOfKind(SyntaxKind.BindingElement)
        .filter((element) => element.getName() === 'yGap'),
      'yGap read in setLines',
    )
    insertItemAfter(yGap, 'overscanX, overscanY')
    const setLines = functionBody(file, 'setLines')
    extendExpression(variableNamed(setLines, 'oWidth').getInitializerOrThrow(), ' + 2 * overscanX')
    extendExpression(variableNamed(setLines, 'oHeight').getInitializerOrThrow(), ' + 2 * overscanY')

    // The sizes now use the overscan, so it must be read before them.
    const sizes = variableNamed(setLines, 'oWidth').getVariableStatementOrThrow()
    const gaps = exactlyOne(
      setLines.getDescendantsOfKind(SyntaxKind.BindingElement).filter((element) => element.getName() === 'overscanX'),
      'overscanX read in setLines',
    ).getFirstAncestorByKindOrThrow(SyntaxKind.VariableStatement)
    if (gaps.getParent() !== setLines) throw new ShapeError('setLines reads its gaps in a nested block')
    if (gaps.getChildIndex() > sizes.getChildIndex()) {
      const text = movableText(gaps)
      gaps.remove()
      insertStatements(setLines, { before: variableNamed(setLines, 'oWidth').getVariableStatementOrThrow() }, text)
    }
  },
}

export default transform
