// The wave pattern as the inside of a ball around the viewer. A drag turns
// the ball gently the way it is pulled, SPIN_SCALE of the turn that would keep
// the bit of pattern under the pointer under it: across turns it about the
// vertical axis (yaw), down about the horizontal one (pitch), a diagonal both.
// Let go, the ball keeps turning the way it was pulled at SPIN_SCALE of the
// pointer's speed and slows over 3 to 9 s, longer for a harder fling, and
// stays where it stops. A new press catches it where it is.
//
// The screen is a window onto the ball's inside, so the pattern bends a little
// towards the edges (a barrel, as a wide lens sees the inside of a sphere):
// a point r px from the middle reads the pattern K·atan(r / K) px from it.
// As in an arcball (Shoemake's; three.js TrackballControls, MIT), the grab is
// made in those curved coordinates, which keeps the pointer's point under it
// at the edges too. Pure (no DOM, no React) so a test can drive it. Waves
// reads it through its `sample` getter, with `patternPeriod` set to PERIOD_PX.
// Lengths are pattern pixels (screen pixels in the middle of the view); times
// are ms as from performance.now(); speeds are px per second.
//
// Deliberate: yaw and pitch each wrap on their own (a torus), not a full
// rotation group. On a true sphere a periodic pattern must pinch or seam at
// the poles, and a vertical drag would turn into a sideways spin there; the
// torus keeps every drag direction alike forever.

import { releaseVelocity, MOMENTUM, type Point } from './momentum.ts'

// The share of the pointer's movement the ball turns, held and spinning on:
// at 1 the point under the pointer stays under it; below, the spin is a
// gentle turn under the cloth follow's stretch rather than the whole motion.
export const SPIN_SCALE = 0.1

export const SPIN = {
  // One full turn of the ball, across and down alike, in pattern pixels.
  // Waves repeats its pattern on this period (16 noise cells across, 12
  // down), so the turn closes without a seam. The ball's radius is
  // PERIOD_PX / 2π, about 1270 px.
  PERIOD_PX: 8000,
  // How strongly the view bends towards the edges: 1 is the true inside of a
  // ball of the radius above, 0 is flat. At 0.8 a point 700 px from the
  // middle reads the pattern 6% nearer it than a flat view would.
  CURVATURE: 0.8,
  // Pattern pixels the ball turns per curved pixel the pointer moves.
  SCALE: SPIN_SCALE,
  // The speeds below are the pointer's, in curved px/s; the ball spins at
  // SCALE of them. A released spin lasts from MIN_SPIN_S (a slow fling) to
  // MAX_SPIN_S (one at MAX_SPIN_PX_S or faster), longer by the log of the
  // speed, and its speed decays exponentially to END_SPEED_PX_S in that time,
  // so the timing does not depend on SCALE.
  MIN_SPIN_S: 3,
  MAX_SPIN_S: 9,
  // A release slower than this does not spin at all.
  MIN_FLING_PX_S: 30,
  // A harder fling counts as this fast; at SCALE 1 the ball then spins about
  // 3.1 rad/s.
  MAX_SPIN_PX_S: 4000,
  END_SPEED_PX_S: 2,
  SAMPLE_WINDOW_MS: MOMENTUM.SAMPLE_WINDOW_MS,
}

export type SpinOptions = typeof SPIN

export interface View {
  width: number
  height: number
}

// The ball's turn in radians, each in [0, 2π).
export interface Orientation {
  yaw: number
  pitch: number
}

// Each grid point's pattern coordinates, indexed line × points per line + point.
export interface PatternCoordinates {
  x: Float64Array
  y: Float64Array
}

interface Sample extends Point {
  time: number
}

interface Spin {
  from: Point
  // px/s at `start`.
  velocity: Point
  start: number
  // The decay rate in 1/s and the spin's length in s.
  decay: number
  seconds: number
}

