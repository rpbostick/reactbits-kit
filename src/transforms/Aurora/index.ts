import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import accumulatedClock from './02-accumulated-clock.ts'
import pausedProp from './03-paused-prop.ts'

const transforms = [paramsGetter, accumulatedClock, pausedProp]
const all = transforms.map((transform) => transform.id)

// Aurora.css is fetched unchanged. The site and the sheet use the same set.
export const Aurora: ComponentSpec = {
  name: 'Aurora',
  upstreamDir: 'src/ts-default/Backgrounds/Aurora',
  files: ['Aurora.tsx', 'Aurora.css'],
  transforms,
  profiles: { site: all, sheet: all },
}
