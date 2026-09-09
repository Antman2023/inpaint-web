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
