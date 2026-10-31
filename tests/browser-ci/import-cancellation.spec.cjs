const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('Escape cancels a stalled import, respects dialogs and ignores late results', async ({
  page,
  baseURL,
}) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.addInitScript(() => {
    localStorage.setItem('inpaint-language', 'en')
    const slice = File.prototype.slice
    File.prototype.slice = function (...args) {
      if (this.name === 'stalled.png') {
        return {
          arrayBuffer: () =>
            new Promise(resolve => {
              window.__finishImportHeader = resolve
            }),
        }
      }
      return slice.apply(this, args)
    }
  })
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    return canvas.toDataURL().split(',')[1]
  })
  const input = page.locator('input[type="file"]')
  await input.setInputFiles({
    name: 'stalled.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect
    .poll(() => page.evaluate(() => typeof window.__finishImportHeader))
    .toBe('function')
  await expect(page.getByRole('status')).toContainText(
    messages.image_import_loading
  )
  await page
    .getByRole('button', { name: messages.feedback, exact: true })
    .click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText(
    messages.image_import_loading
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(input).toBeFocused()
  await page.evaluate(async () => {
    window.__finishImportHeader(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).buffer
    )
    await new Promise(resolve => setTimeout(resolve, 50))
  })
  await expect(page.locator('.editor-shell')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await input.setInputFiles({
    name: 'retry.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
    'disabled',
    false
  )
  await expect(page.locator('#upscale-details')).toContainText('32 × 32')
  expect(errors).toEqual([])
})
