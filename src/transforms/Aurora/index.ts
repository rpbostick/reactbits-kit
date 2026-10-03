import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import accumulatedClock from './02-accumulated-clock.ts'
import pausedProp from './03-paused-prop.ts'
import coordinatesGetter from './04-coordinates-getter.ts'

const shared = [paramsGetter, accumulatedClock, pausedProp]
const transforms = [...shared, coordinatesGetter]

// Aurora.css is fetched unchanged. The sheet also moves the aurora with the
// drag's ripple, glide and spin (04).
export const Aurora: ComponentSpec = {
  name: 'Aurora',
  upstreamDir: 'src/ts-default/Backgrounds/Aurora',
  files: ['Aurora.tsx', 'Aurora.css'],
  transforms,
  profiles: { site: shared.map((transform) => transform.id), sheet: transforms.map((transform) => transform.id) },
}
