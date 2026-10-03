// The `coordinates` change shared by the WebGL backgrounds: a getter called
// once per frame that moves, turns and scales the pattern (a sheet's glide
// and twist, a ball's spin read as a scroll) and stirs it locally (a ripple's
// stretch and swirl around one point). The fragment shader reads its
// coordinate through `kitWarp`, which undoes those moves, so the pattern
// itself moves while the shader's own maths is unchanged.
//
// The shaders are template literals, so the GLSL is edited as text: our
// uniforms and functions go after the `precision … float;` line, and the
// coordinate the shader starts from (`gl_FragCoord.xy`, or the `vUv` main()
// reads first) is wrapped. Only those anchors are matched; the rest of the
// shader is never read or rewritten.
import { Node, SyntaxKind, type NoSubstitutionTemplateLiteral, type SourceFile } from 'ts-morph'
import { addDestructuredProp, componentBody } from './component.ts'
import { addMember, insertBeforeStatement, insertStatements } from './edit.ts'
import { callsTo, effectDeclaring, exactlyOne, functionBody, objectTypeNamed, ShapeError } from './find.ts'
import { addFrameRef } from './params.ts'
import type { TsxTransform } from '../transform.ts'

// What the shader starts from: the fragment's pixel, or the 0–1 varying a
// full-screen triangle passes (y up in both).
export type ShaderCoordinate = 'gl_FragCoord' | 'vUv'

export interface CoordinatesOptions {
  component: string
  propsType: string
  // The variable holding the fragment shader, or the function returning it.
  shader: string
  coordinate: ShaderCoordinate
  // The effect's frame function, and any other function that draws a frame
  // (Plasma's reduced-motion frame); each writes the uniforms before it renders.
  loop: string
  alsoDrawing?: string[]
  // 'destructured': the component destructures its props, and the getter is
  // kept in a ref. 'propsRef': it already keeps all its props in `propsRef`.
  props: 'destructured' | 'propsRef'
}

const GLSL = [
  '',
  '// reactbits-kit coordinates: the pattern shifted by uKitView.xy, turned by',
  '// uKitView.z about uKitCenter (after the shift) and scaled by uKitView.w, and',
  '// stirred near uKitRipple.xy: shifted by uKitRipple.zw and turned by',
  '// uKitRippleShape.y, fading as exp(-d^2 / uKitRippleShape.x^2). Drawing-buffer',
  '// pixels, y up. kitWarp maps a pixel to where it reads the unmoved pattern.',
  'uniform vec4 uKitView;',
  'uniform vec2 uKitCenter;',
  'uniform vec4 uKitRipple;',
  'uniform vec2 uKitRippleShape;',
  'uniform vec2 uKitSize;',
  '',
  'vec2 kitTurn(vec2 v, float angle) {',
  '  float c = cos(angle);',
  '  float s = sin(angle);',
  '  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);',
  '}',
  '',
  'vec2 kitWarp(vec2 p) {',
  '  vec2 fromRipple = p - uKitRipple.xy;',
  '  float near = exp(-dot(fromRipple, fromRipple) / (uKitRippleShape.x * uKitRippleShape.x));',
  '  p = uKitRipple.xy + kitTurn(fromRipple, -uKitRippleShape.y * near) - uKitRipple.zw * near;',
  '  return uKitCenter + kitTurn(p - uKitCenter - uKitView.xy, -uKitView.z) / uKitView.w;',
  '}',
  '',
  'vec2 kitWarpUv(vec2 uv) {',
  '  return kitWarp(uv * uKitSize) / uKitSize;',
  '}',
  '',
].join('\n')

