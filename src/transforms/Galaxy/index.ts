import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import framePropsOutOfDeps from './02-frame-props-out-of-deps.ts'
import transparentLightMode from './03-transparent-light-mode.ts'
import coordinatesGetter from './04-coordinates-getter.ts'

const shared = [paramsGetter, framePropsOutOfDeps, transparentLightMode]
const transforms = [...shared, coordinatesGetter]

// Galaxy.css is fetched unchanged. The sheet also moves the sky with the
// drag's ripple, glide and spin (04).
export const Galaxy: ComponentSpec = {
  name: 'Galaxy',
  upstreamDir: 'src/ts-default/Backgrounds/Galaxy',
  files: ['Galaxy.tsx', 'Galaxy.css'],
  transforms,
  profiles: { site: shared.map((transform) => transform.id), sheet: transforms.map((transform) => transform.id) },
}
