import cv from 'opencv-ts'

// The package exports an Emscripten module before its WASM constructors exist.
// It also has a self-resolving `then`; never return cv from an async function.
export default cv

let ready: Promise<void> | undefined

export function ensureOpenCV(): Promise<void> {
  if (ready) return ready
  ready = new Promise<void>((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      if (typeof cv.Mat === 'function' && typeof cv.MatVector === 'function') {
        try {
          // Verify allocation as well as the presence of exported constructors.
          const mat = new cv.Mat()
          mat.delete()
          resolve()
        } catch (error) {
          reject(error)
        }
      } else if (Date.now() - started >= 30_000) {
        reject(
          new Error(
            'OpenCV 初始化超时，请刷新页面后重试。 / OpenCV initialization timed out. Reload the page and retry.'
          )
        )
      } else {
        setTimeout(check, 50)
      }
    }
    check()
  }).catch(error => {
    ready = undefined
    throw error
  })
  return ready
}
