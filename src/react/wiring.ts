// What connects a transformed background's getter props to our modules,
// without React, so a test can drive it with a stub component. One wiring
// lives as long as one mounted background: its getters are created once and
// read the latest options, so passing them as props never re-runs the
// component's effects.
//
// - colors: the colour drive (colorDrive.ts) moves along the 72-stop loop
//   (palette.ts); each frame `colors` turns that colour into what the
//   component's getter returns (`params` for nine of the ten, `lineColor`
//   for Waves).
// - pointer 'drag': Waves' `pointer` getter follows a drag on bare
//   background (pointerFeed.ts), coasting after a fling with `momentum`.
//   'none': it returns null, so Waves' own cursor response is off and only a
//   displacement stirs it. 'events': the drag reaches components that listen
//   for mouse events on their container as mouseenter, mousemove and
//   mouseleave, as the character sheet hands them.
// - ripple and cloth: Waves' `displacement` getter, from rippleField.ts and
//   clothFollow.ts, with the overscan their reach needs; reduced motion
//   turns both off.
// - spin: Waves' `sample` getter and `patternPeriod`, from sphereSpin.ts: a
//   drag turns the pattern like the inside of a ball, and a fling spins it.
// Each of the three takes `true` for the module's own constants, which are
// the site's, or an object overriding some of them.
// - toyboxState: instead of those three and the drag feed, the dynamics
//   toybox hands a page's own background (toybox.ts): Waves' displacement
//   and sample, or the WebGL backgrounds' coordinates.
import { ClothFollow, FOLLOW, type FollowOptions } from '../modules/clothFollow.ts'
import { ColorDrive, wheelTicks, type WheelAccumulator } from '../modules/colorDrive.ts'
import { colorAt, stopsByTheme, type Theme } from '../modules/palette.ts'
import { attachPointerFeed, PointerFeed, type FeedElement } from '../modules/pointerFeed.ts'
import { RIPPLE, RippleField, rippleRadius, type Displacement, type GridPoint, type Point, type RippleOptions } from '../modules/rippleField.ts'
import { SPIN, SphereSpin, type PatternCoordinates, type SpinOptions, type View } from '../modules/sphereSpin.ts'
import { ToyboxDynamics, type ToyboxState } from './toybox.ts'

export type ColorProp = 'params' | 'lineColor'
export type PointerMode = 'drag' | 'none' | 'events'
// A module on with its own constants (true), with some of them changed, or off.
export type ModuleOption<Options> = boolean | Partial<Options>

// This frame's colour, for `colors` to derive the component's from.
export interface ColorFrame {
  // On the loop, unwrapped: it keeps growing as the colour drifts.
  position: number
  // `colorAt` of the theme's stops at `position`, as `rgb(…)`.
  color: string
  theme: Theme
}

export interface WiringOptions {
  colors?: (frame: ColorFrame) => Record<string, unknown>
  // Which getter prop `colors` feeds; Waves takes `lineColor`, the rest `params`.
  colorProp?: ColorProp
  theme?: Theme
  pointer?: PointerMode
  // Whether a flung drag coasts on after release (pointer 'drag' and 'events', ripple).
  momentum?: boolean
  ripple?: ModuleOption<RippleOptions>
  cloth?: ModuleOption<FollowOptions>
  spin?: ModuleOption<SpinOptions>
  // Toybox's drag dynamics in place of pointer feed, ripple, cloth and spin.
  toyboxState?: ToyboxState
  // Whether a wheel over the background steps the colour drive.
  wheel?: boolean
  // Whether a finger's drag stirs the background; by default it scrolls the page.
  touchDrags?: boolean
  reducedMotion?: boolean
}

// What the wiring reads of the page; a test passes a stand-in.
export interface Surface {
  now(): number
  // The box of the element the background fills, in client coordinates.
  rect(): { left: number; top: number; width: number; height: number }
}

// The element the wiring listens on, and the elements a drag is handed to as
// mouse events (the component's root and its canvas, which may be the same).
export interface WiredElement extends FeedElement {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void
  removeEventListener(type: string, listener: EventListener): void
}

export interface EventTargets {
  root: EventTarget | null
  canvas: EventTarget | null
}

export type MouseEventFactory = (type: string, init: { clientX?: number; clientY?: number; bubbles?: boolean }) => Event

// Options fixed at creation: they decide which modules exist and how they
// are set up. Compared by value, so an inline object on every render is the
// same option.
const STRUCTURAL = ['pointer', 'ripple', 'cloth', 'spin', 'colorProp'] as const

// The module's constants with `option`'s changes, or null when it is off.
function moduleOptions<Options extends object>(option: ModuleOption<Options> | undefined, defaults: Options): Options | null {
  if (option === undefined || option === false) return null
  if (option === true) return defaults
  for (const key of Object.keys(option)) {
    if (!(key in defaults)) throw new Error(`KitBackground: no constant ${key}; the module has ${Object.keys(defaults).join(', ')}`)
  }
  return { ...defaults, ...option }
}

