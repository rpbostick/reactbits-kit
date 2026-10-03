import { addDestructuredProp, addSyncedRef } from '../../ast/component.ts'
import { addMember, insertAfterStatement } from '../../ast/edit.ts'
import { destructuringOf, functionBody, interfaceNamed, ShapeError } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

// The Config fields a motion getter can override.
const MOTION_FIELDS = ['waveSpeedX', 'waveSpeedY', 'waveAmpX', 'waveAmpY', 'friction', 'tension', 'maxCursorMove']

const transform: TsxTransform = {
  id: '05-motion-getter',
  file: 'Waves.tsx',
  kind: 'tsx',
  summary: 'A motion prop: a per-frame getter overriding the speed, amplitude and spring props',
  description:
    'A `motion` prop, a getter called once per frame in `movePoints`, whose `waveSpeedX`, `waveSpeedY`, `waveAmpX`, `waveAmpY`, `friction`, `tension` and `maxCursorMove` override the matching props, so the pattern can change continuously without re-rendering or re-initializing the waves.',
  apply(file) {
    const config = interfaceNamed(file, 'Config')
    for (const field of MOTION_FIELDS) {
      if (!config.getProperty(field)) throw new ShapeError(`interface Config has no ${field}`)
    }
    insertAfterStatement(file, config, `type Motion = Pick<\n  Config,\n  ${MOTION_FIELDS.map((field) => `'${field}'`).join(' | ')}\n>;`)
    addMember(file, 'WavesProps', {
      name: 'motion',
      type: '() => Motion',
      optional: true,
      before: 'backgroundColor',
      comment: 'Like a lineColor getter: called once per frame, and what it returns\noverrides the matching props, so the pattern can change continuously.',
    })
    addDestructuredProp(file, 'Waves', 'motion', 'style')
    addSyncedRef(file, 'Waves', 'motionRef', 'motion')
    destructuringOf(functionBody(file, 'movePoints'), 'configRef.current').setInitializer('{ ...configRef.current, ...motionRef.current?.() }')
  },
}

export default transform
