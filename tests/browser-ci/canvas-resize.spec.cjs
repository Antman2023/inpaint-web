const { test, expect } = require('@playwright/test')

test('image loading draws once and workspace resizing redraws the image', async ({
  page,
  baseURL,
}) => {
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.addInitScript(() => {
    window.__editorDraws = 0
    const draw = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.matches('.editor-shell canvas')) window.__editorDraws++
      return draw.apply(this, args)
    }
  })
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 80
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#4488bb'
    ctx.fillRect(0, 0, 160, 80)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'resize.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
    'disabled',
    false
  )
  const inspect = () =>
    page.locator('.editor-shell canvas').evaluate(async canvas => {
      await new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
      return {
        draws: window.__editorDraws,
        width: canvas.width,
        height: canvas.height,
        pixel: Array.from(
          canvas
            .getContext('2d')
            .getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data
        ),
      }
    })
  const initial = await inspect()
  expect(initial.draws).toBe(1)
  expect(initial.pixel).toEqual([68, 136, 187, 255])
  await page.setViewportSize({ width: 700, height: 600 })
  await expect.poll(async () => (await inspect()).width).not.toBe(initial.width)
  const resized = await inspect()
  expect(resized.draws).toBeGreaterThan(initial.draws)
  expect(Math.abs(resized.width - resized.height * 2)).toBeLessThanOrEqual(1)
  expect(resized.pixel).toEqual(initial.pixel)
  // The outer box can stay the same while padding reduces the drawing area.
  await canvasPadding(page, 180)
  await expect
    .poll(async () => (await inspect()).width)
    .toBeLessThan(resized.width)
  const padded = await inspect()
  expect(padded.pixel).toEqual(initial.pixel)
  expect(Math.abs(padded.width - padded.height * 2)).toBeLessThanOrEqual(1)
})

async function canvasPadding(page, padding) {
  await page.locator('.editor-shell canvas').evaluate((canvas, value) => {
    const container = canvas.parentElement.parentElement
    container.style.paddingLeft = `${value}px`
    container.style.paddingRight = `${value}px`
  }, padding)
}
