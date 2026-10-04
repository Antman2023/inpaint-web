const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

for (const sample of [
  {
    type: 'image/png',
    declared: 'image/jpeg',
    name: 'holiday.jpg',
    extension: 'png',
    width: 64,
  },
  {
    type: 'image/jpeg',
    declared: 'image/png',
    name: 'holiday.png',
    extension: 'jpg',
    width: 64,
  },
  {
    type: 'image/png',
    declared: 'application/octet-stream',
    name: 'holiday.bin',
    extension: 'png',
    width: 64,
  },
  {
    type: 'image/png',
    declared: 'image/jpeg',
    name: 'holiday.jpg',
    extension: 'png',
    width: 4097,
  },
]) {
  test(`import corrects ${sample.declared} to ${sample.type} at width ${sample.width}`, async ({
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
      name: sample.name,
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

test('paste accepts a PNG with generic clipboard metadata', async ({
  page,
  baseURL,
}) => {
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.addInitScript(() => localStorage.setItem('inpaint-language', 'en'))
  await page.goto('/')
  const pasted = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 48
    const context = canvas.getContext('2d')
    context.fillStyle = '#4488bb'
    context.fillRect(0, 0, 48, 48)
    const bytes = Uint8Array.from(
      atob(canvas.toDataURL('image/png').split(',')[1]),
      character => character.charCodeAt(0)
    )
    canvas.width = canvas.height = 0
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([bytes], 'clipboard.bin', {
        type: 'application/octet-stream',
      })
    )
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    })
    // Firefox currently ignores clipboardData passed to synthetic
    // ClipboardEvent constructors. Real paste events still expose it, so fill
    // the synthetic event only when the constructor did not retain the file.
    if (!event.clipboardData?.files.length) {
      Object.defineProperty(event, 'clipboardData', { value: transfer })
    }
    document.body.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(pasted).toBe(true)
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
    'disabled',
    false
  )
  await expect(page.locator('#upscale-details')).toContainText('48 × 48')
})

test('drop prefers a generic image candidate over an earlier invalid file', async ({
  page,
  baseURL,
}) => {
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.addInitScript(() => localStorage.setItem('inpaint-language', 'en'))
  await page.goto('/')
  const accepted = await page.locator('.upload-zone').evaluate(zone => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 40
    const context = canvas.getContext('2d')
    context.fillStyle = '#4488bb'
    context.fillRect(0, 0, 40, 40)
    const bytes = Uint8Array.from(
      atob(canvas.toDataURL('image/png').split(',')[1]),
      character => character.charCodeAt(0)
    )
    canvas.width = canvas.height = 0
    const transfer = new DataTransfer()
    transfer.items.add(
      new File(['not an image'], 'notes.pdf', { type: 'application/pdf' })
    )
    transfer.items.add(
      new File([bytes], 'dropped.bin', {
        type: 'application/octet-stream',
      })
    )
    const event = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    })
    // Keep the synthetic event representative in engines that omit constructor
    // data, as Firefox does for ClipboardEvent in the adjacent regression.
    if (!event.dataTransfer?.files.length) {
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
    }
    zone.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(accepted).toBe(true)
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
    'disabled',
    false
  )
  await expect(page.locator('#upscale-details')).toContainText('40 × 40')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
