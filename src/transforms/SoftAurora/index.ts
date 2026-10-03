import type { ComponentSpec } from '../../transform.ts'
import paramsGetter from './01-params-getter.ts'
import framePropsOutOfDeps from './02-frame-props-out-of-deps.ts'

const transforms = [paramsGetter, framePropsOutOfDeps]
const all = transforms.map((transform) => transform.id)

// SoftAurora.css is fetched unchanged.
export const SoftAurora: ComponentSpec = {
  name: 'SoftAurora',
  upstreamDir: 'src/ts-default/Backgrounds/SoftAurora',
  files: ['SoftAurora.tsx', 'SoftAurora.css'],
  transforms,
  profiles: { site: all, sheet: all },
}
