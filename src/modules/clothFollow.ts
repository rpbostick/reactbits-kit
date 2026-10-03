// The whole wave field following a drag a little, like a sheet on water:
// while the pointer is held, the field is shifted by a share of the pointer's
// offset from the press point, through a soft, underdamped spring so it lags
// and overshoots slightly. On release it does not spring back: it glides on
// with the velocity it had, slowing with a third of the pointer coast's
// friction, and once slow drifts back to rest so gently (overdamped, over
// tens of seconds) that the waves' own flow carries on from wherever it
// ended. The shift is
// strongest at the pointer and falls off across the surface, so the field
// stretches like cloth rather than sliding like a picture. It sits on top of
// the ripple field's local stir. Pure (no DOM, no React) so a test can drive
// it. Lengths are pixels; rates are per second unless the name says ms.

import { MOMENTUM } from './momentum.ts'
import type { Displacement, GridPoint, Point } from './rippleField.ts'

export const FOLLOW = {
  // The field under the pointer heads for this share of the pointer's offset
  // from where it was pressed.
  FOLLOW_SHARE: 0.3,
  // A drag's own pull is at most this share of the surface's shorter side.
  CAP_SHARE: 0.12,
  // The farthest the field is ever shifted, glide and a shift carried into a
  // new press included. Add it to Waves' overscanX and overscanY, so the
  // shifted lines still reach past the edges.
  MAX_SHIFT_PX: 250,
  // The spring towards the target while held, in 1/s² (ω = 5 rad/s, a heavy
  // sheet that is slow to start following), and its damping:
  // ζ = DAMPING / (2ω) = 0.64, which overshoots by about 7%.
  STIFFNESS_PER_S2: 25,
  DAMPING_PER_S: 6.4,
  // Released, the speed decays as exp(-k·t), a third of the coast's friction
  // in momentum.ts: it halves every 1.7 s.
  GLIDE_FRICTION_PER_S: (MOMENTUM.FRICTION_PER_MS * 1000) / 3,
  // A glide is over once it is slower than this (0.03 px a frame at 60 Hz),
  // so it lasts about ln(speed / GLIDE_END) / k: 3.5 s from the 8 px/s a
  // 50 px/s drag lets go at. The release speed is limited so friction alone
  // would end a glide within MAX_GLIDE_S; a hard fling glides about 8.5 s.
  GLIDE_END_SPEED_PX_S: 2,
  MAX_GLIDE_S: 9,
  // And a weak pull back to rest, in 1/s². Below (k/2)² = 0.04 it is
  // overdamped, so the return never wobbles; its slow part decays with a time
  // constant of about 10 s. It fades in as an outward glide slows (e⁻¹ of it
  // at RELAX_SPEED_PX_S outward, all of it once still or heading back), so
  // it does not cut a glide short.
  RELAX_PER_S2: 0.03,
  RELAX_SPEED_PX_S: 1,
  // The falloff: a point FAR_DISTANCE_SHARE of the surface's diagonal from
  // the pointer follows FAR_WEIGHT of the shift (Gaussian in between and beyond).
  FAR_DISTANCE_SHARE: 0.75,
  FAR_WEIGHT: 1 / 3,
  // The fixed integration step; a longer gap (a paused loop) counts as
  // MAX_FRAME_MS.
  SUBSTEP_MS: 1000 / 240,
  MAX_FRAME_MS: 100,
  // Released, the field is at rest once the shift is under SETTLE_PX and
  // slower than SETTLE_SPEED_PX_S.
  SETTLE_PX: 0.1,
  SETTLE_SPEED_PX_S: 1,
}

export type FollowOptions = typeof FOLLOW

export interface FollowInput {
  // The dragged point in the grid's coordinates, without a fling's coast;
  // null when nothing is held.
  pointer: Point | null
  // Changes with each new press, so a press elsewhere starts its own offset.
  stroke: number
  now: number
  width: number
  height: number
}