function checkView(view: View) {
  if (!(view.width > 0) || !(view.height > 0)) throw new Error(`SphereSpin: bad view ${view.width}×${view.height}`)
}

function checkPoint(point: Point, now: number) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(now)) {
    throw new Error(`SphereSpin: bad point ${JSON.stringify(point)} at ${now}`)
  }
}

// The value in [0, period).
export function wrap(value: number, period: number): number {
  return ((value % period) + period) % period
}

// Where on the ball's unrolled surface a screen point looks, before any
// turn: the middle of the view maps to itself, and points further out are
// drawn in along their ray from it.
export function curved(point: Point, view: View, options: SpinOptions = SPIN): Point {
  const centerX = view.width / 2
  const centerY = view.height / 2
  const dx = point.x - centerX
  const dy = point.y - centerY
  const r = Math.hypot(dx, dy)
  if (options.CURVATURE === 0 || r === 0) return { x: point.x, y: point.y }
  const reach = options.PERIOD_PX / (2 * Math.PI) / options.CURVATURE
  const scale = (reach * Math.atan(r / reach)) / r
  return { x: centerX + dx * scale, y: centerY + dy * scale }
}

// How long a spin released at `speed` px/s lasts, in s; 0 below MIN_FLING_PX_S.
export function spinSeconds(speed: number, options: SpinOptions = SPIN): number {
  if (speed < options.MIN_FLING_PX_S) return 0
  const share = Math.log(speed / options.MIN_FLING_PX_S) / Math.log(options.MAX_SPIN_PX_S / options.MIN_FLING_PX_S)
  return options.MIN_SPIN_S + (options.MAX_SPIN_S - options.MIN_SPIN_S) * Math.min(1, share)
}

export class SphereSpin {
  private readonly options: SpinOptions
  // How far the ball has turned, in pattern px, unwrapped while held or
  // spinning and wrapped once at rest.
  private turn: Point = { x: 0, y: 0 }
  private grip: { press: Point; anchor: Point } | null = null
  private samples: Sample[] = []
  private spin: Spin | null = null
  private bufferX = new Float64Array(0)
  private bufferY = new Float64Array(0)
  // Deliberate: with reduced motion a drag neither turns nor spins the ball;
  // it stays where it was.
  reducedMotion = false

  constructor(options: SpinOptions = SPIN) {
    this.options = options
  }

  // One full turn in pattern px: the period Waves' pattern must repeat on.
  get period(): number {
    return this.options.PERIOD_PX
  }

  get held(): boolean {
    return this.grip !== null
  }

  get spinning(): boolean {
    return this.spin !== null
  }

  // Catches the ball at `point` (in the view's pixels), spinning or not.
  grab(point: Point, view: View, now: number) {
    checkPoint(point, now)
    checkView(view)
    if (this.reducedMotion) return
    this.turn = this.turnAt(now)
    this.spin = null
    const period = this.options.PERIOD_PX
    this.turn = { x: wrap(this.turn.x, period), y: wrap(this.turn.y, period) }
    const press = curved(point, view, this.options)
    this.grip = { press, anchor: this.turn }
    this.samples = [{ ...press, time: now }]
  }

  drag(point: Point, view: View, now: number) {
    checkPoint(point, now)
    checkView(view)
    const grip = this.grip
    if (!grip || this.reducedMotion) return
    const at = curved(point, view, this.options)
    const scale = this.options.SCALE
    this.turn = {
      x: grip.anchor.x + (at.x - grip.press.x) * scale,
      y: grip.anchor.y + (at.y - grip.press.y) * scale,
    }
    // The pointer's own path, so the spin's timing is the pointer's.
    this.samples.push({ ...at, time: now })
    const oldest = now - this.options.SAMPLE_WINDOW_MS
    // The last sample stays: the spin starts from it.
    while (this.samples.length > 1 && this.samples[0].time < oldest) this.samples.shift()
  }

