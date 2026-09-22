const { test, expect } = require('@playwright/test')
const messages = require('../../messages/en.json')

test('only a gesture starting and ending on the backdrop dismisses a dialog', async ({
  page,
  baseURL,
}) => {
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort()
  )
  await page.addInitScript(() => localStorage.setItem('inpaint-language', 'en'))
  await page.goto('/')
  const opener = page.getByRole('button', {
    name: messages.feedback,
    exact: true,
  })
  await opener.focus()
  await opener.press('Enter')
  const dialog = page.getByRole('dialog', {
    name: messages.feedback,
    exact: true,
  })
  // Use panel padding so the drag does not start native text selection/dragging.
  const panel = await dialog.locator(':scope > div').boundingBox()
  const inside = {
    x: panel.x + panel.width / 2,
    y: panel.y + 12,
  }
  const outside = { x: 8, y: 8 }
  for (const [start, end] of [
    [inside, outside],
    [outside, inside],
  ]) {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await page.mouse.up()
    await expect(dialog).toBeVisible()
  }
  await page.mouse.click(outside.x, outside.y)
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await opener.press('Enter')
  await expect(dialog).toBeVisible()
  // Model touch capture: release still targets the dialog, but its coordinates
  // are inside the panel. A captured target alone must not dismiss the modal.
  await dialog.evaluate(
    (el, { inside, outside }) => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          isPrimary: true,
          pointerId: 7,
          pointerType: 'touch',
          clientX: outside.x,
          clientY: outside.y,
          button: 0,
        })
      )
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          isPrimary: true,
          pointerId: 7,
          pointerType: 'touch',
          clientX: inside.x,
          clientY: inside.y,
          button: 0,
        })
      )
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    },
    { inside, outside }
  )
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})
