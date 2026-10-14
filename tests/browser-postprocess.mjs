// Run from Vite; exercises real ImageData without downloading AI models.
import { planarToImageData } from '../src/adapters/postprocess.ts'
import { applyResizedAlpha } from '../src/adapters/alpha.ts'

export async function runPostprocessSmoke() {
  const width = 1021,
    height = 1023,
    pixels = width * height
  const rgb = new Uint8Array(pixels * 3)
  const alpha = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    rgb[i] = i % 256
    rgb[pixels + i] = (i * 3 + 17) % 256
    rgb[pixels * 2 + i] = (i * 7 + 91) % 256
    alpha[i] = (i * 11) % 256
  }
  for (const opacity of [undefined, alpha]) {
    const result = await planarToImageData(rgb, opacity, width, height)
    if (result.width !== width || result.height !== height)
      throw new Error('Output dimensions changed')
    for (let i = 0; i < pixels; i++) {
      const offset = i * 4
      if (
        result.data[offset] !== i % 256 ||
        result.data[offset + 1] !== (i * 3 + 17) % 256 ||
        result.data[offset + 2] !== (i * 7 + 91) % 256 ||
        result.data[offset + 3] !== (opacity ? (i * 11) % 256 : 255)
      )
        throw new Error(`Converted RGBA differs at pixel ${i}`)
    }
  }

  const sourceWidth = 257,
    sourceHeight = 259,
    outputWidth = sourceWidth * 4,
    outputHeight = sourceHeight * 4
  const sourceAlpha = Uint8Array.from(
    { length: sourceWidth * sourceHeight },
    (_, i) => (i * 13 + 31) % 256
  )
  const result = new ImageData(outputWidth, outputHeight)
  result.data.fill(73)
  await applyResizedAlpha(result, sourceAlpha, sourceWidth, sourceHeight)
  // Independent pixel-center reference, including both axes and clamped edges.
  const expected = new Uint8ClampedArray(1)
  for (let y = 0; y < outputHeight; y++) {
    const sy = Math.max(0, Math.min(sourceHeight - 1, (y + 0.5) / 4 - 0.5))
    const top = Math.floor(sy),
      bottom = Math.min(sourceHeight - 1, top + 1),
      fy = sy - top
    for (let x = 0; x < outputWidth; x++) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, (x + 0.5) / 4 - 0.5))
      const left = Math.floor(sx),
        right = Math.min(sourceWidth - 1, left + 1),
        fx = sx - left
      const a =
        sourceAlpha[top * sourceWidth + left] * (1 - fx) +
        sourceAlpha[top * sourceWidth + right] * fx
      const b =
        sourceAlpha[bottom * sourceWidth + left] * (1 - fx) +
        sourceAlpha[bottom * sourceWidth + right] * fx
      // Uint8ClampedArray preserves the browser's rounding at half values.
      expected[0] = a * (1 - fy) + b * fy
      const offset = (y * outputWidth + x) * 4
      if (
        result.data[offset] !== 73 ||
        result.data[offset + 1] !== 73 ||
        result.data[offset + 2] !== 73 ||
        result.data[offset + 3] !== expected[0]
      )
        throw new Error(`Scaled RGBA differs at ${x}, ${y}`)
    }
  }
  return {
    convertedPixels: pixels,
    opacityModes: 2,
    scaledPixels: outputWidth * outputHeight,
    status: 'passed',
  }
}
