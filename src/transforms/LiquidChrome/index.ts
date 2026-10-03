import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import colorOutOfDeps from './02-color-out-of-deps.ts'

const transforms = [paramsGetter, colorOutOfDeps]
const all = transforms.map((transform) => transform.id)

// LiquidChrome.css is fetched unchanged.
export const LiquidChrome: ComponentSpec = {
  name: 'LiquidChrome',
  upstreamDir: 'src/ts-default/Backgrounds/LiquidChrome',
  files: ['LiquidChrome.tsx', 'LiquidChrome.css'],
  transforms,
  profiles: { site: all, sheet: all },
}
