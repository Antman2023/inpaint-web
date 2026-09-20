const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadModule } = require('./load-module.cjs')

test('inpainting releases RGB and mask inputs before asynchronous output conversion', async () => {
  let rgbRef, maskRef, finishOutput, reachedOutput
  const paused = new Promise(resolve => { reachedOutput = resolve })
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims }) }
  }
  const adapter = loadModule('src/adapters/inpainting.ts', {
    '../imageResources': {
      withImage: async (image, _signal, task) => task(image),
      imageDataToBlob: async result => result,
    },
    './preprocess': {
      readImageChannels: async () => {
        const rgb = new Uint8Array(3 * 64 * 64)
        rgbRef = new WeakRef(rgb)
        return { rgb }
      },
      readResizedMask: async () => {
        const mask = new Uint8Array(64 * 64)
        maskRef = new WeakRef(mask)
        return mask
      },
    },
    './runtime': {
      withRuntime: task => task(),
      getSession: async () => ({
        inputNames: ['image', 'mask'], outputNames: ['output'],
        run: async () => ({ output: {
          data: new Uint8Array(3 * 64 * 64).fill(23), dims: [1, 3, 64, 64],
        } }),
      }),
    },
    './postprocess': { planarToImageData: async data => {
      reachedOutput()
      await new Promise(resolve => { finishOutput = resolve })
      return data
    } },
  }, { ort: { Tensor } })
  const operation = adapter.default({ naturalWidth: 64, naturalHeight: 64 }, {})
  await paused
  try {
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate)
      global.gc()
    }
    assert.equal(rgbRef.deref() === undefined, true, 'Inpaint RGB input remains retained')
    assert.equal(maskRef.deref() === undefined, true, 'Inpaint mask input remains retained')
  } finally {
    finishOutput()
    const result = await operation
    assert.equal(result.length, 3 * 64 * 64)
    assert.equal(result.at(-1), 23)
  }
})

test('upscale releases RGB input before asynchronous alpha processing', async () => {
  class Image {}
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims }) }
  }
  let rgbRef, finishAlpha, reachedAlpha
  const paused = new Promise(resolve => { reachedAlpha = resolve })
  const adapter = loadModule('src/adapters/superResolution.ts', {
    '../imageResources': {
      withImage: async (image, _signal, task) => task(image),
      imageDataToBlob: async result => result,
    },
    './preprocess': { readImageChannels: async () => {
      const rgb = new Float32Array(3 * 64 * 64)
      rgbRef = new WeakRef(rgb)
      return { rgb, alpha: new Uint8Array(64 * 64) }
    } },
    './alpha': { applyResizedAlpha: async () => {
      reachedAlpha()
      await new Promise(resolve => { finishAlpha = resolve })
    } },
    './runtime': {
      withRuntime: task => task(),
      getSession: async () => ({
        inputNames: ['input'], outputNames: ['output'],
        run: async () => ({ output: {
          data: new Float32Array(3 * 256 * 256), dims: [1, 3, 256, 256],
        } }),
      }),
    },
    '../i18n': { message: key => key },
  }, {
    ort: { Tensor }, HTMLImageElement: Image,
    ImageData: class {
      constructor(data, width, height) { Object.assign(this, { data, width, height }) }
    },
  })
  const image = Object.assign(new Image(), { naturalWidth: 64, naturalHeight: 64 })
  const operation = adapter.default(image, () => {})
  await paused
  try {
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate)
      global.gc()
    }
    assert.equal(rgbRef.deref() === undefined, true, 'RGB input retained after all tiles finished')
  } finally {
    finishAlpha()
    assert.equal((await operation).width, 256)
  }
})

test('completed upscale tile output can be collected while the next inference waits', async () => {
  let outputRef, finish, reachedSecond
  const paused = new Promise(resolve => { reachedSecond = resolve })
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims }) }
  }
  const adapter = loadModule('src/adapters/superResolution.ts', {
    '../imageResources': {}, './preprocess': {}, './alpha': {}, './runtime': {},
    '../i18n': { message: key => key },
  }, {
    ort: { Tensor },
    ImageData: class {
      constructor(data, width, height) { Object.assign(this, { data, width, height }) }
    },
  })
  let runs = 0
  const output = () => ({ output: { data: new Float32Array(3 * 256 * 256).fill(0.5), dims: [1, 3, 256, 256] } })
  const session = {
    inputNames: ['input'], outputNames: ['output'],
    async run() {
      if (++runs === 1) {
        const result = output()
        outputRef = new WeakRef(result.output.data)
        return result
      }
      reachedSecond()
      return new Promise(resolve => { finish = () => resolve(output()) })
    },
  }
  const operation = adapter.tileProc(new Tensor('float32', new Float32Array(3 * 53), [1, 3, 1, 53]), session, () => {})
  await paused
  try {
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate)
      global.gc()
    }
    assert.equal(outputRef.deref() === undefined, true, 'Previous tile output remains retained')
  } finally {
    finish()
    const result = await operation
    assert.equal(result.width, 212)
    assert.equal(result.height, 4)
    assert.deepEqual(Array.from(result.data.slice(-4)), [128, 128, 128, 255])
  }
})

