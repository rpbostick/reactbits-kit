import type { ComponentSpec } from '../../transform.ts'
import cssVariableFix from './01-css-variable-fix.ts'
import lineColorGetter from './02-line-color-getter.ts'
import intersectionObserver from './03-intersection-observer.ts'
import pointerPositionFix from './04-pointer-position-fix.ts'
import motionGetter from './05-motion-getter.ts'
import accumulatedClock from './06-accumulated-clock.ts'
import pausedProp from './07-paused-prop.ts'
import pointerGetter from './08-pointer-getter.ts'
import displacementGetter from './09-displacement-getter.ts'
import overscan from './10-overscan.ts'
import containerPointerListeners from './11-container-pointer-listeners.ts'
import mouseleaveEndsStroke from './12-mouseleave-ends-stroke.ts'
import noiseModule from './13-noise-module.ts'
import sampleGetter from './14-sample-getter.ts'

const transforms = [
  cssVariableFix,
  lineColorGetter,
  intersectionObserver,
  pointerPositionFix,
  motionGetter,
  accumulatedClock,
  pausedProp,
  pointerGetter,
  displacementGetter,
  overscan,
  containerPointerListeners,
  mouseleaveEndsStroke,
  noiseModule,
  sampleGetter,
]
const shared = [cssVariableFix, lineColorGetter, intersectionObserver, pointerPositionFix, motionGetter, accumulatedClock, pausedProp]

// Both feed the ripple, the sheet's glide and the spin through getters
// (09-10, 14, with the noise in its own file and periodic, 13). The site
// also takes the pointer through a getter (08); the sheet hands the waves the
// drags it reports as mouse events on the container (11-12).
const dynamics = [displacementGetter, overscan]
const spin = [noiseModule, sampleGetter]

export const Waves: ComponentSpec = {
  name: 'Waves',
  upstreamDir: 'src/ts-default/Backgrounds/Waves',
  files: ['Waves.tsx', 'Waves.css'],
  transforms,
  profiles: {
    site: [...shared, pointerGetter, ...dynamics, ...spin].map((transform) => transform.id),
    sheet: [...shared, ...dynamics, containerPointerListeners, mouseleaveEndsStroke, ...spin].map((transform) => transform.id),
  },
}
