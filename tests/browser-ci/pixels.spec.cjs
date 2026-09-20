const { test, expect } = require('@playwright/test')

for (const check of [
  {
    name: 'brush path caching preserves rendered pixels',
    path: '/tests/browser-brush.mjs',
    exportName: 'runBrushSmoke',
    expected: { pixelComparisons: 10, status: 'passed' },
  },
  {
    name: 'strip preprocessing preserves RGB, alpha and scaled masks',
    path: '/tests/browser-preprocess.mjs',
    exportName: 'runPreprocessSmoke',
    expected: { pixelsChecked: 1_044_483, rgbModes: 2, scaledMask: 'passed' },
  },
]) {
  test(check.name, async ({ page, baseURL }) => {
    const externalRequests = [],
      errors = []
    page.on('pageerror', error => errors.push(error.message))
    // These checks must remain local and independent of model/CDN availability.
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === baseURL) return route.continue()
      externalRequests.push(url.href)
      return route.abort()
    })
    await page.goto('/')
    expect(
      await page.evaluate(() => ({
        secure: window.isSecureContext,
        isolated: window.crossOriginIsolated,
        sharedMemory: typeof SharedArrayBuffer === 'function',
      }))
    ).toEqual({ secure: true, isolated: true, sharedMemory: true })
    const result = await page.evaluate(
      async ({ path, exportName }) => {
        const module = await import(path)
        return module[exportName]()
      },
      { path: check.path, exportName: check.exportName }
    )
    expect(result).toEqual(check.expected)
    expect(errors).toEqual([])
    expect(externalRequests).toEqual([])
  })
}
