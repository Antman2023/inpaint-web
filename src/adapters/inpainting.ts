import { imageDataToBlob, withImage } from '../imageResources'
import { readImageChannels, readResizedMask } from './preprocess'
import {
  getSession,
  withRuntime,
  type SessionStage,
  type ModelProgress,
} from './runtime'
import { planarToImageData } from './postprocess'
import type { InferenceSession } from 'onnxruntime-web'

export type InpaintStage =
  | SessionStage
  | 'processing_prepare'
  | 'processing_inference'
  | 'processing_output'

async function inpaintPixels(
  image: HTMLImageElement,
  mask: HTMLCanvasElement | HTMLImageElement,
  session: InferenceSession,
  onStage?: (stage: InpaintStage) => void,
  signal?: AbortSignal
) {
  const { naturalWidth: width, naturalHeight: height } = image
  const { rgb, alpha } = await readImageChannels(image, false, signal)
  const selection = await readResizedMask(mask, width, height, signal)
  const feed = {
    [session.inputNames[0]]: new ort.Tensor('uint8', rgb, [
      1,
      3,
      height,
      width,
    ]),
    [session.inputNames[1]]: new ort.Tensor('uint8', selection, [
      1,
      1,
      height,
      width,
    ]),
  }
  onStage?.('processing_inference')
  // Give the browser a chance to paint status and deliver cancellation.
  await new Promise(resolve => setTimeout(resolve, 16))
  signal?.throwIfAborted()
  const results = await session.run(feed)
  // Drop RGB and mask inputs before the asynchronous output conversion.
  return { output: results[session.outputNames[0]], alpha }
}

export default function run(
  source: File | HTMLImageElement,
  mask: HTMLCanvasElement | HTMLImageElement,
  onStage?: (stage: InpaintStage) => void,
  signal?: AbortSignal,
  onModelProgress?: (status: ModelProgress) => void
): Promise<Blob> {
  return withRuntime(
    () =>
      withImage(source, signal, async image => {
        const session = await getSession(
          'inpaint',
          onStage,
          signal,
          onModelProgress
        )
        signal?.throwIfAborted()
        onStage?.('processing_prepare')
        const { naturalWidth: width, naturalHeight: height } = image
        const { output, alpha } = await inpaintPixels(
          image,
          mask,
          session,
          onStage,
          signal
        )
        // Do not race active inference: the runtime lock must outlive session.run.
        signal?.throwIfAborted()
        onStage?.('processing_output')
        if (!(output?.data instanceof Uint8Array))
          throw new TypeError('Expected a uint8 output tensor')
        if (
          output.dims.join(',') !== `1,3,${height},${width}` ||
          output.data.length !== width * height * 3
        )
          throw new Error('Unexpected inpainting output shape or data length')
        const result = await planarToImageData(
          output.data,
          alpha,
          width,
          height,
          signal
        )
        return imageDataToBlob(result, signal)
      }),
    signal
  )
}
