import { Node, SyntaxKind, type ArrowFunction } from 'ts-morph'
import { addDestructuredProp, addSyncedRef } from '../../ast/component.ts'
import { addMember, extendExpression, insertAfterStatement, insertStatements } from '../../ast/edit.ts'
import { callsTo, compact, effectDeclaring, exactlyOne, functionBody, interfaceNamed, ShapeError, variableNamed } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

function callback(call: Node, what: string): ArrowFunction {
  const argument = Node.isCallExpression(call) ? call.getArguments()[0] : undefined
  if (!argument || !Node.isArrowFunction(argument)) throw new ShapeError(`${what} takes no arrow function`)
  return argument
}

const transform: TsxTransform = {
  id: '09-displacement-getter',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'A displacement prop: a per-frame getter adding an offset to every point',
  description:
    'A `displacement` prop, a getter called once per frame at the end of `movePoints` with the grid of points (after this frame\'s wave offsets) and the frame time. It returns an `x` and a `y` offset for each point, indexed line × points per line + point, or null; `drawLines` adds them wherever it adds the cursor offset.',
  apply(file) {
    const effect = effectDeclaring(file, 'tick')
    const move = functionBody(file, 'movePoints')
    const moveDeclaration = move.getParentIfKindOrThrow(SyntaxKind.FunctionDeclaration)
    const time = moveDeclaration.getParameters()[0]?.getName()
    if (!time) throw new ShapeError('movePoints takes no time parameter')
    const lines = exactlyOne(
      move.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((declaration) => compact(declaration.getInitializer()?.getText() ?? '') === 'linesRef.current'),
      'variable read from linesRef.current in movePoints',
    ).getName()

    insertStatements(effect, { before: moveDeclaration }, 'let shift: Displacement | null = null;', "This frame's extra offsets from the displacement getter.")
    insertStatements(move, 'end', `shift = displacementRef.current ? displacementRef.current(${lines}, ${time}) : null;`)

    // moved(point, withCursor) gains the point's index and adds its shift.
    const moved = functionBody(file, 'moved')
    const movedDeclaration = moved.getParentIfKindOrThrow(SyntaxKind.FunctionDeclaration)
    const withCursor = movedDeclaration.getParameters()[1]?.getName()
    if (!withCursor) throw new ShapeError('moved takes no withCursor parameter')
    movedDeclaration.addParameter({ name: 'index', initializer: '-1' })
    extendExpression(variableNamed(moved, 'x').getInitializerOrThrow(), ' + shiftX')
    extendExpression(variableNamed(moved, 'y').getInitializerOrThrow(), ' + shiftY')
    insertStatements(
      moved,
      'start',
      `const shiftX = ${withCursor} && shift && index >= 0 ? shift.x[index] : 0;\nconst shiftY = ${withCursor} && shift && index >= 0 ? shift.y[index] : 0;`,
    )

    // drawLines passes each point's index where it draws it with the cursor.
    const eachLineOf = () =>
      callback(
        exactlyOne(callsTo(functionBody(file, 'drawLines'), 'linesRef.current.forEach'), 'linesRef.current.forEach in drawLines'),
        'linesRef.current.forEach',
      )
    const parameters = eachLineOf().getParameters()
    if (parameters.length !== 1) throw new ShapeError('the per-line callback already takes an index')
    const points = parameters[0].getName()
    // `points => …` has no parentheses for a second parameter to go in.
    if (eachLineOf().getFirstChildByKind(SyntaxKind.OpenParenToken)) eachLineOf().addParameter({ name: 'line' })
    else file.replaceText([parameters[0].getStart(), parameters[0].getEnd()], `(${points}, line)`)
    const eachLine = eachLineOf()
    const eachPoint = callback(exactlyOne(callsTo(eachLine, `${points}.forEach`), `${points}.forEach in drawLines`), `${points}.forEach`)
    const [point, index] = eachPoint.getParameters().map((parameter) => parameter.getName())
    if (!point || !index) throw new ShapeError('the per-point callback takes no index')
    const drawn = exactlyOne(
      callsTo(eachPoint, 'moved', point).filter((call) => call.getArguments().length === 2),
      `moved(${point}, …) in drawLines`,
    )
    drawn.addArgument(`line * ${points}.length + ${index}`)

    // Last: these insert text, which leaves earlier node handles stale.
    insertAfterStatement(file, interfaceNamed(file, 'Mouse'), 'interface Displacement {\n  x: ArrayLike<number>;\n  y: ArrayLike<number>;\n}')
    addMember(file, 'WavesProps', {
      name: 'displacement',
      type: '(lines: readonly (readonly Point[])[], time: number) => Displacement | null',
      optional: true,
      before: 'backgroundColor',
      comment:
        "Called once per frame after the points move, with the grid (each line's\npoints, in container coordinates, with this frame's wave offset) and the\nframe time. It returns an extra offset for every point, indexed\nline × points per line + point, or null for none.",
    })
    addDestructuredProp(file, 'Waves', 'displacement', 'style')
    addSyncedRef(file, 'Waves', 'displacementRef', 'displacement')
  },
}

export default transform
