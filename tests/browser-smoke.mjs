// Run through the Vite development server in a browser console:
// const { runBrowserSmoke } = await import('/tests/browser-smoke.mjs')
// await runBrowserSmoke()
// Uses real models (downloads and caches them when absent).
import inpaint from '../src/adapters/inpainting.ts'
import upscale from '../src/adapters/superResolution.ts'
import { withRuntime } from '../src/adapters/runtime.ts'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function inspect(blob, size, expectedAlpha) {
  assert(blob.type === 'image/png', `Expected PNG, received ${blob.type}`)
  const url = URL.createObjectURL(blob)
  const image = new Image()
  const canvas = document.createElement('canvas')
  try {
    image.src = url
    await image.decode()
    assert(
      image.naturalWidth === size && image.naturalHeight === size,
      `Expected ${size} × ${size}, received ${image.naturalWidth} × ${image.naturalHeight}`
    )
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, size, size).data
    for (const [x, y, expected] of expectedAlpha) {
      const actual = pixels[(y * size + x) * 4 + 3]
      assert(
        actual === expected,
        `Alpha at (${x}, ${y}): expected ${expected}, received ${actual}`
      )
    }
    return {
      width: size,
      height: size,
      bytes: blob.size,
      alphaChecks: expectedAlpha.length,
    }
  } finally {
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
    canvas.width = canvas.height = 0
  }
}

export async function runBrowserSmoke({
  onProgress = console.info,
  signal,
  exerciseCancellation = false,
} = {}) {
  const canvas = document.createElement('canvas')
  const mask = document.createElement('canvas')
  const cancellationControllers = []
  const abortChecks = () => {
    for (const controller of cancellationControllers)
      controller.abort(signal.reason)
  }
  signal?.addEventListener('abort', abortChecks, { once: true })
  canvas.width = canvas.height = mask.width = mask.height = 64
  try {
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#6699cc'
    ctx.fillRect(16, 0, 48, 64)
    ctx.fillStyle = 'rgba(255, 100, 50, 0.5)'
    ctx.fillRect(0, 16, 16, 32)
    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/png')
    )
    assert(blob, 'Fixture encoding failed')
    const file = new File([blob], 'smoke.png', { type: 'image/png' })
    const maskCtx = mask.getContext('2d')
    maskCtx.fillStyle = 'white'
    maskCtx.fillRect(36, 28, 8, 8)
    const started = performance.now()
    const timingsMs = {}
    let cancellation
    if (exerciseCancellation) {
      signal?.throwIfAborted()
      const expectAbort = async task => {
        try {
          await task
        } catch (error) {
          signal?.throwIfAborted()
          assert(error.name === 'AbortError', `Expected cancellation: ${error}`)
          return
        }
        throw new Error('Cancelled operation returned an image')
      }
      const preparation = new AbortController()
      cancellationControllers.push(preparation)
      const stages = []
      await expectAbort(
        inpaint(
          file,
          mask,
          stage => {
            stages.push(stage)
            onProgress({ operation: 'inpaint', check: 'cancellation', stage })
            if (stage === 'processing_prepare') preparation.abort()
          },
          preparation.signal
        )
      )
      assert(
        preparation.signal.aborted,
        'Preparation cancellation was not reached'
      )
      assert(
        !stages.includes('processing_inference'),
        'Cancelled preparation entered inference'
      )
      assert(
        !stages.includes('processing_output'),
        'Cancelled preparation entered output'
      )

      signal?.throwIfAborted()
      const betweenTiles = new AbortController()
      cancellationControllers.push(betweenTiles)
      const progress = []
      const cancelledUpscale = upscale(
        file,
        value => {
          progress.push(value)
          betweenTiles.abort()
        },
        status =>
          onProgress({
            operation: 'upscale',
            check: 'cancellation',
            ...status,
          }),
        betweenTiles.signal
      )
      // Queue a real runtime caller behind the operation being cancelled.
      const [, resumed] = await Promise.all([
        expectAbort(cancelledUpscale),
        withRuntime(async () => true),
      ])
      assert(
        progress.length === 1 && progress[0] === 25,
        'Cancellation did not stop after the first of four tiles'
      )
      assert(resumed, 'Runtime queue did not resume after cancellation')
      cancellation = {
        preparation: 'passed',
        betweenTiles: 'passed',
        queueResumed: true,
      }
      onProgress({ cancellation })
      timingsMs.cancellation = Math.round(performance.now() - started)
    }
    // Successful runs also verify recovery after the optional cancellation checks.
    const inpaintStarted = performance.now()
    const repaired = await inpaint(
      file,
      mask,
      stage => onProgress({ operation: 'inpaint', stage }),
      signal
    )
    const inpaintResult = await inspect(repaired, 64, [
      [0, 0, 0],
      [5, 20, 128],
      [20, 20, 255],
      [40, 32, 255],
    ])
    timingsMs.inpaint = Math.round(performance.now() - inpaintStarted)
    const upscaleStarted = performance.now()
    const enlarged = await upscale(
      file,
      progress => onProgress({ operation: 'upscale', progress }),
      status => onProgress({ operation: 'upscale', ...status }),
      signal
    )
    const upscaleResult = await inspect(enlarged, 256, [
      [0, 0, 0],
      [20, 80, 128],
      [80, 80, 255],
      [62, 0, 32],
      [63, 0, 96],
      [64, 0, 159],
      [65, 0, 223],
    ])
    timingsMs.upscale = Math.round(performance.now() - upscaleStarted)
    return {
      ...(cancellation ? { cancellation } : {}),
      inpaint: inpaintResult,
      upscale: upscaleResult,
      timingsMs,
      elapsedMs: Math.round(performance.now() - started),
    }
  } finally {
    signal?.removeEventListener('abort', abortChecks)
    canvas.width = canvas.height = mask.width = mask.height = 0
  }
}