test('cancelled shared waiters release their abort reason before shared work finishes', async () => {
  const { waitForAbort } = loadModule('src/cancellation.ts')
  let finish
  const shared = new Promise(resolve => { finish = resolve })
  async function cancelWaiter() {
    const controller = new AbortController()
    const reason = new Uint8Array(16 * 1024 * 1024)
    const weak = new WeakRef(reason)
    const waiter = waitForAbort(shared, controller.signal).catch(() => {})
    controller.abort(reason)
    await waiter
    return weak
  }
  const cancelledReason = await cancelWaiter()
  const survivor = waitForAbort(shared, new AbortController().signal)
  try {
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate)
      global.gc()
    }
    assert.equal(cancelledReason.deref() === undefined, true,
      'Cancelled shared waiter retains its abort reason')
  } finally {
    finish(42)
    assert.equal(await survivor, 42)
  }
})

test('model assembly releases copied chunks while later chunks are still pending', async () => {
  assert.equal(typeof global.gc, 'function', 'Run npm run test:memory')
  const chunks = []
  let reads = 0
  let resumeCopy
  let reachedYield
  const paused = new Promise(resolve => {
    reachedYield = resolve
  })
  let cached
  const cache = loadModule(
    'src/adapters/cache.ts',
    {
      '../i18n': { message: key => key },
      localforage: {
        config() {},
        getItem: async () => null,
        setItem: async (_key, value) => {
          cached = value
        },
      },
    },
    {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader: () => ({
            async read() {
              if (reads === 2) return { done: true }
              const value = new Uint8Array(8 * 1024 * 1024).fill(++reads)
              chunks.push(new WeakRef(value))
              return { done: false, value }
            },
            releaseLock() {},
          }),
        },
      }),
      setTimeout(callback, delay) {
        if (delay !== 0) return setTimeout(callback, delay)
        resumeCopy = callback
        reachedYield()
      },
    }
  )
  const download = cache.ensureModel('inpaint')
  await paused
  try {
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate)
      global.gc()
    }
    assert.equal(
      chunks[0].deref() === undefined,
      true,
      'Copied chunk remains retained'
    )
    assert.equal(chunks[1].deref()?.byteLength, 8 * 1024 * 1024)
    assert.equal(cached, undefined)
  } finally {
    resumeCopy()
    const result = new Uint8Array(await download)
    assert.equal(result.length, 16 * 1024 * 1024)
    assert.equal(result[0], 1)
    assert.equal(result[8 * 1024 * 1024 - 1], 1)
    assert.equal(result[8 * 1024 * 1024], 2)
    assert.equal(result.at(-1), 2)
    assert.equal(cached, result.buffer)
  }
})

// Run in a separate Node process with --expose-gc. No browser, model, or network.
test('cancelled queued work releases its payload while live work remains protected', async () => {
  assert.equal(typeof global.gc, 'function', 'Run npm run test:memory')
  const runtime = loadModule('src/adapters/runtime.ts', {
    './cache': {},
    './util': {},
  })
  let finish,
    cancelledRuns = 0
  const active = runtime.withRuntime(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  await new Promise(setImmediate)
  function createWork(onRun) {
    const bytes = new Uint8Array(16 * 1024 * 1024)
    return {
      run: async () => {
        onRun()
        return bytes.byteLength
      },
      weak: new WeakRef(bytes),
    }
  }
  const abandoned = createWork(() => {
    cancelledRuns++
  })
  const retained = createWork(() => {})
  const controller = new AbortController()
  const cancelled = runtime.withRuntime(abandoned.run, controller.signal)
  const rejected = assert.rejects(cancelled, { name: 'AbortError' })
  const survivor = runtime.withRuntime(retained.run)
  abandoned.run = null
  retained.run = null
  try {
    controller.abort()
    await rejected
    // WeakRef targets remain live through the current job. Yield before each GC;
    // do not dereference them in the loop, which would extend their lifetime.
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate)
      global.gc()
    }
    assert.equal(
      abandoned.weak.deref() === undefined,
      true,
      'Cancelled work retained 16 MiB'
    )
    assert.equal(retained.weak.deref()?.byteLength, 16 * 1024 * 1024)
    assert.equal(cancelledRuns, 0)
    await assert.rejects(
      runtime.repairRuntime(() => {}),
      /Wait for image processing/
    )
  } finally {
    finish()
    await active
    assert.equal(await survivor, 16 * 1024 * 1024)
  }
})
