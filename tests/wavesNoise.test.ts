// The noise.ts that Waves 13-noise-module writes, imported and run: at the
// default period it reads exactly as upstream's own Noise, on a smaller
// period it repeats without a seam, and the ball's period (sphereSpin
// SPIN.PERIOD_PX) is a whole number of cells. Both files exist only in a
// temporary directory for the test, never in the repository.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { Project } from 'ts-morph'
import { SPIN } from '../src/modules/sphereSpin.ts'
import { applyTransforms, forProfile } from '../src/transform.ts'
import { COMPONENTS } from '../src/transforms/index.ts'
import { PINNED_COMMIT, readUpstreamFile } from '../src/upstream.ts'
import { UPSTREAM_CHECKOUT, UPSTREAM_SKIP } from './support/upstream.ts'

interface NoiseLike {
  perlin2(x: number, y: number, periodX?: number, periodY?: number): number
}

interface NoiseModule {
  Noise: new (seed: number) => NoiseLike
  NOISE_SCALE: { x: number; y: number }
  MAX_NOISE_PERIOD: number
  noisePeriod(px: number, scale: number): number
}

const scratch = mkdtempSync(join(tmpdir(), 'rbx-noise-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

async function upstreamWaves(): Promise<Map<string, string>> {
  const spec = COMPONENTS.Waves
  const sources = new Map<string, string>()
  for (const file of spec.files) sources.set(file, await readUpstreamFile({ commit: PINNED_COMMIT, checkout: UPSTREAM_CHECKOUT }, `${spec.upstreamDir}/${file}`))
  return sources
}

// The site profile's noise.ts, and upstream's own Grad and Noise lifted out
// of Waves.tsx as they are, each imported from the scratch directory.
async function noiseModules(): Promise<{ built: NoiseModule; original: { Noise: new (seed: number) => NoiseLike } }> {
  const sources = await upstreamWaves()
  const built = applyTransforms(forProfile(COMPONENTS.Waves, 'site'), sources).get('noise.ts')
  assert.ok(built, 'the site profile wrote no noise.ts')
  writeFileSync(join(scratch, 'built.ts'), built)
  const waves = new Project({ useInMemoryFileSystem: true }).createSourceFile('/Waves.tsx', sources.get('Waves.tsx')!)
  writeFileSync(join(scratch, 'original.ts'), `${waves.getClassOrThrow('Grad').getText()}\n\nexport ${waves.getClassOrThrow('Noise').getText()}\n`)
  return {
    built: await import(pathToFileURL(join(scratch, 'built.ts')).href),
    original: await import(pathToFileURL(join(scratch, 'original.ts')).href),
  }
}

function close(actual: number, expected: number, tolerance: number, what: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual}, expected ${expected} ± ${tolerance}`)
}

test('at the default period the moved noise reads exactly as upstream', { skip: UPSTREAM_SKIP }, async () => {
  const { built, original } = await noiseModules()
  assert.equal(built.MAX_NOISE_PERIOD, 256)
  assert.deepEqual(built.NOISE_SCALE, { x: 0.002, y: 0.0015 })
  for (const seed of [0, 0.37, 0.9]) {
    const moved = new built.Noise(seed)
    const theirs = new original.Noise(seed)
    for (let k = 0; k < 500; k++) {
      const x = (k * 7.31) % 600 - 300
      const y = (k * 3.77) % 900 - 450
      assert.equal(moved.perlin2(x, y), theirs.perlin2(x, y), `seed ${seed} at ${x}, ${y}`)
    }
  }
})

test("on a smaller period it repeats without a seam, and the ball's period is whole cells", { skip: UPSTREAM_SKIP }, async () => {
  const { built } = await noiseModules()
  const period = SPIN.PERIOD_PX
  const cellsX = built.noisePeriod(period, built.NOISE_SCALE.x)
  const cellsY = built.noisePeriod(period, built.NOISE_SCALE.y)
  assert.deepEqual([cellsX, cellsY], [16, 12])
  assert.throws(() => built.noisePeriod(1234, built.NOISE_SCALE.x), /whole number/)
  assert.throws(() => built.noisePeriod(1000 * 257, built.NOISE_SCALE.x), /from 1 to 256/)
  const noise = new built.Noise(0.37)
  const read = (x: number, y: number) => noise.perlin2(x * built.NOISE_SCALE.x, y * built.NOISE_SCALE.y, cellsX, cellsY)
  for (let k = 0; k < 200; k++) {
    const x = (k * 137.3) % period
    const y = (k * 91.7) % period
    close(read(x + period, y), read(x, y), 1e-9, `period across at ${x}, ${y}`)
    close(read(x, y - period), read(x, y), 1e-9, `period down at ${x}, ${y}`)
  }
  for (const y of [0, 333, 4321]) {
    close(read(period - 0.01, y), read(0.01, y), 1e-3, `across the seam at y ${y}`)
    close(read(y, period - 0.01), read(y, 0.01), 1e-3, `down the seam at x ${y}`)
  }
})