  // Lets go: the ball spins on at SCALE of the pointer's last speed, or
  // stays put.
  release(now: number) {
    if (!Number.isFinite(now)) throw new Error(`SphereSpin: bad time ${now}`)
    if (!this.grip) return
    this.grip = null
    const perMs = releaseVelocity(this.samples, now, this.options.SAMPLE_WINDOW_MS)
    this.samples = []
    const speed = Math.hypot(perMs.x, perMs.y) * 1000
    const pointerSpeed = Math.min(speed, this.options.MAX_SPIN_PX_S)
    const seconds = spinSeconds(pointerSpeed, this.options)
    if (this.reducedMotion || seconds === 0) return
    const toSpin = (pointerSpeed / speed) * 1000 * this.options.SCALE
    const velocity = { x: perMs.x * toSpin, y: perMs.y * toSpin }
    const decay = Math.log(pointerSpeed / this.options.END_SPEED_PX_S) / seconds
    this.spin = { from: this.turn, velocity, start: now, decay, seconds }
  }

  // Ends a drag without a spin.
  cancel() {
    this.grip = null
    this.samples = []
  }

  // The ball's turn at `now`, in pattern px. Exact for any `now`, so it does
  // not depend on the frame rate; a spin ended or cut short by reduced
  // motion stays where it got to.
  advance(now: number): Point {
    if (!Number.isFinite(now)) throw new Error(`SphereSpin: bad time ${now}`)
    const spin = this.spin
    if (spin && (this.reducedMotion || (now - spin.start) / 1000 >= spin.seconds)) {
      this.turn = this.turnAt(now)
      this.spin = null
    }
    if (this.spin) return this.turnAt(now)
    if (!this.grip) {
      const period = this.options.PERIOD_PX
      this.turn = { x: wrap(this.turn.x, period), y: wrap(this.turn.y, period) }
    }
    return { ...this.turn }
  }

  // The turn as yaw and pitch at `now`.
  orientation(now: number): Orientation {
    const turn = this.advance(now)
    const period = this.options.PERIOD_PX
    return { yaw: (wrap(turn.x, period) / period) * 2 * Math.PI, pitch: (wrap(turn.y, period) / period) * 2 * Math.PI }
  }

  // Where each point of `grid` (in the view's pixels) reads the pattern at
  // `now`. The arrays are the spin's own and change on the next call.
  sample(grid: ReadonlyArray<ReadonlyArray<Point>>, view: View, now: number): PatternCoordinates {
    checkView(view)
    const period = this.options.PERIOD_PX
    const turn = this.advance(now)
    const turnX = wrap(turn.x, period)
    const turnY = wrap(turn.y, period)
    const points = grid.length > 0 ? grid[0].length : 0
    const count = grid.length * points
    if (this.bufferX.length !== count) {
      this.bufferX = new Float64Array(count)
      this.bufferY = new Float64Array(count)
    }
    for (let line = 0; line < grid.length; line++) {
      if (grid[line].length !== points) throw new Error(`SphereSpin: line ${line} has ${grid[line].length} points, not ${points}`)
      for (let index = 0; index < points; index++) {
        const at = curved(grid[line][index], view, this.options)
        const k = line * points + index
        this.bufferX[k] = at.x - turnX
        this.bufferY[k] = at.y - turnY
      }
    }
    return { x: this.bufferX, y: this.bufferY }
  }

  // The turn at `now` without settling anything: held, the dragged turn;
  // spinning, s = v·(1 − e^(−k·t)) / k on from the release, up to the
  // spin's end.
  private turnAt(now: number): Point {
    const spin = this.spin
    if (!spin || this.grip) return { ...this.turn }
    const seconds = Math.min(spin.seconds, Math.max(0, (now - spin.start) / 1000))
    const travel = (1 - Math.exp(-spin.decay * seconds)) / spin.decay
    return { x: spin.from.x + spin.velocity.x * travel, y: spin.from.y + spin.velocity.y * travel }
  }
}
