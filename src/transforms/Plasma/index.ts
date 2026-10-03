import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import framePropsOutOfDeps from './02-frame-props-out-of-deps.ts'

const transforms = [paramsGetter, framePropsOutOfDeps]
const all = transforms.map((transform) => transform.id)

// Plasma.css is fetched unchanged.
export const Plasma: ComponentSpec = {
  name: 'Plasma',
  upstreamDir: 'src/ts-default/Backgrounds/Plasma',
  files: ['Plasma.tsx', 'Plasma.css'],
  transforms,
  profiles: { site: all, sheet: all },
}
