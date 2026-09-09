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
export type SessionStage =
  'processing_runtime' | 'processing_model' | 'processing_initializing'
const stages = new Map<modelType, SessionStage>()
const listeners = new Map<modelType, Set<(stage: SessionStage) => void>>()

function reportStage(type: modelType, stage: SessionStage) {
  stages.set(type, stage)
  for (const listener of listeners.get(type) ?? []) listener(stage)
}
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

export function getSession(
  type: modelType,
  onStage?: (stage: SessionStage) => void
) {
  let session = sessions.get(type)
  if (!session) {
    session = (async () => {
      reportStage(type, 'processing_runtime')
      await loadingOnnxruntime(compatible)
      reportStage(type, 'processing_model')
      const [capabilities, model] = await Promise.all([
        getCapabilities(compatible),
        ensureModel(type),
      ])
      ort.env.wasm.wasmPaths = runtimeBase
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false
      ort.env.wasm.simd = capabilities.simd
      reportStage(type, 'processing_initializing')
      return ort.InferenceSession.create(model, {
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
  if (!onStage) return session
  const subscribers = listeners.get(type) ?? new Set()
  listeners.set(type, subscribers)
  subscribers.add(onStage)
  onStage(stages.get(type) ?? 'processing_runtime')
  return session.finally(() => subscribers.delete(onStage))
}

export function warmupInpaint() {
  return withRuntime(async () => {
    await Promise.all([
      getSession('inpaint'),
      import('./opencv').then(module => module.ensureOpenCV()),
    ])
  })
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
    const { ensureOpenCV } = await import('./opencv')
    await ensureOpenCV()
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
