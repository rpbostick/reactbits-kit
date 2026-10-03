import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PointerFeed } from '../../src/modules/pointerFeed.ts'
import { RIPPLE, RippleField, rippleRadius, type Displacement, type GridPoint, type Point } from '../../src/modules/rippleField.ts'
import { wavesGrid } from '../support/grid.ts'

const WIDTH = 1280
const HEIGHT = 800
const X_GAP = 12
const Y_GAP = 36
const RADIUS = rippleRadius(WIDTH, HEIGHT)
const SURFACE = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT }
const CENTER: Point = { x: WIDTH / 2, y: HEIGHT / 2 }

const GRID = wavesGrid(WIDTH, HEIGHT, X_GAP, Y_GAP)
const POINTS = GRID[0].length

function restOf(k: number): GridPoint {
  return GRID[Math.floor(k / POINTS)][k % POINTS]
}

// A pointer path: where it is at `ms`, or null.
type Path = (ms: number) => Point | null

// Steps a field along `path` every `frameMs` up to `untilMs`; returns the
// field and the last displacement.
function run(path: Path, untilMs: number, frameMs = 1000 / 60, field = new RippleField()) {
  let displacement: Displacement | null = null
  const frames = Math.round(untilMs / frameMs)
  for (let frame = 0; frame <= frames; frame++) {
    const now = frame * frameMs
    displacement = field.step(GRID, { pointer: path(now), stroke: 1, now, radius: RADIUS })
  }
  return { field, displacement }
}

function sizes(displacement: Displacement): number[] {
  return Array.from(displacement.x, (x, k) => Math.hypot(x, displacement.y[k]))
}

function largest(displacement: Displacement, where: (point: GridPoint) => boolean = () => true): number {
  return sizes(displacement).reduce((most, size, k) => (where(restOf(k)) ? Math.max(most, size) : most), 0)
}

function distance(point: Point, from: Point): number {
  return Math.hypot(point.x - from.x, point.y - from.y)
}

// A short flick to the right through the center, then nothing.
const flick: Path = (ms) => (ms <= 100 ? { x: CENTER.x - 60 + 0.6 * ms, y: CENTER.y } : null)

// Circles of `size` px around the center, one turn per `periodMs`, until
// `untilMs`; positive turns clockwise on screen (y points down).
function circling(direction: 1 | -1, untilMs: number, periodMs = 800, size = 80): Path {
  return (ms) => {
    if (ms > untilMs) return null
    const angle = (direction * 2 * Math.PI * ms) / periodMs
    return { x: CENTER.x + size * Math.cos(angle), y: CENTER.y + size * Math.sin(angle) }
  }
}

// Mean displacement around `around`, clockwise positive, over points within a radius.
function meanTwist(displacement: Displacement, around: Point): number {
  let total = 0
  let count = 0
  sizes(displacement).forEach((_, k) => {
    const rest = restOf(k)
    const dx = rest.x - around.x
    const dy = rest.y - around.y
    const r = Math.hypot(dx, dy)
    if (r === 0 || r > RADIUS) return
    total += (displacement.x[k] * -dy + displacement.y[k] * dx) / r
    count++
  })
  return total / count
}

test('a flick stays local at first, then spreads outward', () => {
  const far = (point: GridPoint) => distance(point, CENTER) > 2 * RADIUS
  const early = run(flick, 120).displacement
  const later = run(flick, 600).displacement
  assert.ok(early && later)
  const nearEarly = largest(early, (point) => distance(point, CENTER) < RADIUS)
  assert.ok(nearEarly > 5, `the flick moved the lines near it: ${nearEarly} px`)
  assert.ok(largest(early, far) < nearEarly * 0.05, `far ${largest(early, far)} px vs near ${nearEarly} px`)
  assert.ok(largest(later, far) > largest(early, far) * 3, `far ${largest(early, far)} then ${largest(later, far)} px`)
  assert.ok(largest(later, far) > 0.3, `the ripple reached beyond two radii: ${largest(later, far)} px`)
})

