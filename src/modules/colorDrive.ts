// Where a surface sits on the 72-stop color loop (palette.ts), as a real
// number. It drifts forward on its own; wheel ticks take over, easing to whole
// stops, and the drift resumes a while after the last tick. Time is passed in
// so the logic can be driven from the Waves draw loop (a `lineColor` getter)
// and from a test alike.

export const DRIFT_MS_PER_STOP = 4000
export const EASE_MS = 250
export const RESUME_AFTER_MS = 8000
// A frame gap longer than this (a paused, off-screen surface or a background
// tab) is treated as this long, so the color never leaps on return.
const MAX_FRAME_MS = 100

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3
}

export class ColorDrive {
  reducedMotion = false
  // Unwrapped, so an ease across the 71 → 0 seam stays continuous.
  private position = 0
  private lastFrame: number | null = null
  private stepping = false
  private target = 0
  private easeFrom = 0
  private easeStart = 0
  private lastTick = 0

  advance(now: number): number {
    const frameMs = this.lastFrame === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrame))
    this.lastFrame = now
    if (this.stepping) {
      const progress = this.reducedMotion ? 1 : Math.min(1, (now - this.easeStart) / EASE_MS)
      this.position =
        progress >= 1 ? this.target : this.easeFrom + (this.target - this.easeFrom) * easeOutCubic(progress)
      if (now - this.lastTick >= RESUME_AFTER_MS) this.stepping = false
    } else if (!this.reducedMotion) {
      this.position += frameMs / DRIFT_MS_PER_STOP
    }
    return this.position
  }

  // One wheel or key tick: +1 forward, -1 back. The first tick after a drift
  // snaps to the next whole stop in that direction.
  step(direction: 1 | -1, now: number): void {
    if (this.stepping) {
      this.target += direction
    } else {
      const epsilon = 1e-9
      this.target =
        direction > 0 ? Math.floor(this.position + epsilon) + 1 : Math.ceil(this.position - epsilon) - 1
      this.stepping = true
    }
    this.easeFrom = this.position
    this.easeStart = now
    this.lastTick = now
  }
}

const PIXELS_PER_TICK = 100
const PIXELS_PER_LINE = 40
// A single event this big is a mouse-wheel notch (Firefox sends ~50 px per
// notch, Chrome 100); trackpads send many small deltas that must accumulate.
const NOTCH_PIXELS = 40

export interface WheelAccumulator {
  pixels: number
}

// Converts one wheel event into whole ticks (+ forward, − back), carrying the
// remainder so a trackpad swipe adds up to a few ticks rather than dozens.
export function wheelTicks(
  accumulator: WheelAccumulator,
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
): number {
  const pixels =
    deltaMode === 1 ? deltaY * PIXELS_PER_LINE : deltaMode === 2 ? deltaY * pageHeight : deltaY
  if (pixels === 0) return 0
  if (Math.sign(pixels) !== Math.sign(accumulator.pixels)) accumulator.pixels = 0
  accumulator.pixels += pixels
  const ticks = Math.trunc(accumulator.pixels / PIXELS_PER_TICK)
  if (ticks !== 0) {
    accumulator.pixels -= ticks * PIXELS_PER_TICK
    return ticks
  }
  if (Math.abs(pixels) >= NOTCH_PIXELS) {
    accumulator.pixels = 0
    return Math.sign(pixels)
  }
  return 0
}
