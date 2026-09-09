/* eslint-disable no-console */
/* eslint-disable no-plusplus */
import cv, { type Mat } from 'opencv-ts'
import type { InferenceSession, Tensor } from 'onnxruntime-web'
import { getSession, withRuntime } from './runtime'

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

  const chwArray = new Float32Array(C * H * W) // 创建新的数组来存储转换后的数据

  for (let c = 0; c < C; c++) {
    const channelData = channels.get(c).data // 获取单个通道的数据
    for (let h = 0; h < H; h++) {
      for (let w = 0; w < W; w++) {
        chwArray[c * H * W + h * W + w] = channelData[h * W + w] / 255.0
        // chwArray[c * H * W + h * W + w] = channelData[h * W + w]
      }
    }
  }

  channels.delete() // 清理内存
  return chwArray // 返回转换后的数据
}
async function tileProc(
  inputTensor: Tensor,
  session: InferenceSession,
  callback: (progress: number) => void
) {
  const inputDims = inputTensor.dims
  const imageW = inputDims[3]
  const imageH = inputDims[2]

  const rOffset = 0
  const gOffset = imageW * imageH
  const bOffset = imageW * imageH * 2

  const outImageW = inputDims[3] * 4
  const outImageH = inputDims[2] * 4
  const outputData = new Uint8ClampedArray(outImageW * outImageH * 4)

  const tileSize = 64
  const tilePadding = 6
  const tileSizePre = tileSize - tilePadding * 2

  const tilesx = Math.ceil(inputDims[3] / tileSizePre)
  const tilesy = Math.ceil(inputDims[2] / tileSizePre)

  const { data } = inputTensor
  if (!(data instanceof Float32Array)) {
    throw new TypeError('Expected a float32 input tensor')
  }

  console.log(inputTensor)
  const numTiles = tilesx * tilesy
  let currentTile = 0

  for (let i = 0; i < tilesx; i++) {
    for (let j = 0; j < tilesy; j++) {
      const ti = Date.now()
      const tileW = Math.min(tileSizePre, imageW - i * tileSizePre)
      const tileH = Math.min(tileSizePre, imageH - j * tileSizePre)
      console.log(`tileW: ${tileW} tileH: ${tileH}`)
      const tileROffset = 0
      const tileGOffset = tileSize * tileSize
      const tileBOffset = tileSize * tileSize * 2

      // padding tile 转移到上面的数据上
      const tileData = new Float32Array(tileSize * tileSize * 3)
      for (let xp = -tilePadding; xp < tileSizePre + tilePadding; xp++) {
        for (let yp = -tilePadding; yp < tileSizePre + tilePadding; yp++) {
          // 计算在data中的一维坐标，防止边缘溢出
          let xim = i * tileSizePre + xp
          if (xim < 0) xim = 0
          else if (xim >= imageW) xim = imageW - 1

          // 计算在data中的一维坐标，防止边缘溢出
          let yim = j * tileSizePre + yp
          if (yim < 0) yim = 0
          else if (yim >= imageH) yim = imageH - 1

          const idx = xim + yim * imageW

          const xt = xp + tilePadding
          const yt = yp + tilePadding
          // const idx = (i * tileSize + x) + (j * tileSize + y) * imageW;
          // 主要转化到一维的坐标上，
          tileData[xt + yt * tileSize + tileROffset] = data[idx + rOffset]
          tileData[xt + yt * tileSize + tileGOffset] = data[idx + gOffset]
          tileData[xt + yt * tileSize + tileBOffset] = data[idx + bOffset]
        }
      }

      const tile = new ort.Tensor('float32', tileData, [
        1,
        3,
        tileSize,
        tileSize,
      ])
      const r = await session.run({ 'input.1': tile })
      const results = {
        output: r['1895'],
      }
      if (!(results.output.data instanceof Float32Array)) {
        throw new TypeError('Expected a float32 output tensor')
      }
      console.log(`pre dims:${results.output.dims}`)

      const outTileW = tileW * 4
      const outTileH = tileH * 4
      const outTileSize = tileSize * 4
      const outTileSizePre = tileSizePre * 4

      const outTileROffset = 0
      const outTileGOffset = outTileSize * outTileSize
      const outTileBOffset = outTileSize * outTileSize * 2

      // add tile to output，直接输出
      for (let x = 0; x < outTileW; x++) {
        for (let y = 0; y < outTileH; y++) {
          const xim = i * outTileSizePre + x
          const yim = j * outTileSizePre + y
          const outputIndex = (xim + yim * outImageW) * 4
          const xt = x + tilePadding * 4
          const yt = y + tilePadding * 4
          outputData[outputIndex] =
            results.output.data[xt + yt * outTileSize + outTileROffset] * 255
          outputData[outputIndex + 1] =
            results.output.data[xt + yt * outTileSize + outTileGOffset] * 255
          outputData[outputIndex + 2] =
            results.output.data[xt + yt * outTileSize + outTileBOffset] * 255
          outputData[outputIndex + 3] = 255
        }
      }
      currentTile++
      const dt = Date.now() - ti
      const remTime = (numTiles - currentTile) * dt
      console.log(
        `tile ${currentTile} of ${numTiles} took ${dt} ms, remaining time: ${remTime} ms`
      )
      callback(Math.round(100 * (currentTile / numTiles)))
    }
  }
  return new ImageData(outputData, outImageW, outImageH)
}
function processImage(
  img: HTMLImageElement,
  canvasId?: string
): Promise<Float32Array> {
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
async function superResolution(
  imageFile: File | HTMLImageElement,
  callback: (progress: number) => void
) {
  const img =
    imageFile instanceof HTMLImageElement
      ? imageFile
      : await loadFileImage(imageFile)
  const outputPixelCount = img.width * 4 * img.height * 4
  if (outputPixelCount > 20_000_000) {
    throw new Error(
      'This image is too large for 4x upscaling in the browser. Use an image smaller than about 1.25 megapixels.'
    )
  }

  console.time('sessionCreate')
  const session = await getSession('superResolution')
  console.timeEnd('sessionCreate')

  const imageTersorData = await processImage(img)
  const imageTensor = new ort.Tensor('float32', imageTersorData, [
    1,
    3,
    img.height,
    img.width,
  ])

  const imageData = await tileProc(imageTensor, session, callback)
  console.time('postProcess')
  console.log(imageData, 'imageData')
  const url = imageDataToDataURL(imageData)
  console.timeEnd('postProcess')

  return url
}

export default function run(...args: Parameters<typeof superResolution>) {
  return withRuntime(() => superResolution(...args))
}
