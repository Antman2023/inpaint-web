const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('a stalled cache read times out and UI retry completes without a late result taking over', async ({ page, baseURL }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install()
  await page.addInitScript(() => {
    localStorage.setItem('inpaint-language', 'en')
    window.__modelReads = 0
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      if (key === 'realesrgan-x4' && ++window.__modelReads === 1) {
        // Simulate a storage request whose success arrives after its deadline.
        window.__stalledRead = { result: new Uint8Array([99]).buffer }
        return window.__stalledRead
      }
      return get.call(this, key)
    }
  })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === baseURL) return route.continue()
    if (/\/ort\.[\w-]+\.min\.js$/.test(url.pathname)) {
      return route.fulfill({
        contentType: 'application/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: `window.__sessionCreates = 0; window.__inferenceRuns = 0;
          window.ort = { env: { wasm: {} },
            Tensor: class { constructor(type, data, dims) { Object.assign(this, {type, data, dims}) } },
            InferenceSession: { create: async model => {
              if (model.byteLength !== 4) throw new Error('Stale model used');
              window.__sessionCreates++;
              return { inputNames: ['input'], outputNames: ['output'], run: async () => {
                window.__inferenceRuns++;
                return { output: { data: new Float32Array(3 * 256 * 256), dims: [1, 3, 256, 256] } };
              } };
            } }
          };`,
      })
    }
    return route.abort()
  })
  await page.goto('/')
  const png = await page.evaluate(async () => {
    const { saveModel } = await import('/src/adapters/cache.ts')
    await saveModel('superResolution', new Uint8Array([1, 2, 3, 4]).buffer)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'timeout.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  })
  const toolbar = page.locator('.editor-shell fieldset')
  await expect(toolbar).toHaveJSProperty('disabled', false)
  await page.getByRole('button', { name: messages.upscale, exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__modelReads)).toBe(1)
  await page.clock.fastForward(30_001)
  const failure = page.getByRole('dialog', { name: messages.processing_failed, exact: true })
  await expect(failure.getByRole('alert')).toHaveText(messages.model_cache_read_timeout)
  await expect(toolbar).toHaveJSProperty('disabled', false)
  await expect(page.locator('.editor-shell')).toHaveAttribute('aria-busy', 'false')
  await failure.getByRole('button', { name: messages.repair_retry, exact: true }).click()
  await expect(page.locator('.history-scrollbar')).toBeVisible()
  await expect(toolbar).toHaveJSProperty('disabled', false)
  await page.evaluate(() => window.__stalledRead.onsuccess())
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => ({
    reads: window.__modelReads, sessions: window.__sessionCreates, runs: window.__inferenceRuns,
  }))).toEqual({ reads: 2, sessions: 1, runs: 1 })
  expect(errors).toEqual([])
})
