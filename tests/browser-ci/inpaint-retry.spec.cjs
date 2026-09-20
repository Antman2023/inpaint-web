const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('failed inpainting retries the same image and mask, then accepts a fresh stroke', async ({ page, baseURL }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('inpaint-language', 'en'))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === baseURL) return route.continue()
    if (/\/ort\.[\w-]+\.min\.js$/.test(url.pathname)) return route.fulfill({
      contentType: 'application/javascript',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: `window.__feeds = []; window.__sessions = 0;
        window.ort = { env: { wasm: {} },
          Tensor: class { constructor(type, data, dims) { Object.assign(this, {type, data, dims}) } },
          InferenceSession: { create: async () => {
            window.__sessions++;
            return { inputNames: ['image', 'mask'], outputNames: ['output'], run: async feed => {
              window.__feeds.push({ image: Array.from(feed.image.data), mask: Array.from(feed.mask.data) });
              if (window.__feeds.length === 1) throw new Error('Retry this stroke');
              return { output: { data: feed.image.data.slice(), dims: feed.image.dims } };
            } };
          } }
        };`,
    })
    return route.abort()
  })
  await page.goto('/')
  const png = await page.evaluate(async () => {
    const { saveModel } = await import('/src/adapters/cache.ts')
    await saveModel('inpaint', new Uint8Array([1, 2, 3, 4]).buffer)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#4488bb'
    ctx.fillRect(0, 0, 64, 64)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'retry.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  })
  const toolbar = page.locator('.editor-shell fieldset')
  await expect(toolbar).toHaveJSProperty('disabled', false)
  const stroke = async y => {
    const bounds = await page.locator('.editor-shell canvas').boundingBox()
    await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * y, { steps: 5 })
    await page.mouse.up()
  }
  await stroke(0.3)
  const failure = page.getByRole('dialog', { name: messages.processing_failed, exact: true })
  await expect(failure.getByRole('alert')).toHaveText('Retry this stroke')
  await expect(page.locator('.history-scrollbar')).toHaveCount(0)
  await failure.getByRole('button', { name: messages.repair_retry, exact: true }).click()
  await expect(page.locator('.history-scrollbar img')).toHaveCount(1)
  await expect(toolbar).toHaveJSProperty('disabled', false)
  expect(await page.evaluate(() => {
    const [first, retried] = window.__feeds
    return first.mask.includes(0) && first.mask.includes(255) &&
      JSON.stringify(first) === JSON.stringify(retried)
  })).toBe(true)
  await stroke(0.7)
  await expect(page.locator('.history-scrollbar img')).toHaveCount(2)
  await expect(toolbar).toHaveJSProperty('disabled', false)
  expect(await page.evaluate(() => ({
    runs: window.__feeds.length, sessions: window.__sessions,
    newSelection: JSON.stringify(window.__feeds[1].mask) !== JSON.stringify(window.__feeds[2].mask),
    oldSelectionCleared: window.__feeds[1].mask.every((value, index) =>
      value !== 0 || window.__feeds[2].mask[index] === 255),
  }))).toEqual({ runs: 3, sessions: 1, newSelection: true, oldSelectionCleared: true })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})
