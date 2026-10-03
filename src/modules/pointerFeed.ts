// The pointer a Waves `pointer` or `displacement` getter follows when the
// waves should be stirred only on purpose: a drag that starts on bare
// background, not hovering and not a drag that starts on content (text,
// buttons, links, anything marked data-solid). A fling coasts on with
// momentum after release. The rules are pure functions and the feed is a
// plain class, so tests can drive them; `attachPointerFeed` binds them to an
// element and sets the classes pointerFeed.css turns into grab and grabbing
// cursors.
import { Momentum, type Bounds, type Point } from './momentum.ts'

export const LEFT_BUTTON = 0

// Movement under this many pixels between press and release is a click.
export const DRAG_THRESHOLD_PX = 5

// What a drag cannot start on. Everything else is bare background.
export const SOLID_SELECTOR = 'button, a, input, select, textarea, label, [data-solid]'

// The attribute pointerFeed.css gives the grab cursor, and the class it gives
// the grabbing one.
export const FEED_ATTRIBUTE = 'data-pointer-feed'
export const DRAGGING_CLASS = 'pointer-feed-dragging'

export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX
}

// Typed by shape rather than as Element so a test can pass a stand-in.
export function onSolid(target: { closest?: (selector: string) => unknown } | null, selector = SOLID_SELECTOR): boolean {
  return typeof target?.closest === 'function' && target.closest(selector) !== null
}

// A drag starts only with the main button on bare background. A touch drag
// starts only when `touchDrags` says so; otherwise the finger scrolls the page.
export function startsDrag(button: number, pointerType: string, touchDrags: boolean, solid: boolean): boolean {
  if (button !== LEFT_BUTTON || solid) return false
  return pointerType !== 'touch' || touchDrags
}

// The dragged point during a drag, then a coasting one after a fling; null
// otherwise, which lets the waves settle. Coordinates are the caller's.
export class PointerFeed {
  private point: Point | null = null
  private strokes = 0
  private readonly momentum = new Momentum()
  reducedMotion = false

  // The dragged point only, without the coast.
  get current(): Point | null {
    return this.point
  }

  // Counts presses: a press during a coast moves the pointer in one frame,
  // and this tells a consumer it is a new stroke rather than a fling.
  get stroke(): number {
    return this.strokes
  }

  grab(x: number, y: number, now: number) {
    this.strokes++
    this.point = { x, y }
    this.momentum.press(x, y, now)
  }

  move(x: number, y: number, now: number) {
    if (!this.point) return
    this.point = { x, y }
    this.momentum.move(x, y, now)
  }

  release(now: number) {
    this.point = null
    this.momentum.release(now, this.reducedMotion)
  }

  // Ends the drag without a coast.
  cancel() {
    this.point = null
    this.momentum.cancel()
  }

  // Called once per frame.
  at(now: number, bounds: Bounds): Point | null {
    return this.point ?? this.momentum.advance(now, bounds)
  }
}

// What attachPointerFeed needs of an element; an HTMLElement has all of it.
export interface FeedElement extends EventTarget {
  getBoundingClientRect(): { left: number; top: number }
  setPointerCapture(pointerId: number): void
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  classList: { toggle(token: string, force: boolean): unknown }
}

export interface AttachOptions {
  solidSelector?: string
  // Whether a touch drag stirs the waves now; by default it never does, so
  // a finger scrolls the page.
  touchDrags?: () => boolean
  now?: () => number
}

export interface AttachedFeed {
  // Whether the gesture that ends in the next click was a drag, so a click
  // handler can ignore the click that ends one.
  readonly dragged: boolean
  detach(): void
}

interface Drag {
  pointerId: number
  startX: number
  startY: number
  // Set when the pointer first passes the drag threshold.
  moved: boolean
}

// Feeds `feed` from pointer events on `element`, in coordinates relative to
// the element's top-left corner.
export function attachPointerFeed(element: FeedElement, feed: PointerFeed, options: AttachOptions = {}): AttachedFeed {
  const solidSelector = options.solidSelector ?? SOLID_SELECTOR
  const touchDrags = options.touchDrags ?? (() => false)
  const now = options.now ?? (() => performance.now())
  let drag: Drag | null = null
  let dragged = false

  function local(event: PointerEvent): Point {
    const rect = element.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function setDragging(dragging: boolean) {
    element.classList.toggle(DRAGGING_CLASS, dragging)
  }

  function onPointerDown(event: PointerEvent) {
    dragged = false
    const target = event.target as { closest?: (selector: string) => unknown } | null
    if (!startsDrag(event.button, event.pointerType, touchDrags(), onSolid(target, solidSelector))) return
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }
    const point = local(event)
    feed.grab(point.x, point.y, now())
    setDragging(true)
  }
  function onPointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return
    const point = local(event)
    feed.move(point.x, point.y, now())
    if (drag.moved || !isDrag(event.clientX - drag.startX, event.clientY - drag.startY)) return
    drag.moved = true
    dragged = true
    // Captured only once it is a drag, so a plain click keeps its target.
    element.setPointerCapture(event.pointerId)
  }
  function onPointerEnd(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return
    // A cancelled pointer (the browser took over the gesture) was not flung.
    if (event.type === 'pointercancel') feed.cancel()
    else feed.release(now())
    drag = null
    setDragging(false)
  }

  const listeners: [string, (event: PointerEvent) => void][] = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerEnd],
    ['pointercancel', onPointerEnd],
  ]
  for (const [type, listener] of listeners) element.addEventListener(type, listener as EventListener)
  element.setAttribute(FEED_ATTRIBUTE, '')

  return {
    get dragged() {
      return dragged
    },
    detach() {
      for (const [type, listener] of listeners) element.removeEventListener(type, listener as EventListener)
      element.removeAttribute(FEED_ATTRIBUTE)
      if (drag) feed.cancel()
      drag = null
      setDragging(false)
    },
  }
}
