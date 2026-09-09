import { loadImage as decodeImage } from '../utils'
/* eslint-disable camelcase */
/* eslint-disable no-plusplus */
import { ensureOpenCV } from './opencv'
import { readRGB, readResizedMask } from './preprocess'
import type { Tensor } from 'onnxruntime-web'
import { getSession, withRuntime, type SessionStage } from './runtime'
// ort.env.debug = true
// ort.env.logLevel = 'verbose'
// ort.env.webgpu.profilingMode = 'default'

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'Anonymous'
  await decodeImage(image, url)
  return image
}

async function loadFileImage(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    return await loadImage(objectUrl)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
function postProcess(uint8Data: Uint8Array, width: number, height: number) {
  const chwToHwcData = new Uint8ClampedArray(width * height * 4)
  const size = width * height

  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      const outputIndex = (h * width + w) * 4
      for (let c = 0; c < 3; c++) {
        // RGB通道
        const chwIndex = c * size + h * width + w
        chwToHwcData[outputIndex + c] = uint8Data[chwIndex]
      }
      chwToHwcData[outputIndex + 3] = 255
    }
  }
  return chwToHwcData
}

function imageDataToDataURL(imageData: ImageData) {
  // 创建 canvas
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height

  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to get canvas context')
    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL()
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export type InpaintStage =
  | SessionStage
  | 'processing_opencv'
  | 'processing_prepare'
  | 'processing_inference'
  | 'processing_output'

async function inpaint(
  imageFile: File | HTMLImageElement,
  maskBase64: string,
  onStage?: (stage: InpaintStage) => void
) {
  onStage?.('processing_model')
  console.time('sessionCreate')
  const [session] = await Promise.all([
    getSession('inpaint', onStage).then(session => {
      onStage?.('processing_opencv')
      return session
    }),
    ensureOpenCV(),
  ])
  console.timeEnd('sessionCreate')
  console.time('preProcess')
  onStage?.('processing_prepare')

  const [originalImg, originalMark] = await Promise.all([
    imageFile instanceof HTMLImageElement
      ? imageFile
      : loadFileImage(imageFile),
    loadImage(maskBase64),
  ])

  const [img, mark] = await Promise.all([
    readRGB(originalImg),
    readResizedMask(
      originalMark,
      originalImg.naturalWidth,
      originalImg.naturalHeight
    ),
  ])

  const imageTensor = new ort.Tensor('uint8', img, [
    1,
    3,
    originalImg.naturalHeight,
    originalImg.naturalWidth,
  ])

  const maskTensor = new ort.Tensor('uint8', mark, [
    1,
    1,
    originalImg.naturalHeight,
    originalImg.naturalWidth,
  ])

  const feed: Record<string, Tensor> = {
    [session.inputNames[0]]: imageTensor,
    [session.inputNames[1]]: maskTensor,
  }

  console.timeEnd('preProcess')

  console.time('run')
  onStage?.('processing_inference')
  const results = await session.run(feed)
  console.timeEnd('run')

  console.time('postProcess')
  onStage?.('processing_output')
  const outsTensor = results[session.outputNames[0]]
  if (!(outsTensor?.data instanceof Uint8Array)) {
    throw new TypeError('Expected a uint8 output tensor')
  }
  if (
    outsTensor.dims.join(',') !==
      `1,3,${originalImg.naturalHeight},${originalImg.naturalWidth}` ||
    outsTensor.data.length !==
      originalImg.naturalWidth * originalImg.naturalHeight * 3
  ) {
    throw new Error('Unexpected inpainting output shape or data length')
  }
  const chwToHwcData = postProcess(
    outsTensor.data,
    originalImg.naturalWidth,
    originalImg.naturalHeight
  )
  const imageData = new ImageData(
    chwToHwcData,
    originalImg.naturalWidth,
    originalImg.naturalHeight
  )
  const result = imageDataToDataURL(imageData)
  console.timeEnd('postProcess')

  return result
}

export default function run(
  imageFile: File | HTMLImageElement,
  maskBase64: string,
  onStage?: (stage: InpaintStage) => void,
  signal?: AbortSignal
) {
  return withRuntime(async () => {
    return inpaint(imageFile, maskBase64, onStage)
  }, signal)
}
