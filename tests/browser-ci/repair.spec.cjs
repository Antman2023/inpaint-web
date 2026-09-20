const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('failed runtime repair retries both sources and restores its parent dialog', async ({
  page,
  baseURL,
}) => {
  const requests = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('inpaint-language', 'en'))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === baseURL) return route.continue()
    if (url.pathname.endsWith('/ort.wasm.min.js')) {
      requests.push(route)
      return
    }
    return route.abort()
  })
  await page.goto('/')
  const aboutButton = page.getByRole('button', {
    name: messages.feedback,
    exact: true,
  })
  // Mouse clicks need not focus buttons in WebKit. Start from an explicit
  // keyboard focus so restoration has the same contract on every engine.
  await aboutButton.focus()
  await aboutButton.press('Enter')
  const about = page.getByRole('dialog', {
    name: messages.feedback,
    exact: true,
  })
  const repairButton = about.getByRole('button', {
    name: messages.repair_runtime,
    exact: true,
  })
  const repair = page.getByRole('dialog', {
    name: messages.repair_runtime,
    exact: true,
  })
  await repairButton.focus()
  await repairButton.press('Enter')
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect.poll(() => requests.length).toBe(attempt * 2 + 1)
    await expect(repair).toBeVisible()
    await expect(repairButton).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(repair).toBeVisible()
    for (let source = 0; source < 2; source++) {
      const index = attempt * 2 + source
      await expect.poll(() => requests.length).toBe(index + 1)
      await requests[index].fulfill({
        status: 503,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'offline',
      })
    }
    await expect(repair.getByRole('alert')).toContainText(
      'Failed to load ONNX Runtime'
    )
    await expect(repair.getByRole('status')).toHaveText(messages.repair_failed)
    if (attempt === 0)
      await repair
        .getByRole('button', { name: messages.repair_retry, exact: true })
        .click()
  }
  expect(
    requests.map(route => new URL(route.request().url()).hostname)
  ).toEqual(['cdn.jsdelivr.net', 'unpkg.com', 'cdn.jsdelivr.net', 'unpkg.com'])
  await page.keyboard.press('Escape')
  await expect(repair).toHaveCount(0)
  await expect(about).toBeVisible()
  await expect(repairButton).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(about).toHaveCount(0)
  await expect(aboutButton).toBeFocused()
  expect(errors).toEqual([])
})
