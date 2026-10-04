const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')

const root = resolve(__dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const biome = JSON.parse(readFileSync(resolve(root, 'biome.json'), 'utf8'))
const tsconfig = JSON.parse(
  readFileSync(resolve(root, 'tsconfig.json'), 'utf8')
)

test('format checks cover the repository and every supported staged file', () => {
  assert.equal(manifest.scripts['format:check'], 'prettier --check .')
  assert.match(manifest.scripts.check, /^npm run format:check && /)
  assert.deepEqual(manifest['lint-staged'], {
    '*': ['prettier --write --ignore-unknown', "echo '统一格式化完成🌸'"],
  })
})

test('Biome lints the repository with current rules and ignores generated data', () => {
  assert.equal(manifest.scripts.lint, 'biome lint .')
  assert.equal(biome.$schema, 'https://biomejs.dev/schemas/2.5.15/schema.json')
  assert.equal(biome.linter.rules.preset, 'recommended')
  assert.equal(biome.linter.rules.recommended, undefined)
  assert.deepEqual(biome.files, {
    ignoreUnknown: true,
    includes: [
      '**',
      '!!dist',
      '!!build',
      '!!coverage',
      '!!test-results',
      '!!playwright-report',
      '!!media',
      '!!model',
      '!!cache',
    ],
  })
})

test('TypeScript rejects ambiguous index access and emitted-only syntax', () => {
  assert.equal(
    tsconfig.compilerOptions.noPropertyAccessFromIndexSignature,
    true
  )
  assert.equal(tsconfig.compilerOptions.verbatimModuleSyntax, true)
  assert.equal(tsconfig.compilerOptions.erasableSyntaxOnly, true)
})

test('Vite tooling excludes obsolete CRA environment files', () => {
  const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8')

  assert.equal(existsSync(resolve(root, '.env')), false)
  assert.equal(existsSync(resolve(root, 'src/react-app-env.d.ts')), false)
  assert.match(gitignore, /^\/\.env$/m)
  assert.ok(tsconfig.compilerOptions.types.includes('vite/client'))
})
