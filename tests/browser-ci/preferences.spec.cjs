const { test, expect } = require('@playwright/test')
const en = require('../../messages/en.json')
const zh = require('../../messages/zh.json')

test.use({ locale: 'en-US', colorScheme: 'light' })

for (const failure of ['access denied', 'quota exceeded']) {
  test(`preferences remain usable when storage reports ${failure}`, async ({
    page,
    baseURL,
  }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route =>
      new URL(route.request().url()).origin === baseURL
        ? route.continue()
        : route.abort()
    )
    await page.addInitScript(mode => {
      if (mode === 'access denied') {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('Storage blocked', 'SecurityError')
          },
        })
      } else {
        Storage.prototype.setItem = () => {
          throw new DOMException('Storage full', 'QuotaExceededError')
        }
      }
    }, failure)
    await page.goto('/')
    const html = page.locator('html')
    await expect(
      page.getByRole('heading', { name: en.workspace_title })
    ).toBeVisible()
    await expect(html).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: en.theme_to_light }).click()
    await expect(html).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.emulateMedia({ colorScheme: 'dark' })
    // Deliver the media change before asserting that manual selection wins.
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    await expect(html).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: '切换到中文' }).click()
    await expect(html).toHaveAttribute('lang', 'zh-CN')
    await expect(
      page.getByRole('heading', { name: zh.workspace_title })
    ).toBeVisible()
    await page.reload()
    await expect(html).toHaveAttribute('lang', 'en')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(
      page.getByRole('heading', { name: en.workspace_title })
    ).toBeVisible()
    expect(errors).toEqual([])
  })
}
