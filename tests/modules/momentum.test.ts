import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coastDuration, Momentum, MOMENTUM, releaseVelocity, type Bounds, type Point } from '../../src/modules/momentum.ts'

const FRAME_MS = 16
const WIDE: Bounds = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 }
const SURFACE: Bounds = { left: 0, top: 0, right: 800, bottom: 600 }

function close(actual: number, expected: number, message = '') {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message} expected ${expected}, got ${actual}`)
}

// A drag at `speed` px/ms to the right, ending at (x, y) at time 0.
function fling(speed: number, x = 400, y = 300, reducedMotion = false): Momentum {
  const momentum = new Momentum()
  const start = -10 * FRAME_MS
  momentum.press(x + speed * start, y, start)
  for (let now = start + FRAME_MS; now <= 0; now += FRAME_MS) momentum.move(x + speed * now, y, now)
  momentum.release(0, reducedMotion)
  return momentum
}

// Advances frame by frame until the pointer is gone; returns every point.
function run(momentum: Momentum, bounds: Bounds, frameMs = FRAME_MS): Point[] {
  const points: Point[] = []
  for (let now = frameMs; now < 60_000; now += frameMs) {
    const point = momentum.advance(now, bounds)
    if (!point) return points
    points.push(point)
  }
  throw new Error('the coast never ended')
}

test('release velocity is the travel over the last window; still for the window is zero', () => {
  const steady = [0, 20, 40, 60, 80, 100].map((time) => ({ x: time, y: -time / 2, time }))
  const velocity = releaseVelocity(steady, 100)
  close(velocity.x, 1)
  close(velocity.y, -0.5)

  const turned = [
    { x: 0, y: 0, time: 0 },
    { x: 500, y: 0, time: 100 },
    { x: 500, y: 100, time: 200 },
  ]
  close(releaseVelocity(turned, 200).x, 0, 'only the last 100 ms count')
  close(releaseVelocity(turned, 200).y, 1)

  assert.deepEqual(releaseVelocity(steady, 100 + MOMENTUM.SAMPLE_WINDOW_MS + 1), { x: 0, y: 0 })
  assert.deepEqual(releaseVelocity([{ x: 5, y: 5, time: 0 }], 0), { x: 0, y: 0 })
})

test('decay is the same at any frame rate and slows the pointer down', () => {
  const ends = [8, 12, 20, 50, 600].map((frameMs) => {
    const momentum = fling(1)
    let point: Point | null = null
    for (let now = frameMs; now <= 600; now += frameMs) point = momentum.advance(now, WIDE)
    assert.ok(point)
    return point.x
  })
  for (const end of ends) close(end, ends[0])
  close(ends[0] - 400, (1 - Math.exp(-MOMENTUM.FRICTION_PER_MS * 600)) / MOMENTUM.FRICTION_PER_MS, 'travel')

  const points = run(fling(1), WIDE)
  const early = points[10].x - points[9].x
  const late = points[60].x - points[59].x
  assert.ok(late < early * 0.6, `steps ${early} then ${late}`)
})

test('coast time grows with release speed, is capped, and is none below the minimum', () => {
  assert.equal(coastDuration(MOMENTUM.MIN_RELEASE_SPEED * 0.9), 0)
  assert.ok(coastDuration(0.5) < coastDuration(2))
  assert.equal(coastDuration(1e6), MOMENTUM.MAX_COAST_MS)

  assert.equal(fling(MOMENTUM.MIN_RELEASE_SPEED * 0.9).coasting, false, 'a slow release stops at once')
  const slow = run(fling(0.4), WIDE).length * FRAME_MS
  const fast = run(fling(4), WIDE).length * FRAME_MS
  const hardest = run(fling(1e6), WIDE).length * FRAME_MS
  assert.ok(fast > slow, `slow ${slow} ms, fast ${fast} ms`)
  assert.ok(fast >= 3000, `a fast fling coasts for seconds: ${fast} ms`)
  assert.ok(hardest <= MOMENTUM.MAX_COAST_MS + MOMENTUM.FADE_MS + FRAME_MS, `capped: ${hardest} ms`)
})

test('the pull fades out over FADE_MS after the coast, then the pointer is gone', () => {
  const momentum = fling(0.3)
  const coastEnd = coastDuration(0.3)
  const points = run(momentum, WIDE)
  const total = points.length * FRAME_MS
  assert.ok(total >= coastEnd + MOMENTUM.FADE_MS - 2 * FRAME_MS, `${total} ms`)
  assert.ok(total <= coastEnd + MOMENTUM.FADE_MS + 2 * FRAME_MS, `${total} ms`)
  const last = points[points.length - 1].x - points[points.length - 2].x
  assert.ok(last < MOMENTUM.STOP_SPEED * FRAME_MS * 0.1, `last step ${last}`)
  assert.equal(momentum.advance(60_000, WIDE), null)
})

test('it bounces off an edge with some loss and stays inside', () => {
  const points = run(fling(3, 780, 300), SURFACE)
  for (const point of points) {
    assert.ok(point.x >= SURFACE.left && point.x <= SURFACE.right, `x ${point.x}`)
  }
  const turn = points.findIndex((point, index) => index > 0 && point.x < points[index - 1].x)
  assert.ok(turn > 0, 'it turned back')
  const after = points[turn + 1].x - points[turn].x
  assert.ok(after < 0 && -after < 3 * FRAME_MS * MOMENTUM.BOUNCE_KEEP, `${after} px/frame out`)

  const corner = run(fling(3, 10, 10), { left: 0, top: 0, right: 40, bottom: 40 })
  for (const point of corner) assert.ok(point.x >= 0 && point.x <= 40, `x ${point.x}`)
})

test('a new press during the coast takes over at once', () => {
  const momentum = fling(3)
  momentum.advance(FRAME_MS, WIDE)
  assert.equal(momentum.coasting, true)
  momentum.press(100, 100, 2 * FRAME_MS)
  assert.equal(momentum.coasting, false)
  assert.equal(momentum.advance(3 * FRAME_MS, WIDE), null)
})

test('reduced motion has no coast', () => {
  const momentum = fling(3, 400, 300, true)
  assert.equal(momentum.coasting, false)
  assert.equal(momentum.advance(FRAME_MS, WIDE), null)
})

test('empty bounds fail loud', () => {
  assert.throws(() => fling(3).advance(FRAME_MS, { left: 0, top: 0, right: 0, bottom: 100 }), /empty bounds/)
})
