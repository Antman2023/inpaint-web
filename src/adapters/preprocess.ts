type PixelSource = HTMLImageElement | HTMLCanvasElement

function dimensions(image: PixelSource) {
  return 'naturalWidth' in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height }
}

function validateDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error('Image has invalid dimensions')
}

async function readPixelBatches(
  image: PixelSource,
  width: number,
  height: number,
  consume: (data: Uint8ClampedArray, start: number) => void,
  signal?: AbortSignal
) {
  await yieldForCancellation(signal)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = width
    canvas.height = height
    // Explicit false avoids Chromium switching readback paths between strips,
    // which can change rounding of semi-transparent RGB values.
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    if (!ctx) throw new Error('Unable to get canvas context')
    ctx.drawImage(image, 0, 0, width, height)
    // Draw once so scaling and interpolation are identical across strip edges.
    // Bound each temporary RGBA array instead of reading the entire image at once.
    const rowsPerBatch = Math.max(1, Math.floor(1_000_000 / width))
    for (let y = 0; y < height; y += rowsPerBatch) {
      await yieldForCancellation(signal)
      const rows = Math.min(rowsPerBatch, height - y)
      consume(ctx.getImageData(0, y, width, rows).data, y * width)
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

async function yieldForCancellation(signal?: AbortSignal) {
  signal?.throwIfAborted()
  await new Promise(resolve => setTimeout(resolve, 0))
  signal?.throwIfAborted()
}

export function readImageChannels(
  image: HTMLImageElement,
  normalize: true,
  signal?: AbortSignal
): Promise<{ rgb: Float32Array; alpha?: Uint8Array }>
export function readImageChannels(
  image: HTMLImageElement,
  normalize?: false,
  signal?: AbortSignal
): Promise<{ rgb: Uint8Array; alpha?: Uint8Array }>
export async function readImageChannels(
  image: HTMLImageElement,
  normalize = false,
  signal?: AbortSignal
): Promise<{ rgb: Uint8Array | Float32Array; alpha?: Uint8Array }> {
  signal?.throwIfAborted()
  const { width, height } = dimensions(image)
  validateDimensions(width, height)
  const pixels = width * height
  const rgb = normalize
    ? new Float32Array(pixels * 3)
    : new Uint8Array(pixels * 3)
  let alpha: Uint8Array | undefined
  await readPixelBatches(
    image,
    width,
    height,
    (data, start) => {
      for (let local = 0; local < data.length / 4; local++) {
        const i = start + local
        const offset = local * 4
        rgb[i] = normalize ? data[offset] / 255 : data[offset]
        rgb[pixels + i] = normalize ? data[offset + 1] / 255 : data[offset + 1]
        rgb[pixels * 2 + i] = normalize
          ? data[offset + 2] / 255
          : data[offset + 2]
        const opacity = data[offset + 3]
        if (!alpha && opacity !== 255) {
          // Opaque images need no extra plane. Earlier pixels are known to be opaque.
          alpha = new Uint8Array(pixels)
          alpha.fill(255, 0, i)
        }
        if (alpha) alpha[i] = opacity
      }
    },
    signal
  )
  return { rgb, alpha }
}

export function readMask(image: PixelSource, signal?: AbortSignal) {
  const { width, height } = dimensions(image)
  return readResizedMask(image, width, height, signal)
}

export async function readResizedMask(
  image: PixelSource,
  width: number,
  height: number,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  validateDimensions(width, height)
  const output = new Uint8Array(width * height)
  await readPixelBatches(
    image,
    width,
    height,
    (data, start) => {
      for (let i = 0; i < data.length / 4; i++) {
        // Match OpenCV's existing white-mask decision, including near-white pixels.
        const gray =
          (4899 * data[i * 4] +
            9617 * data[i * 4 + 1] +
            1868 * data[i * 4 + 2] +
            8192) >>
          14
        output[start + i] = gray === 255 ? 0 : 255
      }
    },
    signal
  )
  return output
}
