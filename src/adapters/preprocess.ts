import type { Mat } from 'opencv-ts'
import cv from './opencv'

export function readRGB(image: HTMLImageElement, normalize: true): Float32Array
export function readRGB(image: HTMLImageElement, normalize?: false): Uint8Array
export function readRGB(
  image: HTMLImageElement,
  normalize = false
): Float32Array | Uint8Array {
  let source: Mat | undefined
  let rgb: Mat | undefined
  let canvas: HTMLCanvasElement | undefined
  try {
    // OpenCV's image reader uses display dimensions. Keep model input at
    // its decoded resolution even if the element has width/height attributes.
    if (
      image.width !== image.naturalWidth ||
      image.height !== image.naturalHeight
    ) {
      canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Unable to get canvas context')
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    }
    source = cv.imread(canvas ?? image)
    rgb = new cv.Mat()
    cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB)
    const pixels = rgb.rows * rgb.cols
    const data = rgb.data
    const output = normalize
      ? new Float32Array(pixels * 3)
      : new Uint8Array(pixels * 3)
    // Read interleaved RGB directly instead of allocating a matrix per channel.
    for (let i = 0; i < pixels; i++) {
      if (normalize) {
        output[i] = data[i * 3] / 255
        output[pixels + i] = data[i * 3 + 1] / 255
        output[pixels * 2 + i] = data[i * 3 + 2] / 255
      } else {
        output[i] = data[i * 3]
        output[pixels + i] = data[i * 3 + 1]
        output[pixels * 2 + i] = data[i * 3 + 2]
      }
    }
    return output
  } finally {
    rgb?.delete()
    source?.delete()
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}

export function readMask(image: HTMLImageElement | HTMLCanvasElement) {
  let source: Mat | undefined
  let gray: Mat | undefined
  try {
    source = cv.imread(image)
    gray = new cv.Mat()
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY)
    const output = new Uint8Array(gray.rows * gray.cols)
    const data = gray.data
    for (let i = 0; i < output.length; i++) {
      output[i] = data[i] === 255 ? 0 : 255
    }
    return output
  } finally {
    gray?.delete()
    source?.delete()
  }
}

export function readResizedMask(
  image: HTMLImageElement,
  width: number,
  height: number
) {
  const canvas = document.createElement('canvas')
  try {
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to get canvas context')
    ctx.drawImage(image, 0, 0, width, height)
    // Read pixels directly instead of encoding and decoding a temporary PNG.
    return readMask(canvas)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
