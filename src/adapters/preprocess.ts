type PixelSource = HTMLImageElement | HTMLCanvasElement

function dimensions(image: PixelSource) {
  return 'naturalWidth' in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height }
}

function readPixels(image: PixelSource, width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error('Image has invalid dimensions')
  const canvas = document.createElement('canvas')
  try {
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to get canvas context')
    ctx.drawImage(image, 0, 0, width, height)
    return ctx.getImageData(0, 0, width, height).data
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export function readRGB(image: HTMLImageElement, normalize: true): Float32Array
export function readRGB(image: HTMLImageElement, normalize?: false): Uint8Array
export function readRGB(
  image: HTMLImageElement,
  normalize = false
): Float32Array | Uint8Array {
  const { width, height } = dimensions(image)
  const data = readPixels(image, width, height)
  const pixels = width * height
  const output = normalize
    ? new Float32Array(pixels * 3)
    : new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    output[i] = normalize ? data[i * 4] / 255 : data[i * 4]
    output[pixels + i] = normalize ? data[i * 4 + 1] / 255 : data[i * 4 + 1]
    output[pixels * 2 + i] = normalize ? data[i * 4 + 2] / 255 : data[i * 4 + 2]
  }
  return output
}

export function readMask(image: PixelSource) {
  const { width, height } = dimensions(image)
  return readResizedMask(image, width, height)
}

export function readResizedMask(
  image: PixelSource,
  width: number,
  height: number
) {
  const data = readPixels(image, width, height)
  const output = new Uint8Array(width * height)
  for (let i = 0; i < output.length; i++) {
    // Match OpenCV's existing white-mask decision, including near-white pixels.
    const gray =
      (4899 * data[i * 4] +
        9617 * data[i * 4 + 1] +
        1868 * data[i * 4 + 2] +
        8192) >>
      14
    output[i] = gray === 255 ? 0 : 255
  }
  return output
}
