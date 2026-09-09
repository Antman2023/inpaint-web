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

function notify<T>(listener: (value: T) => void, value: T) {
  try {
    listener(value)
  } catch (error) {
    // UI observers must not fail a shared runtime operation.
    console.error('Runtime status callback failed', error)
  }
}

function reportStage(type: modelType, stage: SessionStage) {
  stages.set(type, stage)
  for (const listener of listeners.get(type) ?? []) notify(listener, stage)
}
let compatible = false
let active = 0
let operationQueue: Promise<void> = Promise.resolve()
let initializing = 0
let repairing: Promise<void> | undefined
let needsRepair = false

function runtimeAccessError() {
  if (repairing)
    return new Error(
      '环境正在修复，请完成后重试。 / Runtime repair in progress.'
    )
  if (needsRepair)
    return new Error(
      '运行环境修复未完成，请重试修复。 / Runtime repair is incomplete. Retry repair.'
    )
}

export async function withRuntime<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const error = runtimeAccessError()
  if (error) throw error
  // Editors can unmount while inference is still running. Serialize all callers
  // and count queued work immediately so repair cannot release their sessions.
  active++
  const task = operationQueue.then(() => {
    signal?.throwIfAborted()
    return operation()
  })
  operationQueue = task.then(
    () => {},
    () => {}
  )
  try {
    return await task
  } finally {
    active--
  }
}

export function getSession(
  type: modelType,
  onStage?: (stage: SessionStage) => void
) {
  const error = runtimeAccessError()
  return error ? Promise.reject(error) : initializeSession(type, onStage)
}

// Repair owns initialization while external access is blocked.
function initializeSession(
  type: modelType,
  onStage?: (stage: SessionStage) => void
) {
  let session = sessions.get(type)
  if (!session) {
    initializing++
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
      if (!compatible && capabilities.webgpu) {
        try {
          return await ort.InferenceSession.create(model, {
            executionProviders: ['webgpu'],
          })
        } catch (error) {
          // Adapter availability does not guarantee this model can initialize
          // on the GPU. Reuse the same model bytes for the CPU backend.
          console.warn('GPU initialization failed; trying WebAssembly', error)
        }
      }
      return ort.InferenceSession.create(model, {
        executionProviders: ['wasm'],
      })
    })()
      .catch(error => {
        if (sessions.get(type) === session) sessions.delete(type)
        throw error
      })
      .finally(() => {
        initializing--
      })
    sessions.set(type, session)
  }
  if (!onStage) return session
  const subscribers = listeners.get(type) ?? new Set()
  listeners.set(type, subscribers)
  subscribers.add(onStage)
  notify(onStage, stages.get(type) ?? 'processing_runtime')
  return session.finally(() => subscribers.delete(onStage))
}

export function warmupInpaint(signal?: AbortSignal) {
  return withRuntime(async () => {
    await Promise.all([
      getSession('inpaint'),
      import('./opencv').then(module => module.ensureOpenCV()),
    ])
  }, signal)
}

export function repairRuntime(
  onProgress: (progress: number | null) => void
): Promise<void> {
  if (repairing) return repairing
  if (active || initializing)
    return Promise.reject(
      new Error(
        '请等待当前图片处理结束后再修复。 / Wait for image processing to finish.'
      )
    )
  // Acquire the repair lock before progress callbacks or other work can reenter.
  repairing = Promise.resolve()
    .then(async () => {
      if (!wasm())
        throw new Error(
          '浏览器不支持 WebAssembly，请更新浏览器后重试。 / WebAssembly is unavailable; update your browser.'
        )
      notify(onProgress, 0)
      const { ensureOpenCV } = await import('./opencv')
      await ensureOpenCV()
      const types: modelType[] = ['inpaint']
      if (
        sessions.has('superResolution') ||
        (await modelExists('superResolution'))
      )
        types.push('superResolution')
      needsRepair = true
      const releaseErrors: unknown[] = []
      for (const [type, session] of sessions) {
        try {
          const loaded = await session
          await loaded.release()
          sessions.delete(type)
          stages.delete(type)
        } catch (error) {
          // Keep failed releases for the next repair, but still clean other sessions.
          releaseErrors.push(error)
        }
      }
      if (releaseErrors.length) {
        const details = releaseErrors
          .map(error =>
            error instanceof Error ? error.message : String(error)
          )
          .join('; ')
        throw new AggregateError(
          releaseErrors,
          `无法释放旧推理会话，请重试修复。 / Failed to release inference sessions: ${details}`
        )
      }
      compatible = true
      await loadingOnnxruntime(true, true)
      for (const [index, type] of types.entries()) {
        await removeCachedModel(type)
        await downloadModel(type, progress =>
          notify(
            onProgress,
            progress === null
              ? null
              : ((index + progress / 100) / types.length) * 90
          )
        )
        await initializeSession(type)
      }
      notify(onProgress, 100)
      needsRepair = false
    })
    .finally(() => {
      repairing = undefined
    })
  return repairing
}
