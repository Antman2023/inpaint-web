import { loadImage } from './utils'

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  signal?: AbortSignal
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      cleanup()
      reject(error)
    }
    const abort = () => fail(signal?.reason)
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    timeout = setTimeout(
      () => fail(new Error('Image encoding timed out')),
      30_000
    )
    try {
      canvas.toBlob(blob => {
        if (settled) return
        if (!blob) {
          fail(new Error('Unable to encode image'))
          return
        }
        cleanup()
        resolve(blob)
      }, 'image/png')
    } catch (error) {
      fail(error)
    }
  })
}

export async function imageDataToBlob(data: ImageData, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const canvas = document.createElement('canvas')
  try {
    canvas.width = data.width
    canvas.height = data.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to get canvas context')
    ctx.putImageData(data, 0, 0)
    const blob = await canvasToBlob(canvas, signal)
    signal?.throwIfAborted()
    return blob
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function withImage<T>(
  source: File | HTMLImageElement,
  signal: AbortSignal | undefined,
  task: (image: HTMLImageElement) => Promise<T>
) {
  signal?.throwIfAborted()
  if (source instanceof HTMLImageElement) return task(source)
  const image = new Image()
  const url = URL.createObjectURL(source)
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error('Image loading timed out')),
    30_000
  )
  try {
    await loadImage(image, url, controller.signal)
    clearTimeout(timeout)
    signal?.throwIfAborted()
    return await task(image)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    controller.abort()
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}

export interface HistoryEntry {
  id: number
  image: HTMLImageElement
  url: string
  thumbnail: string
  bytes: number
}

export function releaseEntry(entry: HistoryEntry) {
  entry.image.removeAttribute('src')
  URL.revokeObjectURL(entry.url)
  URL.revokeObjectURL(entry.thumbnail)
}

export async function createHistoryEntry(
  blob: Blob,
  id: number,
  signal: AbortSignal
): Promise<HistoryEntry> {
  signal.throwIfAborted()
  const image = new Image()
  const canvas = document.createElement('canvas')
  const url = URL.createObjectURL(blob)
  let thumbnail: string | undefined
  let committed = false
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error('Image loading timed out')),
    30_000
  )
  try {
    await loadImage(image, url, controller.signal)
    clearTimeout(timeout)
    signal.throwIfAborted()
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('Image has invalid dimensions')
    const scale = Math.min(
      1,
      224 / image.naturalWidth,
      180 / image.naturalHeight
    )
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to get canvas context')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const small = await canvasToBlob(canvas, signal)
    signal.throwIfAborted()
    thumbnail = URL.createObjectURL(small)
    const entry = {
      id,
      image,
      url,
      thumbnail,
      bytes:
        blob.size +
        small.size +
        4 *
          (image.naturalWidth * image.naturalHeight +
            canvas.width * canvas.height),
    }
    committed = true
    return entry
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    controller.abort()
    canvas.width = 0
    canvas.height = 0
    if (!committed) {
      image.removeAttribute('src')
      URL.revokeObjectURL(url)
      if (thumbnail) URL.revokeObjectURL(thumbnail)
    }
  }
}
