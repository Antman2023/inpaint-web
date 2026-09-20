const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('unavailable editor canvas shows recovery actions and a new import can recover', async ({
  page,
  baseURL,
}) => {
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.addInitScript(() => {
    localStorage.setItem('inpaint-language', 'en')
    const getContext = HTMLCanvasElement.prototype.getContext
    window.__failEditorCanvas = true
    HTMLCanvasElement.prototype.getContext = function (...args) {
      if (window.__failEditorCanvas && this.matches('.editor-shell canvas')) {
        return null
      }
      return getContext.apply(this, args)
    }
  })
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#4488bb'
    ctx.fillRect(0, 0, 64, 64)
    return canvas.toDataURL().split(',')[1]
  })
  const file = {
    name: 'canvas.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  }
  const input = page.locator('input[type="file"]')
  await input.setInputFiles(file)
  await expect(page.getByRole('alert')).toHaveText(messages.editor_unavailable)
  await expect(
    page.getByRole('button', { name: messages.reload_page, exact: true })
  ).toBeVisible()
  await page.evaluate(() => {
    window.__failEditorCanvas = false
  })
  await page
    .getByRole('button', { name: messages.start_new, exact: true })
    .last()
    .click()
  await expect(input).toBeFocused()
  await input.setInputFiles(file)
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
    'disabled',
    false
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect
    .poll(() =>
      page
        .locator('.editor-shell canvas')
        .evaluate(canvas =>
          Array.from(
            canvas
              .getContext('2d')
              .getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data
          )
        )
    )
    .toEqual([68, 136, 187, 255])
})
