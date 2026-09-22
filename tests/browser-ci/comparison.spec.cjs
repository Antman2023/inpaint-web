const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('comparison supports keyboard, dragging and resizing without painting', async ({
  page,
  baseURL,
}) => {
  let processingStarts = 0
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', entry => {
    if (entry.text() === 'inpaint_start') processingStarts++
  })
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
    ctx.fillRect(0, 0, 32, 64)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'comparison.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  const brush = page.getByRole('slider', { name: messages.bruch_size })
  await expect(brush).toBeEnabled()
  await brush.focus()
  await brush.press('ArrowRight')
  const brushSize = await brush.inputValue()
  const toggle = page.getByRole('button', {
    name: messages.original,
    exact: true,
  })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(brush).toBeDisabled()
  await expect(
    page.locator('div.fixed.pointer-events-none[aria-hidden="true"]')
  ).toBeHidden()
  const slider = page.getByRole('slider', {
    name: messages.comparison_position,
  })
  await expect(slider).toHaveValue('0')
  await slider.focus()
  await slider.press('End')
  await expect(slider).toHaveValue('100')
  await expect(slider).toHaveAttribute(
    'aria-valuetext',
    `${messages.original_visible}: 0%`
  )
  await slider.press('Home')
  await expect(slider).toHaveValue('0')
  await slider.press('ArrowRight')
  await expect(slider).toHaveValue('1')
  const bounds = await slider.boundingBox()
  await page.mouse.move(
    bounds.x + bounds.width * 0.25,
    bounds.y + bounds.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    bounds.x + bounds.width * 0.75,
    bounds.y + bounds.height / 2,
    { steps: 6 }
  )
  await page.mouse.up()
  const position = Number(await slider.inputValue())
  expect(position).toBeGreaterThanOrEqual(74)
  expect(position).toBeLessThanOrEqual(76)
  await expect(page.locator('.editor-shell img[draggable="false"]')).toHaveCSS(
    'clip-path',
    `inset(0px 0px 0px ${position}%)`
  )
  await page.setViewportSize({ width: 700, height: 600 })
  await expect
    .poll(async () => (await slider.boundingBox()).width)
    .not.toBe(bounds.width)
  await expect(slider).toHaveValue(String(position))
  expect(processingStarts).toBe(0)
  await toggle.click()
  await expect(slider).toHaveCount(0)
  await expect(brush).toBeEnabled()
  await expect(brush).toHaveValue(brushSize)
  await page.locator('.editor-shell canvas').click()
  await expect.poll(() => processingStarts).toBe(1)
  await expect(
    page.getByRole('dialog', { name: messages.processing_failed, exact: true })
  ).toBeVisible()
  expect(errors).toEqual([])
})
