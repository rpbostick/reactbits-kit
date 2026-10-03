import { Node, SyntaxKind, type ArrowFunction } from 'ts-morph'
import { addDestructuredProp, addSyncedRef, insertBeforeFirstEffect } from '../../ast/component.ts'
import { addMember, insertStatements } from '../../ast/edit.ts'
import { callsTo, callStatement, compact, exactlyOne, functionBody, ShapeError } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'
import { NOISE_FILE } from './13-noise-module.ts'

function callback(call: Node, what: string): ArrowFunction {
  const argument = Node.isCallExpression(call) ? call.getArguments()[0] : undefined
  if (!argument || !Node.isArrowFunction(argument)) throw new ShapeError(`${what} takes no arrow function`)
  return argument
}

// Gives `each` a second parameter `name` unless it has one, keeping a bare
// `p => …` valid by parenthesizing it. Returns the parameters' names.
function withIndex(each: ArrowFunction, name: string): [string, string] {
  const parameters = each.getParameters()
  if (parameters.length === 2) return [parameters[0].getName(), parameters[1].getName()]
  if (parameters.length !== 1) throw new ShapeError(`a forEach callback takes ${parameters.length} parameters`)
  const item = parameters[0].getName()
  if (each.getFirstChildByKind(SyntaxKind.OpenParenToken)) each.addParameter({ name })
  else each.getSourceFile().replaceText([parameters[0].getStart(), parameters[0].getEnd()], `(${item}, ${name})`)
  return [item, name]
}

const transform: TsxTransform = {
  id: '14-sample-getter',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'A sample prop: a per-frame getter for where each point reads the noise; patternPeriod',
  description:
    'A `sample` prop, a getter called once per frame at the start of `movePoints` with the grid and the frame time. It returns, for each point (indexed as for `displacement`), the pixel position the point reads the noise at instead of its own, or null; a result of the wrong length throws. A `patternPeriod` prop (`{ x, y }` in pixels) passes the noise period; it throws unless each is a whole number of noise cells from 1 to 256.',
  apply(file) {
    const noiseImport = () =>
      exactlyOne(
        file.getImportDeclarations().filter((declaration) => declaration.getModuleSpecifierValue() === `./${NOISE_FILE}`),
        `import of './${NOISE_FILE}' (13-noise-module)`,
      )
    noiseImport()
    const move = () => functionBody(file, 'movePoints')
    const moveDeclaration = move().getParentIfKindOrThrow(SyntaxKind.FunctionDeclaration)
    const time = moveDeclaration.getParameters()[0]?.getName()
    if (!time) throw new ShapeError('movePoints takes no time parameter')
    const lines = exactlyOne(
      move()
        .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
        .filter((declaration) => compact(declaration.getInitializer()?.getText() ?? '') === 'linesRef.current'),
      'variable read from linesRef.current in movePoints',
    ).getName()

    // Each line's and each point's callback learn their index.
    const eachLine = () => callback(callStatement(move(), `${lines}.forEach`).getExpression(), `${lines}.forEach`)
    const [points, line] = withIndex(eachLine(), 'line')
    const eachPoint = () => callback(exactlyOne(callsTo(eachLine(), `${points}.forEach`), `${points}.forEach in movePoints`), `${points}.forEach`)
    const [point, index] = withIndex(eachPoint(), 'idx')

    // The noise is read where the getter says, on the period.
    const noiseCall = exactlyOne(callsTo(eachPoint(), 'noise.perlin2'), 'noise.perlin2 in movePoints')
    const [across, down] = noiseCall.getArguments()
    const placeIn = (argument: Node | undefined, axis: 'x' | 'y', local: string) => {
      const read = exactlyOne(
        (argument?.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression) ?? []).filter((access) => compact(access.getText()) === `${point}.${axis}`),
        `${point}.${axis} in the noise call`,
      )
      read.replaceWithText(local)
    }
    placeIn(across, 'x', 'sx')
    placeIn(down, 'y', 'sy')
    exactlyOne(callsTo(eachPoint(), 'noise.perlin2'), 'noise.perlin2 in movePoints').addArguments(['period.x', 'period.y'])
    const pointBody = eachPoint().getBody()
    if (!Node.isBlock(pointBody)) throw new ShapeError('the per-point callback has no block body')
    insertStatements(pointBody, 'start', `const k = ${line} * ${points}.length + ${index};\nconst sx = at ? at.x[k] : ${point}.x,\n  sy = at ? at.y[k] : ${point}.y;`)
    insertStatements(
      move(),
      { before: callStatement(move(), `${lines}.forEach`) },
      [
        `const at = sampleRef.current ? sampleRef.current(${lines}, ${time}) : null;`,
        `const count = ${lines}.length * (${lines}.length > 0 ? ${lines}[0].length : 0);`,
        'if (at && (at.x.length !== count || at.y.length !== count)) {',
        '  throw new Error(`Waves: ${at.x.length} sample points for ${count} grid points`);',
        '}',
        'const period = periodRef.current;',
      ].join('\n'),
    )

    noiseImport().insertNamedImport(0, 'MAX_NOISE_PERIOD')
    noiseImport().addNamedImport('noisePeriod')

    // Last: these insert text, which leaves earlier node handles stale.
    insertBeforeFirstEffect(
      file,
      'Waves',
      [
        'const periodX = patternPeriod ? noisePeriod(patternPeriod.x, NOISE_SCALE.x) : MAX_NOISE_PERIOD;',
        'const periodY = patternPeriod ? noisePeriod(patternPeriod.y, NOISE_SCALE.y) : MAX_NOISE_PERIOD;',
        'const periodRef = useRef({ x: periodX, y: periodY });',
        '',
        'useEffect(() => {',
        '  periodRef.current = { x: periodX, y: periodY };',
        '}, [periodX, periodY]);',
      ].join('\n'),
    )
    addSyncedRef(file, 'Waves', 'sampleRef', 'sample')
    addMember(file, 'WavesProps', {
      name: 'sample',
      type: '(lines: readonly (readonly Point[])[], time: number) => Displacement | null',
      optional: true,
      before: 'backgroundColor',
      comment:
        "Called once per frame before the noise is read, with the grid and the\nframe time. It returns, for every point (indexed as for displacement),\nwhere in the pattern the point reads the noise, in pixels, instead of\nits own place; or null for its own place.",
    })
    addMember(file, 'WavesProps', {
      name: 'patternPeriod',
      type: '{ x: number; y: number }',
      optional: true,
      before: 'backgroundColor',
      comment: 'The pattern repeats every this many pixels across and down; each must be\na whole number of noise cells (1 / NOISE_SCALE px across and down).',
    })
    addDestructuredProp(file, 'Waves', 'sample', 'style')
    addDestructuredProp(file, 'Waves', 'patternPeriod', 'style')
  },
}

export default transform
