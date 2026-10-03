import type { ComponentSpec } from '../transform.ts'
import { Aurora } from './Aurora/index.ts'
import { Balatro } from './Balatro/index.ts'
import { Galaxy } from './Galaxy/index.ts'
import { Iridescence } from './Iridescence/index.ts'
import { LiquidChrome } from './LiquidChrome/index.ts'
import { Plasma } from './Plasma/index.ts'
import { RippleGrid } from './RippleGrid/index.ts'
import { SoftAurora } from './SoftAurora/index.ts'
import { Threads } from './Threads/index.ts'
import { Waves } from './Waves/index.ts'

export const COMPONENTS: Record<string, ComponentSpec> = {
  Waves,
  Aurora,
  Iridescence,
  Threads,
  Balatro,
  LiquidChrome,
  Galaxy,
  Plasma,
  SoftAurora,
  RippleGrid,
}
