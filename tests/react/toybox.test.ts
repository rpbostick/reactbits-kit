// toyboxState: toybox's api.motion mapped to the transformed components'
// getters, driven through a stub motion that records what it is asked and
// returns what the test sets, and through the wiring the adapter uses.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FOLLOW } from '../../src/modules/clothFollow.ts'
import { FEED_ATTRIBUTE, type FeedElement } from '../../src/modules/pointerFeed.ts'
import { RIPPLE, RippleField, rippleRadius, type Displacement, type GridPoint, type Point } from '../../src/modules/rippleField.ts'
import type { PatternCoordinates } from '../../src/modules/sphereSpin.ts'
import {
  FIELD_GAP_PX,
  fieldGrid,
  strongestStir,
  ToyboxDynamics,
  turnedBy,
  type CoordinateFrame,
  type ToyboxMotion,
  type ToyboxSheet,
  type ToyboxSpin,
} from '../../src/react/toybox.ts'
import { BackgroundWiring, type EventTargets, type MouseEventFactory } from '../../src/react/wiring.ts'
import { wavesGrid } from '../support/grid.ts'

const RECT = { left: 100, top: 50, width: 800, height: 600 }
const PERIOD = 8000

class StubMotion implements ToyboxMotion {
  calls: string[] = []
  point: Point | null = null
  sheetNow: ToyboxSheet = { x: 0, y: 0, centerX: 0, centerY: 0, angle: 0, moving: false }
  turn: Point = { x: 0, y: 0 }
  // What ripple() returns for the grid it is given.
  stir: (grid: readonly (readonly GridPoint[])[]) => Displacement | null = () => null
  readonly displaced: Displacement = { x: new Float64Array([1]), y: new Float64Array([2]) }
  readonly sampled: PatternCoordinates = { x: new Float64Array([3]), y: new Float64Array([4]) }
  grids: (readonly (readonly Point[])[])[] = []

  pointer(at?: number) {
    this.calls.push(`pointer ${at}`)
    return this.point
  }
  sheet(at?: number) {
    this.calls.push(`sheet ${at}`)
    return this.sheetNow
  }
  spin(at?: number): ToyboxSpin {
    this.calls.push(`spin ${at}`)
    return { ...this.turn, yaw: 0, pitch: 0, period: PERIOD, moving: false }
  }
  ripple(grid: readonly (readonly GridPoint[])[], at?: number) {
    this.calls.push(`ripple ${at}`)
    this.grids.push(grid)
    return this.stir(grid)
  }
  displace(grid: readonly (readonly GridPoint[])[], at?: number) {
    this.calls.push(`displace ${at}`)
    this.grids.push(grid)
    return this.displaced
  }
  sample(grid: readonly (readonly Point[])[], at?: number) {
    this.calls.push(`sample ${at}`)
    this.grids.push(grid)
    return this.sampled
  }
}

function page(rect = RECT) {
  const clock = { now: 1000 }
  return { clock, surface: { now: () => clock.now, rect: () => rect } }
}

test("'grid' gives Waves the motion's displace and sample on its grid in client coordinates, the ball's period and the reach", () => {
  const motion = new StubMotion()
  const { clock, surface } = page()
  const getters = new ToyboxDynamics({ motion, takes: 'grid' }, surface).getters()
  assert.deepEqual(Object.keys(getters).sort(), ['displacement', 'overscanX', 'overscanY', 'patternPeriod', 'sample'])
  assert.deepEqual(getters.patternPeriod, { x: PERIOD, y: PERIOD })
  assert.equal(getters.overscanX, RIPPLE.MAX_RADIUS_PX * RIPPLE.MAX_DISPLACEMENT_SHARE + FOLLOW.MAX_SHIFT_PX)
  assert.equal(getters.overscanY, getters.overscanX)

  const grid = wavesGrid(RECT.width, RECT.height, 20, 40)
  motion.calls = []
  clock.now = 1016
  const displacement = getters.displacement as (lines: GridPoint[][], time: number) => Displacement | null
  const sample = getters.sample as (lines: GridPoint[][], time: number) => PatternCoordinates | null
  assert.equal(displacement(grid, 1010), motion.displaced)
  assert.equal(sample(grid, 1010), motion.sampled)
  // displace at the frame time; sample, as the kit's own spin, on the surface's clock.
  assert.deepEqual(motion.calls, ['displace 1010', 'sample 1016', 'spin 1016'])
  for (const passed of motion.grids) {
    assert.deepEqual(passed[2][3], { x: grid[2][3].x + RECT.left, y: grid[2][3].y + RECT.top, wave: grid[2][3].wave })
  }

  // A surface at the page's top left passes Waves' grid as it is.
  const atOrigin = new ToyboxDynamics({ motion, takes: 'grid' }, page({ left: 0, top: 0, width: 800, height: 600 }).surface).getters()
  ;(atOrigin.displacement as (lines: GridPoint[][], time: number) => Displacement | null)(grid, 0)
  assert.equal(motion.grids[motion.grids.length - 1], grid)
})

