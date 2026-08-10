/* eslint-disable camelcase */
/* eslint-disable no-plusplus */
import cv, { type Mat } from 'opencv-ts'
import type { InferenceSession, Tensor } from 'onnxruntime-web'
import { ensureModel } from './cache'
import { type Capabilities, getCapabilities } from './util'
// ort.env.debug = true
// ort.env.logLevel = 'verbose'
// ort.env.webgpu.profilingMode = 'default'

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image from ${url}`))
    img.src = url
  })
}

async function loadFileImage(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    return await loadImage(objectUrl)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
function imgProcess(img: Mat) {
  const channels = new cv.MatVector()
  cv.split(img, channels) // 分割通道

  const C = channels.size() // 通道数
  const H = img.rows // 图像高度
  const W = img.cols // 图像宽度

  const chwArray = new Uint8Array(C * H * W) // 创建新的数组来存储转换后的数据

  for (let c = 0; c < C; c++) {
    const channelData = channels.get(c).data // 获取单个通道的数据
    for (let h = 0; h < H; h++) {
      for (let w = 0; w < W; w++) {
        chwArray[c * H * W + h * W + w] = channelData[h * W + w]
        // chwArray[c * H * W + h * W + w] = channelData[h * W + w]
      }
    }
  }

  channels.delete() // 清理内存
  return chwArray // 返回转换后的数据
}
function markProcess(img: Mat) {
  const channels = new cv.MatVector()
  cv.split(img, channels) // 分割通道

  const C = 1 // 通道数
  const H = img.rows // 图像高度
  const W = img.cols // 图像宽度

  const chwArray = new Uint8Array(C * H * W) // 创建新的数组来存储转换后的数据

  for (let c = 0; c < C; c++) {
    const channelData = channels.get(0).data // 获取单个通道的数据
    for (let h = 0; h < H; h++) {
      for (let w = 0; w < W; w++) {
        chwArray[c * H * W + h * W + w] =
          channelData[h * W + w] === 255 ? 0 : 255
      }
    }
  }

  channels.delete() // 清理内存
  return chwArray // 返回转换后的数据
}
function processImage(
  img: HTMLImageElement,
  canvasId?: string
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let src: Mat | undefined
    let srcRgb: Mat | undefined
    try {
      src = cv.imread(img)
      srcRgb = new cv.Mat()
      // 将图像从RGBA转换为RGB
      cv.cvtColor(src, srcRgb, cv.COLOR_RGBA2RGB)
      if (canvasId) {
        cv.imshow(canvasId, srcRgb)
      }
      resolve(imgProcess(srcRgb))
    } catch (error) {
      reject(error)
    } finally {
      src?.delete()
      srcRgb?.delete()
    }
  })
}

function processMark(
  img: HTMLImageElement,
  canvasId?: string
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let src: Mat | undefined
    let srcGrey: Mat | undefined
    try {
      src = cv.imread(img)
      srcGrey = new cv.Mat()

      // 将图像从RGBA转换为二值化
      cv.cvtColor(src, srcGrey, cv.COLOR_BGR2GRAY)

      if (canvasId) {
        cv.imshow(canvasId, srcGrey)
      }

      resolve(markProcess(srcGrey))
    } catch (error) {
      reject(error)
    } finally {
      src?.delete()
      srcGrey?.delete()
    }
  })
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

  // 绘制 imageData 到 canvas
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Unable to get canvas context')
  }
  ctx.putImageData(imageData, 0, 0)

  // 导出为数据 URL
  return canvas.toDataURL()
}

function configEnv(capabilities: Capabilities) {
  ort.env.wasm.wasmPaths =
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/'
  if (capabilities.webgpu) {
    ort.env.wasm.numThreads = 1
  } else {
    if (capabilities.threads) {
      ort.env.wasm.numThreads = navigator.hardwareConcurrency ?? 4
    }
    if (capabilities.simd) {
      ort.env.wasm.simd = true
    }
    ort.env.wasm.proxy = true
  }
  console.log('env', ort.env.wasm)
}
const resizeMark = (
  image: HTMLImageElement,
  width: number,
  height: number
): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    // 将图片绘制到canvas上，并调整大小
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Unable to get canvas context'))
      return
    }
    ctx.drawImage(image, 0, 0, width, height)

    // 获取调整大小后的图片URL
    const resizedImageUrl = canvas.toDataURL()

    // 创建一个新的Image对象并设置其src为调整大小后的图片URL
    const resizedImage = new Image()
    resizedImage.onload = () => resolve(resizedImage)
    resizedImage.onerror = () =>
      reject(new Error('Failed to load resized image'))
    resizedImage.src = resizedImageUrl
  })
}
let model: InferenceSession | null = null
export default async function inpaint(
  imageFile: File | HTMLImageElement,
  maskBase64: string
) {
  console.time('sessionCreate')
  let session = model
  if (!session) {
    const capabilities = await getCapabilities()
    configEnv(capabilities)
    const modelBuffer = await ensureModel('inpaint')
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: [capabilities.webgpu ? 'webgpu' : 'wasm'],
    })
    model = session
  }
  console.timeEnd('sessionCreate')
  console.time('preProcess')

  const [originalImg, originalMark] = await Promise.all([
    imageFile instanceof HTMLImageElement
      ? imageFile
      : loadFileImage(imageFile),
    loadImage(maskBase64),
  ])

  const [img, mark] = await Promise.all([
    processImage(originalImg),
    processMark(
      await resizeMark(originalMark, originalImg.width, originalImg.height)
    ),
  ])

  const imageTensor = new ort.Tensor('uint8', img, [
    1,
    3,
    originalImg.height,
    originalImg.width,
  ])

  const maskTensor = new ort.Tensor('uint8', mark, [
    1,
    1,
    originalImg.height,
    originalImg.width,
  ])

  const feed: Record<string, Tensor> = {
    [session.inputNames[0]]: imageTensor,
    [session.inputNames[1]]: maskTensor,
  }

  console.timeEnd('preProcess')

  console.time('run')
  const results = await session.run(feed)
  console.timeEnd('run')

  console.time('postProcess')
  const outsTensor = results[session.outputNames[0]]
  if (!(outsTensor.data instanceof Uint8Array)) {
    throw new TypeError('Expected a uint8 output tensor')
  }
  const chwToHwcData = postProcess(
    outsTensor.data,
    originalImg.width,
    originalImg.height
  )
  const imageData = new ImageData(
    chwToHwcData,
    originalImg.width,
    originalImg.height
  )
  console.log(imageData, 'imageData')
  const result = imageDataToDataURL(imageData)
  console.timeEnd('postProcess')

  return result
}
