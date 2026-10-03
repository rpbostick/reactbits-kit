import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ColorDrive, DRIFT_MS_PER_STOP, EASE_MS, RESUME_AFTER_MS, wheelTicks } from '../../src/modules/colorDrive.ts'

const FRAME_MS = 16

function runFrames(drive: ColorDrive, from: number, to: number): number {
  let position = drive.advance(from)
  for (let now = from + FRAME_MS; now <= to; now += FRAME_MS) position = drive.advance(now)
  return position
}

test('drifts one stop per DRIFT_MS_PER_STOP with no input', () => {
  const position = runFrames(new ColorDrive(), 0, DRIFT_MS_PER_STOP)
  assert.ok(Math.abs(position - 1) < 0.01, `position ${position}`)
})

test('a long frame gap does not make the drift leap', () => {
  const drive = new ColorDrive()
  drive.advance(0)
  const position = drive.advance(60_000)
  assert.ok(position < 0.05, `position ${position}`)
})

test('a forward tick mid-drift snaps to the next whole stop after the ease', () => {
  const drive = new ColorDrive()
  const drifted = runFrames(drive, 0, 1.4 * DRIFT_MS_PER_STOP)
  assert.ok(drifted > 1 && drifted < 2)
  drive.step(1, 1.4 * DRIFT_MS_PER_STOP)
  assert.equal(drive.advance(1.4 * DRIFT_MS_PER_STOP + EASE_MS), 2)
})

test('ticks accumulate and reverse', () => {
  const drive = new ColorDrive()
  drive.advance(0)
  drive.step(1, 10)
  drive.step(1, 20)
  drive.step(1, 30)
  drive.step(-1, 40)
  assert.equal(drive.advance(40 + EASE_MS), 2)
  drive.step(-1, 1000)
  drive.step(-1, 1010)
  drive.step(-1, 1020)
  assert.equal(drive.advance(1020 + EASE_MS), -1)
})

test('holds the stepped stop, then drifts forward RESUME_AFTER_MS after the last tick', () => {
  const drive = new ColorDrive()
  drive.advance(0)
  drive.step(1, 0)
  assert.equal(runFrames(drive, 1, RESUME_AFTER_MS - 1), 1)
  const resumed = runFrames(drive, RESUME_AFTER_MS, RESUME_AFTER_MS + DRIFT_MS_PER_STOP)
  assert.ok(resumed > 1.9 && resumed < 2.1, `position ${resumed}`)
})

test('reduced motion: no drift, and a tick lands instantly', () => {
  const drive = new ColorDrive()
  drive.reducedMotion = true
  assert.equal(runFrames(drive, 0, 20_000), 0)
  drive.step(-1, 20_000)
  assert.equal(drive.advance(20_000), -1)
})

test('wheel normalization: a mouse notch is one tick, a trackpad swipe a few', () => {
  assert.equal(wheelTicks({ pixels: 0 }, 100, 0, 800), 1)
  assert.equal(wheelTicks({ pixels: 0 }, -53, 0, 800), -1)
  assert.equal(wheelTicks({ pixels: 0 }, 3, 1, 800), 1)
  const trackpad = { pixels: 0 }
  let ticks = 0
  for (let event = 0; event < 40; event++) ticks += wheelTicks(trackpad, 12, 0, 800)
  assert.equal(ticks, 4)
  assert.equal(wheelTicks(trackpad, -12, 0, 800), 0, 'reversing clears the carried remainder')
})
