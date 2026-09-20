// Run from the Vite development server; no models or editor state are needed.
import {
  readImageChannels,
  readResizedMask,
} from '../src/adapters/preprocess.ts'

export async function runPreprocessSmoke() {
  const source = document.createElement('canvas')
  const reference = document.createElement('canvas')
  const image = new Image()
  const width = 1021,
    height = 1023,
    pixels = width * height
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  try {
    source.width = 257
    source.height = 259
    const ctx = source.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 257, 259)
    gradient.addColorStop(0, 'rgba(13,35,177,.2)')
    gradient.addColorStop(0.5, 'white')
    gradient.addColorStop(1, 'rgba(221,51,19,.8)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 257, 259)
    ctx.fillStyle = 'white'
    ctx.fillRect(64, 64, 100, 100)
    reference.width = width
    reference.height = height
    const ref = reference.getContext('2d', { willReadFrequently: false })
    ref.drawImage(source, 0, 0, width, height)
    const maskPixels = ref.getImageData(0, 0, width, height).data
    const mask = await readResizedMask(source, width, height)
    for (let i = 0; i < pixels; i++) {
      const offset = i * 4
      const gray =
        (4899 * maskPixels[offset] +
          9617 * maskPixels[offset + 1] +
          1868 * maskPixels[offset + 2] +
          8192) >>
        14
      assert(mask[i] === (gray === 255 ? 0 : 255), `Mask differs at pixel ${i}`)
    }
    image.src = reference.toDataURL()
    await image.decode()
    // Start with a fresh backing store, matching the production draw exactly.
    reference.width = width
    ref.drawImage(image, 0, 0, width, height)
    const rgba = ref.getImageData(0, 0, width, height).data
    for (const normalize of [false, true]) {
      const result = await readImageChannels(image, normalize)
      for (let i = 0; i < pixels; i++) {
        for (let c = 0; c < 3; c++) {
          const value = rgba[i * 4 + c]
          const expected = normalize ? Math.fround(value / 255) : value
          assert(
            result.rgb[c * pixels + i] === expected,
            `RGB differs at pixel ${i}, channel ${c}, normalized=${normalize}`
          )
        }
        assert(
          (result.alpha?.[i] ?? 255) === rgba[i * 4 + 3],
          `Opacity differs at pixel ${i}`
        )
      }
    }
    return { pixelsChecked: pixels, rgbModes: 2, scaledMask: 'passed' }
  } finally {
    image.removeAttribute('src')
    source.width = source.height = reference.width = reference.height = 0
  }
}
