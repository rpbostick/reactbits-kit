// The drag dynamics toybox hands a page's own background (`api.motion` in
// registerBackground's mount, toybox 0.5.0), mapped to a transformed
// component's getters, so a page wires all ten from one `toyboxState`:
//
// - 'grid' (Waves): `displacement` is the motion's `displace` (ripple and
//   sheet together) and `sample` its `sample` (the spin), on the grid Waves
//   passes, with `patternPeriod` the ball's period and the overscan their
//   reach needs.
// - 'coordinates' (the nine WebGL backgrounds): `coordinates` shifts the
//   pattern by the sheet's shift and the spin's turn, turns it by the sheet's
//   twist about the middle of the view, as toybox's own shader backgrounds
//   do, and stirs it with the ripple field's strongest point.
//
// Toybox's lengths are client pixels and the components' are their
// container's, so everything passes through the surface's box. Toybox owns
// the drag, the momentum and reduced motion; this only reads them.
import { FOLLOW } from '../modules/clothFollow.ts'
import { RIPPLE, rippleRadius, type Displacement, type GridPoint, type Point } from '../modules/rippleField.ts'
import type { PatternCoordinates } from '../modules/sphereSpin.ts'

export interface ToyboxSheet {
  x: number
  y: number
  centerX: number
  centerY: number
  // Radians, clockwise on screen.
  angle: number
  moving: boolean
}

export interface ToyboxSpin {
  // The ball's turn in pattern pixels; it wraps to [0, period) at rest.
  x: number
  y: number
  yaw: number
  pitch: number
  period: number
  moving: boolean
}

// What this adapter reads of `api.motion`. Each member advances it to `at`.
export interface ToyboxMotion {
  pointer(at?: number): Point | null
  sheet(at?: number): ToyboxSheet
  spin(at?: number): ToyboxSpin
  ripple(grid: readonly (readonly GridPoint[])[], at?: number): Displacement | null
  displace(grid: readonly (readonly GridPoint[])[], at?: number): Displacement | null
  sample(grid: readonly (readonly Point[])[], at?: number): PatternCoordinates | null
}

export interface ToyboxState {
  motion: ToyboxMotion
  // Which getters the component takes: Waves' 'grid', or the WebGL
  // backgrounds' 'coordinates'.
  takes: 'grid' | 'coordinates'
}

export interface ToyboxSurface {
  now(): number
  rect(): { left: number; top: number; width: number; height: number }
}

// What the `coordinates` getter returns, as the transformed components
// declare it.
export interface CoordinateFrame {
  x: number
  y: number
  rotation: number
  scale: number
  centerX: number
  centerY: number
  ripple: { x: number; y: number; dx: number; dy: number; radius: number; twist: number } | null
}

// The ripple field's mesh for a WebGL background: as toybox's own shader
// backgrounds lay it, coarser than Waves' grid.
export const FIELD_GAP_PX = 24

// How far toybox's ripple and sheet together move a point: Waves draws that
// much grid beyond each edge.
export const TOYBOX_REACH_PX = RIPPLE.MAX_RADIUS_PX * RIPPLE.MAX_DISPLACEMENT_SHARE + FOLLOW.MAX_SHIFT_PX

// Points FIELD_GAP_PX apart over a width × height view whose top left is
// (left, top), as columns of { x, y, wave }.
export function fieldGrid(left: number, top: number, width: number, height: number): GridPoint[][] {
  const columns = Math.ceil(width / FIELD_GAP_PX) + 1
  const rows = Math.ceil(height / FIELD_GAP_PX) + 1
  return Array.from({ length: columns }, (_, column) =>
    Array.from({ length: rows }, (_, row) => ({ x: left + column * FIELD_GAP_PX, y: top + row * FIELD_GAP_PX, wave: { x: 0, y: 0 } })),
  )
}

// The ripple as one local stir: where the field moves a point furthest,
// that point's shift, and the turn of the field there (half its curl,
// clockwise on screen). Offsets are indexed column × rows + row.
export function strongestStir(grid: readonly (readonly GridPoint[])[], offsets: Displacement): { x: number; y: number; dx: number; dy: number; twist: number } {
  const columns = grid.length
  const rows = columns > 0 ? grid[0].length : 0
  if (columns < 2 || rows < 2) throw new Error(`strongestStir: a ${columns}×${rows} grid is too small`)
  if (offsets.x.length !== columns * rows || offsets.y.length !== columns * rows) {
    throw new Error(`strongestStir: ${offsets.x.length} offsets for ${columns * rows} points`)
  }
  let strongest = 0
  for (let k = 1; k < offsets.x.length; k++) {
    if (Math.hypot(offsets.x[k], offsets.y[k]) > Math.hypot(offsets.x[strongest], offsets.y[strongest])) strongest = k
  }
  const column = Math.floor(strongest / rows)
  const row = strongest % rows
  const left = Math.max(0, column - 1)
  const right = Math.min(columns - 1, column + 1)
  const up = Math.max(0, row - 1)
  const down = Math.min(rows - 1, row + 1)
  const across = (offsets.y[right * rows + row] - offsets.y[left * rows + row]) / (grid[right][row].x - grid[left][row].x)
  const along = (offsets.x[column * rows + down] - offsets.x[column * rows + up]) / (grid[column][down].y - grid[column][up].y)
  const point = grid[column][row]
  return { x: point.x + point.wave.x, y: point.y + point.wave.y, dx: offsets.x[strongest], dy: offsets.y[strongest], twist: (across - along) / 2 }
}

