import { Node, type ObjectLiteralExpression, type SourceFile } from 'ts-morph'
import { componentBody } from '../../ast/component.ts'
import { insertItemAfter } from '../../ast/edit.ts'
import { assignedValue, destructuringOf, effectDeclaring, functionBody, ShapeError, variableNamed } from '../../ast/find.ts'
import { addParamsProp } from '../../ast/params.ts'
import type { TsxTransform } from '../../transform.ts'

// The props object propsRef starts with and the one each render stores.
function storedProps(file: SourceFile): [ObjectLiteralExpression, ObjectLiteralExpression] {
  const body = componentBody(file, 'Threads')
  const initial = variableNamed(body, 'propsRef').getInitializerOrThrow()
  const first = Node.isCallExpression(initial) ? initial.getArguments()[0] : undefined
  const latest = assignedValue(body, 'propsRef.current')
  if (!first || !Node.isObjectLiteralExpression(first) || !Node.isObjectLiteralExpression(latest)) {
    throw new ShapeError('propsRef does not hold an object literal of the props')
  }
  return [first, latest]
}

function addParams(literal: ObjectLiteralExpression) {
  const properties = literal.getProperties()
  if (properties.length === 0) throw new ShapeError('propsRef holds an empty object')
  insertItemAfter(properties[properties.length - 1], 'params')
}

const transform: TsxTransform = {
  id: '01-params-getter',
  file: 'Threads.tsx',
  kind: 'tsx',
  summary: 'A params prop: a per-frame getter overriding color',
  description: 'A `params` prop, a getter called once per frame whose `color` overrides the prop.',
  apply(file) {
    // Upstream already reads the props each frame from propsRef; the frame
    // reads them with the getter's fields on top.
    const update = functionBody(effectDeclaring(file, 'update'), 'update')
    const frame = destructuringOf(update, 'propsRef.current')
    const names = frame.getNameNode()
    if (!Node.isObjectBindingPattern(names) || !names.getElements().some((element) => element.getName() === 'color')) {
      throw new ShapeError('update does not read color from propsRef.current')
    }
    frame.setInitializer('{ ...propsRef.current, ...propsRef.current.params?.() }')

    // Last: these insert text, which leaves earlier node handles stale. The
    // later literal first, so the earlier one is found where it was.
    addParams(storedProps(file)[1])
    addParams(storedProps(file)[0])
    addParamsProp(file, {
      component: 'Threads',
      propsType: 'ThreadsProps',
      fields: ['color'],
      style: 'literal',
      comment: 'Called once per frame; what it returns overrides the matching props, so the color can change\ncontinuously without re-rendering.',
    })
  },
}

export default transform