export class ClothFollow {
  private readonly options: FollowOptions
  private shiftX = 0
  private shiftY = 0
  private speedX = 0
  private speedY = 0
  private settled = true
  private lastNow: number | null = null
  private carryMs = 0
  private press: Point | null = null
  // The shift when the pointer was pressed: a press during a glide pulls on
  // from there, so it takes over without a jump.
  private anchor: Point = { x: 0, y: 0 }
  private pointer: Point | null = null
  private stroke: number | null = null
  // Whether the last substep was held; the first released one limits the glide.
  private held = false
  // Where the falloff is centered: the dragged point, kept after release.
  private center: Point = { x: 0, y: 0 }
  private diagonal = 1
  private bufferX = new Float64Array(0)
  private bufferY = new Float64Array(0)
  // Deliberate: with reduced motion there is no global follow at all.
  reducedMotion = false

  constructor(options: FollowOptions = FOLLOW) {
    this.options = options
  }

  get atRest(): boolean {
    return this.settled
  }

  // The field's shift at the pointer this frame.
  get shift(): Point {
    return { x: this.shiftX, y: this.shiftY }
  }

  // The field's velocity at the pointer, in px/s.
  get velocity(): Point {
    return { x: this.speedX, y: this.speedY }
  }

  reset() {
    this.shiftX = 0
    this.shiftY = 0
    this.speedX = 0
    this.speedY = 0
    this.settled = true
    this.lastNow = null
    this.carryMs = 0
    this.press = null
    this.anchor = { x: 0, y: 0 }
    this.pointer = null
    this.stroke = null
    this.held = false
  }

  // The weight of the shift a point at `place` follows.
  weightAt(place: Point): number {
    const reach = this.options.FAR_DISTANCE_SHARE * this.diagonal
    const distance2 = ((place.x - this.center.x) ** 2 + (place.y - this.center.y) ** 2) / (reach * reach)
    return this.options.FAR_WEIGHT ** distance2
  }

  // Advances the field to `input.now`; false while it is at rest.
  step(input: FollowInput): boolean {
    const { pointer, now, width, height } = input
    if (!Number.isFinite(now) || !(width > 0) || !(height > 0)) {
      throw new Error(`ClothFollow: bad time ${now} or size ${width}×${height}`)
    }
    if (pointer && !(Number.isFinite(pointer.x) && Number.isFinite(pointer.y))) {
      throw new Error(`ClothFollow: bad pointer ${JSON.stringify(pointer)}`)
    }
    if (this.reducedMotion) {
      this.reset()
      return false
    }
    const options = this.options
    const frameMs = this.lastNow === null ? 0 : Math.min(options.MAX_FRAME_MS, Math.max(0, now - this.lastNow))
    this.lastNow = now

    const fresh = pointer !== null && (this.pointer === null || input.stroke !== this.stroke)
    if (fresh) {
      this.press = { x: pointer.x, y: pointer.y }
      this.anchor = { x: this.shiftX, y: this.shiftY }
    }
    const from = fresh ? pointer : this.pointer
    this.pointer = pointer && { x: pointer.x, y: pointer.y }
    this.stroke = input.stroke
    if (!pointer && this.settled) return false
    this.settled = false
    if (pointer) this.center = { x: pointer.x, y: pointer.y }
    this.diagonal = Math.hypot(width, height)
    const cap = Math.min(options.CAP_SHARE * Math.min(width, height), options.MAX_SHIFT_PX)

    const substepMs = options.SUBSTEP_MS
    let elapsed = substepMs - this.carryMs
    // The epsilon keeps a frame that is a whole number of substeps from
    // losing its last one to rounding.
    while (elapsed <= frameMs + 1e-6) {
      const fraction = elapsed / frameMs
      // In the frame that sees the release, the pointer counts as held where
      // it was last seen until the frame's end, so the release lands at the
      // same time at any frame rate.
      const at = pointer && from ? { x: from.x + (pointer.x - from.x) * fraction, y: from.y + (pointer.y - from.y) * fraction } : from
      if (at && this.press) this.pull(this.target(at, this.press, cap))
      else this.glide()
      elapsed += substepMs
    }
    this.carryMs = Math.max(0, frameMs - (elapsed - substepMs))
    if (!pointer) this.press = null

    if (
      !pointer &&
      Math.hypot(this.shiftX, this.shiftY) < options.SETTLE_PX &&
      Math.hypot(this.speedX, this.speedY) < options.SETTLE_SPEED_PX_S
    ) {
      this.reset()
      this.lastNow = now
      return false
    }
    return true
  }

