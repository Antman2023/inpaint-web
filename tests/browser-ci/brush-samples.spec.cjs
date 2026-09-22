const { test, expect } = require('@playwright/test')

test('coalesced pointer samples preserve the same curved mask as separate moves', async ({
  page,
  baseURL,
}) => {
  const errors = []
  let processingStarts = 0
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', entry => {
    if (entry.text() === 'inpaint_start') processingStarts++
  })
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'samples.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.editor-shell fieldset')).toHaveJSProperty(
    'disabled',
    false
  )
  const canvas = page.locator('.editor-shell canvas')
  await canvas.evaluate(el =>
    el.addEventListener('pointerdown', event => {
      window.__samplePointer = event.pointerId
    })
  )
  const baseline = await canvas.evaluate(el => el.toDataURL())
  const results = {}
  for (const mode of [
    'separate',
    'coalesced',
    'empty',
    'unsupported',
    'endpoint',
  ]) {
    const bounds = await canvas.boundingBox()
    await page.mouse.move(
      bounds.x + bounds.width * 0.2,
      bounds.y + bounds.height * 0.5
    )
    await page.mouse.down()
    results[mode] = await canvas.evaluate(async (el, mode) => {
      const rect = el.getBoundingClientRect()
      const points = [
        [0.3, 0.2],
        [0.5, 0.8],
        [0.7, 0.2],
        [0.8, 0.5],
      ]
      const moves = points.map(
        ([x, y]) =>
          new PointerEvent('pointermove', {
            pointerId: window.__samplePointer,
            isPrimary: true,
            buttons: 1,
            clientX: rect.left + rect.width * x,
            clientY: rect.top + rect.height * y,
          })
      )
      if (mode === 'coalesced') {
        Object.defineProperty(moves.at(-1), 'getCoalescedEvents', {
          value: () => moves,
        })
        el.dispatchEvent(moves.at(-1))
      } else {
        for (const move of mode === 'endpoint' ? moves.slice(-1) : moves) {
          if (mode === 'empty' || mode === 'unsupported') {
            Object.defineProperty(move, 'getCoalescedEvents', {
              value: mode === 'empty' ? () => [] : undefined,
            })
          }
          el.dispatchEvent(move)
        }
      }
      await new Promise(requestAnimationFrame)
      return el.toDataURL()
    }, mode)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect
      .poll(() => canvas.evaluate(el => el.toDataURL()))
      .toBe(baseline)
  }
  expect(results.separate).not.toBe(baseline)
  expect(results.separate).not.toBe(results.endpoint)
  expect(results.coalesced).toBe(results.separate)
  expect(results.empty).toBe(results.separate)
  expect(results.unsupported).toBe(results.separate)
  expect(processingStarts).toBe(0)
  expect(errors).toEqual([])
})