test("'coordinates' shifts by the sheet and the spin, turns by the sheet's twist about the middle, and stirs at the ripple's strongest point", () => {
  const motion = new StubMotion()
  const { clock, surface } = page()
  const dynamics = new ToyboxDynamics({ motion, takes: 'coordinates' }, surface)
  const coordinates = dynamics.getters().coordinates as () => CoordinateFrame
  // The ball's first reading is where the scroll starts from.
  motion.turn = { x: 7990, y: 100 }
  assert.deepEqual(coordinates(), { x: 0, y: 0, rotation: 0, scale: 1, centerX: 400, centerY: 300, ripple: null })
  assert.equal(motion.grids[0][0][0].x, RECT.left, 'the field lies over the surface in client coordinates')
  assert.equal(motion.grids[0][1][0].x - motion.grids[0][0][0].x, FIELD_GAP_PX)

  // The sheet moves and twists; the ball turns 30 px across, past its
  // period, and is wrapped at rest: the scroll carries on without a jump.
  motion.sheetNow = { x: 12, y: -5, centerX: 300, centerY: 200, angle: 0.08, moving: true }
  motion.turn = { x: 8020, y: 100 }
  clock.now += 16
  const turning = coordinates()
  assert.deepEqual([turning.x, turning.y, turning.rotation], [12 + 30, -5, 0.08])
  motion.turn = { x: 20, y: 100 }
  clock.now += 16
  assert.equal(coordinates().x, 12 + 30, 'the wrap at rest is no move')

  // A stir: every field point shifts a little, one at (client) 196, 146 most.
  motion.stir = (grid) => {
    const rows = grid[0].length
    const offsets = { x: new Float64Array(grid.length * rows).fill(1), y: new Float64Array(grid.length * rows) }
    offsets.x[4 * rows + 4] = 9
    offsets.y[4 * rows + 4] = -3
    return offsets
  }
  const stirred = coordinates().ripple
  assert.ok(stirred)
  assert.deepEqual({ ...stirred, twist: Math.round(stirred.twist * 1e6) / 1e6 }, {
    x: 4 * FIELD_GAP_PX,
    y: 4 * FIELD_GAP_PX,
    dx: 9,
    dy: -3,
    radius: rippleRadius(RECT.width, RECT.height) * RIPPLE.FALLOFF_SHARE * Math.SQRT2,
    twist: 0,
  })
})

test('strongestStir finds the furthest-moved point and the turn of the field there', () => {
  const grid = fieldGrid(0, 0, 240, 240)
  const rows = grid[0].length
  const center = grid[5][5]
  const offsets = { x: new Float64Array(grid.length * rows), y: new Float64Array(grid.length * rows) }
  // A small clockwise turn (on screen, y down) by 0.002 rad about the
  // centre, on top of a shift that is largest there.
  grid.forEach((line, column) =>
    line.forEach((point, row) => {
      const k = column * rows + row
      const near = Math.exp(-((point.x - center.x) ** 2 + (point.y - center.y) ** 2) / 120 ** 2)
      offsets.x[k] = 6 * near - 0.002 * (point.y - center.y)
      offsets.y[k] = 2 * near + 0.002 * (point.x - center.x)
    }),
  )
  const stir = strongestStir(grid, offsets)
  assert.deepEqual([stir.x, stir.y, stir.dx, stir.dy], [center.x, center.y, 6, 2])
  assert.ok(Math.abs(stir.twist - 0.002) < 1e-12, `twist ${stir.twist}`)
  assert.throws(() => strongestStir(grid, { x: new Float64Array(3), y: new Float64Array(3) }), /3 offsets for/)
})

