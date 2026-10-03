// The color loop: 12 hue families × 6 shades = 72 stops, built in OKLCH so
// every family steps evenly in perceived lightness.

export const FAMILY_NAMES = [
  'Red',
  'Orange',
  'Yellow',
  'Yellow-green',
  'Green',
  'Green-cyan',
  'Cyan',
  'Azure',
  'Blue',
  'Violet',
  'Magenta',
  'Rose',
] as const

export const SHADE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const

export const STOP_COUNT = FAMILY_NAMES.length * SHADE_LETTERS.length

// The backgrounds the lightness ranges below were tuned against: a warm paper
// color for light mode and a near-black for dark mode.
export const backgrounds = { light: '#faf6ee', dark: '#1a1816' } as const

export type Theme = keyof typeof backgrounds

// OKLCH lightness of shade A and shade F per theme. Light mode stops at 0.80
// because a paler A drops below 1.5:1 against the paper; dark mode is lifted
// so F stays clear of the near-black background.
const lightnessRange: Record<Theme, { a: number; f: number }> = {
  light: { a: 0.8, f: 0.38 },
  dark: { a: 0.93, f: 0.5 },
}

const TARGET_CHROMA = 0.13

export interface Oklch {
  l: number
  c: number
  h: number
}

export interface Stop extends Oklch {
  label: string
  name: string
  hex: string
}

function oklchToLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const hueRad = (h * Math.PI) / 180
  const a = c * Math.cos(hueRad)
  const b = c * Math.sin(hueRad)
  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sCone = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  ]
}

function encodeGamma(linear: number): number {
  return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
}

function inSrgbGamut(color: Oklch): boolean {
  return oklchToLinearSrgb(color).every((channel) => channel >= -1e-6 && channel <= 1 + 1e-6)
}

// Lowers chroma until the color fits in sRGB, keeping lightness and hue.
export function clampToGamut(color: Oklch): Oklch {
  if (inSrgbGamut(color)) return color
  let low = 0
  let high = color.c
  for (let iteration = 0; iteration < 24; iteration++) {
    const mid = (low + high) / 2
    if (inSrgbGamut({ ...color, c: mid })) low = mid
    else high = mid
  }
  return { ...color, c: low }
}

// 8-bit sRGB channels, clipped; callers clamp chroma first for exact stops.
export function oklchToRgb255(color: Oklch): [number, number, number] {
  const [red, green, blue] = oklchToLinearSrgb(color).map((channel) =>
    Math.round(Math.min(1, Math.max(0, encodeGamma(Math.max(0, channel)))) * 255),
  )
  return [red, green, blue]
}

export function rgb255ToHex([red, green, blue]: [number, number, number]): string {
  return '#' + [red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')
}

// Serpentine order: odd families (1, 3, …) run A→F, even families F→A, so
// neighboring stops never jump in lightness and 12A wraps back to 1A.
export function buildStops(theme: Theme): Stop[] {
  const { a: lightA, f: lightF } = lightnessRange[theme]
  const shadeStep = (lightA - lightF) / (SHADE_LETTERS.length - 1)
  const stops: Stop[] = []
  FAMILY_NAMES.forEach((name, familyIndex) => {
    // Families are 30° apart, but OKLCH's 0° is a rose and sRGB red sits
    // near 29°, so family n goes at 30n° to keep the names honest.
    const hue = ((familyIndex + 1) * 30) % 360
    for (let step = 0; step < SHADE_LETTERS.length; step++) {
      const shadeIndex = familyIndex % 2 === 0 ? step : SHADE_LETTERS.length - 1 - step
      const color = clampToGamut({ l: lightA - shadeStep * shadeIndex, c: TARGET_CHROMA, h: hue })
      stops.push({
        ...color,
        label: `${familyIndex + 1}${SHADE_LETTERS[shadeIndex]}`,
        name,
        hex: rgb255ToHex(oklchToRgb255(color)),
      })
    }
  })
  return stops
}

export const stopsByTheme: Record<Theme, Stop[]> = {
  light: buildStops('light'),
  dark: buildStops('dark'),
}

export function wrapPosition(position: number): number {
  return ((position % STOP_COUNT) + STOP_COUNT) % STOP_COUNT
}

export function nearestStopIndex(position: number): number {
  return wrapPosition(Math.round(position))
}

// Interpolates in OKLCH between the two stops either side of `position`,
// taking the short way round the hue circle (330° → 0° at the wrap).
export function colorAt(stops: Stop[], position: number): string {
  const wrapped = wrapPosition(position)
  const index = Math.floor(wrapped)
  const fraction = wrapped - index
  const from = stops[index]
  const to = stops[(index + 1) % stops.length]
  const hueDelta = ((to.h - from.h + 540) % 360) - 180
  const [red, green, blue] = oklchToRgb255({
    l: from.l + (to.l - from.l) * fraction,
    c: from.c + (to.c - from.c) * fraction,
    h: from.h + hueDelta * fraction,
  })
  return `rgb(${red}, ${green}, ${blue})`
}
