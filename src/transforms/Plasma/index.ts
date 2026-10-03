import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import framePropsOutOfDeps from './02-frame-props-out-of-deps.ts'
import coordinatesGetter from './03-coordinates-getter.ts'

const shared = [paramsGetter, framePropsOutOfDeps]
const transforms = [...shared, coordinatesGetter]

// Plasma.css is fetched unchanged. The sheet also moves the pattern with the
// drag's ripple, glide and spin (03).
export const Plasma: ComponentSpec = {
  name: 'Plasma',
  upstreamDir: 'src/ts-default/Backgrounds/Plasma',
  files: ['Plasma.tsx', 'Plasma.css'],
  transforms,
  profiles: { site: shared.map((transform) => transform.id), sheet: transforms.map((transform) => transform.id) },
}
