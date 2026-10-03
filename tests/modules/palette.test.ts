import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backgrounds, colorAt, nearestStopIndex, STOP_COUNT, stopsByTheme, type Theme } from '../../src/modules/palette.ts'

const MIN_LINE_CONTRAST = 1.5
const THEMES: Theme[] = ['light', 'dark']

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(hexA: string, hexB: string): number {
  const [lighter, darker] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

for (const theme of THEMES) {
  test(`${theme}: 72 stops, each at least ${MIN_LINE_CONTRAST}:1 against its background`, () => {
    const stops = stopsByTheme[theme]
    assert.equal(stops.length, STOP_COUNT)
    assert.equal(STOP_COUNT, 72)
    for (const stop of stops) {
      const contrast = contrastRatio(stop.hex, backgrounds[theme])
      assert.ok(contrast >= MIN_LINE_CONTRAST, `${theme} ${stop.label}: contrast ${contrast.toFixed(2)}`)
    }
  })

  test(`${theme}: the serpentine order never jumps in lightness, across the seam included`, () => {
    const stops = stopsByTheme[theme]
    stops.forEach((stop, index) => {
      const next = stops[(index + 1) % stops.length]
      // Within a family the step is one shade; across a family boundary it is 0.
      assert.ok(Math.abs(next.l - stop.l) <= 0.1, `${stop.label}→${next.label}: ${Math.abs(next.l - stop.l).toFixed(3)}`)
    })
  })
}

test('colorAt lands on the stop at whole positions and wraps both ways', () => {
  const stops = stopsByTheme.light
  const hexToRgb = (hex: string) => `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`
  assert.equal(colorAt(stops, 5), hexToRgb(stops[5].hex))
  assert.equal(colorAt(stops, STOP_COUNT + 5), colorAt(stops, 5))
  assert.equal(colorAt(stops, -1), colorAt(stops, STOP_COUNT - 1))
  assert.equal(nearestStopIndex(-0.4), 0)
  assert.equal(nearestStopIndex(STOP_COUNT - 0.4), 0)
})
