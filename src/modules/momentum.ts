// Inertia for a flung pointer: after release, a virtual pointer carries on
// along the release velocity, slowing with friction and bouncing softly off
// the edges, then fades out. Pure (no DOM, no React) so any page can use it;
// the caller supplies the time and the bounds. Inertial scrolling as in
// popmotion's `inertia` (MIT), small enough here not to add the dependency.
// Units are pixels and milliseconds.

export const MOMENTUM = {
  // How far back the release velocity looks. Longer smooths a jittery
  // release; shorter follows a last-moment change of direction.
  SAMPLE_WINDOW_MS: 100,
  // k in v *= exp(-k·dt). Higher stops sooner: speed halves every ln 2 / k
  // (about 0.6 s at 0.0012).
  FRICTION_PER_MS: 0.0012,
  // A release slower than this does not coast at all.
  MIN_RELEASE_SPEED: 0.25,
  // The coast ends, and the fade begins, once the speed drops below this.
  STOP_SPEED: 0.1,
  // The longest coast however hard the fling, fade not included.
  MAX_COAST_MS: 4000,
  // How long the pointer's pull takes to fade out after the coast.
  FADE_MS: 500,
  // The share of speed kept by a bounce off an edge. 1 bounces without loss.
  BOUNCE_KEEP: 0.6,
}

export type MomentumOptions = typeof MOMENTUM

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface Sample extends Point {
  time: number
}

// Pixels per millisecond over the samples within the window before `releaseTime`;
// zero when the pointer was still for the whole window.
export function releaseVelocity(samples: Sample[], releaseTime: number, windowMs = MOMENTUM.SAMPLE_WINDOW_MS): Point {
  const recent = samples.filter((sample) => sample.time >= releaseTime - windowMs)
  if (recent.length < 2) return { x: 0, y: 0 }
  const first = recent[0]
  const last = recent[recent.length - 1]
  const span = last.time - first.time
  if (span <= 0) return { x: 0, y: 0 }
  return { x: (last.x - first.x) / span, y: (last.y - first.y) / span }
}

// How long a release at `speed` coasts before the fade: the time friction
// takes to bring it down to STOP_SPEED, capped, and none below MIN_RELEASE_SPEED.
export function coastDuration(speed: number, options: MomentumOptions = MOMENTUM): number {
  if (speed < options.MIN_RELEASE_SPEED) return 0
  return Math.min(options.MAX_COAST_MS, Math.log(speed / options.STOP_SPEED) / options.FRICTION_PER_MS)
}

// Folds a coordinate that has passed an edge back inside, keeping BOUNCE_KEEP
// of the overshoot; returns the new coordinate and how many times it bounced.
function bounce(value: number, low: number, high: number, keep: number): [number, number] {
  let bounces = 0
  while (value < low || value > high) {
    value = value < low ? low + (low - value) * keep : high - (value - high) * keep
    bounces++
  }
  return [value, bounces]
}

export class Momentum {
  private samples: Sample[] = []
  private coast: { point: Point; velocity: Point; time: number; coastEnd: number; fadeStart: number | null } | null =
    null

  private readonly options: MomentumOptions

  constructor(options: MomentumOptions = MOMENTUM) {
    this.options = options
  }

  get coasting(): boolean {
    return this.coast !== null
  }

  // A new press takes over from any coast.
  press(x: number, y: number, now: number) {
    this.coast = null
    this.samples = [{ x, y, time: now }]
  }

  move(x: number, y: number, now: number) {
    this.samples.push({ x, y, time: now })
    const oldest = now - this.options.SAMPLE_WINDOW_MS
    // The last sample stays: the coast starts from it.
    while (this.samples.length > 1 && this.samples[0].time < oldest) this.samples.shift()
  }

  // Starts the coast from the last sample; with reduced motion, or too slow a
  // release, there is none.
  release(now: number, reducedMotion: boolean) {
    const last = this.samples[this.samples.length - 1]
    const velocity = releaseVelocity(this.samples, now, this.options.SAMPLE_WINDOW_MS)
    this.samples = []
    const duration = coastDuration(Math.hypot(velocity.x, velocity.y), this.options)
    if (reducedMotion || !last || duration === 0) {
      this.coast = null
      return
    }
    this.coast = { point: { x: last.x, y: last.y }, velocity, time: now, coastEnd: now + duration, fadeStart: null }
  }

  cancel() {
    this.coast = null
    this.samples = []
  }

  // The virtual pointer at `now`, or null once the coast and fade are over.
  // Fading scales each step down to nothing: a pointer's pull on the waves
  // follows how far it moves per frame.
  advance(now: number, bounds: Bounds): Point | null {
    const coast = this.coast
    if (!coast) return null
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
      throw new Error(`Momentum: empty bounds ${JSON.stringify(bounds)}`)
    }
    const { FRICTION_PER_MS: k, STOP_SPEED, FADE_MS, BOUNCE_KEEP } = this.options
    const dt = Math.max(0, now - coast.time)
    const slow = Math.hypot(coast.velocity.x, coast.velocity.y) < STOP_SPEED
    if (coast.fadeStart === null && (coast.time >= coast.coastEnd || slow)) coast.fadeStart = coast.time
    const fade = coast.fadeStart === null ? 1 : 1 - (now - coast.fadeStart) / FADE_MS
    if (fade <= 0) {
      this.coast = null
      return null
    }
    // Exact for any dt, so the path does not depend on the frame rate.
    const decay = Math.exp(-k * dt)
    const travel = ((1 - decay) / k) * fade
    const [x, bouncesX] = bounce(coast.point.x + coast.velocity.x * travel, bounds.left, bounds.right, BOUNCE_KEEP)
    const [y, bouncesY] = bounce(coast.point.y + coast.velocity.y * travel, bounds.top, bounds.bottom, BOUNCE_KEEP)
    coast.velocity = {
      x: coast.velocity.x * decay * (-BOUNCE_KEEP) ** bouncesX,
      y: coast.velocity.y * decay * (-BOUNCE_KEEP) ** bouncesY,
    }
    coast.point = { x, y }
    coast.time = now
    return { x, y }
  }
}
