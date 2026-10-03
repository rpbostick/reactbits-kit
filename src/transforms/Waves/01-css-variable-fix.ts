import type { Declaration, Rule } from 'postcss'
import { exactlyOne, ShapeError } from '../../ast/find.ts'
import type { CssTransform } from '../../transform.ts'

// The custom properties Waves.tsx sets on the container, in the order the
// transform's two var() calls take them.
const PROPERTIES = ['--x', '--y']
// A var() whose first argument is not a custom property name.
const BARE_VAR = /var\(\s*(?!--)([^()]*?)\s*\)/g

const transform: CssTransform = {
  id: '01-css-variable-fix',
  file: 'Waves.css',
  kind: 'css',
  summary: 'The ::before transform reads var(--x, …) and var(--y, …) instead of invalid var() calls',
  description:
    "The `::before` transform read `var(-0.5rem)` and `var(50%)`, which are invalid CSS and fail Vite's CSS minifier; they now read `var(--x, -0.5rem)` and `var(--y, 50%)`, the custom properties `Waves.tsx` sets.",
  apply(root) {
    const rules: Rule[] = []
    root.walkRules((rule) => {
      if (rule.selector.includes('::before')) rules.push(rule)
    })
    const rule = exactlyOne(rules, 'rule for ::before')
    const declarations: Declaration[] = []
    rule.walkDecls('transform', (declaration) => {
      declarations.push(declaration)
    })
    const declaration = exactlyOne(declarations, 'transform declaration in the ::before rule')
    const found = declaration.value.match(BARE_VAR) ?? []
    if (found.length !== PROPERTIES.length) {
      throw new ShapeError(`${found.length} var() calls without a custom property in "${declaration.value}", expected ${PROPERTIES.length}`)
    }
    let next = 0
    declaration.value = declaration.value.replace(BARE_VAR, (_, fallback: string) => `var(${PROPERTIES[next++]}, ${fallback})`)
  },
}

export default transform
