const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')

// Compile the production module with browser dependencies supplied by each test.
function loadModule(path, dependencies = {}, globals = {}) {
  const source = readFileSync(resolve(__dirname, '..', path), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  })
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ...Object.keys(globals),
    outputText
  )(
    name => dependencies[name] ?? require(name),
    module,
    module.exports,
    ...Object.values(globals)
  )
  return module.exports
}

function cacheHarness(fetch, globals = {}) {
  const stored = new Map()
  const cache = loadModule(
    'src/adapters/cache.ts',
    {
      localforage: {
        config() {},
        async getItem(key) {
          return stored.get(key) ?? null
        },
        async setItem(key, value) {
          stored.set(key, value)
        },
      },
    },
    { fetch, ...globals }
  )
  return { cache, stored }
}

test('concurrent callers share a download and cached calls avoid the network', async () => {
  let requests = 0
  const { cache } = cacheHarness(async () => {
    requests++
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-length': '3' },
    })
  })
  const first = [],
    second = []
  await Promise.all([
    cache.downloadModel('inpaint', p => first.push(p)),
    cache.downloadModel('inpaint', p => second.push(p)),
  ])
  assert.equal(requests, 1)
  assert.equal(first.at(-1), 100)
  assert.equal(second.at(-1), 100)
  assert.deepEqual(
    new Uint8Array(await cache.ensureModel('inpaint')),
    new Uint8Array([1, 2, 3])
  )
  assert.equal(requests, 1)
})

test('empty responses are rejected without caching and a failed download can retry', async () => {
  let empty = true
  let requests = 0
  const { cache, stored } = cacheHarness(async () => {
    requests++
    return new Response(empty ? new Uint8Array() : new Uint8Array([4]))
  })
  await assert.rejects(
    cache.downloadModel('inpaint', () => {}),
    /empty/
  )
  assert.equal(requests, 2)
  assert.equal(stored.size, 0)
  empty = false
  await cache.downloadModel('inpaint', () => {})
  assert.equal(requests, 3)
  assert.equal(stored.size, 1)
})

test('a stalled request aborts and falls back to the backup URL', async () => {
  let requests = 0
  const { cache } = cacheHarness(
    async (_url, { signal }) => {
      if (++requests === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('timeout')), {
            once: true,
          })
        })
      }
      return new Response(new Uint8Array([5]))
    },
    { setTimeout: callback => setTimeout(callback, 5) }
  )
  await cache.downloadModel('inpaint', () => {})
  assert.equal(requests, 2)
})

function imageHarness({
  width = 8000,
  height = 1,
  decodeError = false,
  contextError = false,
  encodeError = false,
} = {}) {
  let revoked = 0
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (contextError ? null : { drawImage() {} }),
    toBlob: (callback, type) =>
      callback(encodeError ? null : new Blob(['image'], { type })),
  }
  const utils = loadModule(
    'src/utils.ts',
    {},
    {
      Image: class {
        naturalWidth = width
        naturalHeight = height
        set src(_value) {
          queueMicrotask(() => (decodeError ? this.onerror() : this.onload()))
        }
      },
      URL: {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: () => revoked++,
      },
      document: { createElement: () => canvas },
    }
  )
  return { utils, canvas, revoked: () => revoked }
}

test('very narrow images retain a nonzero dimension and release their object URL', async () => {
  const { utils, canvas, revoked } = imageHarness()
  const result = await utils.resizeImageFile(
    new File(['image'], 'test.png', { type: 'image/png' }),
    4096
  )
  assert.equal(canvas.width, 4096)
  assert.equal(canvas.height, 1)
  assert.equal(result.resized, true)
  assert.equal(result.file.type, 'image/png')
  assert.equal(revoked(), 1)
})

test('small images return the original file without encoding', async () => {
  const { utils, revoked } = imageHarness({
    width: 100,
    height: 100,
    encodeError: true,
  })
  const file = new File(['image'], 'test.png', { type: 'image/png' })
  assert.deepEqual(await utils.resizeImageFile(file, 4096), {
    file,
    resized: false,
  })
  assert.equal(revoked(), 1)
})

for (const error of ['decodeError', 'contextError', 'encodeError']) {
  test(`${error} rejects the resize and releases its object URL`, async () => {
    const { utils, revoked } = imageHarness({ [error]: true })
    await assert.rejects(
      utils.resizeImageFile(
        new File(['image'], 'test.png', { type: 'image/png' }),
        4096
      )
    )
    assert.equal(revoked(), 1)
  })
}

