const { test, expect } = require('@playwright/test')

test('pointer bursts update the brush cursor once per frame at the latest position', async ({ page, baseURL }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === baseURL
    ? route.continue() : route.abort())
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'brush.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty('disabled', false)
  const canvas = page.locator('.editor-shell canvas')
  await canvas.hover()
  const result = await canvas.evaluate(async canvas => {
    await new Promise(requestAnimationFrame)
    const brush = document.querySelector('div.fixed.pointer-events-none[aria-hidden="true"]')
    const mutations = []
    const observer = new MutationObserver(records => mutations.push(...records))
    observer.observe(brush, { attributes: true, attributeFilter: ['style'] })
    for (let i = 0; i < 20; i++) {
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 200 + i, clientY: 300 + i, pointerId: 1,
      }))
    }
    await new Promise(requestAnimationFrame)
    await Promise.resolve()
    observer.disconnect()
    const transform = new DOMMatrix(brush.style.transform)
    return { updates: mutations.length, x: transform.m41, y: transform.m42,
      radius: parseFloat(brush.style.width) / 2 }
  })
  expect(result.updates).toBe(1)
  expect(result.x).toBeCloseTo(219 - result.radius)
  expect(result.y).toBeCloseTo(319 - result.radius)
})
