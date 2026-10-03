import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import dprCap from './02-dpr-cap.ts'
import coordinatesGetter from './03-coordinates-getter.ts'

const shared = [paramsGetter, dprCap]
const transforms = [...shared, coordinatesGetter]

// Threads.css is fetched unchanged. The sheet also moves the pattern with
// the drag's ripple, glide and spin (03).
export const Threads: ComponentSpec = {
  name: 'Threads',
  upstreamDir: 'src/ts-default/Backgrounds/Threads',
  files: ['Threads.tsx', 'Threads.css'],
  transforms,
  profiles: { site: shared.map((transform) => transform.id), sheet: transforms.map((transform) => transform.id) },
}
