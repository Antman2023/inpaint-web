import { resizeImageFile } from './utils'
import { message } from './i18n'

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

async function readExample(response: Response) {
  const type =
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ??
    ''
  let error: string | undefined
  if (!response.ok) {
    error = `${message('example_load_failed')} (${response.status})`
  } else if (response.status === 206 || response.headers.has('content-range')) {
    error = message('image_import_failed')
  } else if (!IMAGE_TYPES.includes(type)) {
    error = message('invalid_file')
  }
  if (error) {
    // Release rejected bodies without waiting for the server to finish sending.
    void response.body?.cancel().catch(() => {})
    throw new Error(error)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error(message('image_import_failed'))
  let complete = false
  try {
    const chunks: BlobPart[] = []
    let bytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        complete = true
        break
      }
      bytes += value.byteLength
      if (bytes > MAX_IMAGE_BYTES) throw new Error(message('file_too_large'))
      chunks.push(value)
    }
    if (bytes === 0) throw new Error(message('image_import_failed'))
    return new Blob(chunks, { type })
  } finally {
    // A remote cancellation acknowledgement must not delay the import error.
    if (!complete) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export type ImageImportState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; file: File }
  | { status: 'error'; error: string }

// Uploads and examples share one owner; only the newest selection may commit.
export function createImageImporter(
  onChange: (state: ImageImportState) => void
) {
  let active: AbortController | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function stop() {
    const previous = active
    active = undefined
    clearTimeout(timeout)
    previous?.abort()
  }

  return {
    async load(source: File | string) {
      if (disposed) return
      stop()
      const request = new AbortController()
      active = request
      onChange({ status: 'loading' })
      timeout = setTimeout(() => {
        if (active !== request) return
        stop()
        onChange({ status: 'error', error: message('image_import_timeout') })
      }, 30_000)
      try {
        let file: File
        if (typeof source === 'string') {
          const response = await fetch(source, { signal: request.signal })
          if (active !== request) {
            void response.body?.cancel().catch(() => {})
            return
          }
          const blob = await readExample(response)
          file = new File([blob], source.split('/').at(-1) ?? 'example.jpeg', {
            type: blob.type,
          })
        } else {
          file = source
        }
        if (active !== request) return
        if (!IMAGE_TYPES.includes(file.type)) {
          throw new Error(message('invalid_file'))
        }
        if (file.size > MAX_IMAGE_BYTES) {
          throw new Error(message('file_too_large'))
        }
        const result = await resizeImageFile(file, 4096, request.signal)
        if (active === request) onChange({ status: 'ready', file: result.file })
      } catch (error) {
        if (active === request) {
          onChange({
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : message('image_import_failed'),
          })
        }
      } finally {
        request.abort()
        if (active === request) {
          clearTimeout(timeout)
          active = undefined
        }
      }
    },
    cancel() {
      stop()
      if (!disposed) onChange({ status: 'idle' })
    },
    dispose() {
      disposed = true
      stop()
    },
  }
}
