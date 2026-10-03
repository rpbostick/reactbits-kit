// The adapter's wiring, driven through a stub component that calls the
// getter props once per frame as the transformed components do, against the
// modules fed the same input directly.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ClothFollow, FOLLOW } from '../../src/modules/clothFollow.ts'
import { DRIFT_MS_PER_STOP } from '../../src/modules/colorDrive.ts'
import { colorAt, stopsByTheme } from '../../src/modules/palette.ts'
import { FEED_ATTRIBUTE, LEFT_BUTTON, PointerFeed, type FeedElement } from '../../src/modules/pointerFeed.ts'
import { RIPPLE, RippleField, rippleRadius, type Displacement, type GridPoint } from '../../src/modules/rippleField.ts'
import { SPIN, SphereSpin, type PatternCoordinates } from '../../src/modules/sphereSpin.ts'
import { BackgroundWiring, type ColorFrame, type EventTargets, type MouseEventFactory, type WiringOptions } from '../../src/react/wiring.ts'
import { wavesGrid } from '../support/grid.ts'

const FRAME_MS = 16
const RECT = { left: 100, top: 50, width: 800, height: 600 }

// A page clock the test moves by hand.
function surface() {
  const clock = { now: 0 }
  return { clock, surface: { now: () => clock.now, rect: () => RECT } }
}

// What a transformed component reads from its getter props in one frame.
interface Frame {
  params?: Record<string, unknown>
  lineColor?: string
  pointer?: { x: number; y: number } | null
  displacement?: Displacement | null
  sample?: PatternCoordinates | null
}

// The stub component: each frame it calls the getters it was given, as
// Waves (lineColor, pointer, sample, displacement) and the other nine
// (params) do.
function stubFrame(props: Record<string, unknown>, grid: GridPoint[][], time: number): Frame {
  const frame: Frame = {}
  if (typeof props.params === 'function') frame.params = props.params()
  if (typeof props.lineColor === 'function') frame.lineColor = props.lineColor()
  if (typeof props.pointer === 'function') frame.pointer = props.pointer()
  if (typeof props.sample === 'function') frame.sample = props.sample(grid, time)
  if (typeof props.displacement === 'function') frame.displacement = props.displacement(grid, time)
  return frame
}

// The element a background fills, at RECT on the page.
class StandIn extends EventTarget implements FeedElement {
  attributes = new Map<string, string>()
  classList = { toggle: () => undefined }
  getBoundingClientRect() {
    return { left: RECT.left, top: RECT.top }
  }
  setPointerCapture() {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string) {
    this.attributes.delete(name)
  }
}

