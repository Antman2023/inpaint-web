import { useCallback, useEffect, useState } from 'react'
import { waitForAbort } from './cancellation'

async function normalizeImageType(file: File, signal?: AbortSignal) {
  // File.type comes from metadata, often the extension rather than the bytes.
  // Decode validation is still performed by the browser before this check.
  if (file.size < 12) return file
  const header = new Uint8Array(
    await waitForAbort(file.slice(0, 12).arrayBuffer(), signal)
  )
  let type = file.type
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte))
    type = 'image/png'
  else if (header[0] === 255 && header[1] === 216 && header[2] === 255)
    type = 'image/jpeg'
  else if (
    [82, 73, 70, 70].every((byte, i) => header[i] === byte) &&
    [87, 69, 66, 80].every((byte, i) => header[i + 8] === byte)
  )
    type = 'image/webp'
  return type === file.type
    ? file
    : new File([file], imageFileName(file.name, type), {
        type,
        lastModified: file.lastModified,
      })
}

export function imageFileName(name: string, mime: string, edited = false) {
  const extension = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  }[mime]
  if (!extension) return name
  const dot = name.lastIndexOf('.')
  const hasExtension = dot > 0
  const currentExtension = hasExtension ? name.slice(dot + 1).toLowerCase() : ''
  if (
    !edited &&
    (currentExtension === extension ||
      (mime === 'image/jpeg' && currentExtension === 'jpeg'))
  ) {
    return name
  }
  const base = (hasExtension ? name.slice(0, dot) : name) || 'image'
  return `${base}${edited ? '-edited' : ''}.${extension}`
}

export function downloadImage(uri: string, name: string) {
  const link = document.createElement('a')
  link.href = uri
  link.download = name

  link.hidden = true
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
  }
}

function abortReason(signal?: AbortSignal) {
  return (
    signal?.reason ?? new DOMException('Image loading cancelled', 'AbortError')
  )
}

export function loadImage(
  image: HTMLImageElement,
  src: string,
  signal?: AbortSignal
) {
  if (signal?.aborted) return Promise.reject(abortReason(signal))
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      image.removeAttribute('src')
      reject(abortReason(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    image.onload = () => {
      cleanup()
      resolve()
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('Unable to decode image'))
    }
    try {
      image.src = src
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export function useImage(
  file: Blob
): [HTMLImageElement, boolean, Error | undefined, () => void] {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    file: Blob
    attempt: number
    image: HTMLImageElement
    loaded: boolean
    error?: Error
  }>(() => ({ file, attempt, image: new Image(), loaded: false }))
  const retry = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    const image = new Image()
    let objectUrl: string | undefined
    const release = () => {
      image.removeAttribute('src')
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
      objectUrl = undefined
    }
    const controller = new AbortController()
    let active = true
    const timeout = setTimeout(
      () => controller.abort(new Error('Image loading timed out')),
      30_000
    )
    setState({ file, attempt, image, loaded: false })
    void Promise.resolve()
      .then(() => {
        // URL allocation can throw before decoding starts. Keep it in the same
        // retryable error path, and avoid allocation after effect cleanup.
        controller.signal.throwIfAborted()
        objectUrl = URL.createObjectURL(file)
        return loadImage(image, objectUrl, controller.signal)
      })
      .then(() => {
        if (!image.naturalWidth || !image.naturalHeight) {
          throw new Error('Image has invalid dimensions')
        }
        if (active) setState({ file, attempt, image, loaded: true })
      })
      .catch(error => {
        release()
        if (active) {
          setState({
            file,
            attempt,
            image,
            loaded: false,
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      })
      .finally(() => clearTimeout(timeout))

    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
      release()
    }
  }, [file, attempt])

  const current = state.file === file && state.attempt === attempt
  return [
    state.image,
    current && state.loaded,
    current ? state.error : undefined,
    retry,
  ]
}

// https://stackoverflow.com/questions/23945494/use-html5-to-resize-an-image-before-upload
interface ResizeImageFileResult {
  file: File
  resized: boolean
  originalWidth?: number
  originalHeight?: number
}
export async function resizeImageFile(
  file: File,
  maxSize: number,
  signal?: AbortSignal
): Promise<ResizeImageFileResult> {
  if (signal?.aborted) throw abortReason(signal)
  if (!Number.isFinite(maxSize) || maxSize < 1) {
    throw new Error('Invalid maximum image size')
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image')
  }
  const image = new Image()
  const objectUrl = URL.createObjectURL(file)
  let canvas: HTMLCanvasElement | undefined
  try {
    await loadImage(image, objectUrl, signal)
    if (signal?.aborted) throw abortReason(signal)
    const { naturalWidth: width, naturalHeight: height } = image
    if (!width || !height) throw new Error('Image has invalid dimensions')
    file = await normalizeImageType(file, signal)
    if (signal?.aborted) throw abortReason(signal)
    const scale = Math.min(1, maxSize / Math.max(width, height))
    if (scale === 1) {
      return { file, resized: false }
    }

    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('could not get context')
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const outputType =
      file.type === 'image/png' || file.type === 'image/webp'
        ? file.type
        : 'image/jpeg'
    const resizeCanvas = canvas
    const blob = await new Promise<Blob>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      const onAbort = () => {
        cleanup()
        reject(abortReason(signal))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        resizeCanvas.toBlob(result => {
          cleanup()
          if (signal?.aborted) reject(abortReason(signal))
          else if (result) resolve(result)
          else reject(new Error('Unable to encode image'))
        }, outputType)
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
    if (signal?.aborted) throw abortReason(signal)
    const f = new File([blob], imageFileName(file.name, blob.type), {
      type: blob.type,
    })
    return {
      file: f,
      resized: true,
      originalWidth: width,
      originalHeight: height,
    }
  } finally {
    image.onload = null
    image.onerror = null
    image.removeAttribute('src')
    URL.revokeObjectURL(objectUrl)
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
