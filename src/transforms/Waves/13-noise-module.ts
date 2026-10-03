import { Node, SyntaxKind, type ClassDeclaration, type NumericLiteral, type SourceFile } from 'ts-morph'
import { callsTo, compact, exactlyOne, functionBody, ShapeError, statementOf } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

export const NOISE_FILE = 'noise.ts'

function classNamed(file: SourceFile, name: string): ClassDeclaration {
  const found = file.getClass(name)
  if (!found) throw new ShapeError(`no class ${name}`)
  return found
}

function methodBody(declaration: ClassDeclaration, name: string) {
  const body = declaration.getMethod(name)?.getBody()
  if (!body || !Node.isBlock(body)) throw new ShapeError(`${declaration.getName()} has no method ${name} with a block body`)
  return body
}

// The numeric factor `(…) * <scale>` an argument of the noise call ends in.
function scaleOf(argument: Node | undefined, which: string): NumericLiteral {
  if (!argument || !Node.isBinaryExpression(argument) || argument.getOperatorToken().getKind() !== SyntaxKind.AsteriskToken) {
    throw new ShapeError(`the noise call's ${which} argument is not (…) * scale`)
  }
  const scale = argument.getRight()
  if (!Node.isNumericLiteral(scale)) throw new ShapeError(`the noise call's ${which} scale is ${scale.getText()}, not a number`)
  return scale
}

// The lattice wrap `<cell> &= <mask>;` in perlin2, which must be the 256-entry table's.
function latticeWrap(body: ReturnType<typeof methodBody>, cell: string) {
  return statementOf(body, `${cell} &= 255 in perlin2`, (text) => text === `${cell}&=255;`)
}

// `this.gradP[<X or X + 1> + this.perm[<Y or Y + 1>]]` → the wrapped cells.
const CELLS: Record<string, string> = { X: 'X0', 'X+1': 'X1', Y: 'Y0', 'Y+1': 'Y1' }

function wrapGradientIndex(index: Node) {
  if (!Node.isBinaryExpression(index) || index.getOperatorToken().getKind() !== SyntaxKind.PlusToken) {
    throw new ShapeError(`gradient index ${index.getText()} is not <x cell> + this.perm[<y cell>]`)
  }
  const perm = index.getRight()
  const across = CELLS[compact(index.getLeft().getText())]
  const down = Node.isElementAccessExpression(perm) && perm.getExpression().getText() === 'this.perm' ? CELLS[compact(perm.getArgumentExpressionOrThrow().getText())] : undefined
  if (!across?.startsWith('X') || !down?.startsWith('Y')) throw new ShapeError(`gradient index ${index.getText()} is not <x cell> + this.perm[<y cell>]`)
  index.replaceWithText(`${across} + this.perm[${down}]`)
}

