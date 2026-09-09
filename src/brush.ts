export interface BrushStroke {
  // Coordinates and brush width are relative to the canvas, so a resize
  // preserves the selected part of the image.
  size?: number
  pts: { x: number; y: number }[]
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: BrushStroke,
  color = 'rgba(255, 0, 0, 0.5)'
) {
  if (!stroke.pts.length || !stroke.size) return
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
    ctx.arc(first.x * width, first.y * height, size / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.moveTo(first.x * width, first.y * height)
  for (let index = 1; index < stroke.pts.length; index++) {
    const point = stroke.pts[index]
    ctx.lineTo(point.x * width, point.y * height)
  }
  ctx.stroke()
}
