// Opt-in only: downloads actual runtime/model files into an isolated browser.
const { chromium, firefox, webkit } = require('playwright')

async function main() {
  const name = process.env.PLAYWRIGHT_BROWSER || 'chromium'
  const engine = { chromium, firefox, webkit }[name]
  if (!engine) throw new Error(`Unsupported model smoke browser: ${name}`)
  const { createServer } = await import('vite')
  const server = await createServer({
    server: { host: '127.0.0.1', port: 4181, strictPort: true, open: false },
  })
  let browser
  let timeout
  try {
    await server.listen()
    browser = await engine.launch({
      channel: name === 'chromium' ? process.env.PLAYWRIGHT_CHANNEL : undefined,
    })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.exposeFunction('reportModelSmoke', status => {
      console.log(JSON.stringify(status))
    })
    await page.goto('http://127.0.0.1:4181/')
    const result = await Promise.race([
      page.evaluate(async verifyRepair => {
        const { runBrowserSmoke } = await import('/tests/browser-smoke.mjs')
        const options = {
          exerciseCancellation: true,
          onProgress: status => void window.reportModelSmoke(status),
        }
        const initial = await runBrowserSmoke(options)
        if (!verifyRepair) return initial
        const { repairRuntime, hasSession } =
          await import('/src/adapters/runtime.ts')
        const previousRuntime = window.ort
        let reported = -1
        await repairRuntime(progress => {
          const bucket = progress === null ? null : Math.floor(progress / 10)
          if (bucket !== reported) {
            reported = bucket
            void window.reportModelSmoke({ operation: 'repair', progress })
          }
        })
        if (
          window.ort === previousRuntime ||
          !hasSession('inpaint') ||
          !hasSession('superResolution')
        ) {
          throw new Error(
            'Repair did not replace the runtime and recreate both sessions'
          )
        }
        const afterRepair = await runBrowserSmoke(options)
        const scripts = document.querySelectorAll(
          'script[src*="onnxruntime-web"]'
        )
        if (scripts.length)
          throw new Error('Runtime script elements accumulated after repair')
        return {
          initial,
          repair: 'passed',
          afterRepair,
          runtimeScriptElements: scripts.length,
        }
      }, process.env.MODEL_SMOKE_REPAIR === '1'),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Real model smoke timed out after 5 minutes')),
          300_000
        )
      }),
    ])
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(
      JSON.stringify(
        { browser: name, version: browser.version(), ...result },
        null,
        2
      )
    )
  } finally {
    clearTimeout(timeout)
    try {
      await browser?.close()
    } finally {
      await server.close()
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
