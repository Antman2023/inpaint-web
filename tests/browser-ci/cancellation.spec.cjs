const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('cancelled upscaling can rejoin a download without late processing', async ({
  page,
  baseURL,
}) => {
  const errors = []
  const downloads = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('inpaint-language', 'en')
  })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === baseURL) return route.continue()
    if (/\/ort\.[\w-]+\.min\.js$/.test(url.pathname)) {
      return route.fulfill({
        contentType: 'application/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: `window.ort = { env: { wasm: {} }, InferenceSession: {
          create: async () => ({ inputNames: ['input'], outputNames: ['output'],
            run: async () => { throw new Error('Cancelled work entered inference') }
          })
        } }`,
      })
    }
    // Hold the response until both UI waiters cancel. No actual model is fetched.
    if (url.pathname.endsWith('/realesrgan-x4.onnx')) {
      downloads.push(route)
      return
    }
    return route.abort()
  })
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const result = canvas.toDataURL().split(',')[1]
    canvas.width = canvas.height = 0
    return result
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'cancel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  const toolbar = page.locator('.editor-shell fieldset')
  const upscale = page.getByRole('button', {
    name: messages.upscale,
    exact: true,
  })
  const dialog = page.getByRole('dialog', {
    name: messages.upscaleing_model_download_message,
    exact: true,
  })
  await expect(toolbar).toHaveJSProperty('disabled', false)
  for (const method of ['keyboard', 'button']) {
    await upscale.click()
    await expect(dialog).toBeVisible()
    await expect.poll(() => downloads.length).toBe(1)
    if (method === 'keyboard') await page.keyboard.press('Escape')
    else
      await dialog
        .getByRole('button', { name: messages.cancel_processing, exact: true })
        .click()
    await expect(dialog).toHaveCount(0)
    await expect(toolbar).toHaveJSProperty('disabled', false)
    await expect(toolbar).toBeFocused()
    await expect(page.locator('.editor-shell')).toHaveAttribute(
      'aria-busy',
      'false'
    )
  }

  // Completing a shared download must only populate the cache. These deliberately
  // invalid model bytes would fail if a cancelled caller proceeded to inference.
  await downloads[0].fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: Buffer.from([1, 2, 3, 4]),
  })
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { loadModel } = await import('/src/adapters/cache.ts')
        return (await loadModel('superResolution'))?.byteLength
      })
    )
    .toBe(4)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(toolbar).toHaveJSProperty('disabled', false)
  await expect(page.locator('.history-scrollbar')).toHaveCount(0)
  expect(downloads).toHaveLength(1)
  await page
    .getByRole('button', { name: messages.start_new, exact: true })
    .click()
  await expect(page.locator('input[type="file"]')).toBeFocused()
  expect(errors).toEqual([])
})
