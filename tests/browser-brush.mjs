import { drawStroke } from '../src/brush.ts'

// Compare cached paths with immediate canvas drawing, including real rasterization.
export function runBrushSmoke() {
  const actual = document.createElement('canvas')
  const expected = document.createElement('canvas')
  const stroke = { size: 0.04, pts: [{ x: 0.1, y: 0.5 }] }
  let checks = 0
  const compare = (width, height, color) => {
    actual.width = expected.width = width
    actual.height = expected.height = height
    const ctx = expected.getContext('2d')
    ctx.strokeStyle = ctx.fillStyle = color
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.lineWidth = stroke.size * width
    ctx.beginPath()
    const first = stroke.pts[0]
    if (stroke.pts.length === 1) {
      ctx.arc(
        first.x * width,
        first.y * height,
        ctx.lineWidth / 2,
        0,
        Math.PI * 2
      )
      ctx.fill()
    } else {
      ctx.moveTo(first.x * width, first.y * height)
      for (const point of stroke.pts.slice(1))
        ctx.lineTo(point.x * width, point.y * height)
      ctx.stroke()
    }
    const result = actual.getContext('2d')
    drawStroke(result, stroke, color)
    const a = result.getImageData(0, 0, width, height).data
    const b = ctx.getImageData(0, 0, width, height).data
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i])
        throw new Error(`Brush differs at byte ${i}, check ${checks + 1}`)
    }
    checks++
  }
  try {
    const preview = 'rgba(255, 0, 0, 0.5)'
    compare(1000, 500, preview)
    for (let i = 1; i <= 20_000; i++)
      stroke.pts.push({
        x: 0.1 + i / 25_000,
        y: 0.5 + 0.2 * Math.sin(i / 2000),
      })
    compare(1000, 500, preview)
    compare(1000, 500, preview)
    stroke.pts.push({ x: 0.9, y: 0.8 })
    compare(1000, 500, preview)
    compare(600, 400, preview)
    compare(1000, 500, 'white')
    stroke.size = 0.08
    compare(1000, 500, preview)
    stroke.pts = [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.75 },
    ]
    compare(1000, 500, preview)
    stroke.pts.length = 1
    compare(1000, 500, preview)
    stroke.pts.push({ x: 0.5, y: 0.8 })
    compare(1000, 500, preview)
    return { pixelComparisons: checks, status: 'passed' }
  } finally {
    actual.width = actual.height = expected.width = expected.height = 0
  }
}
