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
  const model = await localforage.getItem<ArrayBuffer>(getModel(modelType).name)
  return model instanceof ArrayBuffer && model.byteLength > 0 ? model : null
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

export async function ensureModel(modelType: modelType) {
  const cached = await loadModel(modelType)
  if (cached) return cached
  await downloadModel(modelType, () => {})
  const model = await loadModel(modelType)
  if (!(model instanceof ArrayBuffer) || model.byteLength === 0) {
    throw new Error('Downloaded model is empty')
  }
  return model
}

type ProgressListener = (progress: number) => void
const pendingDownloads = new Map<
  modelType,
  {
    promise: Promise<void>
    listeners: Set<ProgressListener>
    progress: number
  }
>()

export async function downloadModel(
  modelType: modelType,
  setDownloadProgress: ProgressListener
) {
  let pending = pendingDownloads.get(modelType)
  if (!pending) {
    const task = {
      promise: Promise.resolve(),
      listeners: new Set<ProgressListener>(),
      progress: 0,
    }
    pendingDownloads.set(modelType, task)
    task.promise = downloadAndCacheModel(modelType, progress => {
      task.progress = progress
      for (const listener of task.listeners) listener(progress)
    }).finally(() => pendingDownloads.delete(modelType))
    pending = task
  }
  pending.listeners.add(setDownloadProgress)
  try {
    setDownloadProgress(pending.progress)
    await pending.promise
  } finally {
    pending.listeners.delete(setDownloadProgress)
  }
}

async function downloadAndCacheModel(
  modelType: modelType,
  setDownloadProgress: (arg0: number) => void
) {
  if (await modelExists(modelType)) {
    setDownloadProgress(100)
    return
  }

  async function downloadFromUrl(url: string) {
    setDownloadProgress(0)
    const controller = new AbortController()
    // Reset on each chunk so slow but active downloads can finish.
    let timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Model download failed with status ${response.status}`)
      }
      if (!response.body) {
        throw new Error('Model download response has no body')
      }
      const fullSize = Number(response.headers.get('content-length'))
      const reader = response.body.getReader()
      const total: Uint8Array[] = []
      let downloaded = 0

      while (true) {
        const { done, value } = await reader.read()
        clearTimeout(timeout)
        timeout = setTimeout(() => controller.abort(), 30_000)

        if (done) {
          break
        }

        downloaded += value?.length || 0

        if (value) {
          total.push(value)
        }

        if (Number.isFinite(fullSize) && fullSize > 0) {
          setDownloadProgress(Math.min(99, (downloaded / fullSize) * 100))
        }
      }

      clearTimeout(timeout)
      reader.releaseLock()
      if (downloaded === 0) throw new Error('Downloaded model is empty')
      const buffer = new Uint8Array(downloaded)
      let offset = 0
      for (const chunk of total) {
        buffer.set(chunk, offset)
        offset += chunk.length
      }

      await saveModel(modelType, buffer.buffer)
      setDownloadProgress(100)
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }
  }

  const model = getModel(modelType)
  const urls = [model.url, model.backupUrl].filter(Boolean)
  const errors: unknown[] = []
  for (const url of urls) {
    try {
      await downloadFromUrl(url)
      return
    } catch (error) {
      errors.push(error)
    }
  }

  const details = errors
    .map(error => (error instanceof Error ? error.message : String(error)))
    .join('; ')
  throw new Error(`Failed to download the model: ${details}`)
}
