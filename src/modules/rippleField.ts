// A spring mesh laid over the Waves grid that a dragged pointer stirs. Points
// near the pointer are pulled along with its motion and twirled around it, and
// springs between neighbouring points carry the disturbance outward as a
// ripple that fades, while the waves' own pattern flows on underneath. Pure
// (no DOM, no React) so a test can drive it; the caller supplies the grid, the
// pointer and the time.
//
// Each point's 2D displacement follows a damped wave equation on the grid (the
// classic water-ripple step, with a spring back to rest), integrated at a fixed
// substep so the result does not depend on the frame rate. Links between
// neighbours keep their length within limits by position-based constraints,
// as in verlet-js (MIT), so lines neither collapse nor overstretch.
// Lengths are pixels; rates are per second unless the name says ms.

export const RIPPLE = {
  // The pointer's reach: this share of the surface's shorter side, clamped to
  // MIN..MAX_RADIUS_PX. Every other length below scales with it.
  RADIUS_SHARE: 0.2,
  MIN_RADIUS_PX: 120,
  MAX_RADIUS_PX: 180,
  // The Gaussian falloff's σ as a share of the radius: a point one radius
  // from the pointer feels e^-2 ≈ 14% of its pull.
  FALLOFF_SHARE: 0.5,
  // Points under the pointer take on PULL_SHARE of its velocity at this rate
  // (scaled by the falloff). Higher drags the lines harder: 12/s towards all
  // of it stretches them about twice as far as 8/s towards 0.7 of it.
  PULL_PER_S: 12,
  PULL_SHARE: 1,
  // How fast a ripple travels through the mesh, in radii per second. It sets
  // the coupling stiffness between neighbours, c² / gap², along each line and
  // across to the adjacent lines alike.
  WAVE_SPEED_RADII_PER_S: 2.5,
  // The spring pulling each point back to its place in the waves' own
  // pattern, in 1/s² (ω = 5 rad/s).
  ANCHOR_PER_S2: 25,
  // Velocity damping. The ripple's amplitude falls by e every 2 / DAMPING s.
  DAMPING_PER_S: 4,
  // No point moves further than this share of the radius from its place:
  // room for a 600 ms drag's stretch at the pull above.
  MAX_DISPLACEMENT_SHARE: 0.8,
  // A link between neighbours stays between these shares of its rest length.
  MIN_STRETCH: 0.4,
  MAX_STRETCH: 2.5,
  // Wind (the swirl's strength) added per radian the drag turns, in full at
  // SWIRL_FULL_SPEED_PX_S and above, less when slower. Positive turns
  // clockwise on screen.
  SWIRL_PER_RADIAN: 0.5,
  SWIRL_FULL_SPEED_PX_S: 600,
  MAX_WIND: 4,
  // Tangential acceleration per unit of wind one σ from the vortex center,
  // in radii per s².
  SWIRL_ACCEL_RADII_PER_S2: 12,
  // Unwinding: the wind decays at UNWIND_PER_S and also loses
  // UNWIND_FLOOR_PER_S outright, so it reaches zero rather than lingering.
  UNWIND_PER_S: 1,
  UNWIND_FLOOR_PER_S: 0.2,
  // The vortex center trails the pointer by this time constant, so circling
  // stirs around the circle's middle rather than the fingertip.
  CENTER_LAG_MS: 250,
  // Time constant of the pointer velocity's smoothing; evens out jittery events.
  POINTER_SMOOTHING_MS: 40,
  MAX_POINTER_SPEED_PX_S: 5000,
  // The fixed integration step. A frame advances as many whole substeps as
  // fit; a longer gap (a paused loop) counts as MAX_FRAME_MS.
  SUBSTEP_MS: 1000 / 240,
  MAX_FRAME_MS: 100,
  // With no pointer and no wind left, the field comes to rest once every
  // point is within SETTLE_PX of its place and slower than SETTLE_SPEED_PX_S.
  SETTLE_PX: 0.25,
  SETTLE_SPEED_PX_S: 2,
}

export type RippleOptions = typeof RIPPLE

export interface Point {
  x: number
  y: number
}

// A point of the Waves grid: its place, and the waves' own offset this frame.
// Structurally Waves' own point, so Waves can pass its grid as it is.
export interface GridPoint extends Point {
  wave: Point
}

// Each point's offset, indexed line × points per line + point. The arrays are
// the field's own and change on the next step.
export interface Displacement {
  x: Float64Array
  y: Float64Array
}

