import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import framePropsOutOfDeps from './02-frame-props-out-of-deps.ts'
import transparentLightMode from './03-transparent-light-mode.ts'

const transforms = [paramsGetter, framePropsOutOfDeps, transparentLightMode]
const all = transforms.map((transform) => transform.id)

// Galaxy.css is fetched unchanged.
export const Galaxy: ComponentSpec = {
  name: 'Galaxy',
  upstreamDir: 'src/ts-default/Backgrounds/Galaxy',
  files: ['Galaxy.tsx', 'Galaxy.css'],
  transforms,
  profiles: { site: all, sheet: all },
}