function runtimeHarness({ cachedUpscale = false, failDownload = false } = {}) {
  const events = []
  let fail = failDownload
  const runtime = loadModule(
    'src/adapters/runtime.ts',
    {
      './opencv': { ensureOpenCV: async () => {} },
      './cache': {
        modelExists: async () => cachedUpscale,
        ensureModel: async type => type,
        removeCachedModel: async type => events.push(['remove', type]),
        downloadModel: async (type, progress) => {
          events.push(['download', type])
          if (fail) throw new Error('offline')
          progress(100)
        },
      },
      './util': {
        wasm: () => true,
        getCapabilities: async () => ({ webgpu: true, simd: true }),
        loadingOnnxruntime: async () => {},
        runtimeBase: 'https://runtime.test/',
      },
    },
    {
      ort: {
        env: { wasm: {} },
        InferenceSession: {
          create: async (type, options) => {
            events.push(['create', type, options.executionProviders[0]])
            return { release: async () => events.push(['release', type]) }
          },
        },
      },
    }
  )
  return {
    runtime,
    events,
    recover: () => {
      fail = false
    },
  }
}

test('repair releases sessions, replaces cached models and initializes WASM', async () => {
  const { runtime, events } = runtimeHarness({ cachedUpscale: true })
  await runtime.getSession('inpaint')
  const progress = []
  await runtime.repairRuntime(p => progress.push(p))
  assert.deepEqual(events, [
    ['create', 'inpaint', 'webgpu'],
    ['release', 'inpaint'],
    ['remove', 'inpaint'],
    ['download', 'inpaint'],
    ['create', 'inpaint', 'wasm'],
    ['remove', 'superResolution'],
    ['download', 'superResolution'],
    ['create', 'superResolution', 'wasm'],
  ])
  assert.equal(progress.at(-1), 100)
  await runtime.getSession('inpaint')
  assert.equal(events.length, 8)
})

test('repair refuses active inference without touching caches or sessions', async () => {
  const { runtime, events } = runtimeHarness()
  let finish
  const processing = runtime.withRuntime(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /Wait for image processing/
  )
  assert.deepEqual(events, [])
  finish()
  await processing
  await runtime.repairRuntime(() => {})
})

test('concurrent repairs share work, block inference, and failures allow retry', async () => {
  const { runtime, events, recover } = runtimeHarness({ failDownload: true })
  const first = runtime.repairRuntime(() => {})
  assert.equal(
    runtime.repairRuntime(() => {}),
    first
  )
  await assert.rejects(
    runtime.withRuntime(async () => {}),
    /repair in progress/
  )
  await assert.rejects(first, /offline/)
  recover()
  await runtime.repairRuntime(() => {})
  assert.equal(events.filter(event => event[0] === 'download').length, 2)
  await runtime.withRuntime(async () => {})
})

test('runtime loader falls back to another CDN and repair replaces the failed runtime', async () => {
  const { runInNewContext } = require('node:vm')
  const urls = []
  let removed = 0
  const context = {
    exports: {},
    setTimeout,
    clearTimeout,
    document: {
      createElement: () => ({ remove: () => removed++ }),
      head: {
        appendChild: script => {
          urls.push(script.src)
          queueMicrotask(() => {
            if (urls.length === 1) script.onerror()
            else {
              context.ort = { generation: urls.length }
              script.onload()
            }
          })
        },
      },
    },
  }
  context.window = context
  const source = readFileSync(
    resolve(__dirname, '../src/adapters/util.ts'),
    'utf8'
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })
  runInNewContext(outputText, context)
  await context.exports.loadingOnnxruntime(true)
  assert.match(urls[0], /cdn.jsdelivr.net/)
  assert.match(urls[1], /unpkg.com/)
  assert.equal(removed, 1)
  const oldRuntime = context.ort
  await context.exports.loadingOnnxruntime(true, true)
  assert.notEqual(context.ort, oldRuntime)
  assert.equal(context.ort.generation, 3)
  assert.match(urls[2], /ort.wasm.min.js$/)
})

test('OpenCV callers wait for delayed WASM initialization without assimilating its thenable', async () => {
  let checked = 0
  let deleted = 0
  let assimilated = false
  const cv = {
    then: () => {
      assimilated = true
    },
  }
  const { ensureOpenCV } = loadModule('src/adapters/opencv.ts', {
    'opencv-ts': cv,
  })
  const first = ensureOpenCV()
  assert.equal(ensureOpenCV(), first)
  setTimeout(() => {
    cv.Mat = class {
      constructor() {
        checked++
      }
      delete() {
        deleted++
      }
    }
    cv.MatVector = class {}
  }, 5)
  assert.equal(checked, 0)
  assert.equal(await first, undefined)
  assert.equal(checked, 1)
  assert.equal(deleted, 1)
  assert.equal(assimilated, false)
})

test('OpenCV initialization times out and can retry once the module becomes ready', async () => {
  const cv = {}
  let time = 0
  const { ensureOpenCV } = loadModule(
    'src/adapters/opencv.ts',
    { 'opencv-ts': cv },
    {
      Date: { now: () => time },
      setTimeout: callback => {
        time += 30_000
        queueMicrotask(callback)
      },
    }
  )
  await assert.rejects(ensureOpenCV(), /OpenCV initialization timed out/)
  cv.Mat = class {
    delete() {}
  }
  cv.MatVector = class {}
  await ensureOpenCV()
})

