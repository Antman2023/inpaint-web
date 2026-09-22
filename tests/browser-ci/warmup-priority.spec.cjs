const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('cached upscaling finishes while background inpaint download is stalled', async ({
  page,
  baseURL,
}) => {
  let pendingInpaint
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('inpaint-language', 'en'))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === baseURL) return route.continue()
    if (url.pathname.endsWith('/migan_pipeline_v2.onnx')) {
      pendingInpaint = route
      return
    }
    if (/\/ort\.[\w-]+\.min\.js$/.test(url.pathname))
      return route.fulfill({
        contentType: 'application/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: `window.__modelSizes = []; window.__runs = 0;
        window.ort = { env: { wasm: {} },
          Tensor: class { constructor(type, data, dims) { Object.assign(this, {type, data, dims}) } },
          InferenceSession: { create: async model => {
            window.__modelSizes.push(model.byteLength);
            return { inputNames: ['input'], outputNames: ['output'], run: async () => {
              window.__runs++;
              return { output: { data: new Float32Array(3 * 256 * 256), dims: [1, 3, 256, 256] } };
            } };
          } }
        };`,
      })
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
    name: 'warmup.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect.poll(() => Boolean(pendingInpaint)).toBe(true)
  await page
    .getByRole('button', { name: messages.upscale, exact: true })
    .click()
  await expect(page.locator('.history-scrollbar img')).toHaveCount(1)
  await expect(page.locator('#upscale-details')).toContainText('128 × 128')
  await expect(page.locator('.editor-shell fieldset')).toBeEnabled()
  expect(
    await page.evaluate(() => ({
      sizes: window.__modelSizes,
      runs: window.__runs,
    }))
  ).toEqual({ sizes: [4], runs: 1 })
  await pendingInpaint.fulfill({
    contentType: 'application/octet-stream',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: Buffer.from([1, 2, 3]),
  })
  await expect
    .poll(() => page.evaluate(() => window.__modelSizes))
    .toEqual([4, 3])
  await expect(page.locator('.history-scrollbar img')).toHaveCount(1)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})
