const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')

const root = resolve(__dirname, '..')

test('Cloudflare Pages headers are indented and match Caddy security policy', () => {
  const source = readFileSync(resolve(root, 'public/_headers'), 'utf8')
  const lines = source.split(/\r?\n/).filter(Boolean)
  assert.equal(lines[0], '/*')
  for (const line of lines.slice(1)) {
    assert.match(line, /^\s+[^:]+:\s+.+$/, `Invalid header rule: ${line}`)
  }

  const headers = new Map(
    lines.slice(1).map(line => {
      const separator = line.indexOf(':')
      return [
        line.slice(0, separator).trim().toLowerCase(),
        line.slice(separator + 1).trim(),
      ]
    })
  )
  const expected = new Map([
    ['cross-origin-opener-policy', 'same-origin'],
    ['cross-origin-embedder-policy', 'require-corp'],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['x-frame-options', 'DENY'],
    ['content-security-policy', "frame-ancestors 'none'"],
    ['permissions-policy', 'camera=(), microphone=(), geolocation=()'],
  ])
  assert.deepEqual(headers, expected)

  const caddy = readFileSync(resolve(root, 'Caddyfile'), 'utf8')
  for (const [name, value] of expected) {
    const caddyName = name
      .split('-')
      .map(part => part[0].toUpperCase() + part.slice(1))
      .join('-')
    assert.match(
      caddy,
      new RegExp(`${caddyName}\\s+"${value.replace(/[()]/g, '\\$&')}"`),
      `Caddy is missing ${name}`
    )
  }
})

test('Docker build context includes only production build inputs', () => {
  const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
  assert.deepEqual(dockerignore, [
    '**',
    '!.npmrc',
    '!Caddyfile',
    '!Dockerfile',
    '!index.html',
    '!package.json',
    '!package-lock.json',
    '!postcss.config.js',
    '!tsconfig.json',
    '!vite.config.mts',
    '!messages/',
    '!messages/**',
    '!public/',
    '!public/**',
    '!src/',
    '!src/**',
  ])

  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
  assert.match(dockerfile, /^ENV HUSKY=0$/m)
  assert.doesNotMatch(dockerfile, /^COPY\s+\.\s+\.$/m)
  for (const instruction of [
    'COPY package.json package-lock.json .npmrc ./',
    'COPY index.html postcss.config.js tsconfig.json vite.config.mts ./',
    'COPY messages ./messages',
    'COPY public ./public',
    'COPY src ./src',
    'COPY Caddyfile /etc/caddy/Caddyfile',
    'COPY --from=builder /app/dist /srv',
  ]) {
    assert.ok(
      dockerfile.split(/\r?\n/).includes(instruction),
      `Dockerfile is missing: ${instruction}`
    )
  }
})
