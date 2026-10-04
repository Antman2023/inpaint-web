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
    rgb.subarray(start, end).forEach((value, index) => {
      data[(start + index) * 4] = value
    })
    rgb.subarray(pixels + start, pixels + end).forEach((value, index) => {
      data[(start + index) * 4 + 1] = value
    })
    rgb
      .subarray(pixels * 2 + start, pixels * 2 + end)
      .forEach((value, index) => {
        data[(start + index) * 4 + 2] = value
      })
    if (alpha) {
      alpha.subarray(start, end).forEach((value, index) => {
        data[(start + index) * 4 + 3] = value
      })
    } else {
      for (let i = start; i < end; i++) data[i * 4 + 3] = 255
    }
  }
  return new ImageData(data, width, height)
}
