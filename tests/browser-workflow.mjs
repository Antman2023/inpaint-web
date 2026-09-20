import { message } from '../src/i18n.ts'

function assert(condition, details) {
  if (!condition) throw new Error(details)
}

async function waitFor(predicate, description, timeout = 120_000) {
  const started = performance.now()
  while (!predicate()) {
    const error = document.querySelector('[role="alert"]')
    if (error) throw new Error(error.textContent)
    if (performance.now() - started > timeout)
      throw new Error(`Timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

function button(key) {
  const element = Array.from(document.querySelectorAll('button')).find(
    item => item.textContent.trim() === message(key)
  )
  assert(
    element && !element.matches(':disabled'),
    `Missing or disabled button: ${key}`
  )
  return element
}

// Start on the import page. Captures download links without saving files.
// Real model work can take longer on a cold cache; use the UI to cancel if needed.
export async function runBrowserWorkflow({ verifyCleanup = false } = {}) {
  assert(
    document.querySelector('input[type="file"]'),
    'Return to the import page before running this check'
  )
  assert(
    !document.querySelector('dialog[open]'),
    'Close dialogs before running this check'
  )
  const exports = []
  const activeURLs = new Set()
  let createdURLs = 0
  const createURL = URL.createObjectURL
  const revokeURL = URL.revokeObjectURL
  if (verifyCleanup) {
    URL.createObjectURL = function (blob) {
      const url = createURL.call(URL, blob)
      activeURLs.add(url)
      createdURLs++
      return url
    }
    URL.revokeObjectURL = function (url) {
      activeURLs.delete(url)
      return revokeURL.call(URL, url)
    }
  }
  const capture = event => {
    const link = event.target.closest?.('a[download]')
    if (!link) return
    event.preventDefault()
    const name = link.download
    exports.push(
      fetch(link.href)
        .then(response => response.blob())
        .then(async blob => {
          const bitmap = await createImageBitmap(blob)
          try {
            return {
              name,
              width: bitmap.width,
              height: bitmap.height,
              type: blob.type,
            }
          } finally {
            bitmap.close()
          }
        })
    )
  }
  document.addEventListener('click', capture, true)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#5588bb'
    ctx.fillRect(16, 0, 48, 64)
    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/png')
    )
    assert(blob, 'Could not encode test fixture')
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'workflow.png', { type: 'image/png' }))
    document.body.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      })
    )
    await waitFor(
      () => document.querySelector('fieldset:not(:disabled)'),
      'editor readiness'
    )
    button('upscale').click()
    await waitFor(
      () =>
        document.querySelector('fieldset:not(:disabled)') &&
        document.querySelector(
          '.history-scrollbar button[aria-pressed="true"]'
        ),
      'upscale result'
    )
    button('download').click()
    // Focus a non-editable control to exercise the editor's shortcut handler.
    document.querySelector('fieldset').focus()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })
    )
    await waitFor(
      () =>
        document
          .querySelector('#upscale-details')
          ?.textContent.startsWith('64 × 64'),
      'undo'
    )
    button('download').click()
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    )
    await waitFor(
      () =>
        document
          .querySelector('#upscale-details')
          ?.textContent.startsWith('256 × 256'),
      'redo'
    )
    button('download').click()
    const results = await Promise.all(exports)
    assert(
      results.length === 3,
      `Expected three exports, received ${results.length}`
    )
    for (const [index, result] of results.entries()) {
      const original = index === 1
      const size = original ? 64 : 256
      const name = original ? 'workflow.png' : 'workflow-edited.png'
      assert(
        result.width === size &&
          result.height === size &&
          result.name === name &&
          result.type === 'image/png',
        `Unexpected export ${index + 1}: ${JSON.stringify(result)}`
      )
    }
    if (verifyCleanup) {
      const firstResultURLs = new Set(activeURLs)
      assert(
        firstResultURLs.size >= 3,
        'Original, result and thumbnail URLs were not observed'
      )
      button('undo').click()
      await waitFor(
        () =>
          document
            .querySelector('#upscale-details')
            ?.textContent.startsWith('64 × 64'),
        'undo before branching'
      )
      button('upscale').click()
      await waitFor(
        () =>
          document.querySelector('fieldset:not(:disabled)') &&
          document
            .querySelector('#upscale-details')
            ?.textContent.startsWith('256 × 256'),
        'replacement history result'
      )
      await waitFor(
        () =>
          [...firstResultURLs].filter(url => !activeURLs.has(url)).length >= 2,
        'discarded result and thumbnail release',
        10_000
      )
      assert(
        document.querySelectorAll('.history-scrollbar button').length === 1,
        'Discarded history branch is still present'
      )
      const releasedBranchURLs = [...firstResultURLs].filter(
        url => !activeURLs.has(url)
      ).length
      button('start_new').click()
      await waitFor(
        () => document.querySelector('input[type="file"]'),
        'return to import page'
      )
      await waitFor(
        () => activeURLs.size === 0,
        'all editor object URLs to be released',
        10_000
      )
      return {
        exports: results,
        createdURLs,
        releasedBranchURLs,
        remainingURLs: activeURLs.size,
      }
    }
    return results
  } finally {
    if (verifyCleanup) {
      URL.createObjectURL = createURL
      URL.revokeObjectURL = revokeURL
    }
    document.removeEventListener('click', capture, true)
    canvas.width = canvas.height = 0
  }
}