  // The shift for each point of `grid` by its weight, added to `base` (the
  // ripple field's offsets, indexed the same way) when there is one; null
  // while at rest, when `base` is returned as it is.
  displace(grid: ReadonlyArray<ReadonlyArray<GridPoint>>, base: Displacement | null): Displacement | null {
    if (this.settled) return base
    const points = grid.length > 0 ? grid[0].length : 0
    const count = grid.length * points
    if (base && (base.x.length !== count || base.y.length !== count)) {
      throw new Error(`ClothFollow: ${base.x.length} base offsets for ${count} points`)
    }
    if (this.bufferX.length !== count) {
      this.bufferX = new Float64Array(count)
      this.bufferY = new Float64Array(count)
    }
    for (let line = 0; line < grid.length; line++) {
      for (let index = 0; index < points; index++) {
        const k = line * points + index
        const weight = this.weightAt(grid[line][index])
        this.bufferX[k] = weight * this.shiftX + (base ? base.x[k] : 0)
        this.bufferY[k] = weight * this.shiftY + (base ? base.y[k] : 0)
      }
    }
    return { x: this.bufferX, y: this.bufferY }
  }

  // The anchor plus the drag's own pull, each capped.
  private target(at: Point, press: Point, cap: number): Point {
    let x = (at.x - press.x) * this.options.FOLLOW_SHARE
    let y = (at.y - press.y) * this.options.FOLLOW_SHARE
    const pull = Math.hypot(x, y)
    if (pull > cap) {
      x *= cap / pull
      y *= cap / pull
    }
    x += this.anchor.x
    y += this.anchor.y
    const size = Math.hypot(x, y)
    const most = this.options.MAX_SHIFT_PX
    return size > most ? { x: (x * most) / size, y: (y * most) / size } : { x, y }
  }

  // One held substep. Semi-implicit Euler, stable at this substep for ω·dt ≪ 1.
  private pull(target: Point) {
    const options = this.options
    const dt = options.SUBSTEP_MS / 1000
    this.held = true
    this.speedX += (options.STIFFNESS_PER_S2 * (target.x - this.shiftX) - options.DAMPING_PER_S * this.speedX) * dt
    this.speedY += (options.STIFFNESS_PER_S2 * (target.y - this.shiftY) - options.DAMPING_PER_S * this.speedY) * dt
    this.move(dt)
  }

  // One released substep: friction and the weak pull back to rest.
  private glide() {
    const options = this.options
    const dt = options.SUBSTEP_MS / 1000
    if (this.held) {
      this.held = false
      // A free glide covers speed / friction; slowing the release keeps it
      // within MAX_SHIFT_PX, so the field never stops dead at the limit, and
      // within MAX_GLIDE_S.
      const room = Math.max(0, options.MAX_SHIFT_PX - Math.hypot(this.shiftX, this.shiftY)) * options.GLIDE_FRICTION_PER_S
      const longest = options.GLIDE_END_SPEED_PX_S * Math.exp(options.GLIDE_FRICTION_PER_S * options.MAX_GLIDE_S)
      const limit = Math.min(room, longest)
      const speed = Math.hypot(this.speedX, this.speedY)
      if (speed > limit) {
        this.speedX *= limit / speed
        this.speedY *= limit / speed
      }
    }
    const decay = Math.exp(-options.GLIDE_FRICTION_PER_S * dt)
    const size = Math.hypot(this.shiftX, this.shiftY)
    const outward = size > 0 ? Math.max(0, (this.speedX * this.shiftX + this.speedY * this.shiftY) / size) : 0
    const relax = options.RELAX_PER_S2 * Math.exp(-outward / options.RELAX_SPEED_PX_S)
    this.speedX = this.speedX * decay - relax * this.shiftX * dt
    this.speedY = this.speedY * decay - relax * this.shiftY * dt
    this.move(dt)
  }

  private move(dt: number) {
    this.shiftX += this.speedX * dt
    this.shiftY += this.speedY * dt
    const size = Math.hypot(this.shiftX, this.shiftY)
    if (size > this.options.MAX_SHIFT_PX) {
      this.shiftX *= this.options.MAX_SHIFT_PX / size
      this.shiftY *= this.options.MAX_SHIFT_PX / size
    }
  }
}
