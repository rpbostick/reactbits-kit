import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ClothFollow, FOLLOW } from '../../src/modules/clothFollow.ts'
import type { Displacement, Point } from '../../src/modules/rippleField.ts'
import { wavesGrid } from '../support/grid.ts'

const WIDTH = 1280
const HEIGHT = 800
const CAP = Math.min(FOLLOW.CAP_SHARE * Math.min(WIDTH, HEIGHT), FOLLOW.MAX_SHIFT_PX)
const PRESS: Point = { x: 400, y: 400 }
// A sideways wave amplitude as large as Waves is driven with in practice.
const MAX_WAVE_AMP_X = 75

// The grid with the overscan FOLLOW.MAX_SHIFT_PX asks for.
const GRID = wavesGrid(WIDTH, HEIGHT, 12, 36, FOLLOW.MAX_SHIFT_PX, FOLLOW.MAX_SHIFT_PX)

// A pointer path: where the held pointer is at `ms`, or null once released.
type Path = (ms: number) => Point | null

// The press, then a 100 ms move by (dx, dy), held until `releaseMs`.
function dragBy(dx: number, dy: number, releaseMs = Infinity): Path {
  return (ms) => {
    if (ms >= releaseMs) return null
    const share = Math.min(1, ms / 100)
    return { x: PRESS.x + dx * share, y: PRESS.y + dy * share }
  }
}

// Steps a fresh follow along `path` every `frameMs` up to `untilMs`, calling
// `each` after every frame.
function run(path: Path, untilMs: number, frameMs = 1000 / 60, each: (follow: ClothFollow, now: number, moving: boolean) => void = () => {}) {
  const follow = new ClothFollow()
  const frames = Math.round(untilMs / frameMs)
  for (let frame = 0; frame <= frames; frame++) {
    const now = frame * frameMs
    const moving = follow.step({ pointer: path(now), stroke: 1, now, width: WIDTH, height: HEIGHT })
    each(follow, now, moving)
  }
  return follow
}

