const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('interrupted strokes clear their preview and do not start inference', async ({
  page,
  baseURL,
}) => {
  let processingStarts = 0
  const errors = []
  page.on('console', entry => {
    if (entry.text() === 'inpaint_start') processingStarts++
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.addInitScript(() => localStorage.setItem('inpaint-language', 'en'))
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#4488bb'
    ctx.fillRect(0, 0, 64, 64)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'stroke.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
    'disabled',
    false
  )
  const canvas = page.locator('.editor-shell canvas')
  const slider = page.getByRole('slider')
  const pixels = () => canvas.evaluate(el => el.toDataURL())
  await canvas.evaluate(el =>
    el.addEventListener('pointerdown', event => {
      window.__strokePointer = event.pointerId
    })
  )
  const baseline = await pixels()
  for (const interruption of [
    'blur',
    'pointercancel',
    'brush-size',
    'escape',
  ]) {
    await slider.focus()
    const bounds = await canvas.boundingBox()
    await page.mouse.move(
      bounds.x + bounds.width * 0.3,
      bounds.y + bounds.height * 0.5
    )
    await page.mouse.down()
    await page.mouse.move(
      bounds.x + bounds.width * 0.6,
      bounds.y + bounds.height * 0.5,
      { steps: 4 }
    )
    await expect.poll(async () => (await pixels()) !== baseline).toBe(true)
    if (interruption === 'blur')
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    else if (interruption === 'pointercancel')
      await canvas.evaluate(el =>
        el.dispatchEvent(
          new PointerEvent('pointercancel', {
            pointerId: window.__strokePointer,
          })
        )
      )
    else
      await page.keyboard.press(
        interruption === 'escape' ? 'Escape' : 'ArrowRight'
      )
    await expect
      .poll(async () => (await pixels()) === baseline, {
        message: `${interruption} left a stale mask`,
      })
      .toBe(true)
    await page.mouse.up()
    await expect(page.locator('.editor-shell')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    expect(processingStarts).toBe(0)
  }
  // A new completed stroke still works after cancellation (CDN failure is expected).
  await canvas.click()
  await expect.poll(() => processingStarts).toBe(1)
  await expect(
    page.getByRole('dialog', { name: messages.processing_failed, exact: true })
  ).toBeVisible()
  expect(errors).toEqual([])
})