const transform: TsxTransform = {
  id: '13-noise-module',
  file: 'Waves.tsx',
  kind: 'tsx',
  creates: [NOISE_FILE],
  summary: 'Grad and Noise move to noise.ts, whose perlin2 takes a lattice period',
  description:
    "The `Grad` and `Noise` classes moved unchanged to `Waves/noise.ts`, except that `perlin2` takes a lattice period across and down (default 256, which is the original `& 255` wrap), so the pattern can repeat seamlessly on a smaller period. The noise scales `0.002` and `0.0015` are `NOISE_SCALE` there; `noisePeriod` turns a period in pixels into lattice cells and throws unless it is a whole number of cells from 1 to 256.",
  apply(file) {
    const grad = classNamed(file, 'Grad')
    const noise = classNamed(file, 'Noise')
    const perlin = methodBody(noise, 'perlin2')
    latticeWrap(perlin, 'X')
    latticeWrap(perlin, 'Y')
    const call = exactlyOne(callsTo(functionBody(file, 'movePoints'), 'noise.perlin2'), 'noise.perlin2 call in movePoints')
    const [across, down] = call.getArguments()
    const scaleX = scaleOf(across, 'first')
    const scaleY = scaleOf(down, 'second')

    // The classes as they are, into noise.ts.
    const moved = file.getProject().createSourceFile(
      `/${NOISE_FILE}`,
      [
        "// Waves' Perlin noise, moved out of Waves.tsx so it can be imported on",
        '// its own. perlin2 takes a lattice period, so the pattern can wrap seamlessly.',
        '',
        "// Waves reads the noise at a point's pixel position times these.",
        `export const NOISE_SCALE = { x: ${scaleX.getText()}, y: ${scaleY.getText()} };`,
        '',
        "// The largest lattice period: the permutation table's length.",
        'export const MAX_NOISE_PERIOD = 256;',
        '',
        grad.getText(),
        '',
        noise.getText(),
        '',
        'function wrap(cell: number, period: number): number {',
        '  return ((cell % period) + period) % period;',
        '}',
        '',
        '// The lattice period, in cells, of a pattern that repeats every `px` pixels',
        '// read at `scale`; it fails loud unless that is a whole number of cells the',
        '// permutation table can repeat.',
        'export function noisePeriod(px: number, scale: number): number {',
        '  const cells = Math.round(px * scale);',
        '  if (!(cells >= 1 && cells <= MAX_NOISE_PERIOD) || Math.abs(px * scale - cells) > 1e-9) {',
        '    throw new Error(`Waves: a ${px} px pattern period is ${px * scale} noise cells, not a whole number from 1 to ${MAX_NOISE_PERIOD}`);',
        '  }',
        '  return cells;',
        '}',
        '',
      ].join('\n'),
    )
    classNamed(moved, 'Noise').setIsExported(true)

    // perlin2 wraps its cells on the period instead of masking them to 0–255.
    const movedPerlin = () => methodBody(classNamed(moved, 'Noise'), 'perlin2')
    const gradients = () =>
      movedPerlin()
        .getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
        .filter((access) => access.getExpression().getText() === 'this.gradP')
    if (gradients().length !== 4) throw new ShapeError(`perlin2 reads ${gradients().length} gradients, expected 4`)
    for (let index = 0; index < 4; index++) wrapGradientIndex(gradients()[index].getArgumentExpressionOrThrow())
    latticeWrap(movedPerlin(), 'Y').remove()
    latticeWrap(movedPerlin(), 'X').replaceWithText('const X0 = wrap(X, periodX),\n  X1 = wrap(X + 1, periodX),\n  Y0 = wrap(Y, periodY),\n  Y1 = wrap(Y + 1, periodY);')
    const perlinMethod = classNamed(moved, 'Noise').getMethodOrThrow('perlin2')
    perlinMethod.addParameters([
      { name: 'periodX', initializer: 'MAX_NOISE_PERIOD' },
      { name: 'periodY', initializer: 'MAX_NOISE_PERIOD' },
    ])
    moved.insertText(
      perlinMethod.getStart(),
      `// Repeats every periodX lattice cells across and periodY down (whole\n${perlinMethod.getIndentationText()}// numbers up to MAX_NOISE_PERIOD); at 256 it is the original perlin2.\n${perlinMethod.getIndentationText()}`,
    )

    // Waves.tsx reads the scales from there and imports the noise. Nothing in
    // it has changed yet, so the handles found above still hold.
    scaleX.replaceWithText('NOISE_SCALE.x')
    scaleY.replaceWithText('NOISE_SCALE.y')
    classNamed(file, 'Noise').remove()
    classNamed(file, 'Grad').remove()
    const css = exactlyOne(
      file.getImportDeclarations().filter((declaration) => declaration.getModuleSpecifierValue() === './Waves.css'),
      "import of './Waves.css'",
    )
    file.insertText(css.getEnd(), `\nimport { Noise, NOISE_SCALE } from './${NOISE_FILE}';`)
  },
}

export default transform
