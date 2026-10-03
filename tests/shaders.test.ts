// The sheet profile's WebGL backgrounds in a real browser: every shader the
// coordinates transform edits still compiles and links (with the kitWarp
// uniforms active), and kitWarp, fed by the components' own
// writeCoordinates, moves a pattern the way CoordinateFrame says. GLSL is
// only checked by a GPU driver, so this runs in headless Firefox and skips,
// saying so, where there is none.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { Node, Project, SyntaxKind, ts } from 'ts-morph'
import { warpShader } from '../src/ast/coordinates.ts'
import { applyTransforms, forProfile } from '../src/transform.ts'
import { COMPONENTS } from '../src/transforms/index.ts'
import { PINNED_COMMIT, readUpstreamFile } from '../src/upstream.ts'
import { UPSTREAM_CHECKOUT, UPSTREAM_SKIP } from './support/upstream.ts'

const FIREFOX = (process.env.PATH ?? '')
  .split(delimiter)
  .map((dir) => join(dir, 'firefox'))
  .find((path) => existsSync(path))
const SKIP = UPSTREAM_SKIP || (FIREFOX ? false : 'needs firefox on the PATH to compile the shaders')

interface Shaders {
  component: string
  vertex: string
  fragment: string
}

// The sheet's build of each component that takes the coordinates getter:
// its vertex and fragment shader, and the file's TypeScript.
async function built(): Promise<{ shaders: Shaders[]; files: Map<string, string> }> {
  const shaders: Shaders[] = []
  const files = new Map<string, string>()
  const project = new Project({ useInMemoryFileSystem: true })
  for (const spec of Object.values(COMPONENTS)) {
    const sheet = forProfile(spec, 'sheet')
    if (!sheet.transforms.some((transform) => transform.id.endsWith('-coordinates-getter'))) continue
    const sources = new Map<string, string>()
    for (const file of spec.files) {
      sources.set(file, await readUpstreamFile({ commit: PINNED_COMMIT, checkout: UPSTREAM_CHECKOUT }, `${spec.upstreamDir}/${file}`))
    }
    const text = applyTransforms(sheet, sources).get(`${spec.name}.tsx`)!
    files.set(spec.name, text)
    const literals = project
      .createSourceFile(`/${spec.name}.tsx`, text)
      .getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)
      .map((literal) => literal.getLiteralText())
    const one = (what: string, matches: string[]) => {
      assert.equal(matches.length, 1, `${spec.name}: ${matches.length} ${what} shaders`)
      return matches[0]
    }
    shaders.push({
      component: spec.name,
      vertex: one('vertex', literals.filter((glsl) => glsl.includes('gl_Position'))),
      fragment: one('kitWarp fragment', literals.filter((glsl) => glsl.includes('kitWarp('))),
    })
  }
  return { shaders, files }
}

