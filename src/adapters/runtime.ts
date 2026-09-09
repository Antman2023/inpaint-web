import type { InferenceSession } from 'onnxruntime-web'
import {
  downloadModel,
  ensureModel,
  modelExists,
  removeCachedModel,
  type modelType,
} from './cache'
import { getCapabilities, loadingOnnxruntime, runtimeBase, wasm } from './util'

const sessions = new Map<modelType, Promise<InferenceSession>>()
let compatible = false
let active = 0
let repairing: Promise<void> | undefined

export async function withRuntime<T>(operation: () => Promise<T>): Promise<T> {
  if (repairing)
    throw new Error(
      '环境正在修复，请完成后重试。 / Runtime repair in progress.'
    )
  active++
  try {
    return await operation()
  } finally {
    active--
  }
}

export function getSession(type: modelType) {
  let session = sessions.get(type)
  if (!session) {
    session = (async () => {
      await loadingOnnxruntime(compatible)
      const capabilities = await getCapabilities(compatible)
      ort.env.wasm.wasmPaths = runtimeBase
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false
      ort.env.wasm.simd = capabilities.simd
      return ort.InferenceSession.create(await ensureModel(type), {
        executionProviders: [
          !compatible && capabilities.webgpu ? 'webgpu' : 'wasm',
        ],
      })
    })().catch(error => {
      sessions.delete(type)
      throw error
    })
    sessions.set(type, session)
  }
  return session
}

export function repairRuntime(
  onProgress: (progress: number) => void
): Promise<void> {
  if (repairing) return repairing
  if (active)
    return Promise.reject(
      new Error(
        '请等待当前图片处理结束后再修复。 / Wait for image processing to finish.'
      )
    )
  repairing = (async () => {
    if (!wasm())
      throw new Error(
        '浏览器不支持 WebAssembly，请更新浏览器后重试。 / WebAssembly is unavailable; update your browser.'
      )
    onProgress(0)
    const types: modelType[] = ['inpaint']
    if (
      sessions.has('superResolution') ||
      (await modelExists('superResolution'))
    )
      types.push('superResolution')
    const previousSessions = [...sessions.values()]
    sessions.clear()
    for (const session of previousSessions) {
      const loaded = await session.catch(() => null)
      if (loaded) await loaded.release()
    }
    compatible = true
    await loadingOnnxruntime(true, true)
    for (const [index, type] of types.entries()) {
      await removeCachedModel(type)
      await downloadModel(type, progress =>
        onProgress(((index + progress / 100) / types.length) * 90)
      )
      await getSession(type)
    }
    onProgress(100)
  })().finally(() => {
    repairing = undefined
  })
  return repairing
}
