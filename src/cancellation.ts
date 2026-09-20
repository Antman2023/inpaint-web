// Cancel a caller's wait without interrupting work shared by other callers.
export function waitForAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    subscribe(promise, { signal, resolve, reject })
  })
}

interface Waiter<T> {
  signal?: AbortSignal
  resolve?: (value: T) => void
  reject?: (reason: unknown) => void
}

function subscribe<T>(promise: Promise<T>, waiter: Waiter<T>) {
  // A pending shared promise keeps its handlers. Give them only a clearable
  // holder so cancellation can release the signal, reason and settled promise.
  const cleanup = () => {
    waiter.signal?.removeEventListener('abort', abort)
    waiter.signal = undefined
    waiter.resolve = undefined
    waiter.reject = undefined
  }
  const abort = () => {
    waiter.reject?.(waiter.signal?.reason)
    cleanup()
  }
  promise.then(
    value => {
      if (waiter.signal?.aborted) abort()
      else {
        waiter.resolve?.(value)
        cleanup()
      }
    },
    error => {
      waiter.reject?.(error)
      cleanup()
    }
  )
  if (waiter.signal?.aborted) abort()
  else waiter.signal?.addEventListener('abort', abort, { once: true })
}
