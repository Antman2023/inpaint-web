export async function checkWebgpu() {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    if (!navigator.gpu) return false
    return await Promise.race([
      navigator.gpu.requestAdapter().then(adapter => Boolean(adapter)),
      // A stalled driver probe must not prevent the WASM fallback from loading.
      new Promise<boolean>(resolve => {
        timeout = setTimeout(() => resolve(false), 5_000)
      }),
    ])
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
export const wasm = () =>
  typeof WebAssembly === 'object' &&
  typeof WebAssembly.instantiate === 'function'
export const threads = () =>
  (async e => {
    let channel: MessageChannel | undefined
    try {
      if (typeof MessageChannel === 'undefined') {
        return false
      }
      channel = new MessageChannel()
      channel.port1.postMessage(new SharedArrayBuffer(1))
      return WebAssembly.validate(e)
    } catch {
      return false
    } finally {
      channel?.port1.close()
      channel?.port2.close()
    }
  })(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1,
      1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11,
    ])
  )
export const simd = async () =>
  WebAssembly.validate(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10,
      1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ])
  )

export interface Capabilities {
  webgpu: boolean
  wasm: boolean
  simd: boolean
  threads: boolean
}

export const getCapabilities = async (
  skipWebgpu = false
): Promise<Capabilities> => {
  return {
    webgpu: !skipWebgpu && (await checkWebgpu()),
    wasm: wasm(),
    simd: wasm() && (await simd()),
    threads: await threads(),
  }
}
const version = '1.16.3'
export const getTagSrc = async () => {
  const prefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`
  const capablilities = await getCapabilities()
  if (capablilities.webgpu) {
    return `${prefix}ort.webgpu.min.js`
  }
  if (capablilities.wasm) {
    if (capablilities.simd || capablilities.threads) {
      return `${prefix}ort.wasm.min.js`
    }
    return `${prefix}ort.wasm-core.min.js`
  }
  return `${prefix}ort.min.js`
}

export let runtimeBase = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`
let runtimeLoading: Promise<void> | undefined

async function loadScript(src: string) {
  const script = document.createElement('script')
  script.src = src
  script.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      script.onload = null
      script.onerror = null
    }
    const fail = () => {
      if (settled) return
      settled = true
      cleanup()
      script.remove()
      reject(new Error(`Failed to load ONNX Runtime from ${src}`))
    }
    const timeout = setTimeout(fail, 30_000)
    script.onload = () => {
      if (settled) return
      if (typeof ort === 'undefined') fail()
      else {
        settled = true
        cleanup()
        resolve()
      }
    }
    script.onerror = fail
    try {
      document.head.appendChild(script)
    } catch {
      fail()
    }
  })
}

export const loadingOnnxruntime = (
  compatible = false,
  reset = false
): Promise<void> => {
  if (runtimeLoading) return runtimeLoading
  if (reset) {
    // A failed WASM backend retains its initialization error inside ORT.
    // Load a fresh runtime only after the caller has released all sessions.
    delete (window as unknown as { ort?: unknown }).ort
  }
  if (typeof ort !== 'undefined') return Promise.resolve()
  runtimeLoading = (async () => {
    const src = compatible ? `${runtimeBase}ort.wasm.min.js` : await getTagSrc()
    const primaryBase = src.slice(0, src.lastIndexOf('/') + 1)
    const backupBase = primaryBase.includes('cdn.jsdelivr.net')
      ? `https://unpkg.com/onnxruntime-web@${version}/dist/`
      : `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`
    try {
      await loadScript(src)
      runtimeBase = primaryBase
    } catch {
      await loadScript(`${backupBase}${src.split('/').pop()}`)
      runtimeBase = backupBase
    }
  })().finally(() => {
    runtimeLoading = undefined
  })
  return runtimeLoading
}