// A drag feed that also turns the ball: every press, move and release the
// feed hears reaches the spin in the same coordinates.
class SpinningFeed extends PointerFeed {
  private readonly spin: SphereSpin
  private readonly view: () => View

  constructor(spin: SphereSpin, view: () => View) {
    super()
    this.spin = spin
    this.view = view
  }

  override grab(x: number, y: number, now: number) {
    super.grab(x, y, now)
    this.spin.grab({ x, y }, this.view(), now)
  }

  override move(x: number, y: number, now: number) {
    super.move(x, y, now)
    this.spin.drag({ x, y }, this.view(), now)
  }

  override release(now: number) {
    super.release(now)
    this.spin.release(now)
  }

  override cancel() {
    super.cancel()
    this.spin.cancel()
  }
}

export class BackgroundWiring {
  readonly feed: PointerFeed
  readonly drive = new ColorDrive()
  readonly ripple: RippleField | null
  readonly cloth: ClothFollow | null
  readonly spin: SphereSpin | null
  readonly toybox: ToyboxDynamics | null
  // The furthest the ripple and the cloth together move a point, which Waves
  // must draw beyond each edge (overscanX, overscanY).
  readonly reach: number
  private options: WiringOptions
  private readonly surface: Surface
  private readonly getters: Record<string, unknown>
  private inside = false
  private readonly wheelAccumulator: WheelAccumulator = { pixels: 0 }

  constructor(options: WiringOptions, surface: Surface) {
    this.options = options
    this.surface = surface
    const ripple = moduleOptions(options.ripple, RIPPLE)
    const cloth = moduleOptions(options.cloth, FOLLOW)
    const spin = moduleOptions(options.spin, SPIN)
    if (options.toyboxState && (ripple || cloth || spin)) {
      throw new Error('KitBackground: toyboxState brings its own ripple, sheet and spin; leave ripple, cloth and spin out')
    }
    this.toybox = options.toyboxState ? new ToyboxDynamics(options.toyboxState, surface) : null
    this.ripple = ripple ? new RippleField(ripple) : null
    this.cloth = cloth ? new ClothFollow(cloth) : null
    this.spin = spin ? new SphereSpin(spin) : null
    this.reach = (ripple ? ripple.MAX_RADIUS_PX * ripple.MAX_DISPLACEMENT_SHARE : 0) + (cloth ? cloth.MAX_SHIFT_PX : 0)
    this.feed = this.spin ? new SpinningFeed(this.spin, () => this.view()) : new PointerFeed()
    this.applyReducedMotion()
    this.getters = this.createGetters()
  }

  // Takes this render's options. Those that decide which modules exist cannot
  // change on a mounted background; give it a new React key instead.
  configure(options: WiringOptions) {
    for (const key of STRUCTURAL) {
      if (JSON.stringify(options[key]) !== JSON.stringify(this.options[key])) {
        throw new Error(`KitBackground: ${key} changed from ${JSON.stringify(this.options[key])} to ${JSON.stringify(options[key])} on a mounted background; remount it with a new key`)
      }
    }
    if ((options.colors === undefined) !== (this.options.colors === undefined)) {
      throw new Error('KitBackground: colors was given or taken away on a mounted background; remount it with a new key')
    }
    // By identity: the motion is a live object whose readings change.
    if (options.toyboxState?.motion !== this.options.toyboxState?.motion || options.toyboxState?.takes !== this.options.toyboxState?.takes) {
      throw new Error('KitBackground: toyboxState changed on a mounted background; remount it with a new key')
    }
    this.options = options
    this.applyReducedMotion()
  }

  // The getter props for the component, the same functions on every call.
  props(): Record<string, unknown> {
    return this.getters
  }

  // Whether a pointer feed is attached: a drag drives something, and toybox
  // does not hear it for us.
  get feedsPointer(): boolean {
    if (this.toybox) return false
    return this.options.pointer !== undefined || this.ripple !== null || this.cloth !== null || this.spin !== null
  }

  // Listens on `element` for drags and, with `wheel`, wheel ticks. Returns
  // the detach.
  attach(element: WiredElement): () => void {
    const detachers: (() => void)[] = []
    if (this.feedsPointer) {
      const attached = attachPointerFeed(element, this.feed, {
        touchDrags: () => this.options.touchDrags === true,
        now: () => this.surface.now(),
      })
      detachers.push(() => attached.detach())
    }
    if (this.options.wheel) {
      const onWheel = (event: Event) => {
        const { deltaY, deltaMode } = event as WheelEvent
        const ticks = wheelTicks(this.wheelAccumulator, deltaY, deltaMode, this.surface.rect().height)
        for (let tick = 0; tick < Math.abs(ticks); tick++) this.drive.step(ticks > 0 ? 1 : -1, this.surface.now())
      }
      element.addEventListener('wheel', onWheel, { passive: true })
      detachers.push(() => element.removeEventListener('wheel', onWheel))
    }
    return () => {
      for (const detach of detachers) detach()
    }
  }