function close(actual: number, expected: number, tolerance: number, what: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual}, expected ${expected} ± ${tolerance}`)
}

test('a held drag converges to the follow share of its offset', () => {
  assert.equal(FOLLOW.FOLLOW_SHARE, 0.3)
  const shift = run(dragBy(120, -80), 3000).shift
  close(shift.x, 36, 0.05, 'x')
  close(shift.y, -24, 0.05, 'y')
})

test('a long drag is capped at the share of the shorter side', () => {
  // 12% of the 800 px side.
  assert.equal(CAP, 96)
  const shift = run(dragBy(900, 600), 3000).shift
  close(Math.hypot(shift.x, shift.y), CAP, 0.05, 'shift')
  close(Math.atan2(shift.y, shift.x), Math.atan2(600, 900), 1e-3, 'direction')
})

test('the field lags behind the drag and overshoots slightly', () => {
  const target = 200 * FOLLOW.FOLLOW_SHARE
  let at100 = 0
  let most = 0
  run(dragBy(200, 0), 2000, 1000 / 60, (follow, now) => {
    if (Math.abs(now - 100) < 1) at100 = follow.shift.x
    most = Math.max(most, follow.shift.x)
  })
  assert.ok(at100 < target * 0.3, `100 ms in, the field is at ${at100} of ${target} px`)
  assert.ok(most > target * 1.02, `overshoot to ${most} of ${target} px`)
  assert.ok(most < target * 1.15, `overshoot to ${most} of ${target} px stays slight`)
})

test('the pull is strongest at the pointer and falls off to about a third at the far side', () => {
  // Dragged from (200, middle) to (300, middle): the far side is the right edge.
  const follow = run((ms) => ({ x: 200 + Math.min(1, ms / 100) * 100, y: HEIGHT / 2 }), 500)
  const near = follow.weightAt({ x: 300, y: HEIGHT / 2 })
  const far = follow.weightAt({ x: WIDTH, y: HEIGHT / 2 })
  const corner = follow.weightAt({ x: WIDTH, y: 0 })
  close(near, 1, 1e-9, 'weight at the pointer')
  assert.ok(far < 0.75 && far > 0.25, `far edge follows ${far}`)
  assert.ok(corner < far, `the far corner (${corner}) follows less than the far edge (${far})`)
  const displacement = follow.displace(GRID, null)
  assert.ok(displacement)
  const points = GRID[0].length
  const shiftOf = (line: number, index: number) => Math.hypot(displacement.x[line * points + index], displacement.y[line * points + index])
  const middle = Math.round(points / 2)
  const nearLine = GRID.findIndex((line) => line[0].x >= 300)
  assert.ok(shiftOf(GRID.length - 1, middle) < shiftOf(nearLine, middle) * 0.75, 'the far lines move less')
})

test('on release the field glides on along its velocity and slows, without springing back', () => {
  // A steady drag of 600 px/s, let go while still moving.
  const releaseMs = 300
  const path: Path = (ms) => (ms < releaseMs ? { x: PRESS.x + ms * 0.6, y: PRESS.y } : null)
  let atRelease: Point | null = null
  let speedAtRelease = 0
  const after: { now: number; x: number; speed: number }[] = []
  run(path, releaseMs + 10000, 1000 / 60, (follow, now) => {
    if (Math.abs(now - releaseMs) < 1e-6) {
      atRelease = follow.shift
      speedAtRelease = follow.velocity.x
    }
    if (now > releaseMs) after.push({ now, x: follow.shift.x, speed: follow.velocity.x })
  })
  assert.ok(atRelease !== null && speedAtRelease > 20, `moving at ${speedAtRelease} px/s on release`)
  const start = (atRelease as Point).x
  const firstHalf = after.filter((sample) => sample.now - releaseMs <= 500)
  firstHalf.reduce((previous, sample) => {
    assert.ok(sample.x >= previous - 1e-9, `the shift fell from ${previous} to ${sample.x} px at ${sample.now} ms`)
    return sample.x
  }, start)
  const halfSecond = firstHalf[firstHalf.length - 1]
  assert.ok(halfSecond.x - start > 5, `it glided ${halfSecond.x - start} px on in half a second`)
  assert.ok(halfSecond.speed < speedAtRelease * 0.75, `slowed from ${speedAtRelease} to ${halfSecond.speed} px/s`)
  const twoSeconds = after.find((sample) => sample.now - releaseMs >= 2000)
  assert.ok(twoSeconds && twoSeconds.speed > 10, `only ${twoSeconds?.speed} px/s after 2 s`)
  const eightSeconds = after.find((sample) => sample.now - releaseMs >= 8000)
  assert.ok(eightSeconds && eightSeconds.speed < FOLLOW.GLIDE_END_SPEED_PX_S * 2, `still at ${eightSeconds?.speed} px/s after 8 s`)
})

test('a slow fling glides about 3 s, a hard one about 9 s, and none longer', () => {
  // The time from release until the field is slower than the glide's end.
  const glide = (pxPerMs: number) => {
    const releaseMs = 300
    const path: Path = (ms) => (ms < releaseMs ? { x: PRESS.x + ms * pxPerMs, y: PRESS.y } : null)
    let end: number | null = null
    run(path, releaseMs + 15000, 1000 / 60, (follow, now) => {
      if (now > releaseMs && end === null && follow.velocity.x < FOLLOW.GLIDE_END_SPEED_PX_S) end = now - releaseMs
    })
    assert.ok(end !== null, `a ${pxPerMs * 1000} px/s drag glided over 15 s`)
    return end / 1000
  }
  const slow = glide(0.05)
  assert.ok(slow > 2.5 && slow < 4, `a 50 px/s drag glided ${slow} s`)
  const medium = glide(0.2)
  assert.ok(medium > slow + 1 && medium < 8, `a 200 px/s drag glided ${medium} s`)
  for (const pxPerMs of [0.8, 4]) {
    const hard = glide(pxPerMs)
    assert.ok(hard > 8 && hard <= FOLLOW.MAX_GLIDE_S, `a ${pxPerMs * 1000} px/s drag glided ${hard} s`)
  }
})

test('after the glide the field eases back without a jump or a wobble', () => {
  // Let go while moving at 600 px/s, so the glide and the return both run.
  const releaseMs = 300
  const path: Path = (ms) => (ms < releaseMs ? { x: PRESS.x + ms * 0.6, y: PRESS.y } : null)
  let previous: Point | null = null
  let previousStep: number | null = null
  let largestJerk = 0
  let crossed = false
  let restAt: number | null = null
  let shiftAt3s = 0
  const follow = run(path, 150000, 1000 / 60, (field, now, moving) => {
    const shift = field.shift
    if (previous && now > releaseMs) {
      const step = shift.x - previous.x
      if (previousStep !== null && now > releaseMs + 100 && moving) largestJerk = Math.max(largestJerk, Math.abs(step - previousStep))
      previousStep = step
    }
    if (now > releaseMs && shift.x < 0) crossed = true
    if (now > releaseMs && !moving && restAt === null) restAt = now
    if (Math.abs(now - releaseMs - 3000) < 1e-6) shiftAt3s = shift.x
    previous = shift
  })
  // Through the glide and the return, a frame's movement differs from the
  // last one's by under 0.05 px: no jump, no snap. (At the release itself the
  // velocity carries on but the spring's pull stops, as it should; the frame
  // that comes to rest drops the last SETTLE_PX, below the 0.1 px Waves
  // rounds to.)
  assert.ok(largestJerk < 0.05, `a frame's movement changed by ${largestJerk} px`)
  assert.ok(!crossed, 'it never passes back beyond the rest position')
  assert.ok(shiftAt3s > 5, `3 s after release the field still holds ${shiftAt3s} px of the drag`)
  assert.ok(restAt !== null && restAt - releaseMs > 5000, `back at rest ${restAt === null ? 'never' : restAt - releaseMs} ms after release`)
  assert.ok(follow.atRest)
  assert.equal(follow.displace(GRID, null), null, 'nothing to draw at rest')
})