// `turn` moved on from `last` by the shorter way round the period, so a
// turn that wraps at rest reads as no move.
export function turnedBy(last: Point, turn: ToyboxSpin): Point {
  const shorter = (delta: number) => delta - turn.period * Math.round(delta / turn.period)
  return { x: shorter(turn.x - last.x), y: shorter(turn.y - last.y) }
}

export class ToyboxDynamics {
  private readonly motion: ToyboxMotion
  private readonly surface: ToyboxSurface
  private readonly takes: ToyboxState['takes']
  private readonly period: number
  // The spin's turn read as a scroll, unwrapped, and its last reading.
  private scroll: Point = { x: 0, y: 0 }
  private lastTurn: Point | null = null
  private field: { key: string; grid: GridPoint[][] } | null = null

  constructor(state: ToyboxState, surface: ToyboxSurface) {
    if (state.takes !== 'grid' && state.takes !== 'coordinates') throw new Error(`toyboxState: takes must be 'grid' or 'coordinates', not ${JSON.stringify(state.takes)}`)
    this.motion = state.motion
    this.takes = state.takes
    this.surface = surface
    this.period = this.motion.spin(surface.now()).period
    if (!(this.period > 0) || !Number.isFinite(this.period)) throw new Error(`toyboxState: the spin's period is ${this.period}`)
  }

  // The dragged or coasting point in the surface's own coordinates; null
  // when nothing is dragged.
  localPointer(): Point | null {
    const point = this.motion.pointer(this.surface.now())
    if (point === null) return null
    const { left, top } = this.surface.rect()
    return { x: point.x - left, y: point.y - top }
  }

  getters(): Record<string, unknown> {
    if (this.takes === 'coordinates') return { coordinates: () => this.coordinates() }
    return {
      displacement: (lines: readonly (readonly GridPoint[])[], time: number) => this.motion.displace(this.inClient(lines), time),
      // The surface's clock, like the drag's: the frame time can be earlier
      // than the release.
      sample: (lines: readonly (readonly GridPoint[])[]) => {
        const now = this.surface.now()
        const at = this.motion.sample(this.inClient(lines), now)
        if (at !== null && this.motion.spin(now).period !== this.period) throw new Error("toyboxState: the spin's period changed on a mounted background")
        return at
      },
      patternPeriod: { x: this.period, y: this.period },
      overscanX: TOYBOX_REACH_PX,
      overscanY: TOYBOX_REACH_PX,
    }
  }

  coordinates(): CoordinateFrame {
    const now = this.surface.now()
    const { left, top, width, height } = this.surface.rect()
    const sheet = this.motion.sheet(now)
    const turn = this.motion.spin(now)
    const moved = this.lastTurn ? turnedBy(this.lastTurn, turn) : { x: 0, y: 0 }
    this.scroll = { x: this.scroll.x + moved.x, y: this.scroll.y + moved.y }
    this.lastTurn = { x: turn.x, y: turn.y }
    let ripple: CoordinateFrame['ripple'] = null
    if (width > 0 && height > 0) {
      const grid = this.fieldGrid(left, top, width, height)
      const offsets = this.motion.ripple(grid, now)
      if (offsets) {
        const stir = strongestStir(grid, offsets)
        // The field's Gaussian falloff, exp(-d² / 2σ²), as exp(-d² / radius²).
        const radius = rippleRadius(width, height) * RIPPLE.FALLOFF_SHARE * Math.SQRT2
        ripple = { x: stir.x - left, y: stir.y - top, dx: stir.dx, dy: stir.dy, radius, twist: stir.twist }
      }
    }
    return {
      x: sheet.x + this.scroll.x,
      y: sheet.y + this.scroll.y,
      rotation: sheet.angle,
      scale: 1,
      centerX: width / 2,
      centerY: height / 2,
      ripple,
    }
  }

  private fieldGrid(left: number, top: number, width: number, height: number): GridPoint[][] {
    const key = `${left},${top},${width},${height}`
    if (this.field?.key !== key) this.field = { key, grid: fieldGrid(left, top, width, height) }
    return this.field.grid
  }

  // Waves' grid in client coordinates, as toybox reads it.
  private inClient(lines: readonly (readonly GridPoint[])[]): readonly (readonly GridPoint[])[] {
    const { left, top } = this.surface.rect()
    if (left === 0 && top === 0) return lines
    return lines.map((line) => line.map((point) => ({ x: point.x + left, y: point.y + top, wave: point.wave })))
  }
}
