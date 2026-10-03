import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import colorOutOfDeps from './02-color-out-of-deps.ts'
import coordinatesGetter from './03-coordinates-getter.ts'

const shared = [paramsGetter, colorOutOfDeps]
const transforms = [...shared, coordinatesGetter]

// LiquidChrome.css is fetched unchanged. The sheet also moves the pattern
// with the drag's ripple, glide and spin (03).
export const LiquidChrome: ComponentSpec = {
  name: 'LiquidChrome',
  upstreamDir: 'src/ts-default/Backgrounds/LiquidChrome',
  files: ['LiquidChrome.tsx', 'LiquidChrome.css'],
  transforms,
  profiles: { site: shared.map((transform) => transform.id), sheet: transforms.map((transform) => transform.id) },
}
