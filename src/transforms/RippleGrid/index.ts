import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import dprCap from './02-dpr-cap.ts'

const transforms = [paramsGetter, dprCap]
const all = transforms.map((transform) => transform.id)

// RippleGrid.css is fetched unchanged.
export const RippleGrid: ComponentSpec = {
  name: 'RippleGrid',
  upstreamDir: 'src/ts-default/Backgrounds/RippleGrid',
  files: ['RippleGrid.tsx', 'RippleGrid.css'],
  transforms,
  profiles: { site: all, sheet: all },
}