test('the disturbance dies away and the field comes to rest', () => {
  const field = new RippleField()
  const energies: number[] = []
  let restAt: number | null = null
  for (let now = 0; now <= 8000; now += 1000 / 60) {
    const displacement = field.step(GRID, { pointer: flick(now), stroke: 1, now, radius: RADIUS })
    if (displacement && now >= 500 && Math.abs(now % 1000) < 1000 / 60) {
      energies.push(sizes(displacement).reduce((sum, size) => sum + size * size, 0))
    }
    if (!displacement && now > 100 && restAt === null) restAt = now
  }
  assert.ok(restAt !== null && restAt < 4000, `at rest ${restAt} ms after the flick`)
  assert.ok(field.atRest)
  for (let second = 1; second < energies.length; second++) {
    assert.ok(energies[second] < energies[second - 1], `energy by second: ${energies.join(', ')}`)
  }
})

test('displacement stays bounded and the lines neither collapse nor overstretch under a violent drag', () => {
  let seed = 7
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const field = new RippleField()
  const limit = RADIUS * RIPPLE.MAX_DISPLACEMENT_SHARE
  let shortest = Infinity
  let longest = 0
  let most = 0
  // The least a point stays right of its left neighbour and below the one
  // above, in px: negative would mean crossed lines.
  let leastAcross = Infinity
  let leastAlong = Infinity
  for (let now = 0; now <= 3000; now += 1000 / 60) {
    // Wide fast sweeps with tight circles and random jumps on top:
    // thousands of px/s.
    const angle = now / 40
    const pointer = {
      x: CENTER.x + 400 * Math.sin(now / 150) + 60 * Math.cos(angle) + random() * 120,
      y: CENTER.y + 60 * Math.sin(angle) + random() * 120,
    }
    const displacement = field.step(GRID, { pointer, stroke: 1, now, radius: RADIUS })
    assert.ok(displacement)
    for (let k = 0; k < displacement.x.length; k++) {
      assert.ok(Number.isFinite(displacement.x[k]) && Number.isFinite(displacement.y[k]), `point ${k} at ${now} ms`)
      most = Math.max(most, Math.hypot(displacement.x[k], displacement.y[k]))
      const line = Math.floor(k / POINTS)
      const index = k % POINTS
      if (line + 1 < GRID.length) {
        const across = Math.hypot(X_GAP + displacement.x[k + POINTS] - displacement.x[k], displacement.y[k + POINTS] - displacement.y[k]) / X_GAP
        shortest = Math.min(shortest, across)
        longest = Math.max(longest, across)
        leastAcross = Math.min(leastAcross, X_GAP + displacement.x[k + POINTS] - displacement.x[k])
      }
      if (index + 1 < POINTS) {
        const along = Math.hypot(displacement.x[k + 1] - displacement.x[k], Y_GAP + displacement.y[k + 1] - displacement.y[k]) / Y_GAP
        shortest = Math.min(shortest, along)
        longest = Math.max(longest, along)
        leastAlong = Math.min(leastAlong, Y_GAP + displacement.y[k + 1] - displacement.y[k])
      }
    }
  }
  assert.ok(most <= limit + 1e-9, `largest ${most} px, limit ${limit} px`)
  assert.ok(most > limit * 0.95, `the drag reached the limit: ${most} px`)
  assert.ok(shortest > RIPPLE.MIN_STRETCH * 0.6, `shortest link ${shortest} of its rest length`)
  assert.ok(longest < RIPPLE.MAX_STRETCH * 1.2, `longest link ${longest} of its rest length`)
  assert.ok(leastAcross > 0, `neighbouring lines crossed: ${leastAcross} px apart`)
  assert.ok(leastAlong > 0, `a line folded back on itself: ${leastAlong} px`)
})

