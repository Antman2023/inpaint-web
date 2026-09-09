import { imageDataToBlob, withImage } from '../imageResources'
import { readRGB, readResizedMask } from './preprocess'
import { getSession, withRuntime, type SessionStage } from './runtime'

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

export type InpaintStage =
  | SessionStage
  | 'processing_prepare'
  | 'processing_inference'
  | 'processing_output'

export default function run(
  source: File | HTMLImageElement,
  mask: HTMLCanvasElement | HTMLImageElement,
  onStage?: (stage: InpaintStage) => void,
  signal?: AbortSignal
): Promise<Blob> {
  return withRuntime(
    () =>
      withImage(source, signal, async image => {
        const session = await getSession('inpaint', onStage, signal)
        signal?.throwIfAborted()
        onStage?.('processing_prepare')
        const { naturalWidth: width, naturalHeight: height } = image
        const rgb = readRGB(image)
        const selection = readResizedMask(mask, width, height)
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
        // Do not race active inference: the runtime lock must outlive session.run.
        signal?.throwIfAborted()
        onStage?.('processing_output')
        const output = results[session.outputNames[0]]
        if (!(output?.data instanceof Uint8Array))
          throw new TypeError('Expected a uint8 output tensor')
        if (
          output.dims.join(',') !== `1,3,${height},${width}` ||
          output.data.length !== width * height * 3
        )
          throw new Error('Unexpected inpainting output shape or data length')
        return imageDataToBlob(
          new ImageData(postProcess(output.data, width, height), width, height),
          signal
        )
      }),
    signal
  )
}
