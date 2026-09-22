const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('invalid upscale pixels preserve the current result and retry can succeed', async ({
  page,
  baseURL,
}) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('inpaint-language', 'en'))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === baseURL) return route.continue()
    if (/\/ort\.[\w-]+\.min\.js$/.test(url.pathname))
      return route.fulfill({
        contentType: 'application/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: `window.__upscaleRuns = 0; window.__upscaleSessions = 0;
        window.ort = { env: { wasm: {} },
          Tensor: class { constructor(type, data, dims) { Object.assign(this, {type, data, dims}) } },
          InferenceSession: { create: async () => {
            window.__upscaleSessions++;
            return { inputNames: ['input'], outputNames: ['output'], run: async () => {
              const data = new Float32Array(3 * 256 * 256).fill(0.5);
              if (++window.__upscaleRuns === 2) data[24 * 256 + 24] = NaN;
              return { output: { data, dims: [1, 3, 256, 256] } };
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
    canvas.width = canvas.height = 16
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#4488bb'
    ctx.fillRect(0, 0, 16, 16)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'output.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  const toolbar = page.locator('.editor-shell fieldset')
  const upscale = page.getByRole('button', {
    name: messages.upscale,
    exact: true,
  })
  const canvas = page.locator('.editor-shell canvas')
  const history = page.locator('.history-scrollbar img')
  await expect(toolbar).toBeEnabled()
  await upscale.click()
  await expect(history).toHaveCount(1)
  await expect(toolbar).toBeEnabled()
  const originalStep = await history.getAttribute('src')
  const pixels = await canvas.evaluate(el => el.toDataURL())
  await upscale.click()
  const failure = page.getByRole('dialog', {
    name: messages.processing_failed,
    exact: true,
  })
  await expect(failure.getByRole('alert')).toContainText(
    'non-finite pixel values'
  )
  await expect(history).toHaveCount(1)
  await expect(history).toHaveAttribute('src', originalStep)
  await expect(page.locator('#upscale-details')).toContainText('64 × 64')
  await expect.poll(() => canvas.evaluate(el => el.toDataURL())).toBe(pixels)
  expect(await page.evaluate(() => window.__upscaleRuns)).toBe(2)
  await failure
    .getByRole('button', { name: messages.repair_retry, exact: true })
    .click()
  await expect(history).toHaveCount(2)
  await expect(toolbar).toBeEnabled()
  await expect(page.locator('#upscale-details')).toContainText('256 × 256')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(
    await page.evaluate(() => ({
      runs: window.__upscaleRuns,
      sessions: window.__upscaleSessions,
    }))
  ).toEqual({ runs: 6, sessions: 1 })
  expect(errors).toEqual([])
})