  // This frame's colour.
  colorFrame(): ColorFrame {
    const theme = this.options.theme ?? 'light'
    const position = this.drive.advance(this.surface.now())
    return { position, color: colorAt(stopsByTheme[theme], position), theme }
  }

  // The dragged point, or with momentum its coast, in the surface's own
  // coordinates; null when nothing is dragged.
  localPointer(): Point | null {
    if (this.toybox) return this.toybox.localPointer()
    if (this.options.momentum === false) return this.feed.current
    const { width, height } = this.surface.rect()
    return this.feed.at(this.surface.now(), { left: 0, top: 0, right: width, bottom: height })
  }

  // Hands this frame's drag to the component as mouse events, for pointer
  // 'events': a mouseenter on the root when a drag starts, a mousemove on
  // the canvas each frame, a mouseleave on both once it ends. Called once per
  // frame.
  pumpEvents(targets: EventTargets, mouseEvent: MouseEventFactory) {
    if (this.options.pointer !== 'events') throw new Error('pumpEvents is for pointer "events"')
    const point = this.localPointer()
    const { root, canvas } = targets
    const target = canvas ?? root
    if (point === null) {
      if (!this.inside) return
      this.inside = false
      root?.dispatchEvent(mouseEvent('mouseleave', {}))
      if (canvas && canvas !== root) canvas.dispatchEvent(mouseEvent('mouseleave', {}))
      return
    }
    const { left, top } = this.surface.rect()
    const at = { clientX: left + point.x, clientY: top + point.y }
    if (!this.inside) {
      this.inside = true
      root?.dispatchEvent(mouseEvent('mouseenter', at))
    }
    target?.dispatchEvent(mouseEvent('mousemove', { ...at, bubbles: true }))
  }

  private applyReducedMotion() {
    const reduced = this.options.reducedMotion === true
    this.feed.reducedMotion = reduced
    this.drive.reducedMotion = reduced
    if (this.cloth) this.cloth.reducedMotion = reduced
    if (this.spin) this.spin.reducedMotion = reduced
  }

  private view(): View {
    const { width, height } = this.surface.rect()
    return { width, height }
  }

  private createGetters(): Record<string, unknown> {
    const getters: Record<string, unknown> = {}
    const colorProp = this.options.colorProp ?? 'params'
    // Without `colors` there is no colour getter, and the component's own colour props stand.
    if (this.options.colors !== undefined && colorProp === 'params') getters.params = () => this.colors()
    if (this.options.colors !== undefined && colorProp === 'lineColor') {
      getters.lineColor = () => {
        const { lineColor } = this.colors()
        if (typeof lineColor !== 'string') throw new Error(`KitBackground: colors() returned lineColor ${JSON.stringify(lineColor)}, not a string`)
        return lineColor
      }
    }
    const pointer = this.options.pointer
    if (pointer === 'drag') {
      getters.pointer = () => {
        const point = this.localPointer()
        if (point === null) return null
        const { left, top } = this.surface.rect()
        return { x: left + point.x, y: top + point.y }
      }
    } else if (pointer === 'none') {
      getters.pointer = () => null
    }
    if (this.ripple || this.cloth) {
      getters.displacement = (lines: readonly (readonly GridPoint[])[], time: number) => this.displace(lines, time)
      getters.overscanX = this.reach
      getters.overscanY = this.reach
    }
    if (this.spin) {
      const spin = this.spin
      // The surface's clock, like the drag's events: the frame time can be
      // earlier than the release.
      getters.sample = (lines: readonly (readonly Point[])[]): PatternCoordinates => spin.sample(lines, this.view(), this.surface.now())
      getters.patternPeriod = { x: spin.period, y: spin.period }
    }
    if (this.toybox) Object.assign(getters, this.toybox.getters())
    return getters
  }

  // What `colors` makes of this frame's colour.
  private colors(): Record<string, unknown> {
    const colors = this.options.colors
    if (!colors) throw new Error('KitBackground: a colour getter ran without colors')
    return colors(this.colorFrame())
  }

  // The ripple's stir at the dragged point, with the cloth's shift on top;
  // none with reduced motion.
  private displace(lines: readonly (readonly GridPoint[])[], time: number): Displacement | null {
    if (this.options.reducedMotion === true) {
      this.ripple?.reset()
      this.cloth?.reset()
      return null
    }
    const { width, height } = this.surface.rect()
    const stir = this.ripple
      ? this.ripple.step(lines, { pointer: this.localPointer(), stroke: this.feed.stroke, now: time, radius: rippleRadius(width, height) })
      : null
    if (!this.cloth) return stir
    this.cloth.step({ pointer: this.feed.current, stroke: this.feed.stroke, now: time, width, height })
    return this.cloth.displace(lines, stir)
  }
}
