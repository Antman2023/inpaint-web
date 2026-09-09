const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
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
    name => {
      if (name in dependencies) return dependencies[name]
      if (name.startsWith('.')) {
        const target = resolve(__dirname, '..', dirname(path), name)
        return loadModule(target + '.ts', dependencies, globals)
      }
      return require(name)
    },
    module,
    module.exports,
    ...Object.values(globals)
  )
  return module.exports
}

function languageHarness(storage, language = 'en-US') {
  return loadModule(
    'src/i18n.ts',
    {
      '../messages/en.json': require('../messages/en.json'),
      '../messages/zh.json': require('../messages/zh.json'),
    },
    { window: { localStorage: storage }, navigator: { language } }
  )
}

test('language selection persists across reloads and overrides the browser locale', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const first = languageHarness(storage, 'zh-CN')
  assert.equal(first.languageTag(), 'zh')
  first.setLanguageTag('en')
  assert.equal(first.message('download'), 'Download')
  const reloaded = languageHarness(storage, 'zh-CN')
  assert.equal(reloaded.languageTag(), 'en')
  reloaded.setLanguageTag('zh')
  assert.equal(languageHarness(storage, 'en-US').languageTag(), 'zh')
})

test('unavailable preference storage still allows language switching', () => {
  const i18n = languageHarness({
    getItem() {
      throw new Error('storage blocked')
    },
    setItem() {
      throw new Error('storage blocked')
    },
  })
  assert.equal(i18n.languageTag(), 'en')
  i18n.setLanguageTag('zh')
  assert.equal(i18n.message('download'), '下载')
})

test('invalid saved language falls back to a supported browser language', () => {
  for (const [locale, expected] of [
    ['zh-TW', 'zh'],
    ['en-GB', 'en'],
    ['fr-FR', 'en'],
  ]) {
    assert.equal(
      languageHarness({ getItem: () => 'invalid' }, locale).languageTag(),
      expected
    )
  }
})

test('brush paths stay aligned with the image after canvas resizing', () => {
  const { drawStroke } = loadModule('src/brush.ts')
  const stroke = Object.freeze({
    size: 0.1,
    pts: Object.freeze([
      Object.freeze({ x: 0.25, y: 0.5 }),
      Object.freeze({ x: 0.75, y: 0.25 }),
    ]),
  })
  for (const [width, height] of [
    [400, 200],
    [800, 400],
    [200, 100],
  ]) {
    const calls = []
    const ctx = {
      canvas: { width, height },
      beginPath() {},
      moveTo: (...args) => calls.push(['move', ...args]),
      lineTo: (...args) => calls.push(['line', ...args]),
      stroke() {
        calls.push(['stroke'])
      },
    }
    drawStroke(ctx, stroke, 'white')
    assert.equal(ctx.lineWidth, width * 0.1)
    assert.equal(ctx.strokeStyle, 'white')
    assert.deepEqual(calls, [
      ['move', width * 0.25, height * 0.5],
      ['line', width * 0.75, height * 0.25],
      ['stroke'],
    ])
  }
})

test('single brush taps use the same relative position and radius in preview and mask', () => {
  const { drawStroke } = loadModule('src/brush.ts')
  for (const color of [undefined, 'white']) {
    let circle,
      fills = 0
    const ctx = {
      canvas: { width: 600, height: 300 },
      beginPath() {},
      arc: (...args) => {
        circle = args
      },
      fill() {
        fills++
      },
    }
    drawStroke(ctx, { size: 0.05, pts: [{ x: 0.5, y: 0.25 }] }, color)
    assert.deepEqual(circle, [300, 75, 15, 0, Math.PI * 2])
    assert.equal(fills, 1)
    assert.equal(ctx.fillStyle, color ?? 'rgba(255, 0, 0, 0.5)')
  }
})

test('empty and cancelled strokes do not draw into the mask', () => {
  const { drawStroke } = loadModule('src/brush.ts')
  drawStroke({}, { pts: [] })
  drawStroke({}, { pts: [{ x: 0, y: 0 }] })
})

test('undo and redo retain results all the way to the original image', () => {
  const { historyReducer } = loadModule('src/history.ts')
  let state = { entries: [], index: -1 }
  const first = { src: 'first' },
    second = { src: 'second' }
  state = historyReducer(state, { type: 'append', entry: first })
  state = historyReducer(state, { type: 'append', entry: second })
  const entries = state.entries
  state = historyReducer(state, { type: 'undo' })
  assert.equal(state.entries[state.index], first)
  state = historyReducer(state, { type: 'undo' })
  assert.equal(state.index, -1)
  assert.equal(state.entries, entries)
  assert.equal(historyReducer(state, { type: 'undo' }), state)
  state = historyReducer(state, { type: 'redo' })
  assert.equal(state.entries[state.index], first)
  state = historyReducer(state, { type: 'redo' })
  assert.equal(state.entries[state.index], second)
  assert.equal(historyReducer(state, { type: 'redo' }), state)
})

test('history selection preserves later results until a new edit replaces the branch', () => {
  const { historyReducer } = loadModule('src/history.ts')
  const original = Object.freeze({
    entries: Object.freeze(['a', 'b', 'c']),
    index: 2,
  })
  const selected = historyReducer(original, { type: 'select', index: 0 })
  assert.equal(selected.entries, original.entries)
  assert.equal(historyReducer(selected, { type: 'redo' }).index, 1)
  const edited = historyReducer(selected, { type: 'append', entry: 'd' })
  assert.deepEqual(edited, { entries: ['a', 'd'], index: 1 })
  assert.equal(historyReducer(edited, { type: 'redo' }), edited)
  assert.deepEqual(original.entries, ['a', 'b', 'c'])
  const atOriginal = historyReducer(original, { type: 'select', index: -1 })
  assert.deepEqual(historyReducer(atOriginal, { type: 'append', entry: 'e' }), {
    entries: ['e'],
    index: 0,
  })
})

test('invalid history selections and navigation on an empty history are harmless', () => {
  const { historyReducer } = loadModule('src/history.ts')
  const state = { entries: ['a'], index: 0 }
  for (const index of [-2, 1, 0.5, NaN, Infinity]) {
    assert.equal(historyReducer(state, { type: 'select', index }), state)
  }
  const empty = { entries: [], index: -1 }
  assert.equal(historyReducer(empty, { type: 'undo' }), empty)
  assert.equal(historyReducer(empty, { type: 'redo' }), empty)
})

function importHarness({ fetch, resize = async file => ({ file }) } = {}) {
  const states = [],
    timers = new Map()
  let nextTimer = 0
  const { createImageImporter } = loadModule(
    'src/imageImport.ts',
    {
      './utils': { resizeImageFile: resize },
      './i18n': { message: key => key },
    },
    {
      fetch,
      setTimeout: callback => {
        timers.set(++nextTimer, callback)
        return nextTimer
      },
      clearTimeout: id => timers.delete(id),
    }
  )
  return {
    importer: createImageImporter(state => states.push(state)),
    states,
    timers,
  }
}

test('a late example response cannot replace a newer uploaded image', async () => {
  let finish, signal
  const { importer, states, timers } = importHarness({
    fetch: (_url, options) => {
      signal = options.signal
      return new Promise(resolve => {
        finish = resolve
      })
    },
  })
  const old = importer.load('/examples/dog.jpeg')
  const file = new File(['new'], 'new.png', { type: 'image/png' })
  await importer.load(file)
  assert.equal(signal.aborted, true)
  finish(new Response('old', { headers: { 'Content-Type': 'image/jpeg' } }))
  await old
  assert.deepEqual(
    states.map(state => state.status),
    ['loading', 'loading', 'ready']
  )
  assert.equal(states.at(-1).file, file)
  assert.equal(timers.size, 0)
})

