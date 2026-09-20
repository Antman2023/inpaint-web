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
  if (!alpha || alpha.every(value => value === 255)) return
  const lefts = new Uint32Array(result.width)
  const rights = new Uint32Array(result.width)
  const fractions = new Float64Array(result.width)
  for (let x = 0; x < result.width; x++) {
    const sourceX = Math.max(
      0,
      Math.min(width - 1, ((x + 0.5) * width) / result.width - 0.5)
    )
    lefts[x] = Math.floor(sourceX)
    rights[x] = Math.min(width - 1, lefts[x] + 1)
    fractions[x] = sourceX - lefts[x]
  }
  const rowsPerBatch = Math.max(1, Math.floor(1_000_000 / result.width))
  for (let y = 0; y < result.height; y++) {
    if (y % rowsPerBatch === 0) {
      // Paint the output status and deliver cancellation between bounded batches.
      await new Promise(resolve => setTimeout(resolve, 0))
      signal?.throwIfAborted()
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
    for (let x = 0; x < result.width; x++) {
      const left = lefts[x]
      const right = rights[x]
      const fx = fractions[x]
      const a =
        alpha[topOffset + left] * (1 - fx) + alpha[topOffset + right] * fx
      const b =
        alpha[bottomOffset + left] * (1 - fx) + alpha[bottomOffset + right] * fx
      result.data[rowOffset + x * 4 + 3] = a * (1 - fy) + b * fy
    }
  }
}
