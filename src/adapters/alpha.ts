// Scale opacity separately: the RGB model has no alpha channel. Pixel-center
// bilinear sampling preserves soft edges without allocating a second RGBA image.
export async function applyResizedAlpha(
  result: ImageData,
  alpha: Uint8Array | undefined,
  width: number,
  height: number,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  if (!alpha) return
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    alpha.length !== width * height
  ) {
    throw new Error('Alpha data length does not match source dimensions')
  }
  if (alpha.every(value => value === 255)) return
  const columns = Array.from({ length: result.width }, (_, x) => {
    const sourceX = Math.max(
      0,
      Math.min(width - 1, ((x + 0.5) * width) / result.width - 0.5)
    )
    const left = Math.floor(sourceX)
    return {
      left,
      right: Math.min(width - 1, left + 1),
      fraction: sourceX - left,
    }
  })
  const rowsPerBatch = Math.max(1, Math.floor(1_000_000 / result.width))
  for (let y = 0; y < result.height; y++) {
    if (y % rowsPerBatch === 0) {
      // Paint the output status and deliver cancellation between bounded batches.
      await new Promise(resolve => setTimeout(resolve, 0))
      signal?.throwIfAborted()
      if (alpha.length !== width * height) {
        throw new Error('Alpha data became unavailable during scaling')
      }
    }
    const sourceY = Math.max(
      0,
      Math.min(height - 1, ((y + 0.5) * height) / result.height - 0.5)
    )
    const top = Math.floor(sourceY)
    const bottom = Math.min(height - 1, top + 1)
    const fy = sourceY - top
    const topOffset = top * width
    const bottomOffset = bottom * width
    const rowOffset = y * result.width * 4
    for (const [x, { left, right, fraction: fx }] of columns.entries()) {
      const a =
        (alpha[topOffset + left] ?? 255) * (1 - fx) +
        (alpha[topOffset + right] ?? 255) * fx
      const b =
        (alpha[bottomOffset + left] ?? 255) * (1 - fx) +
        (alpha[bottomOffset + right] ?? 255) * fx
      result.data[rowOffset + x * 4 + 3] = a * (1 - fy) + b * fy
    }
  }
}