export interface RippleInput {
  // In the grid's coordinates; null when nothing stirs the field.
  pointer: Point | null
  // Changes with each new press, so a press elsewhere starts afresh instead
  // of reading as one huge, fast move.
  stroke: number
  now: number
  radius: number
}

export function rippleRadius(width: number, height: number, options: RippleOptions = RIPPLE): number {
  const radius = Math.min(width, height) * options.RADIUS_SHARE
  return Math.min(options.MAX_RADIUS_PX, Math.max(options.MIN_RADIUS_PX, radius))
}

// The wind after `ms`: exponential decay plus a constant loss, ending at zero.
function unwound(wind: number, ms: number, options: RippleOptions): number {
  const seconds = ms / 1000
  const size = Math.abs(wind) * Math.exp(-options.UNWIND_PER_S * seconds) - options.UNWIND_FLOOR_PER_S * seconds
  return size > 0 ? Math.sign(wind) * size : 0
}

export class RippleField {
  private readonly options: RippleOptions
  private lines = 0
  private points = 0
  private originX = 0
  private originY = 0
  private gapX = 0
  private gapY = 0
  private ux = new Float64Array(0)
  private uy = new Float64Array(0)
  private vx = new Float64Array(0)
  private vy = new Float64Array(0)
  private startX = new Float64Array(0)
  private startY = new Float64Array(0)
  // Where each point is drawn this frame without the field: place + wave.
  private posX = new Float64Array(0)
  private posY = new Float64Array(0)
  private settled = true
  private lastNow: number | null = null
  // Time since the last substep, carried into the next frame.
  private carryMs = 0
  private pointer: Point | null = null
  private stroke: number | null = null
  // Smoothed pointer velocity, px/s.
  private velocity: Point = { x: 0, y: 0 }
  private center: Point = { x: 0, y: 0 }
  private windAmount = 0

  constructor(options: RippleOptions = RIPPLE) {
    this.options = options
  }

  get wind(): number {
    return this.windAmount
  }

  get atRest(): boolean {
    return this.settled
  }

  reset() {
    this.ux.fill(0)
    this.uy.fill(0)
    this.vx.fill(0)
    this.vy.fill(0)
    this.settled = true
    this.lastNow = null
    this.carryMs = 0
    this.pointer = null
    this.stroke = null
    this.velocity = { x: 0, y: 0 }
    this.windAmount = 0
  }

  // Advances the field to `input.now` and returns the displacement to draw,
  // or null while it is at rest.
  step(grid: ReadonlyArray<ReadonlyArray<GridPoint>>, input: RippleInput): Displacement | null {
    const { pointer, now, radius } = input
    if (!Number.isFinite(now) || !(radius > 0)) {
      throw new Error(`RippleField: bad time ${now} or radius ${radius}`)
    }
    if (pointer && !(Number.isFinite(pointer.x) && Number.isFinite(pointer.y))) {
      throw new Error(`RippleField: bad pointer ${JSON.stringify(pointer)}`)
    }
    const frameMs = this.lastNow === null ? 0 : Math.min(this.options.MAX_FRAME_MS, Math.max(0, now - this.lastNow))
    this.lastNow = now

    const fresh = pointer !== null && (this.pointer === null || input.stroke !== this.stroke)
    const from = fresh ? pointer : this.pointer
    if (fresh) {
      this.velocity = { x: 0, y: 0 }
      this.center = { x: pointer.x, y: pointer.y }
      this.windAmount = 0
    }
    this.pointer = pointer && { x: pointer.x, y: pointer.y }
    this.stroke = input.stroke
    if (!pointer && this.settled) return null
    this.settled = false

    this.layout(grid)
    let rawX = 0
    let rawY = 0
    if (pointer && from && frameMs > 0) {
      rawX = ((pointer.x - from.x) / frameMs) * 1000
      rawY = ((pointer.y - from.y) / frameMs) * 1000
      const speed = Math.hypot(rawX, rawY)
      if (speed > this.options.MAX_POINTER_SPEED_PX_S) {
        rawX *= this.options.MAX_POINTER_SPEED_PX_S / speed
        rawY *= this.options.MAX_POINTER_SPEED_PX_S / speed
      }
    }

    const substepMs = this.options.SUBSTEP_MS
    let elapsed = substepMs - this.carryMs
    // The epsilon keeps a frame that is a whole number of substeps (1/30 s
    // is 8) from losing its last one to rounding.
    while (elapsed <= frameMs + 1e-6) {
      const fraction = elapsed / frameMs
      const at = pointer && from && { x: from.x + (pointer.x - from.x) * fraction, y: from.y + (pointer.y - from.y) * fraction }
      this.substep(at, rawX, rawY, radius)
      elapsed += substepMs
    }
    this.carryMs = Math.max(0, frameMs - (elapsed - substepMs))

    if (!pointer && this.windAmount === 0 && this.calm()) {
      this.reset()
      this.lastNow = now
      return null
    }
    return { x: this.ux, y: this.uy }
  }