// CoordinateFrame, its defaults and writeCoordinates as a component has
// them, as JavaScript for the page.
function writeCoordinatesScript(tsx: string): string {
  const file = new Project({ useInMemoryFileSystem: true }).createSourceFile('/component.tsx', tsx)
  const parts = [
    file.getInterfaceOrThrow('CoordinateFrame'),
    file.getVariableStatementOrThrow((statement) => statement.getDeclarations().some((declaration) => declaration.getName() === 'NO_COORDINATES')),
    file.getVariableStatementOrThrow((statement) => statement.getDeclarations().some((declaration) => declaration.getName() === 'NO_RIPPLE')),
    file.getFunctionOrThrow('writeCoordinates'),
  ]
  const source = parts.map((part: Node) => part.getText()).join('\n')
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

// A probe: a dot at uDot (drawing-buffer pixels) through the transform's
// own warpShader.
const PROBE_VERTEX = 'attribute vec2 position;\nvoid main() { gl_Position = vec4(position, 0.0, 1.0); }\n'
const PROBE_FRAGMENT = warpShader(
  'precision highp float;\nuniform vec2 uDot;\nvoid main() {\n  float on = length(gl_FragCoord.xy - uDot) < 4.0 ? 1.0 : 0.0;\n  gl_FragColor = vec4(on, 0.0, 0.0, 1.0);\n}\n',
  'gl_FragCoord',
)

// The canvas is 32 × 32 CSS px with a 64 × 64 buffer, so the ratio between
// the two is part of what is checked. The dot is at (10, 10) CSS px.
const CASES = [
  { name: 'no frame', frame: null, lit: [10, 10], dark: [] },
  { name: 'shift', frame: { x: 6, y: 4, rotation: 0, scale: 1, centerX: 16, centerY: 16, ripple: null }, lit: [16, 14], dark: [10, 10] },
  { name: 'quarter turn clockwise', frame: { x: 0, y: 0, rotation: Math.PI / 2, scale: 1, centerX: 16, centerY: 16, ripple: null }, lit: [22, 10], dark: [10, 10] },
  { name: 'scale', frame: { x: 0, y: 0, rotation: 0, scale: 2, centerX: 16, centerY: 16, ripple: null }, lit: [4, 4], dark: [10, 10] },
  {
    name: 'ripple shift',
    frame: { x: 0, y: 0, rotation: 0, scale: 1, centerX: 16, centerY: 16, ripple: { x: 10, y: 10, dx: 5, dy: 0, radius: 100, twist: 0 } },
    lit: [15, 10],
    dark: [10, 10],
  },
  {
    name: 'ripple twist',
    frame: { x: 0, y: 0, rotation: 0, scale: 1, centerX: 16, centerY: 16, ripple: { x: 16, y: 16, dx: 0, dy: 0, radius: 1000, twist: Math.PI / 2 } },
    lit: [22, 10],
    dark: [10, 10],
  },
]

function page(shaders: Shaders[], writeCoordinates: string): string {
  const script = `
${writeCoordinates}
const SHADERS = ${JSON.stringify(shaders)};
const PROBE = ${JSON.stringify({ vertex: PROBE_VERTEX, fragment: PROBE_FRAGMENT })};
const CASES = ${JSON.stringify(CASES)};

function compile(gl, vertex, fragment) {
  const program = gl.createProgram();
  const logs = [];
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) logs.push(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) logs.push(gl.getProgramInfoLog(program));
  const uniforms = [];
  for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) uniforms.push(gl.getActiveUniform(program, index).name);
  return { program, logs, uniforms };
}

function canvas(context) {
  const element = document.createElement('canvas');
  element.width = 64;
  element.height = 64;
  element.style.width = '32px';
  element.style.height = '32px';
  document.body.append(element);
  const gl = element.getContext(context);
  if (!gl) throw new Error('no ' + context + ' context');
  return gl;
}

function run() {
  const results = { shaders: [], probe: [] };
  for (const { component, vertex, fragment } of SHADERS) {
    const gl = canvas(fragment.startsWith('#version 300 es') ? 'webgl2' : 'webgl');
    const { logs, uniforms } = compile(gl, vertex, fragment);
    results.shaders.push({ component, logs, uniforms });
  }
  const gl = canvas('webgl');
  const { program, logs } = compile(gl, PROBE.vertex, PROBE.fragment);
  if (logs.length > 0) throw new Error('probe: ' + logs.join('\\n'));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const lit = (x, y) => {
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.round(x * 2), Math.round(64 - y * 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[0] > 127;
  };
  for (const { name, frame, lit: on, dark } of CASES) {
    const stand = { gl, uniforms: {} };
    writeCoordinates(stand, frame);
    for (const [uniform, { value }] of Object.entries(stand.uniforms)) {
      const location = gl.getUniformLocation(program, uniform);
      if (location === null) continue;
      if (value.length === 4) gl.uniform4fv(location, value);
      else gl.uniform2fv(location, value);
    }
    gl.uniform2fv(gl.getUniformLocation(program, 'uDot'), [20, 64 - 20]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    results.probe.push({ name, lit: lit(on[0], on[1]), dark: dark.length === 0 ? true : !lit(dark[0], dark[1]) });
  }
  return results;
}

let body;
try {
  body = JSON.stringify({ ok: run() });
} catch (error) {
  body = JSON.stringify({ error: String(error) + '\\n' + (error && error.stack) });
}
fetch('/result', { method: 'POST', body });
`
  return `<!doctype html><meta charset="utf-8"><title>shaders</title><body><script>${script}</script></body>`
}

function read(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => (text += chunk))
    request.on('end', () => resolve(text))
    request.on('error', reject)
  })
}

// Serves `html`, opens it in headless Firefox and returns what it posts back.
async function inFirefox(html: string): Promise<unknown> {
  const profile = mkdtempSync(join(tmpdir(), 'rbk-firefox-'))
  writeFileSync(
    join(profile, 'user.js'),
    ['browser.shell.checkDefaultBrowser', 'datareporting.policy.dataSubmissionEnabled', 'browser.aboutwelcome.enabled', 'toolkit.telemetry.reportingpolicy.firstRun']
      .map((pref) => `user_pref("${pref}", false);`)
      .join('\n'),
  )
  let resolve!: (value: string) => void
  const posted = new Promise<string>((done) => (resolve = done))
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/result') {
      resolve(await read(request))
      response.end()
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(html)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as { port: number }
  const firefox = spawn(FIREFOX!, ['--headless', '--no-remote', '--profile', profile, `http://127.0.0.1:${port}/`], { stdio: 'ignore' })
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Firefox posted no result within 90 s')), 90_000)
    })
    return JSON.parse(await Promise.race([posted, timeout]))
  } finally {
    clearTimeout(timer)
    firefox.kill()
    server.close()
    rmSync(profile, { recursive: true, force: true })
  }
}

test('the sheet profile’s edited shaders compile in Firefox, and kitWarp moves a pattern as CoordinateFrame says', { skip: SKIP, timeout: 120_000 }, async () => {
  const { shaders, files } = await built()
  assert.deepEqual(
    shaders.map(({ component }) => component).sort(),
    ['Aurora', 'Balatro', 'Galaxy', 'Iridescence', 'LiquidChrome', 'Plasma', 'RippleGrid', 'SoftAurora', 'Threads'],
  )
  const result = (await inFirefox(page(shaders, writeCoordinatesScript(files.get('Aurora')!)))) as {
    ok?: { shaders: { component: string; logs: string[]; uniforms: string[] }[]; probe: { name: string; lit: boolean; dark: boolean }[] }
    error?: string
  }
  assert.ok(result.ok, result.error ?? 'Firefox posted neither a result nor an error')
  for (const { component, logs, uniforms } of result.ok.shaders) {
    assert.deepEqual(logs, [], `${component} does not compile or link`)
    for (const uniform of ['uKitView', 'uKitCenter', 'uKitRipple', 'uKitRippleShape']) {
      assert.ok(uniforms.includes(uniform), `${component}: ${uniform} is not active (${uniforms.join(', ')})`)
    }
  }
  for (const { name, lit, dark } of result.ok.probe) {
    assert.ok(lit, `${name}: the dot is not where the frame moves it`)
    assert.ok(dark, `${name}: the dot is still where it was`)
  }
})
