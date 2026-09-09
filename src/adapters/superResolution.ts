import { imageDataToBlob, withImage } from '../imageResources'
/* eslint-disable no-console */
/* eslint-disable no-plusplus */
import { readRGB } from './preprocess'
import type { InferenceSession, Tensor } from 'onnxruntime-web'
import { getSession, withRuntime, type SessionStage } from './runtime'
import { getUpscalePlan } from '../imageSize'
import { message } from '../i18n'

export type UpscaleStage =
  SessionStage | 'processing_prepare' | 'processing_output'
export interface UpscaleStatus {
  stage?: UpscaleStage
  tile?: number
  total?: number
}

export async function tileProc(
  inputTensor: Tensor,
  session: InferenceSession,
  callback: (progress: number) => void,
  onStatus?: (status: UpscaleStatus) => void,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const inputDims = inputTensor.dims
  const imageW = inputDims[3]
  const imageH = inputDims[2]
  if (
    inputDims.length !== 4 ||
    inputDims[0] !== 1 ||
    inputDims[1] !== 3 ||
    !Number.isInteger(imageW) ||
    !Number.isInteger(imageH) ||
    imageW < 1 ||
    imageH < 1
  ) {
    throw new Error('Expected a positive 1 × 3 × height × width input shape')
  }
  const { data } = inputTensor
  if (!(data instanceof Float32Array)) {
    throw new TypeError('Expected a float32 input tensor')
  }
  if (data.length !== imageW * imageH * 3) {
    throw new Error('Input tensor data length does not match its shape')
  }
  const plan = getUpscalePlan(imageW, imageH)
  if (!plan.ok) throw new Error(message(plan.reason))

  const rOffset = 0
  const gOffset = imageW * imageH
  const bOffset = imageW * imageH * 2

  const outImageW = plan.width
  const outImageH = plan.height
  const outputData = new Uint8ClampedArray(outImageW * outImageH * 4)

  const tileSize = 64
  const tilePadding = 6
  const tileSizePre = tileSize - tilePadding * 2

  const tilesx = Math.ceil(inputDims[3] / tileSizePre)
  const tilesy = Math.ceil(inputDims[2] / tileSizePre)

  const numTiles = tilesx * tilesy
  let currentTile = 0
  const tileData = new Float32Array(tileSize * tileSize * 3)

  for (let i = 0; i < tilesx; i++) {
    for (let j = 0; j < tilesy; j++) {
      signal?.throwIfAborted()
      onStatus?.({ tile: currentTile + 1, total: numTiles })
      // WASM inference can occupy the main thread. Paint status before each tile.
      await new Promise(resolve => setTimeout(resolve, 16))
      signal?.throwIfAborted()
      const tileW = Math.min(tileSizePre, imageW - i * tileSizePre)
      const tileH = Math.min(tileSizePre, imageH - j * tileSizePre)
      const tileROffset = 0
      const tileGOffset = tileSize * tileSize
      const tileBOffset = tileSize * tileSize * 2

      // padding tile 转移到上面的数据上
      for (let yp = -tilePadding; yp < tileSizePre + tilePadding; yp++) {
        for (let xp = -tilePadding; xp < tileSizePre + tilePadding; xp++) {
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
      const r = await session.run({ [session.inputNames[0]]: tile })
      signal?.throwIfAborted()
      const results = {
        output: r[session.outputNames[0]],
      }
      if (!(results.output?.data instanceof Float32Array)) {
        throw new TypeError('Expected a float32 output tensor')
      }

      const outTileW = tileW * 4
      const outTileH = tileH * 4
      const outTileSize = tileSize * 4
      if (
        results.output.dims.join(',') !== `1,3,${outTileSize},${outTileSize}` ||
        results.output.data.length !== 3 * outTileSize * outTileSize
      ) {
        throw new Error(
          `Unexpected 4x model output shape or data length: ${results.output.dims.join(' × ')}`
        )
      }
      const outTileSizePre = tileSizePre * 4

      const outTileROffset = 0
      const outTileGOffset = outTileSize * outTileSize
      const outTileBOffset = outTileSize * outTileSize * 2

      // add tile to output，直接输出
      for (let y = 0; y < outTileH; y++) {
        for (let x = 0; x < outTileW; x++) {
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
      callback(Math.round(100 * (currentTile / numTiles)))
    }
  }
  signal?.throwIfAborted()
  return new ImageData(outputData, outImageW, outImageH)
}
export default function run(
  source: File | HTMLImageElement,
  callback: (progress: number) => void,
  onStatus?: (status: UpscaleStatus) => void,
  signal?: AbortSignal
): Promise<Blob> {
  return withRuntime(
    () =>
      withImage(source, signal, async image => {
        const { naturalWidth: width, naturalHeight: height } = image
        const plan = getUpscalePlan(width, height)
        if (!plan.ok) throw new Error(message(plan.reason))
        const session = await getSession(
          'superResolution',
          stage => onStatus?.({ stage }),
          signal
        )
        signal?.throwIfAborted()
        onStatus?.({ stage: 'processing_prepare' })
        const input = new ort.Tensor('float32', readRGB(image, true), [
          1,
          3,
          height,
          width,
        ])
        const result = await tileProc(
          input,
          session,
          callback,
          onStatus,
          signal
        )
        signal?.throwIfAborted()
        onStatus?.({ stage: 'processing_output' })
        return imageDataToBlob(result, signal)
      }),
    signal
  )
}
