import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseManifest } from '../src/manifest.ts'

const SHA = '4d6a46d3f401736695c495f1e72ed429e0ed1b93'

test('a version 2 manifest reads back as written', () => {
  const manifest = { version: 2, commit: SHA, profile: 'sheet', components: { Waves: { transforms: ['01-css-variable-fix'] } } }
  assert.deepEqual(parseManifest(JSON.stringify(manifest), 'reactbits-kit.json'), manifest)
})

test('a version 1 manifest, written before profiles, reads as the site profile in version 2', () => {
  const old = { version: 1, commit: SHA, components: { Waves: { transforms: ['01-css-variable-fix'] } } }
  assert.deepEqual(parseManifest(JSON.stringify(old), 'reactbits-kit.json'), { ...old, version: 2, profile: 'site' })
})

test('any other shape fails loud with the file and the reason', () => {
  const cases: [unknown, RegExp][] = [
    [{ commit: SHA, profile: 'site', components: {} }, /version undefined, this rbx reads versions 1 and 2/],
    [{ version: 3, commit: SHA, profile: 'site', components: {} }, /version 3/],
    [{ version: 2, commit: SHA, components: {} }, /profile undefined is not one of site, sheet/],
    [{ version: 2, commit: SHA, profile: 'blog', components: {} }, /profile "blog" is not one of/],
    [{ version: 1, commit: SHA, profile: 'site', components: {} }, /a version 1 manifest has no profile/],
    [{ version: 2, commit: '4d6a46d', profile: 'site', components: {} }, /not a full SHA/],
    [{ version: 2, commit: SHA, profile: 'site', components: [] }, /components is not an object/],
    [{ version: 2, commit: SHA, profile: 'site', components: { Waves: {} } }, /components\.Waves\.transforms is not a list/],
    [{ version: 2, commit: SHA, profile: 'site', components: {}, source: '.upstream' }, /unknown keys source/],
    [[], /not a JSON object/],
  ]
  for (const [data, reason] of cases) {
    assert.throws(() => parseManifest(JSON.stringify(data), 'x/reactbits-kit.json'), (error: Error) => {
      assert.match(error.message, /^x\/reactbits-kit\.json: /)
      assert.match(error.message, reason)
      return true
    })
  }
  assert.throws(() => parseManifest('{', 'x/reactbits-kit.json'), /not JSON/)
})