function pointerEvent(type: string, clientX: number, clientY: number) {
  const target = { closest: () => null }
  const event = Object.assign(new Event(type), { button: LEFT_BUTTON, pointerType: 'mouse', pointerId: 1, clientX, clientY })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

// A drag from (110, 60) to (150, 60) in client coordinates, over two frames.
function drag(element: StandIn, clock: { now: number }) {
  element.dispatchEvent(pointerEvent('pointerdown', 110, 60))
  clock.now += FRAME_MS
  element.dispatchEvent(pointerEvent('pointermove', 130, 60))
  clock.now += FRAME_MS
  element.dispatchEvent(pointerEvent('pointermove', 150, 60))
}

function wired(options: WiringOptions) {
  const { clock, surface: page } = surface()
  const wiring = new BackgroundWiring(options, page)
  const element = new StandIn()
  const detach = wiring.attach(element)
  return { clock, wiring, element, detach }
}

test('colors feeds params each frame from the colour drive, through the same getter on every render', () => {
  const frames: ColorFrame[] = []
  const colors = (frame: ColorFrame) => {
    frames.push(frame)
    return { color1: frame.color, lightMode: frame.theme === 'light' }
  }
  const { clock, wiring } = wired({ colors, theme: 'dark' })
  const props = wiring.props()
  assert.deepEqual(Object.keys(props), ['params'])

  assert.deepEqual(stubFrame(props, [], 0).params, { color1: colorAt(stopsByTheme.dark, 0), lightMode: false })
  clock.now = 2 * DRIFT_MS_PER_STOP / 100
  stubFrame(props, [], clock.now)
  clock.now += 50
  const later = stubFrame(props, [], clock.now).params
  const position = frames[frames.length - 1].position
  assert.ok(position > 0, 'the drive drifts along the loop')
  assert.equal(later?.color1, colorAt(stopsByTheme.dark, position))

  const recolored = (frame: ColorFrame) => ({ color1: `next ${frame.theme}` })
  wiring.configure({ colors: recolored, theme: 'light' })
  assert.equal(wiring.props(), props, 'the getters stay the same, so the component does not re-run its effects')
  assert.deepEqual(stubFrame(wiring.props(), [], clock.now).params, { color1: 'next light' }, 'they read the latest options')
})

test("Waves takes its colour as lineColor, which must be a string", () => {
  const { wiring } = wired({ colorProp: 'lineColor', colors: (frame) => ({ lineColor: frame.color }) })
  assert.deepEqual(Object.keys(wiring.props()), ['lineColor'])
  assert.equal(stubFrame(wiring.props(), [], 0).lineColor, colorAt(stopsByTheme.light, 0))

  const { wiring: broken } = wired({ colorProp: 'lineColor', colors: () => ({ lineColour: '#fff' }) })
  assert.throws(() => stubFrame(broken.props(), [], 0), /colors\(\) returned lineColor undefined, not a string/)
})

test('without colors there is no colour getter, and the component keeps its own colour props', () => {
  assert.deepEqual(Object.keys(wired({}).wiring.props()), [])
})

test('the options that decide which modules exist cannot change on a mounted background', () => {
  const { wiring } = wired({ pointer: 'drag', ripple: true })
  assert.throws(() => wiring.configure({ pointer: 'none', ripple: true }), /pointer changed from "drag" to "none".*remount/)
  assert.throws(() => wiring.configure({ pointer: 'drag' }), /ripple changed/)
  assert.throws(() => wiring.configure({ pointer: 'drag', ripple: true, colors: () => ({}) }), /colors was given/)
  wiring.configure({ pointer: 'drag', ripple: true, momentum: false })

  // Module constants compare by value, so an inline object each render is the same option.
  const tuned = wired({ ripple: { PULL_PER_S: 8 }, spin: { CURVATURE: 0 } }).wiring
  tuned.configure({ ripple: { PULL_PER_S: 8 }, spin: { CURVATURE: 0 } })
  assert.throws(() => tuned.configure({ ripple: { PULL_PER_S: 9 }, spin: { CURVATURE: 0 } }), /ripple changed/)
  assert.throws(() => tuned.configure({ ripple: { PULL_PER_S: 8 } }), /spin changed/)
})

test('ripple, cloth and spin take the modules\' own constants or some of them changed; an unknown one fails loud', () => {
  const grid = wavesGrid(RECT.width, RECT.height, 20, 40)
  const drive = (options: WiringOptions, field: RippleField) => {
    const { clock, wiring, element } = wired(options)
    const reference = new PointerFeed()
    element.dispatchEvent(pointerEvent('pointerdown', 110, 60))
    reference.grab(10, 10, clock.now)
    const radius = rippleRadius(RECT.width, RECT.height)
    field.step(grid, { pointer: reference.current, stroke: reference.stroke, now: clock.now, radius })
    stubFrame(wiring.props(), grid, clock.now)
    clock.now += FRAME_MS
    element.dispatchEvent(pointerEvent('pointermove', 210, 90))
    reference.move(110, 40, clock.now)
    const wanted = field.step(grid, { pointer: reference.at(clock.now, { left: 0, top: 0, right: RECT.width, bottom: RECT.height }), stroke: reference.stroke, now: clock.now, radius })
    const actual = stubFrame(wiring.props(), grid, clock.now).displacement
    assert.ok(actual && wanted)
    assert.deepEqual([...actual.x], [...wanted.x])
  }
  drive({ pointer: 'none', ripple: true }, new RippleField())
  drive({ pointer: 'none', ripple: { PULL_PER_S: 8, PULL_SHARE: 0.7 } }, new RippleField({ ...RIPPLE, PULL_PER_S: 8, PULL_SHARE: 0.7 }))
  assert.throws(() => wired({ ripple: { PULL: 8 } as never }), /no constant PULL; the module has RADIUS_SHARE/)
  assert.deepEqual(wired({ spin: { PERIOD_PX: 4000 } }).wiring.props().patternPeriod, { x: 4000, y: 4000 })
})

test("spin gives Waves the sample a drag turns the ball to, and the pattern period; a fling spins on", () => {
  const grid = wavesGrid(RECT.width, RECT.height, 20, 40)
  const { clock, wiring, element } = wired({ pointer: 'none', spin: true })
  const props = wiring.props()
  assert.deepEqual(props.patternPeriod, { x: SPIN.PERIOD_PX, y: SPIN.PERIOD_PX })
  const view = { width: RECT.width, height: RECT.height }

  // The same ball, fed by hand with the drag in the surface's coordinates.
  const ball = new SphereSpin()
  const compare = (label: string) => {
    const actual = stubFrame(props, grid, clock.now).sample
    const wanted = ball.sample(grid, view, clock.now)
    assert.ok(actual, `${label} samples`)
    assert.deepEqual([...actual.x], [...wanted.x], label)
    assert.deepEqual([...actual.y], [...wanted.y], label)
  }
  compare('at rest')
  element.dispatchEvent(pointerEvent('pointerdown', 110, 60))
  ball.grab({ x: 10, y: 10 }, view, clock.now)
  for (let step = 1; step <= 6; step++) {
    clock.now += FRAME_MS
    element.dispatchEvent(pointerEvent('pointermove', 110 + 60 * step, 60 + 20 * step))
    ball.drag({ x: 10 + 60 * step, y: 10 + 20 * step }, view, clock.now)
    compare(`held frame ${step}`)
  }
  assert.ok(wiring.spin?.held, 'the drag holds the ball')
  element.dispatchEvent(pointerEvent('pointerup', 470, 180))
  ball.release(clock.now)
  assert.ok(wiring.spin?.spinning && ball.spinning, 'the fling spins it on')
  for (let step = 1; step <= 4; step++) {
    clock.now += 250
    compare(`spinning at ${step * 250} ms`)
  }

  // A cancelled pointer was not flung.
  element.dispatchEvent(pointerEvent('pointerdown', 110, 60))
  clock.now += FRAME_MS
  element.dispatchEvent(pointerEvent('pointermove', 400, 60))
  element.dispatchEvent(pointerEvent('pointercancel', 400, 60))
  assert.equal(wiring.spin?.spinning, false)
  assert.equal(wiring.spin?.held, false)
})

test('reduced motion stills the ripple, the cloth and the spin', () => {
  const grid = wavesGrid(RECT.width, RECT.height, 20, 40)
  const { clock, wiring, element } = wired({ pointer: 'none', ripple: true, cloth: true, spin: true, reducedMotion: true })
  assert.equal(wiring.spin?.reducedMotion, true)
  const before = stubFrame(wiring.props(), grid, clock.now).sample
  const resting = before && [...before.x]
  drag(element, clock)
  const frame = stubFrame(wiring.props(), grid, clock.now)
  assert.equal(frame.displacement, null)
  assert.deepEqual(frame.sample && [...frame.sample.x], resting, 'the ball did not turn')
})

test("pointer 'drag' gives Waves the dragged point in client coordinates, coasting after a fling with momentum", () => {
  const { clock, wiring, element, detach } = wired({ pointer: 'drag' })
  assert.equal(element.attributes.has(FEED_ATTRIBUTE), true, 'the drag feed is attached')
  assert.equal(stubFrame(wiring.props(), [], clock.now).pointer, null, 'no drag, no pointer')
  drag(element, clock)
  assert.deepEqual(stubFrame(wiring.props(), [], clock.now).pointer, { x: 150, y: 60 })
  element.dispatchEvent(pointerEvent('pointerup', 150, 60))
  clock.now += FRAME_MS
  const coasting = stubFrame(wiring.props(), [], clock.now).pointer
  assert.ok(coasting && coasting.x > 150, `a fling coasts on: ${JSON.stringify(coasting)}`)

  detach()
  assert.equal(element.attributes.has(FEED_ATTRIBUTE), false, 'detached')
})

test("without momentum the pointer ends with the drag; pointer 'none' turns Waves' own cursor response off", () => {
  const still = wired({ pointer: 'drag', momentum: false })
  drag(still.element, still.clock)
  still.element.dispatchEvent(pointerEvent('pointerup', 150, 60))
  still.clock.now += FRAME_MS
  assert.equal(stubFrame(still.wiring.props(), [], still.clock.now).pointer, null)

  const none = wired({ pointer: 'none' })
  drag(none.element, none.clock)
  assert.equal(stubFrame(none.wiring.props(), [], none.clock.now).pointer, null)
})

test('ripple and cloth give Waves the displacement the modules compute for the same drag, and the overscan their reach needs', () => {
  const reach = RIPPLE.MAX_RADIUS_PX * RIPPLE.MAX_DISPLACEMENT_SHARE + FOLLOW.MAX_SHIFT_PX
  const grid = wavesGrid(RECT.width, RECT.height, 20, 40, reach, reach)
  const { clock, wiring, element } = wired({ pointer: 'none', ripple: true, cloth: true })
  const props = wiring.props()
  assert.equal(props.overscanX, reach)
  assert.equal(props.overscanY, reach)
  assert.equal(wired({ ripple: true }).wiring.props().overscanX, RIPPLE.MAX_RADIUS_PX * RIPPLE.MAX_DISPLACEMENT_SHARE)

  // The same modules, fed by hand with what the wiring should give them.
  const ripple = new RippleField()
  const cloth = new ClothFollow()
  const radius = rippleRadius(RECT.width, RECT.height)
  const expected = (pointer: { x: number; y: number } | null, held: { x: number; y: number } | null, stroke: number, time: number) => {
    const stir = ripple.step(grid, { pointer, stroke, now: time, radius })
    cloth.step({ pointer: held, stroke, now: time, width: RECT.width, height: RECT.height })
    return cloth.displace(grid, stir)
  }

  // The drag as a feed of its own: the ripple follows the coast after a
  // fling, the cloth only the held point.
  const reference = new PointerFeed()
  const bounds = { left: 0, top: 0, right: RECT.width, bottom: RECT.height }
  const compare = (label: string) => {
    const actual = stubFrame(props, grid, clock.now).displacement
    const wanted = expected(reference.at(clock.now, bounds), reference.current, reference.stroke, clock.now)
    assert.ok(actual && wanted, `${label} displaces`)
    assert.deepEqual([...actual.x], [...wanted.x], label)
    assert.deepEqual([...actual.y], [...wanted.y], label)
    return actual
  }

  assert.equal(stubFrame(props, grid, clock.now).displacement, expected(null, null, 0, clock.now), 'at rest: none')
  element.dispatchEvent(pointerEvent('pointerdown', 110, 60))
  reference.grab(10, 10, clock.now)
  for (let step = 1; step <= 6; step++) {
    clock.now += FRAME_MS
    element.dispatchEvent(pointerEvent('pointermove', 110 + 40 * step, 60 + 10 * step))
    reference.move(10 + 40 * step, 10 + 10 * step, clock.now)
    compare(`held frame ${step}`)
  }
  element.dispatchEvent(pointerEvent('pointerup', 350, 120))
  reference.release(clock.now)
  for (let step = 1; step <= 4; step++) {
    clock.now += FRAME_MS
    assert.ok(reference.at(clock.now, bounds), 'the fling coasts')
    compare(`coasting frame ${step}`)
  }
  const last = stubFrame(props, grid, clock.now).displacement
  assert.ok(last && last.x.some((value) => value !== 0), 'the drag moved the grid')
})

test("pointer 'events' hands the drag to the component's root and canvas as mouse events", () => {
  const { clock, wiring, element } = wired({ pointer: 'events', momentum: false })
  assert.deepEqual(Object.keys(wiring.props()), [])
  const seen: string[] = []
  const recorder = (name: string) => {
    const target = new EventTarget()
    for (const type of ['mouseenter', 'mousemove', 'mouseleave']) {
      target.addEventListener(type, (event) => {
        const { clientX, clientY } = event as Event & { clientX?: number; clientY?: number }
        seen.push(`${name} ${type}${clientX === undefined ? '' : ` ${clientX},${clientY}`}`)
      })
    }
    return target
  }
  const targets: EventTargets = { root: recorder('root'), canvas: recorder('canvas') }
  const mouseEvent: MouseEventFactory = (type, init) => Object.assign(new Event(type, { bubbles: init.bubbles }), { clientX: init.clientX, clientY: init.clientY })

  wiring.pumpEvents(targets, mouseEvent)
  assert.deepEqual(seen, [], 'nothing without a drag')
  drag(element, clock)
  wiring.pumpEvents(targets, mouseEvent)
  wiring.pumpEvents(targets, mouseEvent)
  element.dispatchEvent(pointerEvent('pointerup', 150, 60))
  wiring.pumpEvents(targets, mouseEvent)
  wiring.pumpEvents(targets, mouseEvent)
  assert.deepEqual(seen, ['root mouseenter 150,60', 'canvas mousemove 150,60', 'canvas mousemove 150,60', 'root mouseleave', 'canvas mouseleave'])

  assert.throws(() => wired({ pointer: 'drag' }).wiring.pumpEvents(targets, mouseEvent), /for pointer "events"/)
})

test('wheel ticks step the colour drive; reduced motion reaches the feed, the drive and the cloth', () => {
  const { clock, wiring, element, detach } = wired({ wheel: true, reducedMotion: true, cloth: true, colors: (frame) => ({ position: frame.position }) })
  assert.equal(wiring.feed.reducedMotion, true)
  assert.equal(wiring.drive.reducedMotion, true)
  assert.equal(wiring.cloth?.reducedMotion, true)
  assert.equal(stubFrame(wiring.props(), [], clock.now).params?.position, 0)
  element.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100, deltaMode: 0 }))
  element.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100, deltaMode: 0 }))
  assert.equal(stubFrame(wiring.props(), [], clock.now).params?.position, 2)

  detach()
  element.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100, deltaMode: 0 }))
  assert.equal(stubFrame(wiring.props(), [], clock.now).params?.position, 2, 'detached')
  wiring.configure({ wheel: true, reducedMotion: false, cloth: true, colors: (frame) => ({ position: frame.position }) })
  assert.equal(wiring.drive.reducedMotion, false)
})