test('OpenCV readiness propagates allocation failures and permits retry', async () => {
  const cv = {
    Mat: class {
      constructor() {
        throw new Error('WASM aborted')
      }
    },
    MatVector: class {},
  }
  const { ensureOpenCV } = loadModule('src/adapters/opencv.ts', {
    'opencv-ts': cv,
  })
  await assert.rejects(ensureOpenCV(), /WASM aborted/)
  cv.Mat = class {
    delete() {}
  }
  await ensureOpenCV()
})

test('installed OpenCV initializes and allocates a real WASM matrix', async () => {
  const { ensureOpenCV, default: cv } = loadModule('src/adapters/opencv.ts')
  await ensureOpenCV()
  const mat = new cv.Mat(2, 3, cv.CV_8UC1)
  try {
    assert.equal(mat.rows, 2)
    assert.equal(mat.cols, 3)
    assert.equal(mat.data.length, 6)
  } finally {
    mat.delete()
  }
})

test('editor warmup and first inference share a single session initialization', async () => {
  const { runtime, events } = runtimeHarness()
  const warmup = runtime.warmupInpaint()
  const stages = []
  const session = runtime.getSession('inpaint', stage => stages.push(stage))
  await Promise.all([warmup, session])
  assert.deepEqual(events, [['create', 'inpaint', 'webgpu']])
  assert.deepEqual(stages, [
    'processing_runtime',
    'processing_model',
    'processing_initializing',
  ])
  await runtime.warmupInpaint()
  assert.equal(events.length, 1)
})

test('repair cannot reset the runtime while editor warmup is initializing', async () => {
  const { runtime } = runtimeHarness()
  const warmup = runtime.warmupInpaint()
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /Wait for image processing/
  )
  await warmup
  await runtime.repairRuntime(() => {})
})

function upscaleHarness() {
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims })
    }
  }
  const adapter = loadModule(
    'src/adapters/superResolution.ts',
    {
      './opencv': { default: {}, ensureOpenCV: async () => {} },
      './runtime': {},
    },
    {
      ort: { Tensor },
      ImageData: class {
        constructor(data, width, height) {
          Object.assign(this, { data, width, height })
        }
      },
      console: { log() {} },
      setTimeout: callback => queueMicrotask(callback),
    }
  )
  return { adapter, Tensor }
}

test('4x tiles use model I/O names and stitch edges with correct RGB and dimensions', async () => {
  const { adapter, Tensor } = upscaleHarness()
  const width = 53,
    height = 55,
    plane = width * height
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < input.length; i++) input[i] = (i % 251) / 255
  const statuses = [],
    progress = []
  let runs = 0
  const session = {
    inputNames: ['rgb'],
    outputNames: ['upscaled'],
    run: async feeds => {
      assert.equal(statuses.at(-1).tile, ++runs)
      const tile = feeds.rgb
      assert.ok(tile)
      const data = new Float32Array(3 * 256 * 256)
      for (let c = 0; c < 3; c++)
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 256; x++) {
            data[c * 256 * 256 + y * 256 + x] =
              tile.data[
                c * 64 * 64 + Math.floor(y / 4) * 64 + Math.floor(x / 4)
              ]
          }
      return { upscaled: new Tensor('float32', data, [1, 3, 256, 256]) }
    },
  }
  const result = await adapter.tileProc(
    new Tensor('float32', input, [1, 3, height, width]),
    session,
    p => progress.push(p),
    status => statuses.push(status)
  )
  assert.equal(result.width, width * 4)
  assert.equal(result.height, height * 4)
  assert.equal(runs, 4)
  for (let y = 0; y < result.height; y++)
    for (let x = 0; x < result.width; x++) {
      const source = Math.floor(y / 4) * width + Math.floor(x / 4)
      const dest = (y * result.width + x) * 4
      for (let c = 0; c < 3; c++)
        assert.equal(
          result.data[dest + c],
          Math.round(input[c * plane + source] * 255)
        )
      assert.equal(result.data[dest + 3], 255)
    }
  assert.deepEqual(progress, [25, 50, 75, 100])
})

test('4x upscaling rejects incompatible output before reporting completion', async () => {
  const { adapter, Tensor } = upscaleHarness()
  const progress = []
  await assert.rejects(
    adapter.tileProc(
      new Tensor('float32', new Float32Array(3), [1, 3, 1, 1]),
      {
        inputNames: ['rgb'],
        outputNames: ['result'],
        run: async () => ({
          result: new Tensor('float32', new Float32Array(3), [1, 3, 1, 1]),
        }),
      },
      p => progress.push(p)
    ),
    /Unexpected 4x model output shape/
  )
  assert.deepEqual(progress, [])
})
