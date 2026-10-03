import { Node } from 'ts-morph'
import { addCommentBefore } from '../../ast/edit.ts'
import { effectDeclaring, ShapeError, statementOf } from '../../ast/find.ts'
import type { TsxTransform } from '../../transform.ts'

const transform: TsxTransform = {
  id: '03-transparent-light-mode',
  file: 'Galaxy.tsx',
  kind: 'tsx',
  summary: 'Light mode no longer clears to opaque white; transparent always blends',
  description:
    'The WebGL setup no longer clears to opaque white in light mode: with `transparent` it always sets up blending and a transparent clear. Light mode draws every pixel opaque, so it looks the same, and the theme can change without a rebuild.',
  apply(file) {
    const effect = effectDeclaring(file, 'update')
    // `if (lightMode) { …white… } else if (transparent) { … } else { … }`:
    // the transparent branch and what follows it take the whole statement's place.
    const setup = statementOf(effect, 'if (lightMode) … else if (transparent) …', (_text, statement) => Node.isIfStatement(statement) && statement.getExpression().getText() === 'lightMode')
    if (!Node.isIfStatement(setup)) throw new ShapeError('the light mode setup is not an if statement')
    const rest = setup.getElseStatement()
    if (!rest || !Node.isIfStatement(rest) || rest.getExpression().getText() !== 'transparent') {
      throw new ShapeError('the light mode setup is not followed by else if (transparent)')
    }
    // Cut up to the inner `if`, so its own text and layout stay as they are.
    // This leaves earlier node handles stale.
    file.replaceText([setup.getStart(), rest.getStart()], '')
    const kept = statementOf(effectDeclaring(file, 'update'), 'if (transparent) …', (_text, statement) => Node.isIfStatement(statement) && statement.getExpression().getText() === 'transparent')
    addCommentBefore(kept, 'Light mode draws every pixel opaque, so the blend set up for transparency leaves it as it is.')
  },
}

export default transform
