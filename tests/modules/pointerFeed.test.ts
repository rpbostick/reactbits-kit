import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  attachPointerFeed,
  DRAG_THRESHOLD_PX,
  DRAGGING_CLASS,
  FEED_ATTRIBUTE,
  isDrag,
  LEFT_BUTTON,
  onSolid,
  PointerFeed,
  startsDrag,
  type FeedElement,
} from '../../src/modules/pointerFeed.ts'

const MIDDLE_BUTTON = 1
const FRAME_MS = 16
const SURFACE = { left: 0, top: 0, right: 800, bottom: 600 }

// A stand-in for an element whose ancestors match `selector`: `closest`
// finds it when it is one of the comma-separated selectors asked for.
function inside(selector: string) {
  return {
    closest: (query: string) => (query.split(',').some((part) => part.trim() === selector) ? {} : null),
  }
}

// An element at (100, 50) on the page, recording what the binding does to it.
class StandIn extends EventTarget implements FeedElement {
  attributes = new Map<string, string>()
  classes = new Set<string>()
  captured: number[] = []
  classList = {
    toggle: (token: string, force: boolean) => (force ? this.classes.add(token) : this.classes.delete(token)),
  }
  getBoundingClientRect() {
    return { left: 100, top: 50 }
  }
  setPointerCapture(pointerId: number) {
    this.captured.push(pointerId)
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string) {
    this.attributes.delete(name)
  }
}

function pointerEvent(type: string, fields: { clientX: number; clientY: number; target?: unknown; button?: number; pointerType?: string }) {
  const { target, ...rest } = fields
  const event = Object.assign(new Event(type), { button: LEFT_BUTTON, pointerType: 'mouse', pointerId: 1, ...rest })
  // The event's own target, as a press on a child element would have.
  if (target !== undefined) Object.defineProperty(event, 'target', { value: target })
  return event
}

test('under the threshold is a click, at it a drag', () => {
  assert.equal(isDrag(3, 3), false)
  assert.equal(isDrag(0, DRAG_THRESHOLD_PX - 0.1), false)
  assert.equal(isDrag(DRAG_THRESHOLD_PX, 0), true)
  assert.equal(isDrag(-4, -4), true)
})

test('a mouse drags whenever; a finger only when allowed; never from solid content or other buttons', () => {
  assert.equal(startsDrag(LEFT_BUTTON, 'mouse', false, false), true)
  assert.equal(startsDrag(LEFT_BUTTON, 'touch', false, false), false)
  assert.equal(startsDrag(LEFT_BUTTON, 'touch', true, false), true)
  assert.equal(startsDrag(LEFT_BUTTON, 'mouse', true, true), false)
  assert.equal(startsDrag(MIDDLE_BUTTON, 'mouse', true, false), false)
})

test('buttons, links, form fields and data-solid are solid; bare background is not', () => {
  for (const selector of ['button', 'a', 'input', 'label', '[data-solid]']) assert.equal(onSolid(inside(selector)), true, selector)
  assert.equal(onSolid(inside('.waves')), false)
  assert.equal(onSolid(null), false)
  assert.equal(onSolid(inside('.hero-text'), '.hero-text, [data-solid]'), true, 'a caller can widen the selector')
})

test('hover feeds no pointer; a drag feeds it; a still release settles', () => {
  const feed = new PointerFeed()
  feed.move(40, 50, 0)
  assert.equal(feed.at(0, SURFACE), null)
  feed.grab(10, 20, 0)
  assert.deepEqual(feed.at(0, SURFACE), { x: 10, y: 20 })
  feed.move(30, 25, FRAME_MS)
  assert.deepEqual(feed.at(FRAME_MS, SURFACE), { x: 30, y: 25 })
  feed.release(1000)
  assert.equal(feed.at(1000, SURFACE), null)
  feed.move(35, 25, 1000 + FRAME_MS)
  assert.equal(feed.at(1000 + FRAME_MS, SURFACE), null, 'moves after release are hover')
})

test('a flung pointer coasts on; a cancelled one or reduced motion does not', () => {
  const flung = new PointerFeed()
  flung.grab(100, 300, 0)
  flung.move(200, 300, 50)
  flung.release(50)
  assert.equal(flung.current, null, 'the dragged point is gone')
  const coasting = flung.at(50 + FRAME_MS, SURFACE)
  assert.ok(coasting && coasting.x > 200, `coasting at ${JSON.stringify(coasting)}`)

  const cancelled = new PointerFeed()
  cancelled.grab(100, 300, 0)
  cancelled.move(200, 300, 50)
  cancelled.cancel()
  assert.equal(cancelled.at(50 + FRAME_MS, SURFACE), null)

  const reduced = new PointerFeed()
  reduced.reducedMotion = true
  reduced.grab(100, 300, 0)
  reduced.move(200, 300, 50)
  reduced.release(50)
  assert.equal(reduced.at(50 + FRAME_MS, SURFACE), null)
})

test('attachPointerFeed feeds element-relative points, sets the cursor hooks, and captures only a real drag', () => {
  const element = new StandIn()
  const feed = new PointerFeed()
  let clock = 0
  const attached = attachPointerFeed(element, feed, { now: () => clock })
  assert.equal(element.attributes.has(FEED_ATTRIBUTE), true, 'the grab cursor applies')

  element.dispatchEvent(pointerEvent('pointerdown', { clientX: 110, clientY: 60, target: inside('.waves') }))
  assert.deepEqual(feed.current, { x: 10, y: 10 })
  assert.equal(element.classes.has(DRAGGING_CLASS), true, 'grabbing while pressed')
  clock = FRAME_MS
  element.dispatchEvent(pointerEvent('pointermove', { clientX: 112, clientY: 60 }))
  assert.deepEqual(element.captured, [], 'not captured under the threshold')
  assert.equal(attached.dragged, false)
  clock = 2 * FRAME_MS
  element.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 60 }))
  assert.deepEqual(element.captured, [1])
  assert.equal(attached.dragged, true)
  element.dispatchEvent(pointerEvent('pointerup', { clientX: 150, clientY: 60 }))
  assert.equal(feed.current, null)
  assert.equal(element.classes.has(DRAGGING_CLASS), false)

  element.dispatchEvent(pointerEvent('pointerdown', { clientX: 110, clientY: 60, target: inside('[data-solid]') }))
  assert.equal(feed.current, null, 'a press on solid content does not grab')
  assert.equal(attached.dragged, false, 'a new press clears the last drag')

  element.dispatchEvent(pointerEvent('pointerdown', { clientX: 110, clientY: 60, target: inside('.waves'), pointerType: 'touch' }))
  assert.equal(feed.current, null, 'a finger scrolls by default')

  attached.detach()
  assert.equal(element.attributes.has(FEED_ATTRIBUTE), false)
  element.dispatchEvent(pointerEvent('pointerdown', { clientX: 110, clientY: 60, target: inside('.waves') }))
  assert.equal(feed.current, null, 'detached')
})
