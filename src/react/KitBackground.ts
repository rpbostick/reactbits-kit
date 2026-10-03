// The React side of the adapter: a hook that keeps one BackgroundWiring for
// a mounted background and attaches it to the element the background fills,
// and <KitBackground>, which renders a transformed component inside that
// element with the wiring's getters. Written with createElement rather than
// JSX so it runs as plain TypeScript; React is the site's own.
import { createElement, useEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { BackgroundWiring, type EventTargets, type WiringOptions } from './wiring.ts'

export interface KitBackground {
  // Put on the element the background fills.
  ref: RefObject<HTMLDivElement | null>
  // The getter props for the component; the same functions on every render.
  props: Record<string, unknown>
  wiring: BackgroundWiring
}

function surfaceOf(ref: RefObject<HTMLDivElement | null>) {
  return {
    now: () => performance.now(),
    rect: () => {
      const element = ref.current
      if (!element) throw new Error('KitBackground: the background element is not mounted')
      const { left, top, width, height } = element.getBoundingClientRect()
      return { left, top, width, height }
    },
  }
}

// The component's root (the element's first child) and its canvas, which
// pointer 'events' hands the drag to.
function eventTargets(element: HTMLElement): EventTargets {
  const root = element.firstElementChild
  return { root, canvas: root?.querySelector('canvas') ?? root }
}

export function useKitBackground(options: WiringOptions): KitBackground {
  const ref = useRef<HTMLDivElement | null>(null)
  const [wiring] = useState(() => new BackgroundWiring(options, surfaceOf(ref)))
  wiring.configure(options)

  useEffect(() => {
    const element = ref.current
    if (!element) throw new Error('KitBackground: the ref was not put on an element')
    return wiring.attach(element)
  }, [wiring])

  useEffect(() => {
    if (options.pointer !== 'events') return
    const element = ref.current
    if (!element) throw new Error('KitBackground: the ref was not put on an element')
    let frame = requestAnimationFrame(function pump() {
      wiring.pumpEvents(eventTargets(element), (type, init) => new MouseEvent(type, init))
      frame = requestAnimationFrame(pump)
    })
    return () => cancelAnimationFrame(frame)
  }, [wiring, options.pointer])

  return { ref, props: wiring.props(), wiring }
}

export interface KitBackgroundProps<P> extends WiringOptions {
  component: ComponentType<P>
  // The component's own props (settings), under the wiring's getters.
  props?: Partial<P>
  paused?: boolean
  className?: string
  style?: CSSProperties
}

// A transformed component wired to our modules, filling a positioned div
// that hears the drags.
export function KitBackground<P>({ component, props, paused, className, style, ...options }: KitBackgroundProps<P>): ReactElement {
  const background = useKitBackground(options)
  const merged = { ...props, ...background.props, ...(paused === undefined ? {} : { paused }) }
  return createElement(
    'div',
    { ref: background.ref, className, style: { position: 'relative', width: '100%', height: '100%', ...style } },
    createElement(component as ComponentType<Record<string, unknown>>, merged),
  )
}
