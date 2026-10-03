import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import colorsOutOfDeps from './02-colors-out-of-deps.ts'

const transforms = [paramsGetter, colorsOutOfDeps]
const all = transforms.map((transform) => transform.id)

// Balatro.css is fetched unchanged.
export const Balatro: ComponentSpec = {
  name: 'Balatro',
  upstreamDir: 'src/ts-default/Backgrounds/Balatro',
  files: ['Balatro.tsx', 'Balatro.css'],
  transforms,
  profiles: { site: all, sheet: all },
}
