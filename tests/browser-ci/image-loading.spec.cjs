const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

for (const failure of ['allocation', 'decode']) {
  test(`editor image ${failure} failure releases resources and permits retry`, async ({
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
    await page.addInitScript(failure => {
      localStorage.setItem('inpaint-language', 'en')
      const active = new Set()
      window.__imageURLs = active
      const create = URL.createObjectURL
      const revoke = URL.revokeObjectURL
      let calls = 0
      URL.createObjectURL = blob => {
        // The first URL validates the import; the second loads it in Editor.
        if (++calls === 2) {
          if (failure === 'allocation')
            throw new Error('Image URL allocation failed')
          blob = new Blob(['undecodable'], { type: 'image/png' })
        }
        const url = create.call(URL, blob)
        active.add(url)
        return url
      }
      URL.revokeObjectURL = url => {
        active.delete(url)
        revoke.call(URL, url)
      }
    }, failure)
    await page.goto('/')
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      const result = canvas.toDataURL().split(',')[1]
      canvas.width = canvas.height = 0
      return result
    })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'recover.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })
    await expect(page.getByRole('alert')).toHaveText(
      messages.editor_image_failed
    )
    await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
      'disabled',
      true
    )
    await expect
      .poll(() => page.evaluate(() => window.__imageURLs.size))
      .toBe(0)
    await page
      .getByRole('button', { name: messages.repair_retry, exact: true })
      .click()
    await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
      'disabled',
      false
    )
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('#upscale-details')).toContainText('64 × 64')
    await expect
      .poll(() => page.evaluate(() => window.__imageURLs.size))
      .toBe(1)
    await page
      .getByRole('button', { name: messages.start_new, exact: true })
      .click()
    await expect
      .poll(() => page.evaluate(() => window.__imageURLs.size))
      .toBe(0)
    expect(errors).toEqual([])
  })
}