test('the pull and the swirl are about twice as strong as at half their strength, not cut off by the limit', () => {
  assert.equal(RIPPLE.SWIRL_ACCEL_RADII_PER_S2, 12)
  // A steady 600 px/s drag through the center, still held, against the pull
  // at half strength (8/s towards 0.7 of the pointer's velocity).
  const half = { ...RIPPLE, PULL_PER_S: 8, PULL_SHARE: 0.7, MAX_DISPLACEMENT_SHARE: 0.5 }
  const drag: Path = (ms) => ({ x: CENTER.x - 180 + 0.6 * ms, y: CENTER.y })
  for (const ms of [100, 300, 600]) {
    const full = run(drag, ms).displacement
    const weak = run(drag, ms, 1000 / 60, new RippleField(half)).displacement
    assert.ok(full && weak)
    const stretch = largest(full) / largest(weak)
    assert.ok(stretch > 1.8 && stretch < 2.3, `${ms} ms in, the drag moved the lines ${largest(full)} px, ${stretch}× as far`)
  }

  const halfSwirl = new RippleField({ ...RIPPLE, SWIRL_ACCEL_RADII_PER_S2: RIPPLE.SWIRL_ACCEL_RADII_PER_S2 / 2 })
  const twist = meanTwist(run(circling(1, 1600), 1600).displacement as Displacement, CENTER)
  const weakTwist = meanTwist(run(circling(1, 1600), 1600, 1000 / 60, halfSwirl).displacement as Displacement, CENTER)
  // The circling's own pull twists the lines too, so the swirl's share
  // doubling raises the whole by less than 2×.
  assert.ok(twist / weakTwist > 1.4, `circling twisted the lines ${twist / weakTwist}× as far`)
})

test('circling winds a swirl the same way round, a straight drag none, and it unwinds after release', () => {
  const clockwise = run(circling(1, 1600), 1600)
  const anticlockwise = run(circling(-1, 1600), 1600)
  assert.ok(clockwise.displacement && anticlockwise.displacement)
  assert.ok(clockwise.field.wind > 1, `clockwise wind ${clockwise.field.wind}`)
  assert.ok(anticlockwise.field.wind < -1, `anticlockwise wind ${anticlockwise.field.wind}`)
  const twist = meanTwist(clockwise.displacement, CENTER)
  assert.ok(twist > 3, `clockwise twist ${twist} px`)
  assert.ok(meanTwist(anticlockwise.displacement, CENTER) < -3, `anticlockwise twist ${meanTwist(anticlockwise.displacement, CENTER)} px`)

  const straight = run((ms) => ({ x: 200 + 0.8 * ms, y: CENTER.y }), 1000)
  assert.ok(Math.abs(straight.field.wind) < 0.01, `straight wind ${straight.field.wind}`)

  // After release the wind falls steadily to zero, and the twist with it.
  const field = clockwise.field
  const winds: number[] = []
  for (let now = 1600; now <= 1600 + 3500; now += 1000 / 60) {
    const displacement = field.step(GRID, { pointer: null, stroke: 1, now, radius: RADIUS })
    winds.push(field.wind)
    if (Math.abs(now - 2600) < 1000 / 120) {
      assert.ok(displacement)
      const unwinding = meanTwist(displacement, CENTER)
      assert.ok(unwinding > 0 && unwinding < twist, `twist ${twist} px, a second after release ${unwinding} px`)
    }
  }
  for (let index = 1; index < winds.length; index++) assert.ok(winds[index] <= winds[index - 1])
  assert.equal(field.wind, 0, 'unwound within 3.5 s')
})

test('the field is the same at 30 and at 120 frames a second', () => {
  for (const [name, path] of [
    ['flick', flick],
    ['circling', circling(1, 1000)],
  ] as [string, Path][]) {
    const slow = run(path, 1000, 1000 / 30).displacement
    const fast = run(path, 1000, 1000 / 120).displacement
    assert.ok(slow && fast)
    let difference = 0
    for (let k = 0; k < slow.x.length; k++) {
      difference = Math.max(difference, Math.hypot(slow.x[k] - fast.x[k], slow.y[k] - fast.y[k]))
    }
    const scale = largest(fast)
    assert.ok(difference < scale * 0.05, `${name}: differs by ${difference} px of ${scale} px`)
  }
})

