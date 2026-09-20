export interface BrushStroke {
  // Coordinates and brush width are relative to the canvas, so a resize
  // preserves the selected part of the image.
  size?: number
  // Append while drawing; use a new array when replacing existing points.
  pts: { x: number; y: number }[]
}

// Weak keys let finished/cancelled strokes release their native paths naturally.
const paths = new WeakMap<
  BrushStroke,
  {
    points: BrushStroke['pts']
    width: number
    height: number
    count: number
    path: Path2D
  }
>()

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: BrushStroke,
  color = 'rgba(255, 0, 0, 0.5)'
) {
  if (!stroke.pts.length || !stroke.size) {
    paths.delete(stroke)
    return
  }
  const { width, height } = ctx.canvas
  const size = stroke.size * width
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = size
  const first = stroke.pts[0]
  ctx.beginPath()
  if (stroke.pts.length === 1) {
    paths.delete(stroke)
    ctx.arc(first.x * width, first.y * height, size / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  if (typeof Path2D !== 'undefined') {
    let cached = paths.get(stroke)
    if (
      !cached ||
      cached.points !== stroke.pts ||
      cached.width !== width ||
      cached.height !== height ||
      cached.count > stroke.pts.length
    ) {
      const path = new Path2D()
      path.moveTo(first.x * width, first.y * height)
      cached = { points: stroke.pts, width, height, count: 1, path }
      paths.set(stroke, cached)
    }
    for (; cached.count < stroke.pts.length; cached.count++) {
      const point = stroke.pts[cached.count]
      cached.path.lineTo(point.x * width, point.y * height)
    }
    ctx.stroke(cached.path)
    return
  }
  ctx.moveTo(first.x * width, first.y * height)
  for (let index = 1; index < stroke.pts.length; index++) {
    const point = stroke.pts[index]
    ctx.lineTo(point.x * width, point.y * height)
  }
  ctx.stroke()
}
