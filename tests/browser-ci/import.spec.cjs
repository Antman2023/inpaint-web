const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

for (const failure of ['oversized', 'undecodable']) {
  test(`image import recovers from ${failure} files and releases resources`, async ({
    page,
    baseURL,
  }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // Editor warmup may try loading a runtime. This suite never fetches a CDN/model.
    await page.route('**/*', route =>
      new URL(route.request().url()).origin === baseURL
        ? route.continue()
        : route.abort()
    )
    await page.addInitScript(() => {
      localStorage.setItem('inpaint-language', 'en')
      const resources = { active: new Set(), created: 0 }
      window.__importResources = resources
      const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL
      URL.createObjectURL = blob => {
        const url = create.call(URL, blob)
        resources.active.add(url)
        resources.created++
        return url
      }
      URL.revokeObjectURL = url => {
        resources.active.delete(url)
        revoke.call(URL, url)
      }
    })
    await page.goto('/')
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'retry.png',
      mimeType: 'image/png',
      buffer:
        failure === 'oversized'
          ? Buffer.alloc(10 * 1024 * 1024 + 1)
          : Buffer.from('invalid image data'),
    })
    await expect(page.getByRole('alert')).toContainText(
      failure === 'oversized' ? messages.file_too_large : /decode/i
    )
    await expect(fileInput).toHaveValue('')
    await expect(page.locator('.editor-shell')).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => window.__importResources.active.size))
      .toBe(0)

    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#5588bb'
      ctx.fillRect(0, 0, 64, 64)
      const base64 = canvas.toDataURL().split(',')[1]
      canvas.width = canvas.height = 0
      return base64
    })
    await fileInput.setInputFiles({
      name: 'retry.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })
    await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
      'disabled',
      false
    )
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('#upscale-details')).toContainText('64 × 64')
    await expect
      .poll(() => page.evaluate(() => window.__importResources.active.size))
      .toBe(1)
    await page
      .getByRole('button', { name: messages.start_new, exact: true })
      .click()
    await expect(fileInput).toBeAttached()
    await expect(fileInput).toBeFocused()
    await expect(page.locator('.editor-shell')).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => window.__importResources.active.size))
      .toBe(0)
    expect(
      await page.evaluate(() => window.__importResources.created)
    ).toBeGreaterThanOrEqual(2)
    expect(errors).toEqual([])
  })
}