  // Sizes the arrays to the grid, starting from rest when the grid changed
  // (Waves rebuilds it on resize), and reads where each point is drawn.
  private layout(grid: ReadonlyArray<ReadonlyArray<GridPoint>>) {
    const lines = grid.length
    const points = lines > 0 ? grid[0].length : 0
    if (lines < 2 || points < 2) throw new Error(`RippleField: a ${lines}×${points} grid is too small`)
    for (const line of grid) {
      if (line.length !== points) throw new Error('RippleField: lines of different lengths')
    }
    const gapX = grid[1][0].x - grid[0][0].x
    const gapY = grid[0][1].y - grid[0][0].y
    if (!(gapX > 0 && gapY > 0)) throw new Error(`RippleField: bad grid gaps ${gapX}, ${gapY}`)
    const changed =
      lines !== this.lines ||
      points !== this.points ||
      gapX !== this.gapX ||
      gapY !== this.gapY ||
      grid[0][0].x !== this.originX ||
      grid[0][0].y !== this.originY
    if (changed) {
      const count = lines * points
      this.lines = lines
      this.points = points
      this.gapX = gapX
      this.gapY = gapY
      this.originX = grid[0][0].x
      this.originY = grid[0][0].y
      this.ux = new Float64Array(count)
      this.uy = new Float64Array(count)
      this.vx = new Float64Array(count)
      this.vy = new Float64Array(count)
      this.startX = new Float64Array(count)
      this.startY = new Float64Array(count)
      this.posX = new Float64Array(count)
      this.posY = new Float64Array(count)
    }
    for (let line = 0; line < lines; line++) {
      for (let index = 0; index < points; index++) {
        const point = grid[line][index]
        const k = line * points + index
        this.posX[k] = point.x + point.wave.x
        this.posY[k] = point.y + point.wave.y
      }
    }
  }

