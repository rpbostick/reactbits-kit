import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import colorsOutOfDeps from './02-colors-out-of-deps.ts'
import coordinatesGetter from './03-coordinates-getter.ts'

const shared = [paramsGetter, colorsOutOfDeps]
const transforms = [...shared, coordinatesGetter]

// Balatro.css is fetched unchanged. The sheet also moves the pattern with
// the drag's ripple, glide and spin (03).
export const Balatro: ComponentSpec = {
  name: 'Balatro',
  upstreamDir: 'src/ts-default/Backgrounds/Balatro',
  files: ['Balatro.tsx', 'Balatro.css'],
  transforms,
  profiles: { site: shared.map((transform) => transform.id), sheet: transforms.map((transform) => transform.id) },
}
