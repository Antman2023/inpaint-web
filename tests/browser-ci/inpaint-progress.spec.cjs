const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

for (const knownLength of [true, false]) {
  test(`inpaint download progress survives cancellation and rejoining (${knownLength ? 'known' : 'unknown'} length)`, async ({
    page,
    baseURL,
  }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(knownLength => {
      localStorage.setItem('inpaint-language', 'en')
      const fetchOriginal = window.fetch
      window.__inpaintDownloads = 0
      window.fetch = (input, init) => {
        if (String(input).endsWith('/migan_pipeline_v2.onnx')) {
          window.__inpaintDownloads++
          const stream = new ReadableStream({
            start(controller) {
              window.__inpaintStream = controller
              controller.enqueue(new Uint8Array([1, 2]))
            },
          })
          return Promise.resolve(
            new Response(stream, {
              headers: knownLength ? { 'content-length': '4' } : {},
            })
          )
        }
        return fetchOriginal(input, init)
      }
    }, knownLength)
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === baseURL) return route.continue()
      if (/\/ort\.[\w-]+\.min\.js$/.test(url.pathname))
        return route.fulfill({
          contentType: 'application/javascript',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: `window.__inpaintRuns = 0; window.__inpaintSessions = 0;
          window.ort = { env: { wasm: {} },
            Tensor: class { constructor(type, data, dims) { Object.assign(this, {type, data, dims}) } },
            InferenceSession: { create: async () => {
              window.__inpaintSessions++;
              return { inputNames: ['image', 'mask'], outputNames: ['output'], run: async feed => {
                window.__inpaintRuns++;
                return { output: { data: feed.image.data.slice(), dims: feed.image.dims } };
              } };
            } }
          };`,
        })
      return route.abort()
    })
    await page.goto('/')
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      return canvas.toDataURL().split(',')[1]
    })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'progress.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })
    const toolbar = page.locator('.editor-shell fieldset')
    const canvas = page.locator('.editor-shell canvas')
    const progress = page.getByRole('progressbar', {
      name: messages.processing_model,
    })
    await expect(toolbar).toBeEnabled()
    await expect
      .poll(() => page.evaluate(() => window.__inpaintDownloads))
      .toBe(1)
    // Join an already running warmup and recover its current progress immediately.
    await canvas.click()
    await expect(progress).toBeVisible()
    if (knownLength)
      await expect(progress).toHaveAttribute('aria-valuenow', '50')
    else {
      await expect(progress).not.toHaveAttribute('aria-valuenow')
      await expect(progress).toHaveAttribute(
        'aria-valuetext',
        messages.progress_unknown
      )
    }
    await page.keyboard.press('Escape')
    await expect(toolbar).toBeEnabled()
    await expect(progress).toHaveCount(0)
    await expect(toolbar).toBeFocused()
    await page.evaluate(() =>
      window.__inpaintStream.enqueue(new Uint8Array([3]))
    )
    await canvas.click()
    await expect(progress).toBeVisible()
    if (knownLength)
      await expect(progress).toHaveAttribute('aria-valuenow', '75')
    expect(await page.evaluate(() => window.__inpaintRuns)).toBe(0)
    await page.evaluate(() => {
      window.__inpaintStream.enqueue(new Uint8Array([4]))
      window.__inpaintStream.close()
    })
    await expect(page.locator('.history-scrollbar img')).toHaveCount(1)
    await expect(toolbar).toBeEnabled()
    await expect(progress).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(
      await page.evaluate(() => ({
        downloads: window.__inpaintDownloads,
        sessions: window.__inpaintSessions,
        runs: window.__inpaintRuns,
      }))
    ).toEqual({ downloads: 1, sessions: 1, runs: 1 })
    expect(errors).toEqual([])
  })
}