test('late image decoding cannot overwrite the new selection or its timeout', async () => {
  const pending = new Map()
  const { importer, states, timers } = importHarness({
    resize: file => new Promise(resolve => pending.set(file.name, resolve)),
  })
  const old = importer.load(new File(['old'], 'old.png', { type: 'image/png' }))
  const file = new File(['new'], 'new.png', { type: 'image/png' })
  const next = importer.load(file)
  pending.get('old.png')({ file: new File(['old'], 'old.png') })
  await old
  assert.equal(states.at(-1).status, 'loading')
  assert.equal(timers.size, 1)
  pending.get('new.png')({ file })
  await next
  assert.equal(states.at(-1).file, file)
  assert.equal(timers.size, 0)
})

test('cancel and disposal suppress late results and errors', async () => {
  for (const action of ['cancel', 'dispose']) {
    let reject, signal
    const { importer, states, timers } = importHarness({
      fetch: (_url, options) => {
        signal = options.signal
        return new Promise((_resolve, fail) => {
          reject = fail
        })
      },
    })
    const task = importer.load('/examples/dog.jpeg')
    importer[action]()
    assert.equal(signal.aborted, true)
    const count = states.length
    reject(new Error('late failure'))
    await task
    assert.equal(states.length, count)
    assert.equal(timers.size, 0)
    const file = new File(['new'], 'new.png', { type: 'image/png' })
    await importer.load(file)
    if (action === 'dispose') assert.equal(states.length, count)
    else assert.equal(states.at(-1).file, file)
  }
})

test('import timeout aborts the request, reports an error, and permits retry', async () => {
  let signal
  const { importer, states, timers } = importHarness({
    fetch: (_url, options) => {
      signal = options.signal
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      )
    },
  })
  const task = importer.load('/examples/dog.jpeg')
  timers.values().next().value()
  await task
  assert.equal(signal.aborted, true)
  assert.deepEqual(states.at(-1), {
    status: 'error',
    error: 'image_import_timeout',
  })
  await importer.load(new File(['ok'], 'ok.png', { type: 'image/png' }))
  assert.equal(states.at(-1).status, 'ready')
  assert.equal(timers.size, 0)
})

test('uploads and examples share format, size and decoding validation', async () => {
  let decoded = 0
  const { importer, states, timers } = importHarness({
    fetch: async () =>
      new Response('bad image', { headers: { 'Content-Type': 'image/jpeg' } }),
    resize: async () => {
      decoded++
      throw new Error('Unable to decode image')
    },
  })
  await importer.load(new File(['text'], 'note.txt', { type: 'text/plain' }))
  assert.equal(states.at(-1).error, 'invalid_file')
  await importer.load(
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    })
  )
  assert.equal(states.at(-1).error, 'file_too_large')
  assert.equal(decoded, 0)
  await importer.load('/examples/dog.jpeg')
  assert.equal(states.at(-1).error, 'Unable to decode image')
  assert.equal(decoded, 1)
  assert.equal(timers.size, 0)
})

