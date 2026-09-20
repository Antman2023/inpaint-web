// Convert model CHW output into canvas RGBA in bounded batches so the output
// stage can paint and accept cancellation before allocating an encoded result.
export async function planarToImageData(
  rgb: Uint8Array,
  alpha: Uint8Array | undefined,
  width: number,
  height: number,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const pixels = width * height
  const data = new Uint8ClampedArray(pixels * 4)
  const batchSize = 1_000_000
  for (let start = 0; start < pixels; start += batchSize) {
    await new Promise(resolve => setTimeout(resolve, 0))
    signal?.throwIfAborted()
    const end = Math.min(pixels, start + batchSize)
    for (let i = start; i < end; i++) {
      const offset = i * 4
      data[offset] = rgb[i]
      data[offset + 1] = rgb[pixels + i]
      data[offset + 2] = rgb[pixels * 2 + i]
      data[offset + 3] = alpha?.[i] ?? 255
    }
  }
  return new ImageData(data, width, height)
}
