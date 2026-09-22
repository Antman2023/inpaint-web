const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('oversized example headers fail before body reads and allow retry', async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('inpaint-language', 'en')
    const originalFetch = window.fetch
    window.__exampleReads = 0
    window.__exampleCancelled = false
    let first = true
    window.fetch = (input, options) => {
      if (first && String(input).endsWith('/examples/dog.jpeg')) {
        first = false
        const body = new ReadableStream(
          {
            pull() {
              window.__exampleReads++
            },
            cancel() {
              window.__exampleCancelled = true
              // A slow cancellation acknowledgement must not delay the error.
              return new Promise(resolve => {
                window.__finishExampleCancel = resolve
              })
            },
          },
          { highWaterMark: 0 }
        )
        return Promise.resolve(
          new Response(body, {
            headers: {
              'content-type': 'image/jpeg',
              'content-length': '10485761',
            },
          })
        )
      }
      return originalFetch(input, options)
    }
  })
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.goto('/')
  const sample = page.getByRole('button', { name: 'dog', exact: true })
  await sample.click()
  await expect(page.getByRole('alert')).toContainText(messages.file_too_large)
  expect(
    await page.evaluate(() => ({
      reads: window.__exampleReads,
      cancelled: window.__exampleCancelled,
    }))
  ).toEqual({ reads: 0, cancelled: true })
  await expect(page.locator('.editor-shell')).toHaveCount(0)
  await sample.click()
  await expect(page.locator('.editor-shell fieldset')).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.evaluate(() => window.__finishExampleCancel())
  await expect(page.locator('.editor-shell fieldset')).toBeEnabled()
})
