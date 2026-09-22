const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

for (const sample of [
  { type: 'image/png', declared: 'image/jpeg', extension: 'png', width: 64 },
  { type: 'image/jpeg', declared: 'image/png', extension: 'jpg', width: 64 },
  { type: 'image/png', declared: 'image/jpeg', extension: 'png', width: 4097 },
]) {
  test(`import corrects ${sample.type} metadata at width ${sample.width}`, async ({
    page,
    baseURL,
  }) => {
    await page.route('**/*', route =>
      new URL(route.request().url()).origin === baseURL
        ? route.continue()
        : route.abort()
    )
    await page.addInitScript(() =>
      localStorage.setItem('inpaint-language', 'en')
    )
    await page.goto('/')
    const source = await page.evaluate(({ type, width }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = 16
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#4488bb'
      ctx.fillRect(0, 0, width / 2, 16)
      return canvas.toDataURL(type).split(',')[1]
    }, sample)
    await page.locator('input[type="file"]').setInputFiles({
      name: sample.declared === 'image/jpeg' ? 'holiday.jpg' : 'holiday.png',
      mimeType: sample.declared,
      buffer: Buffer.from(source, 'base64'),
    })
    await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
      'disabled',
      false
    )
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        event => {
          const link = event.target.closest?.('a[download]')
          if (!link) return
          event.preventDefault()
          window.__exportedImage = { name: link.download, url: link.href }
        },
        true
      )
    })
    await page
      .getByRole('button', { name: messages.download, exact: true })
      .click()
    const exported = await page.evaluate(async () => {
      const { name, url } = window.__exportedImage
      const blob = await (await fetch(url)).blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      return {
        name,
        type: blob.type,
        width: canvas.width,
        alpha: ctx.getImageData(canvas.width - 1, 0, 1, 1).data[3],
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
      }
    })
    expect(exported.name).toBe(`holiday.${sample.extension}`)
    expect(exported.type).toBe(sample.type)
    expect(exported.width).toBe(Math.min(4096, sample.width))
    expect(exported.alpha).toBe(sample.type === 'image/png' ? 0 : 255)
    if (sample.width <= 4096)
      expect(Buffer.from(exported.bytes)).toEqual(Buffer.from(source, 'base64'))
  })
}