test('oversized example streams are cancelled before downloading the entire response', async () => {
  let cancelled = false,
    chunks = 0,
    decoded = false,
    signal
  const body = new ReadableStream({
    pull(controller) {
      if (++chunks <= 30) controller.enqueue(new Uint8Array(1024 * 1024))
      else controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  const { importer, states, timers } = importHarness({
    fetch: async (_url, options) => {
      signal = options.signal
      return new Response(body, { headers: { 'content-type': 'image/png' } })
    },
    resize: async file => {
      decoded = true
      return { file }
    },
  })
  await importer.load('/large.png')
  assert.equal(states.at(-1).error, 'file_too_large')
  assert.equal(cancelled, true)
  assert.ok(chunks < 30)
  assert.equal(decoded, false)
  assert.equal(body.locked, false)
  assert.equal(signal.aborted, true)
  assert.equal(timers.size, 0)
})

test('example streams accept the exact size limit and parse the image MIME', async () => {
  let received
  const { importer, states } = importHarness({
    fetch: async () =>
      new Response(new Uint8Array(10 * 1024 * 1024), {
        headers: { 'content-type': 'image/png; charset=binary' },
      }),
    resize: async file => {
      received = file
      return { file }
    },
  })
  await importer.load('/limit.png')
  assert.equal(received.size, 10 * 1024 * 1024)
  assert.equal(received.type, 'image/png')
  assert.equal(states.at(-1).status, 'ready')
})

test('broken example streams release the reader and allow a subsequent import', async () => {
  const body = new ReadableStream({
    pull(controller) {
      controller.error(new Error('connection interrupted'))
    },
  })
  const { importer, states } = importHarness({
    fetch: async () =>
      new Response(body, { headers: { 'content-type': 'image/png' } }),
  })
  await importer.load('/broken.png')
  assert.equal(states.at(-1).error, 'connection interrupted')
  assert.equal(body.locked, false)
  await importer.load(new File(['image'], 'valid.png', { type: 'image/png' }))
  assert.equal(states.at(-1).status, 'ready')
})

test('failed example HTTP responses are reported without decoding their body', async () => {
  const { importer, states } = importHarness({
    fetch: async () => new Response('missing', { status: 404 }),
  })
  await importer.load('/examples/missing.jpeg')
  assert.deepEqual(states.at(-1), {
    status: 'error',
    error: 'example_load_failed (404)',
  })
})

function cacheHarness(fetch, globals = {}, storage = {}) {
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
        ...storage,
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

test('downloads without a usable content length remain indeterminate until cached', async () => {
  for (const length of [undefined, '0', 'invalid', '-1']) {
    const progress = []
    const { cache } = cacheHarness(
      async () =>
        new Response(new Uint8Array([1, 2]), {
          headers: length === undefined ? {} : { 'content-length': length },
        })
    )
    await cache.downloadModel('inpaint', value => progress.push(value))
    assert.equal(progress.at(-1), 100)
    assert.ok(progress.slice(0, -1).every(value => value === null))
  }
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

test('a broken response releases its reader before a clean fallback is cached', async () => {
  let requests = 0
  const broken = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([9]))
    },
    pull(controller) {
      controller.error(new Error('connection lost'))
    },
  })
  const { cache } = cacheHarness(async () => {
    if (++requests === 1) return new Response(broken)
    assert.equal(broken.locked, false)
    return new Response(new Uint8Array([1, 2]))
  })
  await cache.downloadModel('inpaint', () => {})
  assert.equal(requests, 2)
  assert.deepEqual(
    new Uint8Array(await cache.loadModel('inpaint')),
    new Uint8Array([1, 2])
  )
})

test('throwing progress observers cannot reject or restart a shared download', async () => {
  let requests = 0
  const reported = [],
    progress = []
  const { cache } = cacheHarness(
    async () => {
      requests++
      return new Response(new Uint8Array([1]), {
        headers: { 'content-length': '1' },
      })
    },
    { console: { error: (...args) => reported.push(args) } }
  )
  await Promise.all([
    cache.downloadModel('inpaint', () => {
      throw new Error('observer failed')
    }),
    cache.downloadModel('inpaint', value => progress.push(value)),
  ])
  assert.equal(requests, 1)
  assert.equal(progress.at(-1), 100)
  assert.ok(reported.length > 0)
  assert.equal((await cache.loadModel('inpaint')).byteLength, 1)
})

test('cache write failure does not redownload and the next attempt can recover', async () => {
  let requests = 0,
    fail = true
  const progress = []
  const quotaError = new Error('storage quota exceeded')
  const { cache, stored } = cacheHarness(
    async () => {
      requests++
      return new Response(new Uint8Array([7]))
    },
    {},
    {
      async setItem(key, value) {
        if (fail) throw quotaError
        stored.set(key, value)
      },
    }
  )
  await assert.rejects(
    cache.downloadModel('inpaint', value => progress.push(value)),
    error => error === quotaError
  )
  assert.equal(requests, 1)
  assert.equal(progress.includes(100), false)
  assert.equal(stored.size, 0)
  fail = false
  await cache.downloadModel('inpaint', value => progress.push(value))
  assert.equal(requests, 2)
  assert.equal(progress.at(-1), 100)
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
  decodePending = false,
  encodePending = false,
  encodeThrows = false,
} = {}) {
  let revoked = 0
  const images = [],
    encodedSizes = []
  let finishEncoding
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (contextError ? null : { drawImage() {} }),
    toBlob: (callback, type) => {
      encodedSizes.push([canvas.width, canvas.height])
      if (encodeThrows) throw new Error('Encoding failed synchronously')
      if (encodePending) {
        finishEncoding = callback
        return
      }
      callback(encodeError ? null : new Blob(['image'], { type }))
    },
  }
  const utils = loadModule(
    'src/utils.ts',
    {},
    {
      Image: class {
        constructor() {
          images.push(this)
        }
        naturalWidth = width
        naturalHeight = height
        set src(_value) {
          if (!decodePending)
            queueMicrotask(() =>
              decodeError ? this.onerror?.() : this.onload?.()
            )
        }
        removeAttribute(name) {
          assert.equal(name, 'src')
          this.sourceRemoved = true
        }
      },
      URL: {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: () => revoked++,
      },
      document: { createElement: () => canvas },
    }
  )
  return {
    utils,
    canvas,
    images,
    encodedSizes,
    finishEncoding: value => finishEncoding(value),
    revoked: () => revoked,
  }
}

test('very narrow images retain a nonzero dimension and release their object URL', async () => {
  const { utils, canvas, encodedSizes, revoked } = imageHarness()
  const result = await utils.resizeImageFile(
    new File(['image'], 'test.png', { type: 'image/png' }),
    4096
  )
  assert.deepEqual(encodedSizes, [[4096, 1]])
  assert.equal(canvas.width, 0)
  assert.equal(canvas.height, 0)
  assert.equal(result.resized, true)
  assert.equal(result.file.type, 'image/png')
  assert.equal(revoked(), 1)
})

test('resizing uses the actual encoder MIME when the requested format falls back', async () => {
  const { utils, finishEncoding } = imageHarness({ encodePending: true })
  const resizing = utils.resizeImageFile(
    new File(['image'], 'holiday.webp', { type: 'image/webp' }),
    4096
  )
  await new Promise(resolve => setImmediate(resolve))
  finishEncoding(new Blob(['png'], { type: 'image/png' }))
  const { file } = await resizing
  assert.equal(file.type, 'image/png')
  assert.equal(file.name, 'holiday.png')
})

test('export names match the format and retain the source name for edited results', () => {
  const { imageFileName } = loadModule('src/utils.ts')
  for (const [name, mime, edited, expected] of [
    ['holiday.JPEG', 'image/jpeg', false, 'holiday.JPEG'],
    ['holiday.webp', 'image/png', false, 'holiday.png'],
    ['holiday.v2.jpg', 'image/png', true, 'holiday.v2-edited.png'],
    ['holiday', 'image/webp', false, 'holiday.webp'],
    ['', 'image/png', true, 'image-edited.png'],
    ['.photo', 'image/png', false, '.photo.png'],
  ])
    assert.equal(imageFileName(name, mime, edited), expected)
})

for (const fails of [false, true]) {
  test(`download activates a connected anchor and cleans it after ${fails ? 'failure' : 'success'}`, () => {
    let connected = false,
      clicked = false
    const anchor = {
      click() {
        assert.equal(connected, true)
        assert.equal(this.hidden, true)
        clicked = true
        if (fails) throw new Error('click failed')
      },
      remove() {
        connected = false
      },
    }
    const { downloadImage } = loadModule(
      'src/utils.ts',
      {},
      {
        document: {
          createElement: () => anchor,
          body: {
            appendChild() {
              connected = true
            },
          },
        },
      }
    )
    const download = () =>
      downloadImage('blob:current-result', 'holiday-edited.png')
    if (fails) assert.throws(download, /click failed/)
    else download()
    assert.equal(clicked, true)
    assert.equal(connected, false)
    assert.equal(anchor.href, 'blob:current-result')
    assert.equal(anchor.download, 'holiday-edited.png')
  })
}

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

test('image loading clears handlers after success and permits reusing the image', async () => {
  const { loadImage } = loadModule('src/utils.ts')
  const image = { src: '', onload: null, onerror: null }
  const first = loadImage(image, 'first.png')
  image.onload()
  await first
  assert.equal(image.onload, null)
  assert.equal(image.onerror, null)
  const second = loadImage(image, 'second.png')
  assert.equal(image.src, 'second.png')
  image.onload()
  await second
  assert.equal(image.onload, null)
  assert.equal(image.onerror, null)
})

test('failed image loading rejects once without reloading the broken source', async () => {
  const { loadImage } = loadModule('src/utils.ts')
  const sources = []
  const image = {
    get src() {
      return sources.at(-1) ?? ''
    },
    set src(value) {
      sources.push(value)
    },
    onload: null,
    onerror: null,
  }
  const loading = loadImage(image, 'broken.png')
  image.onerror(new Event('error'))
  await assert.rejects(loading, /Unable to decode image/)
  assert.deepEqual(sources, ['broken.png'])
  assert.equal(image.onload, null)
  assert.equal(image.onerror, null)
  const retry = loadImage(image, 'valid.png')
  image.onload()
  await retry
})

function runtimeHarness({
  cachedUpscale = false,
  failDownload = false,
  createSession = async () => {},
  releaseSession = async () => {},
} = {}) {
  const events = []
  const runtimeLoads = []
  const observerErrors = []
  let fail = failDownload
  const runtime = loadModule(
    'src/adapters/runtime.ts',
    {
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
        loadingOnnxruntime: async (compatible, reset) => {
          runtimeLoads.push({ compatible, reset })
        },
        runtimeBase: 'https://runtime.test/',
      },
    },
    {
      console: { error: (...args) => observerErrors.push(args), warn() {} },
      ort: {
        env: { wasm: {} },
        InferenceSession: {
          create: async (type, options) => {
            events.push(['create', type, options.executionProviders[0]])
            await createSession(type, options.executionProviders[0])
            return {
              release: async () => {
                events.push(['release', type])
                await releaseSession(type)
              },
            }
          },
        },
      },
    }
  )
  return {
    runtime,
    events,
    runtimeLoads,
    observerErrors,
    recover: () => {
      fail = false
    },
  }
}

test('GPU initialization failure falls back once and concurrent callers share the WASM session', async () => {
  const { runtime, events, runtimeLoads } = runtimeHarness({
    createSession: async (_type, provider) => {
      if (provider === 'webgpu') throw new Error('GPU model unsupported')
    },
  })
  const [first, second] = await Promise.all([
    runtime.getSession('inpaint'),
    runtime.getSession('inpaint'),
  ])
  assert.equal(first, second)
  assert.deepEqual(events, [
    ['create', 'inpaint', 'webgpu'],
    ['create', 'inpaint', 'wasm'],
  ])
  assert.equal(runtimeLoads.length, 1)
  assert.equal(await runtime.getSession('inpaint'), first)
  assert.equal(events.length, 2)
})

test('a failed WASM fallback reports its error and leaves initialization retryable', async () => {
  const wasmError = new Error('WASM initialization failed')
  let fail = true
  const { runtime, events } = runtimeHarness({
    createSession: async (_type, provider) => {
      if (!fail) return
      throw provider === 'wasm'
        ? wasmError
        : new Error('GPU initialization failed')
    },
  })
  await assert.rejects(
    runtime.getSession('inpaint'),
    error => error === wasmError
  )
  assert.equal(events.length, 2)
  fail = false
  assert.ok(await runtime.getSession('inpaint'))
  assert.equal(events.length, 3)
})

for (const failingStage of [
  'processing_runtime',
  'processing_model',
  'processing_initializing',
]) {
  test(`a throwing ${failingStage} observer cannot interrupt a shared session`, async () => {
    const { runtime, events, observerErrors } = runtimeHarness()
    const stages = []
    const [first, second] = await Promise.all([
      runtime.getSession('inpaint', stage => {
        if (stage === failingStage) throw new Error('observer failed')
      }),
      runtime.getSession('inpaint', stage => stages.push(stage)),
    ])
    assert.equal(first, second)
    assert.equal(events.filter(event => event[0] === 'create').length, 1)
    assert.deepEqual(stages, [
      'processing_runtime',
      'processing_model',
      'processing_initializing',
    ])
    assert.equal(observerErrors.length, 1)
    await runtime.repairRuntime(() => {})
    assert.equal(
      observerErrors.length,
      1,
      'settled observers must be unsubscribed'
    )
  })
}

