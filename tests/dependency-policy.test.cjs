const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')

const root = resolve(__dirname, '..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))

function packageName(lockPath) {
  const path = lockPath.slice(lockPath.lastIndexOf('node_modules/') + 13)
  const parts = path.split('/')
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

test('dependency install scripts have an explicit reviewed policy', () => {
  const manifest = readJson('package.json')
  const lock = readJson('package-lock.json')
  const npmrc = readFileSync(resolve(root, '.npmrc'), 'utf8')

  assert.match(npmrc, /^strict-allow-scripts=true$/m)
  assert.deepEqual(manifest.allowScripts, {
    '@swc/core': false,
    'fsevents@2.3.3': true,
    protobufjs: false,
  })
  assert.equal(manifest.overrides['@swc/core'], '1.16.2')

  const scriptedPackages = Object.entries(lock.packages).filter(
    ([, metadata]) => metadata.hasInstallScript
  )
  assert.ok(scriptedPackages.length > 0)

  for (const [lockPath, metadata] of scriptedPackages) {
    const name = packageName(lockPath)
    const versionedName = `${name}@${metadata.version}`
    assert.ok(
      Object.hasOwn(manifest.allowScripts, name) ||
        Object.hasOwn(manifest.allowScripts, versionedName),
      `${versionedName} is missing from allowScripts`
    )
  }

  assert.equal(lock.packages['node_modules/fsevents'].version, '2.3.3')
  assert.deepEqual(lock.packages['node_modules/fsevents'].os, ['darwin'])
})
