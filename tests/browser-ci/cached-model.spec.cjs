const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('cached upscale initialization reads once and retries reuse the session without a download dialog', async ({
  page,
  baseURL,
}) => {
  const modelRequests = []
  await page.addInitScript(() => {
    localStorage.setItem('inpaint-language', 'en')
    window.__modelReads = 0
    window.__dialogs = []
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      if (key === 'realesrgan-x4') window.__modelReads++
      return get.call(this, key)
    }
    const show = HTMLDialogElement.prototype.showModal
    HTMLDialogElement.prototype.showModal = function () {
      window.__dialogs.push(this.getAttribute('aria-label'))
      return show.call(this)
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
              if (model.byteLength !== 4) throw new Error('Unexpected cached model');
              window.__sessionCreates++;
              return { inputNames: ['input'], outputNames: ['output'],
                run: async () => { window.__inferenceRuns++; throw new Error('Intentional inference failure') }
              };
            } }
          };`,
      })
    }
    if (url.pathname.endsWith('/realesrgan-x4.onnx'))
      modelRequests.push(url.href)
    return route.abort()
  })
  await page.goto('/')
  const png = await page.evaluate(async () => {
    const { saveModel } = await import('/src/adapters/cache.ts')
    await saveModel('superResolution', new Uint8Array([1, 2, 3, 4]).buffer)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'cached.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
    'disabled',
    false
  )
  await page
    .getByRole('button', { name: messages.upscale, exact: true })
    .click()
  const failure = page.getByRole('dialog', {
    name: messages.processing_failed,
    exact: true,
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect
      .poll(() => page.evaluate(() => window.__inferenceRuns))
      .toBe(attempt + 1)
    await expect(failure.getByRole('alert')).toHaveText(
      'Intentional inference failure'
    )
    expect(
      await page.evaluate(() => ({
        reads: window.__modelReads,
        sessions: window.__sessionCreates,
      }))
    ).toEqual({ reads: 1, sessions: 1 })
    expect(await page.evaluate(() => window.__dialogs)).not.toContain(
      messages.upscaleing_model_download_message
    )
    if (attempt === 0)
      await failure
        .getByRole('button', { name: messages.repair_retry, exact: true })
        .click()
  }
  expect(modelRequests).toEqual([])
})
