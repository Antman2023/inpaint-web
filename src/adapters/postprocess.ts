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
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error('Image has invalid dimensions')
  }
  const pixels = width * height
  if (rgb.length !== pixels * 3 || (alpha && alpha.length !== pixels)) {
    throw new Error('Pixel data length does not match image dimensions')
  }
  const data = new Uint8ClampedArray(pixels * 4)
  const batchSize = 1_000_000
  for (let start = 0; start < pixels; start += batchSize) {
    await new Promise(resolve => setTimeout(resolve, 0))
    signal?.throwIfAborted()
    if (rgb.length !== pixels * 3 || (alpha && alpha.length !== pixels)) {
      throw new Error('Pixel data became unavailable during conversion')
    }
    const end = Math.min(pixels, start + batchSize)
    // Write each RGBA pixel together instead of traversing the output four
    // times and invoking a callback for every channel of every pixel.
    for (let i = start, offset = start * 4; i < end; i++, offset += 4) {
      data[offset] = rgb[i] ?? 0
      data[offset + 1] = rgb[pixels + i] ?? 0
      data[offset + 2] = rgb[pixels * 2 + i] ?? 0
      data[offset + 3] = alpha?.[i] ?? 255
    }
  }
  return new ImageData(data, width, height)
}