test('a hard fling glides within the limit and never stops dead at it', () => {
  const path: Path = (ms) => (ms < 120 ? { x: PRESS.x + ms * 8, y: PRESS.y } : null)
  let largest = 0
  let lastSpeed = Infinity
  run(path, 3000, 1000 / 60, (follow, now) => {
    largest = Math.max(largest, follow.shift.x)
    if (now > 120 && now < 600) {
      assert.ok(follow.velocity.x <= lastSpeed + 1e-9, `sped up to ${follow.velocity.x} px/s at ${now} ms`)
      lastSpeed = follow.velocity.x
    }
  })
  assert.ok(largest <= FOLLOW.MAX_SHIFT_PX * 0.99, `the shift reached ${largest} of ${FOLLOW.MAX_SHIFT_PX} px`)
})

test('the frame rate does not change the motion', () => {
  const path = dragBy(500, 300, 900)
  const at = (frameMs: number) => {
    const samples: Point[] = []
    run(path, 1200, frameMs, (follow, now) => {
      if (Math.abs(now % 300) < 1e-6 || Math.abs((now % 300) - 300) < 1e-6) samples.push(follow.shift)
    })
    return samples
  }
  const reference = at(1000 / 240)
  // Rates whose frames land on every 300 ms sample.
  for (const frameMs of [1000 / 30, 1000 / 50, 1000 / 60, 1000 / 120]) {
    const samples = at(frameMs)
    assert.equal(samples.length, reference.length, `${frameMs} ms frames sampled ${samples.length} times`)
    samples.forEach((sample, index) => {
      const gap = Math.hypot(sample.x - reference[index].x, sample.y - reference[index].y)
      assert.ok(gap < 0.5, `at ${index * 300} ms, ${frameMs.toFixed(1)} ms frames differ by ${gap} px`)
    })
  }
})

