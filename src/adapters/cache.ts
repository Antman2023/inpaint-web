import { waitForAbort } from '../cancellation'
import { message } from '../i18n'
import localforage from 'localforage'

export type modelType = 'inpaint' | 'superResolution'

localforage.config({
  name: 'modelCache',
})

export async function saveModel(modelType: modelType, modelBlob: ArrayBuffer) {
  await localforage.setItem(getModel(modelType).name, modelBlob)
}

function getModel(modelType: modelType) {
  if (modelType === 'inpaint') {
    const modelList = [
      {
        name: 'model',
        url: 'https://huggingface.co/lxfater/inpaint-web/resolve/main/migan.onnx',
        backupUrl: '',
      },
      {
        name: 'model-perf',
        url: 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan.onnx',
        backupUrl: '',
      },
      {
        name: 'migan-pipeline-v2',
        url: 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
        backupUrl:
          'https://worker-share-proxy-01f5.lxfater.workers.dev/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
      },
    ]
    const currentModel = modelList[2]
    return currentModel
  }
  if (modelType === 'superResolution') {
    const modelList = [
      {
        name: 'realesrgan-x4',
        url: 'https://huggingface.co/lxfater/inpaint-web/resolve/main/realesrgan-x4.onnx',
        backupUrl:
          'https://worker-share-proxy-01f5.lxfater.workers.dev/lxfater/inpaint-web/resolve/main/realesrgan-x4.onnx',
      },
    ]
    const currentModel = modelList[0]
    return currentModel
  }
  throw new Error('wrong modelType')
}

export async function loadModel(
  modelType: modelType
): Promise<ArrayBuffer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const model = await Promise.race([
      localforage.getItem<ArrayBuffer>(getModel(modelType).name),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message('model_cache_read_timeout')))
        }, 30_000)
      }),
    ])
    return model instanceof ArrayBuffer && model.byteLength > 0 ? model : null
  } finally {
    clearTimeout(timer)
  }
}

export async function modelExists(modelType: modelType) {
  const model = await loadModel(modelType)
  return model instanceof ArrayBuffer && model.byteLength > 0
}

export async function removeCachedModel(modelType: modelType) {
  // Let an earlier preload finish before removing its result.
  await pendingDownloads.get(modelType)?.promise.catch(() => {})
  await localforage.removeItem(getModel(modelType).name)
}

export async function ensureModel(
  modelType: modelType,
  onProgress: ProgressListener = () => {}
) {
  // Share both the cache lookup and downloaded bytes with concurrent callers.
  return downloadModel(modelType, onProgress)
}

export type DownloadProgress = number | null
type ProgressListener = (
  progress: DownloadProgress,
  downloading: boolean
) => void

function notifyProgress(
  listener: ProgressListener,
  progress: DownloadProgress,
  downloading: boolean
) {
  try {
    listener(progress, downloading)
  } catch (error) {
    // Observers must not interrupt a download shared by other callers.
    console.error('Model download progress callback failed', error)
  }
}

interface PendingDownload {
  promise: Promise<ArrayBuffer>
  listeners: Set<ProgressListener>
  progress: DownloadProgress
  downloading: boolean
}
const pendingDownloads = new Map<modelType, PendingDownload>()

export async function downloadModel(
  modelType: modelType,
  setDownloadProgress: ProgressListener,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  let pending = pendingDownloads.get(modelType)
  if (!pending) {
    const task: PendingDownload = {
      // Register before starting, so even reentrant observers join this task.
      promise: Promise.resolve()
        .then(() =>
          downloadAndCacheModel(modelType, (progress, downloading) => {
            if (task.progress === progress && task.downloading === downloading)
              return
            task.progress = progress
            task.downloading = downloading
            for (const listener of task.listeners)
              notifyProgress(listener, progress, downloading)
          })
        )
        .finally(() => pendingDownloads.delete(modelType)),
      listeners: new Set<ProgressListener>(),
      progress: null as DownloadProgress,
      downloading: false,
    }
    pendingDownloads.set(modelType, task)
    pending = task
  }
  // Each waiter owns its subscription, even when callers reuse a React setter.
  const listener: ProgressListener = (progress, downloading) =>
    setDownloadProgress(progress, downloading)
  pending.listeners.add(listener)
  try {
    notifyProgress(setDownloadProgress, pending.progress, pending.downloading)
    return await waitForAbort(pending.promise, signal)
  } finally {
    pending.listeners.delete(listener)
  }
}

