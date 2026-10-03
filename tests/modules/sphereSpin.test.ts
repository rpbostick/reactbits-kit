// The ball: a drag across turns it as much as the same drag down, at
// SPIN_SCALE (1 keeps the point under the pointer under it), a release spins
// on the way it was pulled and slows to a stop within 3 to 9 s without
// turning back, the result does not depend on the frame rate, the turn wraps
// without a seam in a pattern periodic on PERIOD_PX, a press catches a spin
// where it is, reduced motion neither turns nor spins, and with the cloth
// follow on top the two stay bounded and settle. That Waves' noise repeats on
// PERIOD_PX is tests/wavesNoise.test.ts, on the noise.ts rbx builds.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ClothFollow, FOLLOW } from '../../src/modules/clothFollow.ts'
import type { Point } from '../../src/modules/momentum.ts'
import { curved, SPIN, SPIN_SCALE, SphereSpin, spinSeconds, wrap, type View } from '../../src/modules/sphereSpin.ts'

const VIEW: View = { width: 1280, height: 800 }
const CENTER: Point = { x: 640, y: 400 }
const PERIOD = SPIN.PERIOD_PX
// The 1:1 grab the default spin is a share of.
const FULL = { ...SPIN, SCALE: 1 }

// A press at `from`, moved in a straight line to `from + (dx, dy)` over
// `ms` with an event every 8 ms, released at the end. Returns the release time.
function fling(spin: SphereSpin, from: Point, dx: number, dy: number, ms: number, start = 0): number {
  spin.grab(from, VIEW, start)
  for (let t = 8; t <= ms; t += 8) {
    const share = t / ms
    spin.drag({ x: from.x + dx * share, y: from.y + dy * share }, VIEW, start + t)
  }
  spin.release(start + ms)
  return start + ms
}

// Where a single screen point reads the pattern.
function patternAt(spin: SphereSpin, point: Point, now: number): Point {
  const read = spin.sample([[point]], VIEW, now)
  return { x: read.x[0], y: read.y[0] }
}

// The distance between two values on a circle of `period`.
function circular(a: number, b: number, period: number): number {
  const gap = wrap(a - b, period)
  return Math.min(gap, period - gap)
}

// a − b on a circle of PERIOD, between −PERIOD / 2 and PERIOD / 2: the turn
// is wrapped once at rest, which must not read as a step back.
function signedStep(a: number, b: number): number {
  return wrap(a - b + PERIOD / 2, PERIOD) - PERIOD / 2
}

// How long after `releaseMs` the spin stops, stepping at 60 Hz.
function stopsAfter(spin: SphereSpin, releaseMs: number): number {
  for (let now = releaseMs; now < releaseMs + 20000; now += 1000 / 60) {
    spin.advance(now)
    if (!spin.spinning) return (now - releaseMs) / 1000
  }
  throw new Error('still spinning after 20 s')
}

