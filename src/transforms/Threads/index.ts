import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import dprCap from './02-dpr-cap.ts'

const transforms = [paramsGetter, dprCap]
const all = transforms.map((transform) => transform.id)

// Threads.css is fetched unchanged.
export const Threads: ComponentSpec = {
  name: 'Threads',
  upstreamDir: 'src/ts-default/Backgrounds/Threads',
  files: ['Threads.tsx', 'Threads.css'],
  transforms,
  profiles: { site: all, sheet: all },
}
