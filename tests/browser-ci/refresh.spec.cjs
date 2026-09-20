const { test, expect } = require('@playwright/test')

test('resource-owning components force remount during Fast Refresh', async ({
  request,
}) => {
  // A retained reset comment is insufficient: the compiler must emit forceReset
  // in the refresh signature or disposed importers/controllers can be reused.
  for (const component of ['App', 'Editor']) {
    const response = await request.get(`/src/${component}.tsx`)
    expect(response.ok()).toBe(true)
    expect(await response.text()).toMatch(
      new RegExp(`\\w+\\(${component},\\s*"[^"]+",\\s*true\\s*[,)]`)
    )
  }
})
