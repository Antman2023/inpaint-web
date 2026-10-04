const assert = require('node:assert/strict')

async function main() {
  const base = process.argv[2]
  assert(base, 'Usage: node tests/deployment-smoke.cjs http://localhost:8080')
  const request = (path, options = {}) =>
    fetch(new URL(path, base), {
      ...options,
      headers: { 'accept-encoding': 'identity', ...options.headers },
      signal: AbortSignal.timeout(10_000),
    })
  const checkIsolation = response => {
    assert.equal(
      response.headers.get('cross-origin-opener-policy'),
      'same-origin'
    )
    assert.equal(
      response.headers.get('cross-origin-embedder-policy'),
      'require-corp'
    )
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(
      response.headers.get('referrer-policy'),
      'strict-origin-when-cross-origin'
    )
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(
      response.headers.get('content-security-policy'),
      "frame-ancestors 'none'"
    )
    assert.equal(
      response.headers.get('permissions-policy'),
      'camera=(), microphone=(), geolocation=()'
    )
  }
  const index = await request('/')
  assert.equal(index.status, 200)
  assert.match(index.headers.get('content-type'), /text\/html/)
  assert.match(index.headers.get('cache-control'), /max-age=0.*must-revalidate/)
  checkIsolation(index)
  const html = await index.text()
  const asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1]
  assert(asset, 'Expected a hashed JavaScript entry in built index.html')
  const stylesheet = html.match(/href="(\/assets\/[^" ]+\.css)"/)?.[1]
  assert(stylesheet, 'Expected a hashed stylesheet in built index.html')
  const script = await request(asset)
  assert.equal(script.status, 200)
  assert.match(script.headers.get('content-type'), /javascript/)
  assert.match(
    script.headers.get('cache-control'),
    /max-age=31536000.*immutable/
  )
  checkIsolation(script)
  const scriptBytes = new Uint8Array(await script.arrayBuffer())
  const css = await request(stylesheet)
  assert.equal(css.status, 200)
  assert.match(css.headers.get('content-type'), /text\/css/)
  assert.match(css.headers.get('cache-control'), /max-age=31536000.*immutable/)
  checkIsolation(css)
  assert.ok((await css.arrayBuffer()).byteLength > 0)

  const compressed = await request(asset, {
    headers: { 'accept-encoding': 'gzip' },
  })
  assert.equal(compressed.status, 200)
  assert.equal(compressed.headers.get('content-encoding'), 'gzip')
  assert.match(compressed.headers.get('vary'), /accept-encoding/i)
  checkIsolation(compressed)
  assert.deepEqual(new Uint8Array(await compressed.arrayBuffer()), scriptBytes)

  const head = await request(asset, { method: 'HEAD' })
  assert.equal(head.status, 200)
  const headContentLength = head.headers.get('content-length')
  if (headContentLength !== null) {
    assert.equal(Number(headContentLength), scriptBytes.byteLength)
  }
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  checkIsolation(head)

  for (const [path, original, cachePattern, originalBytes] of [
    ['/', index, /max-age=0.*must-revalidate/, new TextEncoder().encode(html)],
    [asset, script, /max-age=31536000.*immutable/, scriptBytes],
  ]) {
    const etag = original.headers.get('etag')
    if (etag === null) continue
    const unchanged = await request(path, {
      headers: { 'if-none-match': etag },
    })
    assert.ok([200, 304].includes(unchanged.status), path)
    assert.match(unchanged.headers.get('cache-control'), cachePattern, path)
    checkIsolation(unchanged)
    const unchangedBytes = new Uint8Array(await unchanged.arrayBuffer())
    if (unchanged.status === 304) {
      assert.equal(unchangedBytes.byteLength, 0, path)
    } else {
      assert.deepEqual(unchangedBytes, originalBytes, path)
    }
  }

  for (const path of ['/index.html', '/smoke-client-route']) {
    const response = await request(path)
    assert.equal(response.status, 200, path)
    assert.match(
      response.headers.get('cache-control'),
      /max-age=0.*must-revalidate/,
      path
    )
    assert.equal(await response.text(), html, path)
  }
  const example = await request('/examples/dog.jpeg')
  assert.equal(example.status, 200)
  assert.match(example.headers.get('content-type'), /image\/jpeg/)
  await example.arrayBuffer()
  for (const path of [
    '/assets/missing-smoke.js',
    '/assets/missing-smoke.css',
    '/examples/missing-smoke.jpeg',
  ]) {
    const response = await request(path)
    assert.equal(response.status, 404, path)
    assert.equal(response.headers.get('cache-control'), 'no-store', path)
    checkIsolation(response)
    assert.doesNotMatch(
      response.headers.get('cache-control') ?? '',
      /immutable/,
      path
    )
    assert.notEqual(await response.text(), html, path)
  }
  console.log(
    'Deployment checks passed: JS/CSS assets, gzip integrity, HEAD, conditional caching, cache policies, security headers, SPA fallback and missing-resource 404s.'
  )
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
