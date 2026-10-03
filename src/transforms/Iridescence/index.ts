import type { ComponentSpec } from '../../transform.ts'
import accumulatedClock from './01-accumulated-clock.ts'
import pausedProp from './02-paused-prop.ts'
import paramsGetter from './03-params-getter.ts'
import colorOutOfDeps from './04-color-out-of-deps.ts'

const transforms = [accumulatedClock, pausedProp, paramsGetter, colorOutOfDeps]

// Iridescence.css is fetched unchanged. The sheet's colour drifts every
// frame, so it also takes a colour getter.
export const Iridescence: ComponentSpec = {
  name: 'Iridescence',
  upstreamDir: 'src/ts-default/Backgrounds/Iridescence',
  files: ['Iridescence.tsx', 'Iridescence.css'],
  transforms,
  profiles: {
    site: [accumulatedClock.id, pausedProp.id],
    sheet: transforms.map((transform) => transform.id),
  },
}