test('throwing repair progress callbacks cannot leave a successful repair blocked', async () => {
  const { runtime, events, observerErrors } = runtimeHarness()
  await runtime.getSession('inpaint')
  await runtime.repairRuntime(() => {
    throw new Error('progress observer failed')
  })
  assert.ok(observerErrors.length >= 3)
  assert.ok(events.some(event => event[0] === 'release'))
  const session = await runtime.getSession('inpaint')
  assert.equal(await runtime.withRuntime(async () => session), session)
  assert.equal(events.filter(event => event[0] === 'create').length, 2)
})

test('observer exceptions do not mask real initialization failures or prevent retries', async () => {
  const failure = new Error('model initialization failed')
  let fail = true
  const { runtime } = runtimeHarness({
    createSession: async () => {
      if (fail) throw failure
    },
  })
  const results = await Promise.allSettled([
    runtime.getSession('inpaint', () => {
      throw new Error('observer failed')
    }),
    runtime.getSession('inpaint'),
  ])
  for (const result of results) {
    assert.equal(result.status, 'rejected')
    assert.equal(result.reason, failure)
  }
  fail = false
  assert.ok(await runtime.getSession('inpaint'))
})

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

test('runtime serializes work across callers and blocks repair until the queue drains', async () => {
  const { runtime, events } = runtimeHarness()
  const order = []
  let finishFirst
  let finishSecond
  const first = runtime.withRuntime(async () => {
    order.push('first starts')
    await new Promise(resolve => {
      finishFirst = resolve
    })
    order.push('first finishes')
    return 'first result'
  })
  const second = runtime.withRuntime(async () => {
    order.push('second starts')
    await new Promise(resolve => {
      finishSecond = resolve
    })
    order.push('second finishes')
    return 'second result'
  })
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /Wait for image processing/
  )
  assert.deepEqual(order, ['first starts'])
  assert.deepEqual(events, [])
  finishFirst()
  assert.equal(await first, 'first result')
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /Wait for image processing/
  )
  assert.deepEqual(order, ['first starts', 'first finishes', 'second starts'])
  finishSecond()
  assert.equal(await second, 'second result')
  await runtime.repairRuntime(() => {})
  assert.equal(order.at(-1), 'second finishes')
})

test('closing an editor skips its queued work without interrupting active inference', async () => {
  const { runtime } = runtimeHarness()
  const activeController = new AbortController()
  const queuedController = new AbortController()
  const order = []
  let finish
  const active = runtime.withRuntime(async () => {
    order.push('active')
    await new Promise(resolve => {
      finish = resolve
    })
    order.push('finished')
  }, activeController.signal)
  const queued = runtime.withRuntime(async () => {
    order.push('cancelled task ran')
  }, queuedController.signal)
  const cancelled = assert.rejects(
    queued,
    error => error === queuedController.signal.reason
  )
  const next = runtime.withRuntime(async () => {
    order.push('new editor')
  })
  await Promise.resolve()
  activeController.abort()
  queuedController.abort()
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /Wait for image processing/
  )
  assert.deepEqual(order, ['active'])
  finish()
  await Promise.all([active, cancelled, next])
  assert.deepEqual(order, ['active', 'finished', 'new editor'])
  await runtime.repairRuntime(() => {})
})

test('an already closed editor cannot enqueue work or prevent runtime repair', async () => {
  const { runtime } = runtimeHarness()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runtime.withRuntime(
      async () => assert.fail('cancelled operation ran'),
      controller.signal
    ),
    error => error === controller.signal.reason
  )
  await runtime.repairRuntime(() => {})
})

