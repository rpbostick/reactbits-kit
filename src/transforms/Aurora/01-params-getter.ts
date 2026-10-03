import { Node, SyntaxKind } from 'ts-morph'
import { addMember, insertBeforeStatement, insertStatements } from '../../ast/edit.ts'
import { compact, functionBody, interfaceNamed, ShapeError } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

// The props a params getter can override.
const PARAM_FIELDS = ['colorStops', 'amplitude', 'blend', 'speed']

const transform: TsxTransform = {
  id: '01-params-getter',
  file: 'Aurora.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding colorStops, amplitude, blend and speed',
  description:
    'A `params` prop, a getter called once per frame whose `colorStops`, `amplitude`, `blend` and `speed` override the matching props, so the aurora can change continuously without re-rendering.',
  apply(file) {
    const props = interfaceNamed(file, 'AuroraProps')
    for (const field of PARAM_FIELDS) {
      if (!props.getProperty(field)) throw new ShapeError(`interface AuroraProps has no ${field}`)
    }

    // Every read of the props in the loop goes through this frame's params.
    const update = functionBody(file, 'update')
    const reads = update.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).filter((read) => compact(read.getText()) === 'propsRef.current')
    if (reads.length === 0) throw new ShapeError('update does not read propsRef.current')
    const first = reads[0].getFirstAncestor((ancestor) => ancestor.getParent() === update)
    if (!first || !Node.isStatement(first)) throw new ShapeError('propsRef.current is read outside a statement of update')
    const index = first.getChildIndex()
    for (const read of reads.reverse()) read.replaceWithText('current')
    insertStatements(update, { before: update.getStatements()[index] }, 'const current = { ...propsRef.current, ...propsRef.current.params?.() };')

    // Last: these insert text, which leaves earlier node handles stale.
    insertBeforeStatement(file, props, `type FrameParams = Partial<Pick<AuroraProps, ${PARAM_FIELDS.map((field) => `'${field}'`).join(' | ')}>>;`)
    addMember(file, 'AuroraProps', {
      name: 'params',
      type: '() => FrameParams',
      optional: true,
      comment: 'Called once per frame; what it returns overrides the matching props, so\nthe aurora can change continuously without re-rendering.',
    })
  },
}

export default transform