function close(actual: number, expected: number, tolerance: number, what: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual}, expected ${expected} ± ${tolerance}`)
}

// A smooth pattern that repeats every PERIOD across and down, standing in
// for Waves' periodic noise.
function periodicPattern(x: number, y: number): number {
  const turn = (2 * Math.PI) / PERIOD
  return Math.sin(turn * x + 0.3) * Math.cos(3 * turn * y) + Math.sin(2 * turn * (x + y))
}

test('a drag across yaws and a drag down pitches by the same amount', () => {
  for (const distance of [50, 200, -300]) {
    const across = new SphereSpin()
    across.grab(CENTER, VIEW, 0)
    across.drag({ x: CENTER.x + distance, y: CENTER.y }, VIEW, 100)
    const down = new SphereSpin()
    down.grab(CENTER, VIEW, 0)
    down.drag({ x: CENTER.x, y: CENTER.y + distance }, VIEW, 100)
    const yawed = across.orientation(100)
    const pitched = down.orientation(100)
    assert.ok(yawed.yaw > 0.001 && yawed.yaw < 2 * Math.PI - 0.001, `a ${distance} px drag across yawed ${yawed.yaw}`)
    assert.equal(yawed.pitch, 0)
    assert.equal(pitched.yaw, 0)
    close(pitched.pitch, yawed.yaw, 1e-12, `pitch for ${distance} px down`)
  }
  // A diagonal turns both ways at once.
  const diagonal = new SphereSpin()
  diagonal.grab(CENTER, VIEW, 0)
  diagonal.drag({ x: CENTER.x + 120, y: CENTER.y + 120 }, VIEW, 100)
  const both = diagonal.orientation(100)
  close(both.yaw, both.pitch, 1e-12, 'diagonal')
  assert.ok(both.yaw > 0.05 * SPIN_SCALE, `diagonal yawed ${both.yaw}`)
})

test('a drag turns the ball SPIN_SCALE = 0.1 of the 1:1 grab, across and down', () => {
  assert.equal(SPIN_SCALE, 0.1)
  assert.equal(SPIN.SCALE, SPIN_SCALE)
  for (const [from, dx, dy] of [
    [CENTER, 300, 0],
    [CENTER, 0, -250],
    [{ x: 100, y: 80 }, 900, 600],
    [{ x: 1200, y: 700 }, -1100, -50],
  ] as const) {
    const gentle = new SphereSpin()
    const full = new SphereSpin(FULL)
    gentle.grab(from, VIEW, 0)
    full.grab(from, VIEW, 0)
    for (let step = 1; step <= 20; step++) {
      const point = { x: from.x + (dx * step) / 20, y: from.y + (dy * step) / 20 }
      gentle.drag(point, VIEW, step * 10)
      full.drag(point, VIEW, step * 10)
      const turned = gentle.advance(step * 10)
      const fullTurn = full.advance(step * 10)
      close(turned.x, fullTurn.x * SPIN_SCALE, 1e-9, `yaw at step ${step} of ${dx}, ${dy}`)
      close(turned.y, fullTurn.y * SPIN_SCALE, 1e-9, `pitch at step ${step} of ${dx}, ${dy}`)
    }
    if (dx !== 0) assert.ok(Math.abs(full.advance(200).x) > 100, `the full grab yawed only ${full.advance(200).x}`)
    if (dy !== 0) assert.ok(Math.abs(full.advance(200).y) > 40, `the full grab pitched only ${full.advance(200).y}`)
  }
})

test('a release spins at SPIN_SCALE of the full spin, for as long', () => {
  for (const [dx, dy] of [
    [300, 0],
    [0, -300],
    [1000, -1000],
    [6, 3],
  ]) {
    const gentle = new SphereSpin()
    const full = new SphereSpin(FULL)
    const release = fling(gentle, CENTER, dx, dy, 200)
    fling(full, CENTER, dx, dy, 200)
    const gentleFrom = gentle.advance(release)
    const fullFrom = full.advance(release)
    assert.equal(gentle.spinning, full.spinning, `spinning differs for ${dx}, ${dy}`)
    for (let now = release; now < release + 10000; now += 250) {
      const gentleTurn = gentle.advance(now)
      const fullTurn = full.advance(now)
      close(signedStep(gentleTurn.x, gentleFrom.x), signedStep(fullTurn.x, fullFrom.x) * SPIN_SCALE, 1e-6, `yaw spun by ${now - release} ms`)
      close(signedStep(gentleTurn.y, gentleFrom.y), signedStep(fullTurn.y, fullFrom.y) * SPIN_SCALE, 1e-6, `pitch spun by ${now - release} ms`)
      assert.equal(gentle.spinning, full.spinning, `one stopped first at ${now - release} ms`)
    }
  }
})

test('at scale 1 the point under the pointer stays under it during a drag', () => {
  for (const [from, dx, dy] of [
    [CENTER, 400, 0],
    [CENTER, 0, -350],
    [{ x: 100, y: 80 }, 900, 600],
    [{ x: 1200, y: 700 }, -1100, -50],
  ] as const) {
    const spin = new SphereSpin(FULL)
    const grabbed = patternAt(spin, from, 0)
    spin.grab(from, VIEW, 0)
    for (let step = 1; step <= 40; step++) {
      const point = { x: from.x + (dx * step) / 40, y: from.y + (dy * step) / 40 }
      spin.drag(point, VIEW, step * 10)
      const under = patternAt(spin, point, step * 10)
      assert.ok(circular(under.x, grabbed.x, PERIOD) < 1e-6, `x drifted to ${under.x} from ${grabbed.x}`)
      assert.ok(circular(under.y, grabbed.y, PERIOD) < 1e-6, `y drifted to ${under.y} from ${grabbed.y}`)
    }
  }
})

test('a release spins on the way it was pulled, slowing, and never turns back', () => {
  for (const [dx, dy] of [
    [300, 0],
    [0, 300],
    [-200, 150],
  ]) {
    const spin = new SphereSpin()
    const release = fling(spin, CENTER, dx, dy, 200)
    let previous = spin.advance(release)
    let previousSpeed = Infinity
    let moved = 0
    let wasSpinning = spin.spinning
    assert.ok(wasSpinning, 'the release did not spin')
    for (let now = release + 1000 / 60; now < release + 12000; now += 1000 / 60) {
      const turn = spin.advance(now)
      const stepX = signedStep(turn.x, previous.x)
      const stepY = signedStep(turn.y, previous.y)
      const along = (stepX * dx + stepY * dy) / Math.hypot(dx, dy)
      const sideways = Math.abs(stepX * dy - stepY * dx) / Math.hypot(dx, dy)
      const speed = Math.hypot(stepX, stepY)
      // The frame the spin ends in still covers the rest of it.
      if (wasSpinning) {
        assert.ok(along > 0, `moved ${along} px along the pull at ${now - release} ms`)
        assert.ok(speed < previousSpeed, `sped up to ${speed} px a frame at ${now - release} ms`)
      } else {
        // Stopped: it stays, with no step back towards where it started.
        assert.ok(along >= -1e-9 && speed < 1e-9, `moved ${speed} px a frame after stopping`)
      }
      assert.ok(sideways < 1e-9, `drifted ${sideways} px sideways`)
      moved += along
      wasSpinning = spin.spinning
      previousSpeed = speed
      previous = turn
    }
    assert.ok(moved > 100, `a ${Math.hypot(dx, dy) * 5} px/s fling spun on only ${moved} px`)
  }
})

test('a slow fling stops after 3 s or more, a fast one within 9 s', () => {
  const slow = new SphereSpin()
  // 40 px/s, just over the slowest release that spins.
  const slowRelease = fling(slow, CENTER, 8, 0, 200)
  const slowSeconds = stopsAfter(slow, slowRelease)
  assert.ok(slowSeconds >= SPIN.MIN_SPIN_S && slowSeconds < SPIN.MIN_SPIN_S + 0.5, `a slow fling spun ${slowSeconds} s`)
  const fast = new SphereSpin()
  // 10000 px/s, past the fastest spin.
  const fastRelease = fling(fast, CENTER, 1000, -1000, 141)
  const fastSeconds = stopsAfter(fast, fastRelease)
  assert.ok(fastSeconds > 8.5 && fastSeconds <= SPIN.MAX_SPIN_S + 1 / 60, `a fast fling spun ${fastSeconds} s`)
  const medium = new SphereSpin()
  const mediumSeconds = stopsAfter(medium, fling(medium, CENTER, 100, 0, 200))
  assert.ok(mediumSeconds > slowSeconds && mediumSeconds < fastSeconds, `a 500 px/s fling spun ${mediumSeconds} s`)
  assert.equal(spinSeconds(SPIN.MIN_FLING_PX_S * 0.9), 0)
  close(spinSeconds(SPIN.MIN_FLING_PX_S), SPIN.MIN_SPIN_S, 1e-12, 'slowest spin')
  close(spinSeconds(SPIN.MAX_SPIN_PX_S * 10), SPIN.MAX_SPIN_S, 1e-12, 'fastest spin')
  // A drag held still before release does not spin.
  const still = new SphereSpin()
  still.grab(CENTER, VIEW, 0)
  still.drag({ x: 900, y: 400 }, VIEW, 50)
  still.release(400)
  assert.equal(still.spinning, false)
})

test('the spin does not depend on the frame rate', () => {
  const turns = (frameMs: number) => {
    const spin = new SphereSpin()
    const release = fling(spin, CENTER, 400, -250, 200)
    const seen = new Map<number, Point>()
    for (let frame = 0; frame * frameMs <= 10000; frame++) {
      const now = release + frame * frameMs
      const turn = spin.advance(now)
      const key = Math.round(frame * frameMs)
      if (key % 500 === 0) seen.set(key, turn)
    }
    return seen
  }
  const slow = turns(1000 / 30)
  const fast = turns(1000 / 144)
  assert.ok(slow.size >= 20, `${slow.size} common times`)
  for (const [key, turn] of slow) {
    const other = fast.get(key)
    assert.ok(other, `no 144 Hz frame at ${key} ms`)
    assert.ok(circular(turn.x, other.x, PERIOD) < 1e-6, `x at ${key} ms: ${turn.x} at 30 Hz, ${other.x} at 144 Hz`)
    assert.ok(circular(turn.y, other.y, PERIOD) < 1e-6, `y at ${key} ms: ${turn.y} at 30 Hz, ${other.y} at 144 Hz`)
  }
})

test('the turn wraps without a seam in a pattern periodic on PERIOD_PX', () => {
  // A drag and fling left and up from rest crosses the turn's seam at once,
  // and the spin stops (wrapping the turn) on the far side. Every point reads
  // the same pattern as it would on a turn that never wrapped.
  const spin = new SphereSpin()
  const grid = [0, 200, 640, 1100].map((x) => [0, 300, 790].map((y) => ({ x, y })))
  const unwrapped = { x: 0, y: 0 }
  let last = spin.advance(0)
  let crossings = 0
  const compare = (now: number) => {
    const turn = spin.advance(now)
    if (Math.abs(turn.x - last.x) > PERIOD / 2) crossings++
    unwrapped.x += signedStep(turn.x, last.x)
    unwrapped.y += signedStep(turn.y, last.y)
    last = turn
    const at = spin.sample(grid, VIEW, now)
    grid.flat().forEach((point, k) => {
      const bent = curved(point, VIEW)
      close(periodicPattern(at.x[k], at.y[k]), periodicPattern(bent.x - unwrapped.x, bent.y - unwrapped.y), 1e-9, `pattern at ${point.x}, ${point.y}, ${now} ms`)
    })
  }
  // The fling is scaled with SPIN_SCALE so it turns far enough to wrap at any setting.
  const pull = 2 * (0.2 / SPIN_SCALE)
  spin.grab(CENTER, VIEW, 0)
  for (let t = 8; t <= 200; t += 8) {
    spin.drag({ x: CENTER.x - pull * t, y: CENTER.y - pull * t }, VIEW, t)
    compare(t)
  }
  spin.release(200)
  for (let now = 200; now < 10000; now += 1000 / 60) compare(now)
  assert.equal(spin.spinning, false)
  assert.ok(unwrapped.x < -300 && unwrapped.y < -300, `turned only ${unwrapped.x}, ${unwrapped.y}`)
  assert.ok(crossings >= 1, 'the turn never wrapped')
})

test('the view bends gently towards the edges, and not at all at curvature 0', () => {
  const flat = { ...SPIN, CURVATURE: 0 }
  assert.deepEqual(curved({ x: 3, y: 790 }, VIEW, flat), { x: 3, y: 790 })
  assert.deepEqual(curved(CENTER, VIEW), CENTER)
  const edge = curved({ x: CENTER.x + 700, y: CENTER.y }, VIEW)
  const share = (edge.x - CENTER.x) / 700
  assert.ok(share > 0.9 && share < 0.97, `700 px out reads ${share} as far`)
  assert.equal(edge.y, CENTER.y)
  // Further out is always further along the pattern.
  let last = -Infinity
  for (let x = -400; x <= 1700; x += 10) {
    const at = curved({ x, y: 100 }, VIEW).x
    assert.ok(at > last, `curved x not increasing at ${x}`)
    last = at
  }
})

test('a press catches a spin where it is and holds it there', () => {
  const spin = new SphereSpin()
  const release = fling(spin, CENTER, 300, 200, 200)
  const before = spin.advance(release + 1500)
  spin.grab({ x: 100, y: 100 }, VIEW, release + 1500)
  assert.equal(spin.spinning, false)
  const caught = spin.advance(release + 1500)
  assert.ok(circular(caught.x, before.x, PERIOD) < 1e-9 && circular(caught.y, before.y, PERIOD) < 1e-9, 'the press moved the ball')
  for (let now = release + 1500; now < release + 3000; now += 16) {
    const held = spin.advance(now)
    assert.ok(circular(held.x, caught.x, PERIOD) < 1e-9 && circular(held.y, caught.y, PERIOD) < 1e-9, `the held ball moved at ${now}`)
  }
})

test('reduced motion neither turns nor spins, and stops a spin where it is', () => {
  const still = new SphereSpin()
  still.reducedMotion = true
  fling(still, CENTER, 600, 300, 200)
  assert.equal(still.spinning, false)
  assert.deepEqual(still.orientation(5000), { yaw: 0, pitch: 0 })

  const spin = new SphereSpin()
  const release = fling(spin, CENTER, 300, 0, 200)
  const before = spin.advance(release + 1000)
  spin.reducedMotion = true
  const after = spin.advance(release + 1000)
  assert.equal(spin.spinning, false)
  assert.ok(circular(after.x, before.x, PERIOD) < 1e-9, `stopping moved the ball from ${before.x} to ${after.x}`)
  assert.ok(circular(spin.advance(release + 5000).x, before.x, PERIOD) < 1e-9, 'the ball moved after stopping')
})

test('the spin and the cloth follow together stay bounded, settle, and are off with reduced motion', () => {
  for (const reducedMotion of [false, true]) {
    const spin = new SphereSpin()
    const follow = new ClothFollow()
    spin.reducedMotion = reducedMotion
    follow.reducedMotion = reducedMotion
    const grid = [0, 400, 1280].map((x) => [0, 400, 800].map((y) => ({ x, y })))
    const releaseMs = 1500
    // A violent zig-zag held for 1.5 s, then a fling, feeding both.
    const pointerAt = (ms: number): Point => ({ x: CENTER.x + 600 * Math.sign(Math.sin(ms / 40)), y: CENTER.y + 300 * Math.sin(ms / 70) })
    spin.grab(pointerAt(0), VIEW, 0)
    let spinStoppedAt: number | null = null
    let largestShift = 0
    let lastShift = 0
    for (let now = 0; now <= 150000; now += 1000 / 60) {
      const held = now < releaseMs
      const pointer = held ? pointerAt(now) : null
      if (pointer) spin.drag(pointer, VIEW, now)
      else if (spin.held) spin.release(now)
      follow.step({ pointer, stroke: 1, now, width: VIEW.width, height: VIEW.height })
      const read = spin.sample(grid, VIEW, now)
      for (let k = 0; k < read.x.length; k++) {
        assert.ok(Number.isFinite(read.x[k]) && Number.isFinite(read.y[k]), `point ${k} reads ${read.x[k]}, ${read.y[k]} at ${now} ms`)
      }
      const shift = Math.hypot(follow.shift.x, follow.shift.y)
      largestShift = Math.max(largestShift, shift)
      if (!held && spinStoppedAt === null && !spin.spinning) spinStoppedAt = now - releaseMs
      lastShift = shift
    }
    if (reducedMotion) {
      assert.deepEqual(spin.orientation(150000), { yaw: 0, pitch: 0 })
      assert.equal(largestShift, 0)
    } else {
      assert.ok(largestShift > 50 && largestShift <= FOLLOW.MAX_SHIFT_PX, `the sheet's shift reached ${largestShift} px`)
      assert.ok(spinStoppedAt !== null && spinStoppedAt <= SPIN.MAX_SPIN_S * 1000 + 20, `the spin stopped ${spinStoppedAt} ms after release`)
      assert.ok(follow.atRest && lastShift === 0, `the sheet still holds ${lastShift} px after 150 s`)
    }
  }
})

test('bad input fails loud', () => {
  const spin = new SphereSpin()
  assert.throws(() => spin.grab({ x: Number.NaN, y: 0 }, VIEW, 0), /bad point/)
  assert.throws(() => spin.grab(CENTER, { width: 0, height: 800 }, 0), /bad view/)
  assert.throws(() => spin.advance(Number.NaN), /bad time/)
  assert.throws(() => spin.sample([[CENTER, CENTER], [CENTER]], VIEW, 0), /has 1 points, not 2/)
})
