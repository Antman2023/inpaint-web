import { imageDataToBlob, withImage } from '../imageResources'
/* eslint-disable no-console */
/* eslint-disable no-plusplus */
import { readImageChannels } from './preprocess'
import { applyResizedAlpha } from './alpha'
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

      // Clamp the row once and advance contiguous source/target indices.
      // All 64 × 64 values are overwritten, including replicated edge padding.
      const sourceLeft = i * tileSizePre - tilePadding
      for (let yt = 0; yt < tileSize; yt++) {
        const yim = Math.max(
          0,
          Math.min(imageH - 1, j * tileSizePre + yt - tilePadding)
        )
        const sourceRow = yim * imageW
        const targetRow = yt * tileSize
        for (let xt = 0; xt < tileSize; xt++) {
          const xim = Math.max(0, Math.min(imageW - 1, sourceLeft + xt))
          const idx = sourceRow + xim
          const target = targetRow + xt
          tileData[target + tileROffset] = data[idx + rOffset]
          tileData[target + tileGOffset] = data[idx + gOffset]
          tileData[target + tileBOffset] = data[idx + bOffset]
        }
      }

      const tile = new ort.Tensor('float32', tileData, [
        1,
        3,
        tileSize,
        tileSize,
      ])
      // Consume the output in a separate callback so the async loop does not
      // retain the previous tile's tensor while awaiting the next inference.
      await session.run({ [session.inputNames[0]]: tile }).then(r => {
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
          results.output.dims.join(',') !==
            `1,3,${outTileSize},${outTileSize}` ||
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

        const output = results.output.data
        for (let y = 0; y < outTileH; y++) {
          let outputIndex =
            ((j * outTileSizePre + y) * outImageW + i * outTileSizePre) * 4
          let sourceIndex =
            (y + tilePadding * 4) * outTileSize + tilePadding * 4
          const end = sourceIndex + outTileW
          for (; sourceIndex < end; sourceIndex++, outputIndex += 4) {
            const red = output[sourceIndex + outTileROffset]
            const green = output[sourceIndex + outTileGOffset]
            const blue = output[sourceIndex + outTileBOffset]
            // Typed-array conversion silently turns NaN/Infinity into black or
            // white. Reject unusable pixels before committing an edited image.
            if (
              !Number.isFinite(red) ||
              !Number.isFinite(green) ||
              !Number.isFinite(blue)
            )
              throw new Error(
                'Upscaling model returned non-finite pixel values'
              )
            outputData[outputIndex] = red * 255
            outputData[outputIndex + 1] = green * 255
            outputData[outputIndex + 2] = blue * 255
            outputData[outputIndex + 3] = 255
          }
        }
      })
      currentTile++
      callback(Math.round(100 * (currentTile / numTiles)))
    }
  }
  signal?.throwIfAborted()
  return new ImageData(outputData, outImageW, outImageH)
}

async function upscalePixels(
  image: HTMLImageElement,
  session: InferenceSession,
  callback: (progress: number) => void,
  onStatus?: (status: UpscaleStatus) => void,
  signal?: AbortSignal
) {
  const { rgb, alpha } = await readImageChannels(image, true, signal)
  const input = new ort.Tensor('float32', rgb, [
    1,
    3,
    image.naturalHeight,
    image.naturalWidth,
  ])
  const result = await tileProc(input, session, callback, onStatus, signal)
  // Only the output and alpha survive into postprocessing; the full RGB input
  // must not remain in the awaiting function's scope during alpha resizing.
  return { result, alpha }
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
        const { result, alpha } = await upscalePixels(
          image,
          session,
          callback,
          onStatus,
          signal
        )
        signal?.throwIfAborted()
        onStatus?.({ stage: 'processing_output' })
        await applyResizedAlpha(result, alpha, width, height, signal)
        return imageDataToBlob(result, signal)
      }),
    signal
  )
}