test('the drawn shift adds to the ripple and stays within the overscan', () => {
  let largest = 0
  const count = GRID.length * GRID[0].length
  const base: Displacement = { x: new Float64Array(count).fill(1), y: new Float64Array(count) }
  // A violent zig-zag, then release.
  const path: Path = (ms) => (ms < 1500 ? { x: PRESS.x + 800 * Math.sign(Math.sin(ms / 40)), y: PRESS.y } : null)
  run(path, 3000, 1000 / 60, (follow) => {
    largest = Math.max(largest, Math.hypot(follow.shift.x, follow.shift.y))
    const displacement = follow.displace(GRID, base)
    if (displacement && displacement !== base) {
      const weight = follow.weightAt(GRID[0][0])
      close(displacement.x[0], weight * follow.shift.x + 1, 1e-9, 'the first point')
    }
  })
  assert.ok(largest <= FOLLOW.MAX_SHIFT_PX + 1e-9, `the shift reached ${largest} px`)
  // The outermost lines stay off screen however far the waves swing them.
  assert.ok(GRID[0][0].x + FOLLOW.MAX_SHIFT_PX + MAX_WAVE_AMP_X < 0, `left line at ${GRID[0][0].x}`)
  assert.ok(GRID[GRID.length - 1][0].x - FOLLOW.MAX_SHIFT_PX - MAX_WAVE_AMP_X > WIDTH, 'right line')
  // And each line's ends stay beyond the top and bottom however far the
  // field is shifted up or down.
  const lastPoint = GRID[0].length - 1
  assert.ok(GRID[0][0].y + FOLLOW.MAX_SHIFT_PX < 0, `top end at ${GRID[0][0].y}`)
  assert.ok(GRID[0][lastPoint].y - FOLLOW.MAX_SHIFT_PX > HEIGHT, `bottom end at ${GRID[0][lastPoint].y}`)
})

test('reduced motion has no follow', () => {
  const follow = new ClothFollow()
  follow.reducedMotion = true
  const path = dragBy(400, 0)
  const count = GRID.length * GRID[0].length
  const base: Displacement = { x: new Float64Array(count), y: new Float64Array(count) }
  for (let now = 0; now <= 1000; now += 1000 / 60) {
    assert.equal(follow.step({ pointer: path(now), stroke: 1, now, width: WIDTH, height: HEIGHT }), false)
    assert.equal(follow.displace(GRID, base), base)
  }
  assert.deepEqual(follow.shift, { x: 0, y: 0 })
})

test('a press during a glide takes over from where the field is; bad input fails loud', () => {
  const follow = run(dragBy(300, 0, 1000), 1200)
  const before = follow.shift
  // A second stroke pressed far away and held still: no jump towards it or
  // back to rest, only the glide's speed spent by the spring.
  let largestStep = 0
  let previous = before
  for (let now = 1200 + 1000 / 60; now <= 4000; now += 1000 / 60) {
    follow.step({ pointer: { x: 1100, y: 100 }, stroke: 2, now, width: WIDTH, height: HEIGHT })
    largestStep = Math.max(largestStep, Math.hypot(follow.shift.x - previous.x, follow.shift.y - previous.y))
    previous = follow.shift
  }
  assert.ok(largestStep < 1, `the shift moved ${largestStep} px in one frame`)
  assert.ok(Math.abs(follow.shift.x - before.x) < 5, `the field moved from ${before.x} to ${follow.shift.x} px`)
  assert.throws(() => follow.step({ pointer: { x: Number.NaN, y: 0 }, stroke: 2, now: 4100, width: WIDTH, height: HEIGHT }), /bad pointer/)
  assert.throws(() => follow.step({ pointer: null, stroke: 2, now: 4100, width: 0, height: HEIGHT }), /bad time/)
})
