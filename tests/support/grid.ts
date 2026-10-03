import type { GridPoint } from '../../src/modules/rippleField.ts'

// A grid laid out as Waves lays its points (100 px beyond each side, 15 px
// above and below, plus any overscan), with the waves' own offset at zero.
export function wavesGrid(width: number, height: number, xGap: number, yGap: number, overscanX = 0, overscanY = 0): GridPoint[][] {
  const totalLines = Math.ceil((width + 200 + 2 * overscanX) / xGap)
  const totalPoints = Math.ceil((height + 30 + 2 * overscanY) / yGap)
  const xStart = (width - xGap * totalLines) / 2
  const yStart = (height - yGap * totalPoints) / 2
  const lines: GridPoint[][] = []
  for (let line = 0; line <= totalLines; line++) {
    const points: GridPoint[] = []
    for (let index = 0; index <= totalPoints; index++) {
      points.push({ x: xStart + xGap * line, y: yStart + yGap * index, wave: { x: 0, y: 0 } })
    }
    lines.push(points)
  }
  return lines
}