  private substep(pointer: Point | null, rawX: number, rawY: number, radius: number) {
    const options = this.options
    const ms = options.SUBSTEP_MS
    const dt = ms / 1000

    // The pointer's smoothed velocity, and the wind its turning winds up.
    if (pointer) {
      const blend = 1 - Math.exp(-ms / options.POINTER_SMOOTHING_MS)
      const before = this.velocity
      const after = { x: before.x + (rawX - before.x) * blend, y: before.y + (rawY - before.y) * blend }
      const speedBefore = Math.hypot(before.x, before.y)
      const speed = Math.hypot(after.x, after.y)
      if (speedBefore > 1 && speed > 1) {
        const turn = Math.atan2(before.x * after.y - before.y * after.x, before.x * after.x + before.y * after.y)
        this.windAmount += options.SWIRL_PER_RADIAN * turn * Math.min(1, speed / options.SWIRL_FULL_SPEED_PX_S)
      }
      this.velocity = after
      const follow = 1 - Math.exp(-ms / options.CENTER_LAG_MS)
      this.center = {
        x: this.center.x + (pointer.x - this.center.x) * follow,
        y: this.center.y + (pointer.y - this.center.y) * follow,
      }
    } else {
      this.velocity = { x: 0, y: 0 }
    }
    this.windAmount = unwound(this.windAmount, ms, options)
    this.windAmount = Math.max(-options.MAX_WIND, Math.min(options.MAX_WIND, this.windAmount))

    const { lines, points, ux, uy, vx, vy, posX, posY } = this
    const sigma = radius * options.FALLOFF_SHARE
    const falloff = 1 / (2 * sigma * sigma)
    const reach = (4 * sigma) ** 2
    const waveSpeed = options.WAVE_SPEED_RADII_PER_S * radius
    const acrossLines = (waveSpeed / this.gapX) ** 2
    const alongLine = (waveSpeed / this.gapY) ** 2
    const omega = Math.sqrt(4 * (acrossLines + alongLine) + options.ANCHOR_PER_S2)
    if (omega * dt > 1.5) {
      throw new Error(`RippleField: grid gaps ${this.gapX}×${this.gapY} too fine for a ${ms} ms substep`)
    }
    const anchor = options.ANCHOR_PER_S2
    const damping = options.DAMPING_PER_S
    const pullTargetX = this.velocity.x * options.PULL_SHARE
    const pullTargetY = this.velocity.y * options.PULL_SHARE
    const swirl = (options.SWIRL_ACCEL_RADII_PER_S2 * radius * this.windAmount) / sigma

    // Velocities, all from this substep's displacements.
    for (let line = 0; line < lines; line++) {
      for (let index = 0; index < points; index++) {
        const k = line * points + index
        // A missing neighbour at the edge counts as the point itself.
        const left = line > 0 ? k - points : k
        const right = line < lines - 1 ? k + points : k
        const up = index > 0 ? k - 1 : k
        const down = index < points - 1 ? k + 1 : k
        let ax =
          acrossLines * (ux[left] + ux[right] - 2 * ux[k]) +
          alongLine * (ux[up] + ux[down] - 2 * ux[k]) -
          anchor * ux[k] -
          damping * vx[k]
        let ay =
          acrossLines * (uy[left] + uy[right] - 2 * uy[k]) +
          alongLine * (uy[up] + uy[down] - 2 * uy[k]) -
          anchor * uy[k] -
          damping * vy[k]
        const x = posX[k] + ux[k]
        const y = posY[k] + uy[k]
        if (pointer) {
          const dx = x - pointer.x
          const dy = y - pointer.y
          const distance2 = dx * dx + dy * dy
          if (distance2 < reach) {
            const pull = options.PULL_PER_S * Math.exp(-distance2 * falloff)
            ax += pull * (pullTargetX - vx[k])
            ay += pull * (pullTargetY - vy[k])
          }
        }
        if (swirl !== 0) {
          const dx = x - this.center.x
          const dy = y - this.center.y
          const distance2 = dx * dx + dy * dy
          if (distance2 < reach) {
            // Tangential, clockwise on screen (y down) for positive wind;
            // (-dy, dx) / σ is r / σ long, so the push is zero at the center.
            const weight = swirl * Math.exp(-distance2 * falloff)
            ax -= weight * dy
            ay += weight * dx
          }
        }
        vx[k] += ax * dt
        vy[k] += ay * dt
      }
    }

    const { startX, startY } = this
    startX.set(ux)
    startY.set(uy)
    for (let k = 0; k < ux.length; k++) {
      ux[k] += vx[k] * dt
      uy[k] += vy[k] * dt
    }
    this.constrainLinks()
    const limit = radius * options.MAX_DISPLACEMENT_SHARE
    for (let k = 0; k < ux.length; k++) {
      const size = Math.hypot(ux[k], uy[k])
      if (size > limit) {
        ux[k] *= limit / size
        uy[k] *= limit / size
      }
      // Velocity from the corrected move, so the constraints take energy out
      // rather than putting it in.
      vx[k] = (ux[k] - startX[k]) / dt
      vy[k] = (uy[k] - startY[k]) / dt
    }
  }

  // One pass over the links across lines and along them.
  private constrainLinks() {
    const { lines, points } = this
    for (let line = 0; line < lines; line++) {
      for (let index = 0; index < points; index++) {
        const k = line * points + index
        if (line < lines - 1) this.constrainLink(k, k + points, this.gapX, 0)
        if (index < points - 1) this.constrainLink(k, k + 1, 0, this.gapY)
      }
    }
  }

  private constrainLink(from: number, to: number, restX: number, restY: number) {
    const { ux, uy, options } = this
    const restLength = Math.hypot(restX, restY)
    let linkX = restX + ux[to] - ux[from]
    let linkY = restY + uy[to] - uy[from]
    let length = Math.hypot(linkX, linkY)
    // Fully collapsed: part the two along the rest direction.
    if (length === 0) {
      linkX = restX * 1e-6
      linkY = restY * 1e-6
      length = restLength * 1e-6
    }
    const target = Math.min(options.MAX_STRETCH * restLength, Math.max(options.MIN_STRETCH * restLength, length))
    if (target === length) return
    const share = (length - target) / (2 * length)
    ux[from] += linkX * share
    uy[from] += linkY * share
    ux[to] -= linkX * share
    uy[to] -= linkY * share
  }

  private calm(): boolean {
    const { SETTLE_PX, SETTLE_SPEED_PX_S } = this.options
    for (let k = 0; k < this.ux.length; k++) {
      if (Math.abs(this.ux[k]) > SETTLE_PX || Math.abs(this.uy[k]) > SETTLE_PX) return false
      if (Math.abs(this.vx[k]) > SETTLE_SPEED_PX_S || Math.abs(this.vy[k]) > SETTLE_SPEED_PX_S) return false
    }
    return true
  }
}