test('a flung pointer keeps stirring the field as it coasts; a new press starts afresh', () => {
  function fling(coast: boolean) {
    const pointer = new PointerFeed()
    const field = new RippleField()
    let now = 0
    let displacement: Displacement | null = null
    const frame = () => {
      displacement = field.step(GRID, { pointer: pointer.at(now, SURFACE), stroke: pointer.stroke, now, radius: RADIUS })
      now += 1000 / 60
    }
    pointer.grab(300, CENTER.y, now)
    while (now <= 150) {
      pointer.move(300 + 1.5 * now, CENTER.y, now)
      frame()
    }
    if (coast) pointer.release(now)
    else pointer.cancel()
    const released = now
    while (now < released + 800) frame()
    return { pointer, field, displacement: displacement as Displacement | null, frame, now: () => now }
  }

  const coasting = fling(true)
  const stopped = fling(false)
  const coastPoint = coasting.pointer.at(coasting.now(), SURFACE)
  assert.ok(coastPoint, 'still coasting 800 ms after the release')
  assert.ok(coasting.displacement && stopped.displacement)
  const nearCoast = largest(coasting.displacement, (point) => distance(point, coastPoint) < RADIUS)
  const nearStopped = largest(stopped.displacement, (point) => distance(point, coastPoint) < RADIUS)
  assert.ok(nearCoast > 3 * nearStopped && nearCoast > 2, `near the coasting pointer: ${nearCoast} px with the coast, ${nearStopped} px without`)

  // A press far away mid-coast pulls nothing there; the same jump read as
  // part of the old stroke would be one fast move.
  const pressAt = { x: 150, y: 150 }
  const underPress = (point: GridPoint) => distance(point, pressAt) < RADIUS / 2
  // The ripple already there, with no press, is the baseline.
  const pressed = (stroke: number | null) => {
    const flung = fling(true)
    const now = flung.now()
    let displacement: Displacement | null = null
    for (let frame = 0; frame < 3; frame++) {
      const at = now + frame * (1000 / 60)
      const pointer = stroke === null ? flung.pointer.at(at, SURFACE) : pressAt
      displacement = flung.field.step(GRID, { pointer, stroke: stroke ?? 1, now: at, radius: RADIUS })
    }
    assert.ok(displacement)
    return { moved: largest(displacement, underPress), wind: flung.field.wind }
  }
  const baseline = pressed(null).moved
  const fresh = pressed(2)
  const stale = pressed(1)
  assert.ok(
    Math.abs(fresh.moved - baseline) < baseline * 0.2 && stale.moved > baseline + 2,
    `under the press: ${baseline} px without it, ${fresh.moved} px as a new stroke, ${stale.moved} px as the old one`,
  )
  assert.equal(fresh.wind, 0, 'a new press starts without wind')

  coasting.pointer.grab(pressAt.x, pressAt.y, coasting.now())

  // The coast ends and the field comes to rest.
  coasting.pointer.release(coasting.now())
  let rest: number | null = null
  for (let frame = 0; frame < 60 * 10 && rest === null; frame++) {
    coasting.frame()
    if (coasting.field.atRest) rest = frame
  }
  assert.ok(rest !== null, 'at rest within 10 s')
})

test('a new grid starts from rest; a grid too fine for the substep fails loud', () => {
  const { field } = run(flick, 300)
  const other = wavesGrid(900, 600, X_GAP, Y_GAP)
  const displacement = field.step(other, { pointer: null, stroke: 1, now: 320, radius: RADIUS })
  assert.equal(displacement, null, 'nothing to draw on the new grid')
  const fine = GRID.map((points, line) => points.map((point, index) => ({ x: line * 0.5, y: index * 0.5, wave: point.wave })))
  const fresh = new RippleField()
  fresh.step(fine, { pointer: CENTER, stroke: 1, now: 0, radius: RADIUS })
  assert.throws(() => fresh.step(fine, { pointer: CENTER, stroke: 1, now: 20, radius: RADIUS }), /too fine/)
})
