// Each transform applied to React Bits at the pinned commit: it applies on
// top of the changes before it in its profile, the result type-checks, and it
// adds the API and code paths its change describes (checked on the structure,
// not the text). Each profile's set reproduces the props and key code paths
// of that project's versions, and a transform whose upstream shape is gone
// fails by name.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Node, Project, SyntaxKind, type SourceFile } from 'ts-morph'
import { compact, effectDeclaring, functionBody, objectTypeNamed } from '../src/ast/find.ts'
import { applyTransforms, createdFiles, forProfile, PROFILES, TransformError, type ComponentSpec, type Profile } from '../src/transform.ts'
import { COMPONENTS } from '../src/transforms/index.ts'
import { PINNED_COMMIT, readUpstreamFile } from '../src/upstream.ts'
import { typeErrors } from './support/typecheck.ts'
import { UPSTREAM_CHECKOUT, UPSTREAM_SKIP } from './support/upstream.ts'

const upstreamCache = new Map<string, Map<string, string>>()

async function upstream(spec: ComponentSpec): Promise<Map<string, string>> {
  let sources = upstreamCache.get(spec.name)
  if (!sources) {
    sources = new Map()
    for (const file of spec.files) {
      sources.set(file, await readUpstreamFile({ commit: PINNED_COMMIT, checkout: UPSTREAM_CHECKOUT }, `${spec.upstreamDir}/${file}`))
    }
    upstreamCache.set(spec.name, sources)
  }
  return sources
}

// The first profile that applies `id`, and the spec with that profile's
// transforms up to `id`, without it and with it.
function profileUpTo(spec: ComponentSpec, id: string): { profile: Profile; before: ComponentSpec; after: ComponentSpec } {
  const profile = PROFILES.find((candidate) => spec.profiles[candidate].includes(id))
  assert.ok(profile, `${spec.name} ${id} is in no profile`)
  const transforms = forProfile(spec, profile).transforms
  const index = transforms.findIndex((transform) => transform.id === id)
  return { profile, before: { ...spec, transforms: transforms.slice(0, index) }, after: { ...spec, transforms: transforms.slice(0, index + 1) } }
}

interface Output {
  tsx: SourceFile
  css: string
  // The files the transforms added, parsed; absent until a transform adds one.
  added: Map<string, SourceFile>
}

function output(spec: ComponentSpec, files: Map<string, string>): Output {
  const project = new Project({ useInMemoryFileSystem: true })
  const added = new Map<string, SourceFile>()
  for (const [file, text] of files) {
    if (!spec.files.includes(file)) added.set(file, project.createSourceFile(`/${file}`, text))
  }
  return {
    tsx: project.createSourceFile(`/${spec.name}.tsx`, files.get(`${spec.name}.tsx`)!),
    css: files.get(`${spec.name}.css`)!,
    added,
  }
}

// A props type's members as name (with ? when optional) → type, whitespace removed.
function members(file: SourceFile, name: string): Record<string, string> {
  const found = objectTypeNamed(file, name)
  return Object.fromEntries(
    found.getProperties().map((property) => [`${property.getName()}${property.hasQuestionToken() ? '?' : ''}`, compact(property.getTypeNodeOrThrow().getText())]),
  )
}

function body(file: SourceFile, name: string): string {
  return compact(functionBody(file, name).getText())
}

function includes(text: string, part: string, where: string) {
  assert.ok(text.includes(compact(part)), `${where} lacks ${part}`)
}

function excludes(text: string, part: string, where: string) {
  assert.ok(!text.includes(compact(part)), `${where} still has ${part}`)
}

// The component's destructured or declared props, in the component's own parameter.
function destructured(file: SourceFile, component: string): string[] {
  const declaration = file.getFunction(component) ?? file.getVariableDeclarationOrThrow(component).getInitializerOrThrow()
  const parameter = (declaration as { getParameters(): Node[] }).getParameters()[0]
  const pattern = parameter.getFirstChildByKind(SyntaxKind.ObjectBindingPattern)
  return pattern ? pattern.getElements().map((element) => element.getName()) : []
}

// The dependency list of the effect that declares `marker`.
function dependencies(file: SourceFile, marker: string): string[] {
  const call = effectDeclaring(file, marker).getParentOrThrow().getParentOrThrow()
  const list = Node.isCallExpression(call) ? call.getArguments()[1] : undefined
  assert.ok(list && Node.isArrayLiteralExpression(list), `the effect declaring ${marker} has no dependency list`)
  return list.getElements().map((element) => element.getText())
}

