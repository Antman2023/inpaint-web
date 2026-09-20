// Exercise the memory invariants after Vite's production minification too.
const { mkdtempSync, readdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join, relative, sep } = require('node:path')
const { spawnSync } = require('node:child_process')

async function main() {
  const root = resolve(__dirname, '..')
  const temporaryRoot = resolve(tmpdir())
  const output = mkdtempSync(join(temporaryRoot, 'inpaint-memory-'))
  try {
    const entries = {}
    const collect = directory => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, item.name)
        if (item.isDirectory()) collect(file)
        else if (item.name.endsWith('.ts') && !item.name.endsWith('.d.ts')) {
          entries[relative(root, file).replaceAll(sep, '/').slice(0, -3)] = file
        }
      }
    }
    collect(join(root, 'src'))
    const { build } = await import('vite')
    await build({
      configFile: false,
      logLevel: 'error',
      build: {
        outDir: output,
        emptyOutDir: false,
        minify: true,
        lib: { entry: entries, formats: ['cjs'] },
        rollupOptions: {
          // Preserve imports for the same dependency injection as source tests.
          external: id => !Object.values(entries).includes(id),
          output: { entryFileNames: '[name].cjs', paths: id => id, exports: 'named' },
        },
      },
    })
    const result = spawnSync(process.execPath, ['--expose-gc', '--test', 'tests/runtime-memory.cjs'], {
      cwd: root,
      env: { ...process.env, MEMORY_COMPILED_DIR: output },
      stdio: 'inherit',
      timeout: 60_000,
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    const location = relative(temporaryRoot, output)
    if (!location.startsWith('inpaint-memory-') || location.includes(sep))
      throw new Error('Unexpected temporary build directory')
    rmSync(output, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
