const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

for (const scenario of ['success', 'cancel', 'cancel-dialog']) {
  test(`processing completion preserves user focus: ${scenario}`, async ({
    page,
    baseURL,
  }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() =>
      localStorage.setItem('inpaint-language', 'en')
    )
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === baseURL) return route.continue()
      if (/\/ort\.[\w-]+\.min\.js$/.test(url.pathname))
        return route.fulfill({
          contentType: 'application/javascript',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: `window.ort = { env: { wasm: {} },
            Tensor: class { constructor(type, data, dims) { Object.assign(this, {type, data, dims}) } },
            InferenceSession: { create: async () => ({
              inputNames: ['image', 'mask'], outputNames: ['output'],
              run: feed => new Promise(resolve => {
                window.__finishInference = () => resolve({ output: {
                  data: feed.image.data.slice(), dims: feed.image.dims
                } });
              })
            }) }
          };`,
        })
      return route.abort()
    })
    await page.goto('/')
    const png = await page.evaluate(async () => {
      const { saveModel } = await import('/src/adapters/cache.ts')
      await saveModel('inpaint', new Uint8Array([1, 2, 3, 4]).buffer)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      return canvas.toDataURL().split(',')[1]
    })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'focus.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })
    const toolbar = page.locator('.editor-shell fieldset')
    await expect(toolbar).toBeEnabled()
    await page.locator('.editor-shell canvas').click()
    await expect
      .poll(() => page.evaluate(() => typeof window.__finishInference))
      .toBe('function')
    if (scenario !== 'success') {
      await page
        .getByRole('button', { name: messages.cancel_processing, exact: true })
        .click()
      await expect(
        page.getByText(messages.processing_cancelling, { exact: true })
      ).toBeVisible()
    }
    const feedback = page.getByRole('button', {
      name: messages.feedback,
      exact: true,
    })
    let expectedFocus = feedback
    if (scenario === 'cancel-dialog') {
      await feedback.click()
      expectedFocus = page
        .getByRole('dialog')
        .getByRole('button', { name: messages.close, exact: true })
    } else {
      await feedback.focus()
    }
    await expect(expectedFocus).toBeFocused()
    await page.evaluate(() => window.__finishInference())
    await expect(toolbar).toBeEnabled()
    // The completion callback runs in the next animation frame.
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    await expect(expectedFocus).toBeFocused()
    await expect(page.locator('.history-scrollbar img')).toHaveCount(
      scenario === 'success' ? 1 : 0
    )
    expect(errors).toEqual([])
  })
}