test("on the field grid, the kit's own RippleField stirs most along a drag's path", () => {
  const grid = fieldGrid(0, 0, RECT.width, RECT.height)
  const field = new RippleField()
  const radius = rippleRadius(RECT.width, RECT.height)
  let offsets: Displacement | null = null
  for (let frame = 0; frame <= 20; frame++) {
    offsets = field.step(grid, { pointer: { x: 200 + 10 * frame, y: 300 }, stroke: 1, now: frame * 16, radius })
  }
  assert.ok(offsets)
  const stir = strongestStir(grid, offsets)
  // The drag ran from (200, 300) to (400, 300); its wake trails the pointer.
  assert.ok(stir.x >= 200 && stir.x <= 400 && Math.abs(stir.y - 300) < radius, `strongest at ${stir.x}, ${stir.y}`)
  assert.ok(stir.dx > 1 && Number.isFinite(stir.twist), JSON.stringify(stir))
})

test('turnedBy takes the shorter way round the period', () => {
  const spin = (x: number, y: number): ToyboxSpin => ({ x, y, yaw: 0, pitch: 0, period: PERIOD, moving: false })
  assert.deepEqual(turnedBy({ x: 100, y: 0 }, spin(130, -20)), { x: 30, y: -20 })
  assert.deepEqual(turnedBy({ x: 7990, y: 10 }, spin(20, 7995)), { x: 30, y: -15 })
})

test('toyboxState stands in for the drag feed, ripple, cloth and spin; it cannot change on a mounted background', () => {
  const motion = new StubMotion()
  const { clock, surface } = page()
  assert.throws(() => new BackgroundWiring({ toyboxState: { motion, takes: 'grid' }, ripple: true }, surface), /brings its own ripple, sheet and spin/)
  assert.throws(() => new BackgroundWiring({ toyboxState: { motion, takes: 'lines' as never } }, surface), /takes must be 'grid' or 'coordinates'/)

  const wiring = new BackgroundWiring({ toyboxState: { motion, takes: 'coordinates' }, pointer: 'events' }, surface)
  assert.deepEqual(Object.keys(wiring.props()), ['coordinates'])
  const attributes = new Map<string, string>()
  const element = Object.assign(new EventTarget(), {
    classList: { toggle: () => undefined },
    getBoundingClientRect: () => RECT,
    setPointerCapture: () => undefined,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  }) as unknown as FeedElement & EventTarget
  wiring.attach(element as never)
  assert.equal(attributes.has(FEED_ATTRIBUTE), false, 'toybox hears the drag; the wiring attaches no feed')

  // pointer 'events' hands toybox's dragged point (client coordinates) on as mouse events.
  const seen: string[] = []
  const root = new EventTarget()
  for (const type of ['mouseenter', 'mousemove', 'mouseleave']) {
    root.addEventListener(type, (event) => {
      const { clientX, clientY } = event as Event & { clientX?: number; clientY?: number }
      seen.push(`${type}${clientX === undefined ? '' : ` ${clientX},${clientY}`}`)
    })
  }
  const targets: EventTargets = { root, canvas: null }
  const mouseEvent: MouseEventFactory = (type, init) => Object.assign(new Event(type), { clientX: init.clientX, clientY: init.clientY })
  motion.point = { x: 340, y: 220 }
  wiring.pumpEvents(targets, mouseEvent)
  motion.point = null
  clock.now += 16
  wiring.pumpEvents(targets, mouseEvent)
  assert.deepEqual(seen, ['mouseenter 340,220', 'mousemove 340,220', 'mouseleave'])

  wiring.configure({ toyboxState: { motion, takes: 'coordinates' }, pointer: 'events' })
  assert.throws(() => wiring.configure({ toyboxState: { motion: new StubMotion(), takes: 'coordinates' }, pointer: 'events' }), /toyboxState changed/)
  assert.throws(() => wiring.configure({ pointer: 'events' }), /toyboxState changed/)
})

test("pointer 'drag' with toyboxState gives Waves toybox's dragged point", () => {
  const motion = new StubMotion()
  const wiring = new BackgroundWiring({ toyboxState: { motion, takes: 'grid' }, pointer: 'drag' }, page().surface)
  const pointer = wiring.props().pointer as () => Point | null
  assert.equal(pointer(), null)
  motion.point = { x: 340, y: 220 }
  assert.deepEqual(pointer(), { x: 340, y: 220 })
})
