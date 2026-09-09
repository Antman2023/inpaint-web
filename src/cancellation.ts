// Cancel a caller's wait without interrupting work shared by other callers.
export function waitForAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    promise.then(
      value => {
        cleanup()
        if (signal.aborted) reject(signal.reason)
        else resolve(value)
      },
      error => {
        cleanup()
        reject(error)
      }
    )
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
