export async function checkWebgpu() {
  if (!navigator.gpu) {
    return false
  }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    return false
  }
  return true
}
export const wasm = () =>
  typeof WebAssembly === 'object' &&
  typeof WebAssembly.instantiate === 'function'
export const threads = () =>
  (async e => {
    try {
      if (typeof MessageChannel === 'undefined') {
        return false
      }
      const channel = new MessageChannel()
      channel.port1.postMessage(new SharedArrayBuffer(1))
      channel.port1.close()
      channel.port2.close()
      return WebAssembly.validate(e)
    } catch {
      return false
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

export const getCapabilities = async (): Promise<Capabilities> => {
  return {
    webgpu: await checkWebgpu(),
    wasm: wasm(),
    simd: await simd(),
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

export const loadingOnnxruntime = async () => {
  const script = document.createElement('script')
  script.src = await getTagSrc()
  script.crossOrigin = 'anonymous'

  await new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener(
      'error',
      () => reject(new Error(`Failed to load ONNX Runtime from ${script.src}`)),
      { once: true }
    )
    document.head.appendChild(script)
  })
}