async function downloadAndCacheModel(
  modelType: modelType,
  setDownloadProgress: ProgressListener
) {
  const cached = await loadModel(modelType)
  if (cached) {
    setDownloadProgress(100, false)
    return cached
  }

  async function downloadFromUrl(url: string) {
    setDownloadProgress(null, true)
    const controller = new AbortController()
    // Track activity without allocating a new timer for every network chunk.
    let lastActivity = performance.now()
    const checkIdle = () => {
      const remaining = 30_000 - (performance.now() - lastActivity)
      if (remaining > 0) timeout = setTimeout(checkIdle, remaining)
      else controller.abort(new Error(message('model_download_timeout')))
    }
    let timeout = setTimeout(checkIdle, 30_000)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let complete = false
    try {
      const response = await fetch(url, { signal: controller.signal })
      reader = response.body?.getReader()
      if (!response.ok) {
        throw new Error(`Model download failed with status ${response.status}`)
      }
      // No Range was requested: a partial response cannot initialize a model.
      if (response.status === 206 || response.headers.has('content-range')) {
        throw new Error('Model download returned a partial response')
      }
      const contentType = response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase()
      if (
        contentType === 'text/html' ||
        contentType === 'application/json' ||
        contentType === 'text/xml' ||
        contentType === 'application/xml' ||
        contentType?.endsWith('+json') ||
        contentType?.endsWith('+xml')
      ) {
        throw new Error(
          `Model download returned ${contentType} instead of a model`
        )
      }
      if (!reader) {
        throw new Error('Model download response has no body')
      }
      const fullSize = Number(response.headers.get('content-length'))
      const encoding = response.headers
        .get('content-encoding')
        ?.trim()
        .toLowerCase()
      // Fetch yields decoded bytes; Content-Length describes the encoded body.
      const hasByteProgress =
        (!encoding || encoding === 'identity') &&
        Number.isSafeInteger(fullSize) &&
        fullSize > 0
      if (hasByteProgress) setDownloadProgress(0, true)
      const total: Array<Uint8Array | undefined> = []
      let downloaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          complete = true
          break
        }

        // Empty chunks are not download progress and must not extend the deadline.
        if (!value?.byteLength) continue
        lastActivity = performance.now()
        downloaded += value.byteLength
        total.push(value)

        if (hasByteProgress) {
          // Match the UI's one decimal place; tiny chunks need no extra renders.
          setDownloadProgress(
            Math.min(99, Math.round((downloaded / fullSize) * 1000) / 10),
            true
          )
        }
      }

      clearTimeout(timeout)
      if (downloaded === 0) throw new Error('Downloaded model is empty')
      const buffer = new Uint8Array(downloaded)
      let offset = 0
      const copyBatchSize = 8 * 1024 * 1024
      let copiedSinceYield = 0
      for (let index = 0; index < total.length; index++) {
        const chunk = total[index]
        // Once copied, a chunk should be collectible during later batches,
        // rather than retained alongside the full assembled model buffer.
        total[index] = undefined
        if (!chunk) continue
        for (let start = 0; start < chunk.length;) {
          // Large responses may arrive as one chunk. Bound copying independently
          // of network chunk size so UI cancellation can detach its waiter.
          if (copiedSinceYield === copyBatchSize) {
            await new Promise(resolve => setTimeout(resolve, 0))
            copiedSinceYield = 0
          }
          const length = Math.min(
            chunk.length - start,
            copyBatchSize - copiedSinceYield
          )
          buffer.set(chunk.subarray(start, start + length), offset)
          start += length
          offset += length
          copiedSinceYield += length
        }
      }

      return buffer.buffer
    } catch (error) {
      // Body readers may reject with a generic AbortError instead of the reason.
      if (controller.signal.aborted) throw controller.signal.reason
      throw error
    } finally {
      clearTimeout(timeout)
      controller.abort()
      // Release rejected response bodies as well as interrupted model streams.
      // Do not wait for a remote cancellation acknowledgement before fallback.
      if (!complete) void reader?.cancel().catch(() => {})
      reader?.releaseLock()
    }
  }

  const model = getModel(modelType)
  const urls = [model.url, model.backupUrl].filter(Boolean)
  const errors: unknown[] = []
  for (const url of urls) {
    let buffer: ArrayBuffer
    try {
      buffer = await downloadFromUrl(url)
    } catch (error) {
      errors.push(error)
      continue
    }
    // A storage failure cannot be fixed by downloading the same bytes again.
    await saveModel(modelType, buffer)
    setDownloadProgress(100, true)
    return buffer
  }

  const details = errors
    .map(error => (error instanceof Error ? error.message : String(error)))
    .join('; ')
  throw new Error(`Failed to download the model: ${details}`)
}