// The effect declaring `marker`, whitespace removed.
function effect(file: SourceFile, marker: string): string {
  return compact(effectDeclaring(file, marker).getText())
}

// Expectations for a params change: the prop's type, the component
// destructures it, and `loop` reads it and writes each of `writes`.
function paramsAdded(component: string, propsType: string, type: string, loop: string, writes: string[]) {
  return ({ tsx }: Output) => {
    assert.equal(members(tsx, propsType)['params?'], compact(type))
    assert.ok(destructured(tsx, component).includes('params'), `${component} does not destructure params`)
    for (const write of writes) includes(body(tsx, loop), write, loop)
  }
}

// Expectation that `removed` left the dependencies of the effect declaring
// `marker` and `kept` is still there.
function outOfDependencies(marker: string, removed: string[], kept: string) {
  return ({ tsx }: Output) => {
    const list = dependencies(tsx, marker)
    for (const name of removed) assert.ok(!list.includes(name), `${name} is still a dependency`)
    assert.ok(list.includes(kept), `${kept} left the dependencies too`)
  }
}

// Optional members: name → type, as members() reports them.
function optional(types: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(types).map(([name, type]) => [`${name}?`, compact(type)]))
}

// What each change adds, on the output with that change applied.
const EXPECTED: Record<string, Record<string, (out: Output) => void>> = {
  Waves: {
    '01-css-variable-fix': ({ css }) => {
      includes(compact(css), 'var(--x, -0.5rem)', 'Waves.css')
      includes(compact(css), 'var(--y, 50%)', 'Waves.css')
      assert.doesNotMatch(css, /var\(\s*[^-\s]/, 'a var() without a custom property is left')
    },
    '02-line-color-getter': ({ tsx }) => {
      assert.equal(members(tsx, 'WavesProps')['lineColor?'], 'LineColor')
      assert.equal(compact(tsx.getTypeAliasOrThrow('LineColor').getTypeNodeOrThrow().getText()), compact('string | (() => string)'))
      includes(body(tsx, 'drawLines'), "typeof lineColor === 'function' ? lineColor() : lineColor", 'drawLines')
    },
    '03-intersection-observer': ({ tsx }) => {
      const effect = compact(tsx.getVariableDeclarationOrThrow('Waves').getText())
      includes(effect, 'new IntersectionObserver', 'Waves')
      // On the window here; 11-container-pointer-listeners moves it to the container.
      includes(body(tsx, 'start'), "addEventListener('mousemove', onMouseMove)", 'start')
      includes(body(tsx, 'start'), 'requestAnimationFrame(tick)', 'start')
      includes(body(tsx, 'stop'), "removeEventListener('mousemove', onMouseMove)", 'stop')
      includes(body(tsx, 'stop'), 'cancelAnimationFrame(frameIdRef.current)', 'stop')
      includes(effect, 'observer.observe(container)', 'the effect')
      includes(effect, 'observer.disconnect()', 'the cleanup')
      const listeners = effect.split(compact("addEventListener('mousemove'")).length - 1
      assert.equal(listeners, 1, 'mousemove is attached only in start()')
    },
    '04-pointer-position-fix': ({ tsx }) => {
      includes(body(tsx, 'updateMouse'), 'container.getBoundingClientRect()', 'updateMouse')
      excludes(body(tsx, 'updateMouse'), 'boundingRef.current', 'updateMouse')
    },
    '05-motion-getter': ({ tsx }) => {
      assert.equal(members(tsx, 'WavesProps')['motion?'], '()=>Motion')
      assert.ok(destructured(tsx, 'Waves').includes('motion'))
      includes(body(tsx, 'movePoints'), '...motionRef.current?.()', 'movePoints')
    },
    '06-accumulated-clock': ({ tsx }) => {
      const move = body(tsx, 'movePoints')
      includes(move, 'phase.x += frameMs * waveSpeedX', 'movePoints')
      includes(move, 'Math.min(MAX_FRAME_MS', 'movePoints')
      // The point's own x, or with 14-sample-getter where it samples (sx).
      includes(move, '+ phase.x) *', 'movePoints')
      excludes(move, 'time * waveSpeedX', 'movePoints')
    },
    '07-paused-prop': ({ tsx }) => {
      assert.equal(members(tsx, 'WavesProps')['paused?'], 'boolean')
      assert.ok(destructured(tsx, 'Waves').includes('paused'))
      includes(body(tsx, 'tick'), 'frameIdRef.current = pausedRef.current ? null : requestAnimationFrame(tick)', 'tick')
      includes(body(tsx, 'tick'), 'if (pausedRef.current) phase.last = null', 'tick')
      includes(body(tsx, 'onResize'), 'requestFrameRef.current?.()', 'onResize')
    },
    '08-pointer-getter': ({ tsx }) => {
      assert.equal(members(tsx, 'WavesProps')['pointer?'], compact('() => { x: number; y: number } | null'))
      includes(body(tsx, 'tick'), 'const point = pointerRef.current()', 'tick')
      includes(body(tsx, 'tick'), 'else mouse.set = false', 'tick')
      const start = body(tsx, 'start')
      assert.ok(start.indexOf(compact('if (pointerRef.current) return;')) < start.indexOf(compact("addEventListener('mousemove'")), 'start returns before the listeners')
    },
    '09-displacement-getter': ({ tsx }) => {
      assert.equal(members(tsx, 'WavesProps')['displacement?'], compact('(lines: readonly (readonly Point[])[], time: number) => Displacement | null'))
      includes(body(tsx, 'movePoints'), 'shift = displacementRef.current ? displacementRef.current(lines, time) : null', 'movePoints')
      includes(body(tsx, 'moved'), '+ shiftX', 'moved')
      includes(body(tsx, 'drawLines'), 'moved(p, !isLast, line * points.length + idx)', 'drawLines')
    },
    '10-overscan': ({ tsx }) => {
      const props = members(tsx, 'WavesProps')
      assert.equal(props['overscanX?'], 'number')
      assert.equal(props['overscanY?'], 'number')
      const setLines = body(tsx, 'setLines')
      includes(setLines, '+ 2 * overscanX', 'setLines')
      assert.ok(setLines.indexOf('overscanX}=configRef.current') < setLines.indexOf('constoWidth'), 'the overscan is read before the sizes use it')
    },
    '11-container-pointer-listeners': ({ tsx }) => {
      includes(body(tsx, 'start'), "container?.addEventListener('mousemove', onMouseMove)", 'start')
      includes(body(tsx, 'stop'), "container?.removeEventListener('mousemove', onMouseMove)", 'stop')
      const waves = effect(tsx, 'tick')
      excludes(waves, "window.addEventListener('mousemove'", 'the effect')
      excludes(waves, 'touchmove', 'the effect')
      excludes(waves, 'onTouchMove', 'the effect')
    },
    '12-mouseleave-ends-stroke': ({ tsx }) => {
      includes(effect(tsx, 'tick'), 'function onMouseLeave() { mouseRef.current.set = false; }', 'the effect')
      includes(body(tsx, 'start'), "container?.addEventListener('mouseleave', onMouseLeave)", 'start')
      includes(body(tsx, 'stop'), "container?.removeEventListener('mouseleave', onMouseLeave)", 'stop')
    },
    '13-noise-module': ({ tsx, added }) => {
      const noise = added.get('noise.ts')
      assert.ok(noise, 'no noise.ts')
      assert.equal(tsx.getClass('Noise'), undefined, 'Noise is still in Waves.tsx')
      assert.equal(tsx.getClass('Grad'), undefined, 'Grad is still in Waves.tsx')
      assert.ok(noise.getClassOrThrow('Noise').isExported(), 'noise.ts does not export Noise')
      assert.ok(noise.getClass('Grad'), 'noise.ts has no Grad')
      const perlin = noise.getClassOrThrow('Noise').getMethodOrThrow('perlin2')
      assert.deepEqual(
        perlin.getParameters().map((parameter) => compact(parameter.getText())),
        ['x:number', 'y:number', 'periodX=MAX_NOISE_PERIOD', 'periodY=MAX_NOISE_PERIOD'],
      )
      const perlinBody = compact(perlin.getBodyOrThrow().getText())
      includes(perlinBody, 'this.gradP[X1 + this.perm[Y1]]', 'perlin2')
      excludes(perlinBody, '&= 255', 'perlin2')
      assert.equal(compact(noise.getVariableDeclarationOrThrow('NOISE_SCALE').getInitializerOrThrow().getText()), '{x:0.002,y:0.0015}')
      assert.ok(noise.getFunction('noisePeriod')?.isExported(), 'noise.ts does not export noisePeriod')
      includes(body(tsx, 'movePoints'), 'NOISE_SCALE.x', 'movePoints')
      assert.ok(tsx.getImportDeclaration((declaration) => declaration.getModuleSpecifierValue() === './noise.ts'), 'Waves.tsx does not import noise.ts')
    },
    '14-sample-getter': ({ tsx }) => {
      const props = members(tsx, 'WavesProps')
      assert.equal(props['sample?'], compact('(lines: readonly (readonly Point[])[], time: number) => Displacement | null'))
      assert.equal(props['patternPeriod?'], compact('{ x: number; y: number }'))
      const move = body(tsx, 'movePoints')
      includes(move, 'const at = sampleRef.current ? sampleRef.current(lines, time) : null', 'movePoints')
      includes(move, 'throw new Error(`Waves: ${at.x.length} sample points for ${count} grid points`)', 'movePoints')
      includes(move, 'lines.forEach((pts, line) =>', 'movePoints')
      includes(move, 'const k = line * pts.length + idx', 'movePoints')
      includes(move, 'noise.perlin2((sx + phase.x) * NOISE_SCALE.x, (sy + phase.y) * NOISE_SCALE.y, period.x, period.y)', 'movePoints')
      assert.ok(move.indexOf(compact('const at =')) < move.indexOf(compact('lines.forEach(')), 'the sample is read before the points move')
      includes(compact(tsx.getVariableDeclarationOrThrow('Waves').getText()), 'patternPeriod ? noisePeriod(patternPeriod.x, NOISE_SCALE.x) : MAX_NOISE_PERIOD', 'Waves')
    },
  },
  Aurora: {
    '01-params-getter': ({ tsx }) => {
      assert.equal(members(tsx, 'AuroraProps')['params?'], '()=>FrameParams')
      includes(body(tsx, 'update'), 'const current = { ...propsRef.current, ...propsRef.current.params?.() }', 'update')
      includes(body(tsx, 'update'), 'current.amplitude', 'update')
    },
    '02-accumulated-clock': ({ tsx }) => {
      const update = body(tsx, 'update')
      includes(update, 'clock.value += frameMs * 0.001 * speed', 'update')
      includes(update, 'current.time === undefined ? clock.value : current.time * speed * 0.1', 'update')
      excludes(update, 't * 0.01', 'update')
    },
    '03-paused-prop': ({ tsx }) => {
      assert.equal(members(tsx, 'AuroraProps')['paused?'], 'boolean')
      includes(body(tsx, 'update'), 'animateId = propsRef.current.paused ? null : requestAnimationFrame(update)', 'update')
      includes(body(tsx, 'update'), 'clock.last = propsRef.current.paused ? null : t', 'update')
      includes(body(tsx, 'resize'), 'requestFrameRef.current?.()', 'resize')
    },
  },
  Iridescence: {
    '01-accumulated-clock': ({ tsx }) => {
      includes(body(tsx, 'update'), 'program.uniforms.uTime.value = clock.value', 'update')
      includes(body(tsx, 'update'), 'clock.value += frameMs * 0.001', 'update')
    },
    '02-paused-prop': ({ tsx }) => {
      assert.equal(members(tsx, 'IridescenceProps')['paused?'], 'boolean')
      assert.ok(destructured(tsx, 'Iridescence').includes('paused'))
      includes(body(tsx, 'update'), 'animateId = pausedRef.current ? null : requestAnimationFrame(update)', 'update')
      includes(body(tsx, 'resize'), 'requestFrameRef.current?.()', 'resize')
    },
    '03-params-getter': paramsAdded('Iridescence', 'IridescenceProps', '() => { color?: [number, number, number] }', 'update', [
      'const current = { ...colorRef.current, ...colorRef.current.params?.() }',
      'program.uniforms.uColor.value.set(...current.color)',
    ]),
    '04-color-out-of-deps': outOfDependencies('update', ['color'], 'speed'),
  },
  Threads: {
    '01-params-getter': (out) => {
      paramsAdded('Threads', 'ThreadsProps', '() => { color?: [number, number, number] }', 'update', [
        'const { color, amplitude, distance, enableMouseInteraction } = { ...propsRef.current, ...propsRef.current.params?.() }',
      ])(out)
      includes(compact(out.tsx.getText()), 'propsRef.current = { color, amplitude, distance, enableMouseInteraction, params }', 'Threads')
    },
    '02-dpr-cap': ({ tsx }) => includes(body(tsx, 'resize'), 'Math.min(window.devicePixelRatio || 1, 1.5)', 'resize'),
  },
  Balatro: {
    '01-params-getter': (out) => {
      paramsAdded('Balatro', 'BalatroProps', "() => Partial<Pick<BalatroProps, 'color1' | 'color2' | 'color3'>>", 'update', [
        'const colors = { ...colorsRef.current, ...colorsRef.current.params?.() }',
        'program.uniforms.uColor1.value = hexToVec4(colors.color1)',
        'program.uniforms.uColor3.value = hexToVec4(colors.color3)',
      ])(out)
      includes(compact(out.tsx.getText()), 'colorsRef.current = { color1, color2, color3, params }', 'Balatro')
    },
    '02-colors-out-of-deps': outOfDependencies('update', ['color1', 'color2', 'color3'], 'spinRotation'),
  },
  LiquidChrome: {
    '01-params-getter': paramsAdded('LiquidChrome', 'LiquidChromeProps', '() => { baseColor?: [number, number, number] }', 'update', [
      'const current = { ...colorRef.current, ...colorRef.current.params?.() }',
      '(program.uniforms.uBaseColor.value as Float32Array).set(current.baseColor)',
    ]),
    '02-color-out-of-deps': outOfDependencies('update', ['baseColor'], 'speed'),
  },
  Galaxy: {
    '01-params-getter': paramsAdded('Galaxy', 'GalaxyProps', "() => Partial<Pick<GalaxyProps, 'hueShift' | 'saturation' | 'lightMode'>>", 'update', [
      'const current = { ...frameRef.current, ...frameRef.current.params?.() }',
      'program.uniforms.uHueShift.value = current.hueShift',
      'program.uniforms.uLightMode.value = current.lightMode ? 1 : 0',
    ]),
    '02-frame-props-out-of-deps': outOfDependencies('update', ['hueShift', 'saturation', 'lightMode'], 'transparent'),
    '03-transparent-light-mode': ({ tsx }) => {
      const galaxy = effect(tsx, 'update')
      excludes(galaxy, 'gl.clearColor(1, 1, 1, 1)', 'the effect')
      includes(galaxy, 'if (transparent) { gl.enable(gl.BLEND);', 'the effect')
    },
  },
  Plasma: {
    '01-params-getter': (out) => {
      paramsAdded('Plasma', 'PlasmaProps', "() => Partial<Pick<PlasmaProps, 'color' | 'lightMode'>>", 'loop', ['applyFrameParams();'])(out)
      includes(body(out.tsx, 'renderStaticFrame'), 'applyFrameParams();', 'renderStaticFrame')
      includes(effect(out.tsx, 'loop'), '(program.uniforms.uCustomColor.value as Float32Array).set(hexToRgb(current.color))', 'the effect')
    },
    '02-frame-props-out-of-deps': outOfDependencies('loop', ['color', 'lightMode'], 'speed'),
  },
  SoftAurora: {
    '01-params-getter': paramsAdded('SoftAurora', 'SoftAuroraProps', "() => Partial<Pick<SoftAuroraProps, 'color1' | 'color2' | 'lightMode'>>", 'update', [
      'const current = { ...frameRef.current, ...frameRef.current.params?.() }',
      'program.uniforms.uColor2.value = hexToVec3(current.color2)',
      'program.uniforms.uLightMode.value = current.lightMode ? 1 : 0',
    ]),
    '02-frame-props-out-of-deps': outOfDependencies('update', ['color1', 'color2', 'lightMode'], 'speed'),
  },
  RippleGrid: {
    '01-params-getter': paramsAdded('RippleGrid', 'Props', '() => { gridColor?: string; lightMode?: boolean }', 'render', [
      'const frame = paramsRef.current?.()',
      'if (frame?.gridColor !== undefined) uniforms.gridColor.value = hexToRgb(frame.gridColor)',
      'if (frame?.lightMode !== undefined) uniforms.lightMode.value = frame.lightMode',
    ]),
    '02-dpr-cap': ({ tsx }) => includes(effect(tsx, 'render'), 'dpr: Math.min(window.devicePixelRatio, 1.5)', 'the effect'),
  },
}

type Props = [string, Record<string, string>]

const WAVES_SITE_PROPS: Props = [
  'WavesProps',
  {
    'lineColor?': 'LineColor',
    'motion?': '()=>Motion',
    'pointer?': compact('() => { x: number; y: number } | null'),
    'displacement?': compact('(lines: readonly (readonly Point[])[], time: number) => Displacement | null'),
    'sample?': compact('(lines: readonly (readonly Point[])[], time: number) => Displacement | null'),
    'patternPeriod?': compact('{ x: number; y: number }'),
    'backgroundColor?': 'string',
    'waveSpeedX?': 'number',
    'waveSpeedY?': 'number',
    'waveAmpX?': 'number',
    'waveAmpY?': 'number',
    'xGap?': 'number',
    'yGap?': 'number',
    'overscanX?': 'number',
    'overscanY?': 'number',
    'friction?': 'number',
    'tension?': 'number',
    'maxCursorMove?': 'number',
    'paused?': 'boolean',
    'style?': 'CSSProperties',
    'className?': 'string',
  },
]

const AURORA_PROPS: Props = [
  'AuroraProps',
  {
    'colorStops?': 'string[]',
    'amplitude?': 'number',
    'blend?': 'number',
    'time?': 'number',
    'speed?': 'number',
    'lightMode?': 'boolean',
    'params?': '()=>FrameParams',
    'paused?': 'boolean',
  },
]

const IRIDESCENCE_SITE_PROPS: Props = [
  'IridescenceProps',
  { 'color?': '[number,number,number]', 'speed?': 'number', 'amplitude?': 'number', 'mouseReact?': 'boolean', 'paused?': 'boolean' },
]

const WAVES_SHEET_PROPS: Props = [
  'WavesProps',
  Object.fromEntries(
    Object.entries(WAVES_SITE_PROPS[1]).filter(([name]) => !['pointer?', 'displacement?', 'sample?', 'patternPeriod?', 'overscanX?', 'overscanY?'].includes(name)),
  ),
]

const IRIDESCENCE_SHEET_PROPS: Props = ['IridescenceProps', { ...IRIDESCENCE_SITE_PROPS[1], ...optional({ params: '() => { color?: [number, number, number] }' }) }]

// The seven the sheet added have one set, which both profiles apply.
const THREADS_PROPS: Props = [
  'ThreadsProps',
  optional({
    color: '[number, number, number]',
    amplitude: 'number',
    distance: 'number',
    enableMouseInteraction: 'boolean',
    params: '() => { color?: [number, number, number] }',
  }),
]

const BALATRO_PROPS: Props = [
  'BalatroProps',
  optional({
    spinRotation: 'number',
    spinSpeed: 'number',
    offset: '[number, number]',
    color1: 'string',
    color2: 'string',
    color3: 'string',
    contrast: 'number',
    lighting: 'number',
    spinAmount: 'number',
    pixelFilter: 'number',
    spinEase: 'number',
    isRotate: 'boolean',
    mouseInteraction: 'boolean',
    params: "() => Partial<Pick<BalatroProps, 'color1' | 'color2' | 'color3'>>",
  }),
]

const LIQUID_CHROME_PROPS: Props = [
  'LiquidChromeProps',
  optional({
    baseColor: '[number, number, number]',
    speed: 'number',
    amplitude: 'number',
    frequencyX: 'number',
    frequencyY: 'number',
    interactive: 'boolean',
    params: '() => { baseColor?: [number, number, number] }',
  }),
]

const GALAXY_PROPS: Props = [
  'GalaxyProps',
  optional({
    focal: '[number, number]',
    rotation: '[number, number]',
    starSpeed: 'number',
    density: 'number',
    hueShift: 'number',
    disableAnimation: 'boolean',
    speed: 'number',
    mouseInteraction: 'boolean',
    glowIntensity: 'number',
    saturation: 'number',
    mouseRepulsion: 'boolean',
    twinkleIntensity: 'number',
    rotationSpeed: 'number',
    repulsionStrength: 'number',
    autoCenterRepulsion: 'number',
    transparent: 'boolean',
    lightMode: 'boolean',
    params: "() => Partial<Pick<GalaxyProps, 'hueShift' | 'saturation' | 'lightMode'>>",
  }),
]

const PLASMA_PROPS: Props = [
  'PlasmaProps',
  optional({
    color: 'string',
    speed: 'number',
    direction: "'forward' | 'reverse' | 'pingpong'",
    scale: 'number',
    opacity: 'number',
    mouseInteractive: 'boolean',
    renderScale: 'number',
    maxDpr: 'number',
    targetFps: 'number',
    iterations: 'number',
    lightMode: 'boolean',
    params: "() => Partial<Pick<PlasmaProps, 'color' | 'lightMode'>>",
  }),
]

const SOFT_AURORA_PROPS: Props = [
  'SoftAuroraProps',
  optional({
    speed: 'number',
    scale: 'number',
    brightness: 'number',
    color1: 'string',
    color2: 'string',
    noiseFrequency: 'number',
    noiseAmplitude: 'number',
    bandHeight: 'number',
    bandSpread: 'number',
    octaveDecay: 'number',
    layerOffset: 'number',
    colorSpeed: 'number',
    enableMouseInteraction: 'boolean',
    mouseInfluence: 'number',
    lightMode: 'boolean',
    params: "() => Partial<Pick<SoftAuroraProps, 'color1' | 'color2' | 'lightMode'>>",
  }),
]

const RIPPLE_GRID_PROPS: Props = [
  'Props',
  optional({
    enableRainbow: 'boolean',
    gridColor: 'string',
    rippleIntensity: 'number',
    gridSize: 'number',
    gridThickness: 'number',
    fadeDistance: 'number',
    vignetteStrength: 'number',
    glowIntensity: 'number',
    opacity: 'number',
    gridRotation: 'number',
    mouseInteraction: 'boolean',
    mouseInteractionRadius: 'number',
    lightMode: 'boolean',
    params: '() => { gridColor?: string; lightMode?: boolean }',
  }),
]

// The props of each project's versions, which its profile's set reproduces.
const REFERENCE_PROPS: Record<string, Record<Profile, Props>> = {
  Waves: { site: WAVES_SITE_PROPS, sheet: WAVES_SHEET_PROPS },
  Aurora: { site: AURORA_PROPS, sheet: AURORA_PROPS },
  Iridescence: { site: IRIDESCENCE_SITE_PROPS, sheet: IRIDESCENCE_SHEET_PROPS },
  Threads: { site: THREADS_PROPS, sheet: THREADS_PROPS },
  Balatro: { site: BALATRO_PROPS, sheet: BALATRO_PROPS },
  LiquidChrome: { site: LIQUID_CHROME_PROPS, sheet: LIQUID_CHROME_PROPS },
  Galaxy: { site: GALAXY_PROPS, sheet: GALAXY_PROPS },
  Plasma: { site: PLASMA_PROPS, sheet: PLASMA_PROPS },
  SoftAurora: { site: SOFT_AURORA_PROPS, sheet: SOFT_AURORA_PROPS },
  RippleGrid: { site: RIPPLE_GRID_PROPS, sheet: RIPPLE_GRID_PROPS },
}

test('the kit covers all ten backgrounds', () => {
  assert.deepEqual(Object.keys(COMPONENTS).sort(), Object.keys(REFERENCE_PROPS).sort())
  assert.equal(Object.keys(COMPONENTS).length, 10)
})

test('every transform has an expectation here, its file matches its component, and every profile applies known transforms in order', () => {
  for (const spec of Object.values(COMPONENTS)) {
    assert.deepEqual(
      spec.transforms.map((transform) => transform.id),
      Object.keys(EXPECTED[spec.name]),
      `${spec.name}: transforms and expectations differ`,
    )
    spec.transforms.forEach((transform, index) => {
      assert.match(transform.id, new RegExp(`^${String(index + 1).padStart(2, '0')}-[a-z0-9-]+$`), `${spec.name} ${transform.id} is numbered in order`)
      assert.ok(spec.files.includes(transform.file), `${spec.name} ${transform.id} changes ${transform.file}`)
      assert.ok(PROFILES.some((profile) => spec.profiles[profile].includes(transform.id)), `${spec.name} ${transform.id} is in no profile`)
    })
    for (const profile of PROFILES) forProfile(spec, profile)
  }
})

test('a profile naming an unknown transform or listing them out of order fails loud', () => {
  const spec = COMPONENTS.Aurora
  assert.throws(() => forProfile({ ...spec, profiles: { ...spec.profiles, sheet: ['01-params-getter', '09-nothing'] } }, 'sheet'), /profile sheet names 09-nothing/)
  assert.throws(() => forProfile({ ...spec, profiles: { ...spec.profiles, sheet: ['02-accumulated-clock', '01-params-getter'] } }, 'sheet'), /out of order/)
})

for (const spec of Object.values(COMPONENTS)) {
  test(`${spec.name}: upstream at the pinned commit type-checks on its own`, { skip: UPSTREAM_SKIP }, async () => {
    assert.deepEqual(typeErrors(spec.name, await upstream(spec)), [])
  })

  for (const transform of spec.transforms) {
    test(`${spec.name} ${transform.id}: applies after the changes before it in its profile, type-checks and adds what it describes`, { skip: UPSTREAM_SKIP }, async () => {
      const sources = await upstream(spec)
      const { before, after } = profileUpTo(spec, transform.id)
      const built = applyTransforms(after, sources)
      const expectation = EXPECTED[spec.name][transform.id]
      assert.throws(() => expectation(output(spec, applyTransforms(before, sources))), assert.AssertionError, 'the expectation already holds without the change')
      expectation(output(spec, built))
      assert.deepEqual(typeErrors(spec.name, built), [])
    })
  }

  for (const profile of PROFILES) {
    test(`${spec.name}: the ${profile} profile reproduces that project's props, keeps every change's code paths and type-checks`, { skip: UPSTREAM_SKIP }, async () => {
      const profiled = forProfile(spec, profile)
      const built = applyTransforms(profiled, await upstream(spec))
      const final = output(spec, built)
      const [name, props] = REFERENCE_PROPS[spec.name][profile]
      assert.deepEqual(members(final.tsx, name), props)
      for (const transform of profiled.transforms) EXPECTED[spec.name][transform.id](final)
      assert.deepEqual(typeErrors(spec.name, built), [])
      assert.deepEqual([...built.keys()], [...spec.files, ...createdFiles(profiled).map(([file]) => file)], 'the upstream files, then those the profile adds')
    })

    test(`${spec.name}: unchanged files pass through as fetched (${profile})`, { skip: UPSTREAM_SKIP }, async () => {
      const profiled = forProfile(spec, profile)
      const sources = await upstream(spec)
      const result = applyTransforms(profiled, sources)
      for (const file of spec.files.filter((name) => !profiled.transforms.some((transform) => transform.file === name))) {
        assert.equal(result.get(file), sources.get(file), file)
      }
    })
  }
}

test('a transform whose upstream shape is gone fails by name', { skip: UPSTREAM_SKIP }, async () => {
  const cases: [string, string, (text: string) => string, string][] = [
    ['Waves', 'Waves.tsx', (text) => text.replaceAll('updateMouse', 'trackPointer'), '04-pointer-position-fix'],
    ['Waves', 'Waves.css', (text) => text.replace(/var\(-0\.5rem\)/, '-0.5rem'), '01-css-variable-fix'],
    ['Waves', 'Waves.tsx', (text) => text.replace(/time \* waveSpeedX/, 'waveSpeedX * 2'), '06-accumulated-clock'],
    ['Aurora', 'Aurora.tsx', (text) => text.replace(/time = t \* 0\.01, /, ''), '02-accumulated-clock'],
    ['Iridescence', 'Iridescence.tsx', (text) => text.replace(/cancelAnimationFrame\(animateId\);/, ''), '02-paused-prop'],
    ['Iridescence', 'Iridescence.tsx', (text) => text.replace(/uColor: \{ value:/, 'uTint: { value:'), '03-params-getter'],
    ['Waves', 'Waves.tsx', (text) => text.replace(/function onTouchMove/, 'function onFingerMove'), '11-container-pointer-listeners'],
    ['Waves', 'Waves.tsx', (text) => text.replace(/X &= 255;/, 'X &= 127;'), '13-noise-module'],
    ['Waves', 'Waves.tsx', (text) => text.replace(/lines\.forEach\(pts => \{/, 'lines.forEach((pts, at, all) => {'), '14-sample-getter'],
    ['Threads', 'Threads.tsx', (text) => text.replace(/devicePixelRatio \|\| 1, 2\)/, 'devicePixelRatio || 1, 3)'), '02-dpr-cap'],
    ['Balatro', 'Balatro.tsx', (text) => text.replace(/\n {4}color2,\n/, '\n'), '02-colors-out-of-deps'],
    ['LiquidChrome', 'LiquidChrome.tsx', (text) => text.replace(/uBaseColor: \{ value:/, 'uTint: { value:'), '01-params-getter'],
    ['Galaxy', 'Galaxy.tsx', (text) => text.replace(/\} else if \(transparent\) \{/, '} else if (alpha) {'), '03-transparent-light-mode'],
    ['Plasma', 'Plasma.tsx', (text) => text.replace(/const renderStaticFrame/, 'const paintOnce').replace(/renderStaticFrame\(\)/g, 'paintOnce()'), '01-params-getter'],
    ['SoftAurora', 'SoftAurora.tsx', (text) => text.replace(/uLightMode: \{ value:/, 'uTheme: { value:'), '01-params-getter'],
    ['RippleGrid', 'RippleGrid.tsx', (text) => text.replace(/type Props = /, 'type GridProps = ').replace(/React\.FC<Props>/, 'React.FC<GridProps>'), '01-params-getter'],
  ]
  for (const [component, file, mutate, failing] of cases) {
    const spec = forProfile(COMPONENTS[component], profileUpTo(COMPONENTS[component], failing).profile)
    const sources = new Map(await upstream(spec))
    const original = sources.get(file)!
    sources.set(file, mutate(original))
    assert.notEqual(sources.get(file), original, `the ${component} mutation for ${failing} changed nothing`)
    assert.throws(
      () => applyTransforms(spec, sources),
      (error: unknown) => {
        assert.ok(error instanceof TransformError, String(error))
        assert.equal(error.transform, failing, error.message)
        assert.match(error.message, new RegExp(`^${component} ${failing} no longer applies: `))
        return true
      },
      `${component} with ${failing}'s shape removed still applied`,
    )
  }
})