const PRECISION = /^[ \t]*precision\s+(?:lowp|mediump|highp)\s+float\s*;[^\n]*\n/gm
const MAIN = /\bvoid\s+main\s*\(\s*\)\s*\{/g

// The fragment shader with kitWarp declared and its starting coordinate
// wrapped. Every `gl_FragCoord` must be read as `.xy`; a `vUv` shader wraps
// only the first read in main(), so what main() works out from the screen
// itself afterwards (a vignette) stays put.
export function warpShader(glsl: string, coordinate: ShaderCoordinate): string {
  if (glsl.includes('kitWarp')) throw new ShapeError('the shader already has kitWarp')
  const precision = exactlyOne([...glsl.matchAll(PRECISION)], "the shader's precision … float; line")
  const at = precision.index + precision[0].length
  let body = glsl.slice(at)
  if (coordinate === 'gl_FragCoord') {
    const reads = [...body.matchAll(/\bgl_FragCoord\b(\.xy\b)?/g)]
    if (reads.length === 0) throw new ShapeError('the shader does not read gl_FragCoord')
    if (reads.some((read) => read[1] === undefined)) throw new ShapeError('the shader reads gl_FragCoord other than as .xy')
    body = body.replace(/\bgl_FragCoord\.xy\b/g, 'kitWarp(gl_FragCoord.xy)')
  } else {
    const main = exactlyOne([...body.matchAll(MAIN)], 'void main() in the shader')
    const start = main.index + main[0].length
    const read = /\bvUv\b/.exec(body.slice(start))
    if (!read) throw new ShapeError('main() does not read vUv')
    const index = start + read.index
    body = `${body.slice(0, index)}kitWarpUv(vUv)${body.slice(index + 'vUv'.length)}`
  }
  return `${glsl.slice(0, at)}${GLSL}${body}`
}

// The template literal `name` holds or, for a function, returns.
function shaderLiteral(file: SourceFile, name: string): NoSubstitutionTemplateLiteral {
  const declaration = exactlyOne(
    file.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((candidate) => candidate.getName() === name),
    `variable ${name}`,
  )
  let value: Node | undefined = declaration.getInitializer()
  if (value && (Node.isArrowFunction(value) || Node.isFunctionExpression(value))) {
    const body = value.getBody()
    value = Node.isBlock(body)
      ? exactlyOne(body.getStatements().filter(Node.isReturnStatement), `return in ${name}`).getExpression()
      : body
  }
  if (!value || !Node.isNoSubstitutionTemplateLiteral(value)) throw new ShapeError(`${name} is not a shader template literal without substitutions`)
  return value
}

// Our TypeScript, before the props type: the frame the getter returns and
// the function that writes it into the uniforms kitWarp reads.
const TYPESCRIPT = [
  "// What the `coordinates` getter returns each frame (reactbits-kit). Lengths",
  "// are the container's pixels from its top left, angles radians clockwise",
  '// on screen.',
  'interface CoordinateFrame {',
  "  // The pattern's shift.",
  '  x: number;',
  '  y: number;',
  '  // Its turn about (centerX, centerY) moved by the shift, and its scale (1 for none).',
  '  rotation: number;',
  '  scale: number;',
  '  centerX: number;',
  '  centerY: number;',
  '  // A local stretch and swirl: near (x, y) the pattern shifts by (dx, dy) and',
  '  // turns by twist about it, fading as exp(-d² / radius²); null for none.',
  '  ripple: { x: number; y: number; dx: number; dy: number; radius: number; twist: number } | null;',
  '}',
  '',
  'const NO_COORDINATES: CoordinateFrame = { x: 0, y: 0, rotation: 0, scale: 1, centerX: 0, centerY: 0, ripple: null };',
  'const NO_RIPPLE = { x: 0, y: 0, dx: 0, dy: 0, radius: 1, twist: 0 };',
  '',
  "// Writes this frame's coordinates into the fragment shader's kitWarp",
  "// uniforms, in the drawing buffer's pixels with y up.",
  'function writeCoordinates(program: Program, frame: CoordinateFrame | null) {',
  '  const view = frame ?? NO_COORDINATES;',
  '  const ripple = view.ripple ?? NO_RIPPLE;',
  '  const numbers = [view.x, view.y, view.rotation, view.scale, view.centerX, view.centerY, ripple.x, ripple.y, ripple.dx, ripple.dy, ripple.radius, ripple.twist];',
  '  if (!numbers.every(Number.isFinite) || !(view.scale > 0) || !(ripple.radius > 0)) {',
  '    throw new Error(`coordinates: bad frame ${JSON.stringify(frame)}`);',
  '  }',
  '  const canvas = program.gl.canvas as HTMLCanvasElement;',
  "  // A canvas that is not laid out (display: none) shows nothing, so any ratio does.",
  '  const across = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;',
  '  const down = canvas.clientHeight > 0 ? canvas.height / canvas.clientHeight : 1;',
  '  const uniforms = program.uniforms;',
  '  uniforms.uKitView = { value: [view.x * across, -view.y * down, -view.rotation, view.scale] };',
  '  uniforms.uKitCenter = { value: [view.centerX * across, canvas.height - view.centerY * down] };',
  '  uniforms.uKitRipple = { value: [ripple.x * across, canvas.height - ripple.y * down, ripple.dx * across, -ripple.dy * down] };',
  '  uniforms.uKitRippleShape = { value: [ripple.radius * Math.sqrt(across * down), -ripple.twist] };',
  '  uniforms.uKitSize = { value: [canvas.width, canvas.height] };',
  '}',
].join('\n')

const COMMENT =
  'Called once per frame: shifts, turns and scales the pattern and stirs it\nlocally around a point (see CoordinateFrame), or null for none.'

function propsDeclaration(file: SourceFile, name: string) {
  const declaration = file.getInterface(name) ?? file.getTypeAlias(name)
  if (!declaration) throw new ShapeError(`no interface or type ${name}`)
  return declaration
}

const READS: Record<ShaderCoordinate, string> = {
  gl_FragCoord: 'every `gl_FragCoord.xy` the fragment shader reads',
  vUv: 'the first `vUv` its `main()` reads (so what it works out from the screen itself afterwards stays put)',
}

// The transform for one component, `id` in its numbering.
export function coordinatesTransform(id: string, options: CoordinatesOptions): TsxTransform {
  return {
    id,
    file: `${options.component}.tsx`,
    kind: 'tsx',
    summary: 'A coordinates prop: a per-frame getter that shifts, turns and scales the pattern and stirs it locally',
    description: `A \`coordinates\` prop, a getter called once per frame before the frame is drawn that returns a \`CoordinateFrame\` or null: a shift, a turn about a centre and a scale of the whole pattern (a sheet's glide and twist, a ball's spin read as a scroll), and a ripple, a local shift and swirl around one point fading with distance. They are written to \`uKit…\` uniforms, and ${READS[options.coordinate]} goes through \`kitWarp\`, which maps each pixel to where it reads the unmoved pattern.`,
    apply(file) {
      addCoordinatesGetter(file, options)
    },
  }
}

// Wraps the shader's coordinate in kitWarp and writes the getter's frame
// into its uniforms before every render.
export function addCoordinatesGetter(file: SourceFile, options: CoordinatesOptions) {
  const ogl = exactlyOne(
    file.getImportDeclarations().filter((declaration) => declaration.getModuleSpecifierValue() === 'ogl'),
    "import from 'ogl'",
  )
  if (!ogl.getNamedImports().some((named) => named.getName() === 'Program')) throw new ShapeError("Program is not imported from 'ogl'")
  objectTypeNamed(file, options.propsType)
  if (options.props === 'propsRef') {
    const kept = componentBody(file, options.component)
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .some((declaration) => declaration.getName() === 'propsRef')
    if (!kept) throw new ShapeError(`component ${options.component} keeps no propsRef`)
  }

  const literal = shaderLiteral(file, options.shader)
  const text = literal.getText()
  literal.replaceWithText(`\`${warpShader(text.slice(1, -1), options.coordinate)}\``)

  const getter = options.props === 'propsRef' ? 'propsRef.current.coordinates' : 'coordinatesRef.current'
  const effect = effectDeclaring(file, options.loop)
  for (const name of [options.loop, ...(options.alsoDrawing ?? [])]) {
    const render = exactlyOne(callsTo(functionBody(effect, name), 'renderer.render'), `renderer.render in ${name}`)
    const statement = render.getParent()
    const block = statement?.getParent()
    if (!statement || !Node.isExpressionStatement(statement) || !block || !Node.isBlock(block)) {
      throw new ShapeError(`renderer.render in ${name} is not a statement of a block`)
    }
    insertStatements(block, { before: statement }, `writeCoordinates(program, ${getter}?.() ?? null);`)
  }
  if (options.props === 'destructured') addFrameRef(file, options.component, 'coordinatesRef', 'coordinates')

  // Last: these insert text, which leaves earlier node handles stale.
  insertBeforeStatement(file, propsDeclaration(file, options.propsType), TYPESCRIPT)
  addMember(file, options.propsType, { name: 'coordinates', type: '() => CoordinateFrame | null', optional: true, comment: COMMENT })
  if (options.props === 'destructured') addDestructuredProp(file, options.component, 'coordinates')
}