test('failed runtime work preserves its error and lets queued callers continue', async () => {
  const { runtime } = runtimeHarness()
  const failure = new Error('inference failed')
  const order = []
  const first = runtime.withRuntime(() => {
    order.push('failed')
    throw failure
  })
  const second = runtime.withRuntime(async () => {
    order.push('recovered')
    return 42
  })
  await assert.rejects(first, error => error === failure)
  assert.equal(await second, 42)
  assert.deepEqual(order, ['failed', 'recovered'])
  await runtime.repairRuntime(() => {})
  assert.equal(await runtime.withRuntime(async () => 43), 43)
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

test('GPU probing falls back after synchronous and asynchronous driver failures', async () => {
  for (const requestAdapter of [
    () => {
      throw new Error('driver failed')
    },
    async () => {
      throw new Error('driver failed')
    },
    async () => null,
  ]) {
    const { checkWebgpu } = loadModule(
      'src/adapters/util.ts',
      {},
      {
        navigator: { gpu: { requestAdapter } },
      }
    )
    assert.equal(await checkWebgpu(), false)
  }
})

test('stalled GPU probing times out and ignores a late adapter result', async () => {
  let finish,
    expire,
    activeTimer = false
  const { checkWebgpu } = loadModule(
    'src/adapters/util.ts',
    {},
    {
      navigator: {
        gpu: {
          requestAdapter: () =>
            new Promise(resolve => {
              finish = resolve
            }),
        },
      },
      setTimeout: (fn, ms) => {
        assert.equal(ms, 5000)
        expire = fn
        activeTimer = true
        return 1
      },
      clearTimeout: () => {
        activeTimer = false
      },
    }
  )
  const probe = checkWebgpu()
  expire()
  assert.equal(await probe, false)
  assert.equal(activeTimer, false)
  finish({})
  assert.equal(await probe, false)
})

test('successful GPU probing clears its deadline and compatibility mode skips the driver', async () => {
  let requests = 0,
    timers = 0
  const { checkWebgpu, getCapabilities } = loadModule(
    'src/adapters/util.ts',
    {},
    {
      navigator: {
        gpu: {
          requestAdapter: async () => {
            requests++
            return {}
          },
        },
      },
      setTimeout: () => {
        timers++
        return 1
      },
      clearTimeout: () => {
        timers--
      },
    }
  )
  assert.equal(await checkWebgpu(), true)
  assert.equal(timers, 0)
  assert.equal((await getCapabilities(true)).webgpu, false)
  assert.equal(requests, 1)
})

for (const fail of [false, true]) {
  test(`thread probing closes both message ports after ${fail ? 'failure' : 'success'}`, async () => {
    const closed = []
    const { threads } = loadModule(
      'src/adapters/util.ts',
      {},
      {
        MessageChannel: class {
          port1 = {
            postMessage() {
              if (fail) throw new Error('shared memory blocked')
            },
            close: () => closed.push(1),
          }
          port2 = { close: () => closed.push(2) }
        },
        SharedArrayBuffer: class {},
        WebAssembly: { validate: () => true },
      }
    )
    assert.equal(await threads(), !fail)
    assert.deepEqual(closed, [1, 2])
  })
}

function runtimeScriptHarness({ appendError = false } = {}) {
  const scripts = [],
    timers = new Map()
  let timerId = 0
  const context = {
    exports: {},
    setTimeout: fn => {
      timers.set(++timerId, fn)
      return timerId
    },
    clearTimeout: id => timers.delete(id),
    document: {
      createElement: () => ({
        remove() {
          this.removed = true
        },
      }),
      head: {
        appendChild(script) {
          scripts.push(script)
          if (appendError) throw new Error('append blocked')
        },
      },
    },
  }
  context.window = context
  const { outputText } = ts.transpileModule(
    readFileSync(resolve(__dirname, '../src/adapters/util.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  )
  require('node:vm').runInNewContext(outputText, context)
  return { context, scripts, timers, loader: context.exports }
}

test('runtime timeout cleans handlers before fallback and ignores late events', async () => {
  const { context, scripts, timers, loader } = runtimeScriptHarness()
  const task = loader.loadingOnnxruntime(true)
  assert.equal(loader.loadingOnnxruntime(true), task)
  const first = scripts[0],
    lateLoad = first.onload,
    lateError = first.onerror
  timers.values().next().value()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(first.onload, null)
  assert.equal(first.onerror, null)
  assert.equal(first.removed, true)
  assert.equal(scripts.length, 2)
  context.ort = { ready: true }
  scripts[1].onload()
  await task
  lateLoad()
  lateError()
  assert.equal(scripts.length, 2)
  assert.equal(timers.size, 0)
  assert.equal(scripts[1].onload, null)
  assert.equal(scripts[1].onerror, null)
})

test('repair alternates CDN sources and keeps WASM on the successful source', async () => {
  const { context, scripts, loader } = runtimeScriptHarness()
  const first = loader.loadingOnnxruntime(true)
  scripts[0].onerror()
  await new Promise(resolve => setImmediate(resolve))
  context.ort = {}
  scripts[1].onload()
  await first
  assert.match(loader.runtimeBase, /unpkg.com/)
  const repaired = loader.loadingOnnxruntime(true, true)
  assert.match(scripts[2].src, /unpkg.com/)
  scripts[2].onerror()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(scripts[3].src, /cdn.jsdelivr.net/)
  context.ort = {}
  scripts[3].onload()
  await repaired
  assert.match(loader.runtimeBase, /cdn.jsdelivr.net/)
})

test('synchronous script insertion failure clears timers and permits retry', async () => {
  const { scripts, timers, loader } = runtimeScriptHarness({
    appendError: true,
  })
  for (let attempt = 1; attempt <= 2; attempt++) {
    await assert.rejects(
      loader.loadingOnnxruntime(true),
      /Failed to load ONNX Runtime/
    )
    assert.equal(scripts.length, attempt * 2)
    assert.equal(timers.size, 0)
    assert.ok(
      scripts.every(
        script =>
          script.removed && script.onload === null && script.onerror === null
      )
    )
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

// Fixed pixel expectations captured from the former OpenCV preprocessing.
const pixelFixture = new Uint8ClampedArray([
  255, 0, 128, 255, 10, 20, 30, 255, 254, 254, 254, 255, 255, 255, 255, 255,
])
function preprocessHarness(failure, pixels = pixelFixture) {
  const draws = []
  const canvas = {
    getContext: () =>
      failure === 'context'
        ? null
        : {
            drawImage: (...args) => {
              if (failure === 'draw') throw new Error('draw failed')
              draws.push(args)
            },
            getImageData: () => {
              if (failure === 'read') throw new Error('read failed')
              return { data: pixels }
            },
          },
  }
  return {
    canvas,
    draws,
    adapter: loadModule(
      'src/adapters/preprocess.ts',
      {},
      {
        document: { createElement: () => canvas },
      }
    ),
  }
}

test('Canvas RGB conversion retains natural resolution, CHW order and normalization', () => {
  const { adapter, canvas, draws } = preprocessHarness()
  const image = { naturalWidth: 2, naturalHeight: 2, width: 20, height: 10 }
  const expected = new Uint8Array([
    255, 10, 254, 255, 0, 20, 254, 255, 128, 30, 254, 255,
  ])
  assert.deepEqual(adapter.readRGB(image), expected)
  assert.deepEqual(
    adapter.readRGB(image, true),
    Float32Array.from(expected, n => n / 255)
  )
  assert.deepEqual(draws[0].slice(1), [0, 0, 2, 2])
  assert.equal(canvas.width, 0)
  assert.equal(canvas.height, 0)
})

test('Canvas masks preserve the old white threshold, near-white and transparent edges', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 0, 255, 255, 255, 255, 254, 254, 254, 255, 255, 255, 254, 255, 254,
    255, 255, 255, 255, 254, 255, 255, 255, 255, 255, 1, 128, 128, 128, 128,
  ])
  const { adapter, canvas, draws } = preprocessHarness(undefined, pixels)
  const source = { width: 2, height: 2 }
  assert.deepEqual(
    adapter.readResizedMask(source, 4, 2),
    new Uint8Array([255, 0, 255, 0, 0, 255, 0, 255])
  )
  assert.deepEqual(draws[0], [source, 0, 0, 4, 2])
  assert.equal(canvas.width, 0)
  assert.equal(canvas.height, 0)
})

for (const failure of ['context', 'draw', 'read']) {
  test(`pixel preprocessing releases its canvas after ${failure} fails`, () => {
    const { adapter, canvas } = preprocessHarness(failure)
    assert.throws(
      () => adapter.readMask({ width: 2, height: 2 }),
      /context|draw|read/
    )
    assert.equal(canvas.width, 0)
    assert.equal(canvas.height, 0)
  })
}

function upscaleHarness({ runtime = {}, globals = {} } = {}) {
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims })
    }
  }
  const adapter = loadModule(
    'src/adapters/superResolution.ts',
    {
      '../utils': loadModule('src/utils.ts'),
      '../imageResources': loadModule('src/imageResources.ts', {}, globals),
      './preprocess': {},
      './runtime': runtime,
      '../imageSize': loadModule('src/imageSize.ts'),
      '../i18n': { message: key => key },
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
      ...globals,
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
  const tileBuffers = new Set()
  const session = {
    inputNames: ['rgb'],
    outputNames: ['upscaled'],
    run: async feeds => {
      assert.equal(statuses.at(-1).tile, ++runs)
      const tile = feeds.rgb
      assert.ok(tile)
      tileBuffers.add(tile.data.buffer)
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
  assert.equal(tileBuffers.size, 1)
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

test('4x upscaling rejects malformed inputs before inference or progress', async () => {
  const { adapter, Tensor } = upscaleHarness()
  for (const [data, dims] of [
    [new Float32Array(3), [1, 3, 0, 1]],
    [new Float32Array(3), [1, 1, 1, 3]],
    [new Float32Array(2), [1, 3, 1, 1]],
    [new Uint8Array(3), [1, 3, 1, 1]],
    [new Float32Array(1001 * 1250 * 3), [1, 3, 1001, 1250]],
  ]) {
    let called = false
    await assert.rejects(
      adapter.tileProc(
        new Tensor('float32', data, dims),
        {
          run: async () => {
            called = true
          },
        },
        () => {
          called = true
        }
      )
    )
    assert.equal(called, false)
  }
})

test('4x upscaling rejects truncated outputs even when dimensions are valid', async () => {
  const { adapter, Tensor } = upscaleHarness()
  const progress = []
  await assert.rejects(
    adapter.tileProc(
      new Tensor('float32', new Float32Array(3), [1, 3, 1, 1]),
      {
        inputNames: ['rgb'],
        outputNames: ['result'],
        run: async () => ({
          result: new Tensor('float32', new Float32Array(3), [1, 3, 256, 256]),
        }),
      },
      p => progress.push(p)
    ),
    /data length/
  )
  assert.deepEqual(progress, [])
})

function inpaintOutputHarness(
  output,
  encodeError = false,
  runSession = async () => ({ result: output }),
  runtimeOverride
) {
  let rendered
  const images = []
  class MockImage {
    constructor() {
      images.push(this)
    }
    naturalWidth = 2
    naturalHeight = 1
    width = 20
    height = 10
    set src(value) {
      queueMicrotask(() => this.onload?.())
    }
  }
  const canvas = {
    getContext: () => ({
      drawImage() {},
      putImageData(image) {
        rendered = image
      },
    }),
    toBlob: callback => {
      if (encodeError) throw new Error('encode failed')
      callback(new Blob(['result'], { type: 'image/png' }))
    },
  }
  const adapter = loadModule(
    'src/adapters/inpainting.ts',
    {
      '../utils': loadModule('src/utils.ts'),
      './preprocess': {
        readRGB: () => new Uint8Array(6),
        readResizedMask: () => new Uint8Array(2),
      },
      './runtime': {
        withRuntime: runtimeOverride?.withRuntime ?? (task => task()),
        getSession: async () => ({
          inputNames: ['rgb', 'mask'],
          outputNames: ['result'],
          run: runSession,
        }),
      },
    },
    {
      Image: MockImage,
      HTMLImageElement: MockImage,
      document: { createElement: () => canvas },
      ort: {
        Tensor: class {
          constructor(type, data, dims) {
            Object.assign(this, { type, data, dims })
          }
        },
      },
      ImageData: class {
        constructor(data, width, height) {
          Object.assign(this, { data, width, height })
        }
      },
      console: { time() {}, timeEnd() {} },
    }
  )
  return {
    run: (mask = {}, signal) =>
      adapter.default(new MockImage(), mask, undefined, signal),
    images,
    rendered: () => rendered,
    canvas,
  }
}

test('upscale file decoding failure clears callbacks and revokes its object URL', async () => {
  const images = [],
    revoked = []
  class MockImage {
    constructor() {
      images.push(this)
    }
    removeAttribute() {}
    set src(_value) {
      queueMicrotask(() => this.onerror?.())
    }
  }
  const { adapter } = upscaleHarness({
    runtime: {
      withRuntime: task => task(),
      getSession() {
        throw new Error('must not initialize before decoding')
      },
    },
    globals: {
      Image: MockImage,
      HTMLImageElement: MockImage,
      URL: {
        createObjectURL: () => 'blob:private-image',
        revokeObjectURL: url => revoked.push(url),
      },
    },
  })
  await assert.rejects(
    adapter.default(new File(['bad'], 'bad.png'), () => {}),
    error => error.message === 'Unable to decode image'
  )
  assert.deepEqual(revoked, ['blob:private-image'])
  assert.equal(images[0].onload, null)
  assert.equal(images[0].onerror, null)
})

for (const fails of [false, true]) {
  test(`inpainting releases the output canvas after encoding ${fails ? 'fails' : 'succeeds'}`, async () => {
    const { run, canvas } = inpaintOutputHarness(
      {
        data: new Uint8Array(6),
        dims: [1, 3, 1, 2],
      },
      fails
    )
    if (fails) await assert.rejects(run(), /encode failed/)
    else assert.equal(await (await run()).text(), 'result')
    assert.equal(canvas.width, 0)
    assert.equal(canvas.height, 0)
  })
}

test('inpainting validates output shape and length before rendering', async () => {
  for (const output of [
    undefined,
    { data: new Float32Array(6), dims: [1, 3, 1, 2] },
    { data: new Uint8Array(6), dims: [1, 3, 2, 1] },
    { data: new Uint8Array(3), dims: [1, 3, 1, 2] },
  ]) {
    const { run, rendered } = inpaintOutputHarness(output)
    await assert.rejects(run(), /output tensor|output shape/)
    assert.equal(rendered(), undefined)
  }
})

test('inpainting converts valid planar output to RGBA without changing pixels', async () => {
  const { run, rendered } = inpaintOutputHarness({
    data: new Uint8Array([1, 2, 3, 4, 5, 6]),
    dims: [1, 3, 1, 2],
  })
  assert.equal(await (await run()).text(), 'result')
  assert.deepEqual(
    rendered().data,
    new Uint8ClampedArray([1, 3, 5, 255, 2, 4, 6, 255])
  )
})

test('direct session initialization prevents runtime repair until it settles', async () => {
  let finish
  const initialized = new Promise(resolve => {
    finish = resolve
  })
  const { runtime, runtimeLoads } = runtimeHarness({
    createSession: () => initialized,
  })
  const session = runtime.getSession('inpaint')
  const repair = runtime.repairRuntime(() => {})
  finish()
  await assert.rejects(repair, /Wait for image processing/)
  await session
  assert.equal(
    runtimeLoads.some(load => load.reset),
    false
  )
  await runtime.repairRuntime(() => {})
})

test('repair blocks direct session access as well as inference', async () => {
  const { runtime } = runtimeHarness()
  const repairing = runtime.repairRuntime(() => {})
  await assert.rejects(runtime.getSession('inpaint'), /repair in progress/)
  await repairing
  await runtime.getSession('inpaint')
})

test('a failed release still cleans other sessions and can retry the failed session', async () => {
  let failRelease = true
  const { runtime, events, runtimeLoads } = runtimeHarness({
    cachedUpscale: true,
    releaseSession: async type => {
      if (type === 'inpaint' && failRelease) throw new Error('device busy')
    },
  })
  await runtime.getSession('inpaint')
  await runtime.getSession('superResolution')
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /device busy/
  )
  assert.deepEqual(
    events.filter(event => event[0] === 'release'),
    [
      ['release', 'inpaint'],
      ['release', 'superResolution'],
    ]
  )
  assert.equal(
    runtimeLoads.some(load => load.reset),
    false
  )
  await assert.rejects(runtime.getSession('inpaint'), /repair is incomplete/)
  await assert.rejects(
    runtime.withRuntime(async () => {}),
    /repair is incomplete/
  )
  failRelease = false
  await runtime.repairRuntime(() => {})
  assert.equal(
    events.filter(event => event[0] === 'release' && event[1] === 'inpaint')
      .length,
    2
  )
  assert.equal(
    events.filter(
      event => event[0] === 'release' && event[1] === 'superResolution'
    ).length,
    1
  )
  await runtime.withRuntime(async () => {})
})

test('an incomplete runtime reset requires successful repair before new inference', async () => {
  const { runtime, recover } = runtimeHarness({ failDownload: true })
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /offline/
  )
  await assert.rejects(runtime.getSession('inpaint'), /repair is incomplete/)
  await assert.rejects(
    runtime.withRuntime(async () => {}),
    /repair is incomplete/
  )
  recover()
  await runtime.repairRuntime(() => {})
  await runtime.withRuntime(() => runtime.getSession('inpaint'))
})

test('repair acquires its lock before invoking progress callbacks', async () => {
  const { runtime } = runtimeHarness()
  let nestedRepair, deniedSession, deniedInference
  const repairing = runtime.repairRuntime(progress => {
    if (progress !== 0 || nestedRepair) return
    nestedRepair = runtime.repairRuntime(() => {})
    deniedSession = assert.rejects(
      runtime.getSession('inpaint'),
      /repair in progress/
    )
    deniedInference = assert.rejects(
      runtime.withRuntime(async () => {}),
      /repair in progress/
    )
  })
  await repairing
  assert.equal(nestedRepair, repairing)
  await Promise.all([deniedSession, deniedInference])
})

test('failed session initialization releases the initialization guard for repair', async () => {
  let fail = true
  const { runtime } = runtimeHarness({
    createSession: async () => {
      if (fail) throw new Error('initialization failed')
    },
  })
  await assert.rejects(runtime.getSession('inpaint'), /initialization failed/)
  fail = false
  await runtime.repairRuntime(() => {})
  await runtime.withRuntime(() => runtime.getSession('inpaint'))
})

test('upscale planning accepts the exact pixel limit and rejects larger images', () => {
  const { getUpscalePlan } = loadModule('src/imageSize.ts')
  assert.deepEqual(getUpscalePlan(1250, 1000), {
    ok: true,
    width: 5000,
    height: 4000,
  })
  assert.deepEqual(getUpscalePlan(1251, 1000), {
    ok: false,
    reason: 'upscale_too_large',
  })
  assert.deepEqual(getUpscalePlan(1, 1), { ok: true, width: 4, height: 4 })
  assert.deepEqual(getUpscalePlan(1000, 1250), {
    ok: true,
    width: 4000,
    height: 5000,
  })
})

test('upscale planning rejects invalid dimensions and checks repeated upscaling', () => {
  const { getUpscalePlan } = loadModule('src/imageSize.ts')
  for (const value of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.deepEqual(getUpscalePlan(value, 1), {
      ok: false,
      reason: 'invalid_image_dimensions',
    })
    assert.deepEqual(getUpscalePlan(1, value), {
      ok: false,
      reason: 'invalid_image_dimensions',
    })
  }
  const first = getUpscalePlan(1000, 1000)
  assert.equal(first.ok, true)
  assert.deepEqual(getUpscalePlan(first.width, first.height), {
    ok: false,
    reason: 'upscale_too_large',
  })
})

test('oversized source images are rejected before acquiring an upscale model session', async () => {
  class MockImage {
    naturalWidth = 1251
    naturalHeight = 1000
    width = 100
    height = 80
  }
  let sessions = 0
  const { adapter } = upscaleHarness({
    globals: { HTMLImageElement: MockImage },
    runtime: {
      withRuntime: task => task(),
      getSession: async () => {
        sessions++
      },
    },
  })
  await assert.rejects(
    adapter.default(new MockImage(), () => {}),
    /upscale_too_large/
  )
  assert.equal(sessions, 0)
})

test('cancelling before resize starts allocates no image or object URL', async () => {
  const { utils, images, revoked } = imageHarness()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    utils.resizeImageFile(
      new File(['x'], 'x.png', { type: 'image/png' }),
      4096,
      controller.signal
    ),
    { name: 'AbortError' }
  )
  assert.equal(images.length, 0)
  assert.equal(revoked(), 0)
})

test('cancelling stalled decoding releases the source and settles the resize', async () => {
  const { utils, images, revoked } = imageHarness({ decodePending: true })
  const controller = new AbortController()
  const operation = utils.resizeImageFile(
    new File(['x'], 'x.png', { type: 'image/png' }),
    4096,
    controller.signal
  )
  controller.abort()
  await assert.rejects(operation, { name: 'AbortError' })
  assert.equal(images[0].onload, null)
  assert.equal(images[0].onerror, null)
  assert.equal(images[0].sourceRemoved, true)
  assert.equal(revoked(), 1)
})

test('cancelling pending encoding releases the canvas before a late encoder callback', async () => {
  const { utils, canvas, images, revoked, finishEncoding } = imageHarness({
    encodePending: true,
  })
  const controller = new AbortController()
  const operation = utils.resizeImageFile(
    new File(['x'], 'x.png', { type: 'image/png' }),
    4096,
    controller.signal
  )
  await new Promise(setImmediate)
  assert.equal(canvas.width, 4096)
  controller.abort()
  await assert.rejects(operation, { name: 'AbortError' })
  assert.equal(canvas.width, 0)
  assert.equal(canvas.height, 0)
  assert.equal(images[0].sourceRemoved, true)
  assert.equal(revoked(), 1)
  finishEncoding(new Blob(['late'], { type: 'image/png' }))
  assert.equal(revoked(), 1)
})

test('resize clears abort listeners after success or synchronous encoding failure', async () => {
  for (const encodeThrows of [false, true]) {
    const { utils, canvas, revoked } = imageHarness({ encodeThrows })
    const controller = new AbortController(),
      listeners = new Set()
    const signal = controller.signal
    const add = signal.addEventListener.bind(signal),
      remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = (type, callback, options) => {
      listeners.add(callback)
      add(type, callback, options)
    }
    signal.removeEventListener = (type, callback) => {
      listeners.delete(callback)
      remove(type, callback)
    }
    const task = utils.resizeImageFile(
      new File(['x'], 'x.png', { type: 'image/png' }),
      4096,
      signal
    )
    if (encodeThrows)
      await assert.rejects(task, /Encoding failed synchronously/)
    else assert.equal((await task).resized, true)
    assert.equal(listeners.size, 0)
    assert.equal(canvas.width, 0)
    assert.equal(revoked(), 1)
  }
})

test('import cancellation and timeout propagate into stalled local decoding', async () => {
  for (const action of ['cancel', 'timeout', 'dispose']) {
    const { utils, revoked } = imageHarness({ decodePending: true })
    const { importer, states, timers } = importHarness({
      resize: utils.resizeImageFile,
    })
    const operation = importer.load(
      new File(['x'], 'x.png', { type: 'image/png' })
    )
    if (action === 'timeout') timers.values().next().value()
    else importer[action]()
    await operation
    assert.equal(revoked(), 1)
    assert.equal(timers.size, 0)
    assert.equal(
      states.at(-1).status,
      action === 'cancel' ? 'idle' : action === 'timeout' ? 'error' : 'loading'
    )
    if (action === 'timeout')
      assert.equal(states.at(-1).error, 'image_import_timeout')
  }
})

test('history caps steps while preserving stable IDs, undo to original and redo', () => {
  const { historyReducer, HISTORY_MAX_STEPS } = loadModule('src/history.ts')
  let state = { entries: [], index: -1 }
  for (let id = 1; id <= 25; id++)
    state = historyReducer(state, {
      type: 'append',
      entry: { id, bytes: 1 },
      sizeOf: e => e.bytes,
    })
  assert.equal(state.entries.length, HISTORY_MAX_STEPS)
  assert.equal(state.evicted, 5)
  assert.deepEqual(
    state.entries.map(e => e.id),
    Array.from({ length: 20 }, (_, i) => i + 6)
  )
  for (let i = 0; i < 20; i++) state = historyReducer(state, { type: 'undo' })
  assert.equal(state.index, -1)
  assert.equal(historyReducer(state, { type: 'redo' }).entries[0].id, 6)
})

test('history budgets include the current result and trim branches before evicting', () => {
  const { historyReducer, HISTORY_MAX_BYTES: limit } =
    loadModule('src/history.ts')
  const append = (state, id, bytes) =>
    historyReducer(state, {
      type: 'append',
      entry: { id, bytes },
      sizeOf: e => e.bytes,
    })
  let state = append({ entries: [], index: -1 }, 1, limit / 2)
  state = append(state, 2, limit / 2)
  assert.equal(state.entries.length, 2)
  state = historyReducer(state, { type: 'select', index: 0 })
  state = append(state, 3, limit / 2)
  assert.deepEqual(
    state.entries.map(e => e.id),
    [1, 3]
  )
  assert.equal(state.evicted, undefined)
  state = append(state, 4, 1)
  assert.deepEqual(
    state.entries.map(e => e.id),
    [3, 4]
  )
  assert.equal(state.evicted, 1)
  state = append(state, 5, limit + 1)
  assert.deepEqual(
    state.entries.map(e => e.id),
    [5]
  )
  assert.equal(state.evicted, 3)
  assert.equal(historyReducer(state, { type: 'undo' }).index, -1)
})

test('cancelled model download waiters detach while other callers finish and cache', async () => {
  let deliver,
    calls = 0
  const { cache } = cacheHarness(() => {
    calls++
    return new Promise(resolve => {
      deliver = resolve
    })
  })
  const controller = new AbortController(),
    first = [],
    second = []
  const abandoned = cache.downloadModel(
    'inpaint',
    n => first.push(n),
    controller.signal
  )
  const rejected = assert.rejects(abandoned, { name: 'AbortError' })
  const retained = cache.downloadModel('inpaint', n => second.push(n))
  await new Promise(setImmediate)
  controller.abort()
  await rejected
  const count = first.length
  deliver(new Response(new Uint8Array([1, 2, 3])))
  await retained
  assert.equal(calls, 1)
  assert.equal(first.length, count)
  assert.equal(second.at(-1), 100)
  assert.equal((await cache.loadModel('inpaint')).byteLength, 3)
})

test('cancelling a session waiter preserves shared initialization and removes its observer', async () => {
  let finish,
    creates = 0
  const { runtime } = runtimeHarness({
    createSession: () =>
      ++creates === 1
        ? new Promise(resolve => {
            finish = resolve
          })
        : Promise.resolve(),
  })
  const controller = new AbortController(),
    stages = []
  const abandoned = runtime.getSession(
    'inpaint',
    stage => stages.push(stage),
    controller.signal
  )
  const rejected = assert.rejects(abandoned, { name: 'AbortError' })
  await new Promise(setImmediate)
  controller.abort()
  await rejected
  const count = stages.length
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /Wait for image processing/
  )
  const retained = runtime.getSession('inpaint')
  finish()
  await retained
  assert.equal(stages.length, count)
  await runtime.repairRuntime(() => {})
})

test('queued cancellation settles before active inference while keeping repair blocked', async () => {
  const { runtime } = runtimeHarness()
  let finish
  const active = runtime.withRuntime(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const controller = new AbortController()
  const queued = runtime.withRuntime(
    async () => assert.fail('queued operation ran'),
    controller.signal
  )
  const rejected = assert.rejects(queued, { name: 'AbortError' })
  controller.abort()
  await rejected
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /Wait for image processing/
  )
  finish()
  await active
  await runtime.withRuntime(async () => 'next')
  await runtime.repairRuntime(() => {})
})

for (const cancelAt of ['before', 'status', 'inference', 'between']) {
  test(`upscale cancellation at ${cancelAt} omits remaining tiles and final output`, async () => {
    const controller = new AbortController()
    const { adapter, Tensor } = upscaleHarness()
    let runs = 0
    const progress = []
    if (cancelAt === 'before') controller.abort()
    const operation = adapter.tileProc(
      new Tensor('float32', new Float32Array(53 * 3), [1, 3, 1, 53]),
      {
        inputNames: ['rgb'],
        outputNames: ['result'],
        run: async () => {
          runs++
          if (cancelAt === 'inference') controller.abort()
          return {
            result: new Tensor(
              'float32',
              new Float32Array(256 * 256 * 3),
              [1, 3, 256, 256]
            ),
          }
        },
      },
      n => {
        progress.push(n)
        if (cancelAt === 'between') controller.abort()
      },
      () => {
        if (cancelAt === 'status') controller.abort()
      },
      controller.signal
    )
    await assert.rejects(operation, { name: 'AbortError' })
    assert.equal(runs, ['before', 'status'].includes(cancelAt) ? 0 : 1)
    assert.deepEqual(progress, cancelAt === 'between' ? [50] : [])
  })
}

test('inpaint cancellation waits for active inference, keeps the lock and omits encoding', async () => {
  const { runtime } = runtimeHarness()
  const controller = new AbortController()
  let finish, entered
  const started = new Promise(resolve => {
    entered = resolve
  })
  const { run, rendered } = inpaintOutputHarness(
    undefined,
    false,
    () => {
      entered()
      return new Promise(resolve => {
        finish = resolve
      })
    },
    runtime
  )
  let settled = false
  const task = run({}, controller.signal).finally(() => {
    settled = true
  })
  const rejected = assert.rejects(task, { name: 'AbortError' })
  await started
  controller.abort()
  await new Promise(setImmediate)
  assert.equal(settled, false)
  await assert.rejects(
    runtime.repairRuntime(() => {}),
    /Wait for image processing/
  )
  finish({})
  await rejected
  assert.equal(rendered(), undefined)
  await runtime.repairRuntime(() => {})
})

function resourceHarness({
  decodePending = false,
  encodePending = false,
  encodeNull = false,
  encodeThrows = false,
  contextError = false,
  globals = {},
} = {}) {
  const images = [],
    canvases = [],
    urls = new Set(),
    revoked = [],
    encoders = []
  class MockImage {
    naturalWidth = 640
    naturalHeight = 480
    constructor() {
      images.push(this)
    }
    set src(value) {
      this.source = value
      if (!decodePending) queueMicrotask(() => this.onload?.())
    }
    removeAttribute() {
      this.source = undefined
    }
  }
  let id = 0
  const resources = loadModule(
    'src/imageResources.ts',
    {},
    {
      Image: MockImage,
      HTMLImageElement: MockImage,
      URL: {
        createObjectURL: () => {
          const url = `blob:${++id}`
          urls.add(url)
          return url
        },
        revokeObjectURL: url => {
          assert.ok(urls.delete(url), `URL released once: ${url}`)
          revoked.push(url)
        },
      },
      document: {
        createElement: () => {
          const canvas = {
            getContext: () =>
              contextError ? null : { drawImage() {}, putImageData() {} },
            toBlob: callback => {
              if (encodeThrows) throw new Error('encode failure')
              const finish = () =>
                callback(
                  encodeNull ? null : new Blob(['png'], { type: 'image/png' })
                )
              if (encodePending) encoders.push(finish)
              else queueMicrotask(finish)
            },
          }
          canvases.push(canvas)
          return canvas
        },
      },
      ...globals,
    }
  )
  return { resources, images, canvases, urls, revoked, encoders }
}

test('history entries own separate PNG thumbnails, estimate pixels, and release both URLs', async () => {
  const { resources, images, canvases, urls } = resourceHarness()
  const blob = new Blob(['full-image'])
  const entry = await resources.createHistoryEntry(
    blob,
    7,
    new AbortController().signal
  )
  assert.equal(entry.id, 7)
  assert.equal(entry.bytes, blob.size + 3 + 4 * (640 * 480 + 224 * 168))
  assert.equal(urls.size, 2)
  assert.notEqual(entry.url, entry.thumbnail)
  assert.equal(canvases[0].width, 0)
  assert.equal(canvases[0].height, 0)
  resources.releaseEntry(entry)
  assert.equal(urls.size, 0)
  assert.equal(images[0].source, undefined)
})

for (const phase of ['decode', 'encode', 'null', 'throw', 'context']) {
  test(`history creation cleans resources after ${phase} cancellation or failure`, async () => {
    const h = resourceHarness({
      decodePending: phase === 'decode',
      encodePending: phase === 'encode',
      encodeNull: phase === 'null',
      encodeThrows: phase === 'throw',
      contextError: phase === 'context',
    })
    const controller = new AbortController()
    const task = h.resources.createHistoryEntry(
      new Blob(['png']),
      1,
      controller.signal
    )
    const rejected = assert.rejects(task)
    if (phase === 'decode' || phase === 'encode') {
      await new Promise(setImmediate)
      controller.abort()
    }
    await rejected
    for (const finish of h.encoders) finish()
    await new Promise(setImmediate)
    assert.equal(h.urls.size, 0)
    assert.equal(h.images[0].source, undefined)
    assert.ok(
      h.canvases.every(canvas => canvas.width === 0 && canvas.height === 0)
    )
  })
}

test('encoding timeout releases the canvas and ignores late results', async () => {
  const timers = new Map()
  let id = 0
  const h = resourceHarness({
    encodePending: true,
    globals: {
      setTimeout: callback => {
        timers.set(++id, callback)
        return id
      },
      clearTimeout: id => timers.delete(id),
    },
  })
  const task = h.resources.imageDataToBlob({ width: 2, height: 2 })
  const rejected = assert.rejects(task, /encoding timed out/)
  timers.values().next().value()
  await rejected
  h.encoders[0]()
  assert.equal(timers.size, 0)
  assert.equal(h.canvases[0].width, 0)
  assert.equal(h.canvases[0].height, 0)
})

test('a cancelled encoder completion cannot return a late image result', async () => {
  const controller = new AbortController()
  const canvas = {
    getContext: () => ({ putImageData() {} }),
    toBlob: callback => {
      callback(new Blob(['late']))
      controller.abort()
    },
  }
  const resources = loadModule(
    'src/imageResources.ts',
    {},
    { document: { createElement: () => canvas } }
  )
  await assert.rejects(
    resources.imageDataToBlob({ width: 2, height: 2 }, controller.signal),
    { name: 'AbortError' }
  )
  assert.equal(canvas.width, 0)
  assert.equal(canvas.height, 0)
})

test('cancelling owned file decoding releases the URL and never enters preprocessing', async () => {
  const h = resourceHarness({ decodePending: true })
  const controller = new AbortController()
  const task = h.resources.withImage(
    new File(['png'], 'source.png'),
    controller.signal,
    async () => assert.fail('cancelled image used')
  )
  const rejected = assert.rejects(task, { name: 'AbortError' })
  controller.abort()
  await rejected
  assert.equal(h.urls.size, 0)
  assert.equal(h.images[0].source, undefined)
  assert.equal(h.images[0].onload, null)
  assert.equal(h.images[0].onerror, null)
})

test('borrowed decoded images are reused and remain owned by the caller', async () => {
  const h = resourceHarness()
  const entry = await h.resources.createHistoryEntry(
    new Blob(['png']),
    1,
    new AbortController().signal
  )
  const controller = new AbortController()
  await assert.rejects(
    h.resources.withImage(entry.image, controller.signal, async image => {
      assert.equal(image, entry.image)
      controller.abort()
      controller.signal.throwIfAborted()
    }),
    { name: 'AbortError' }
  )
  assert.equal(h.urls.size, 2)
  assert.equal(h.images.length, 1)
  assert.equal(entry.image.source, entry.url)
  h.resources.releaseEntry(entry)
})
