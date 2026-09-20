const { readFileSync } = require('node:fs')
const { resolve, dirname, relative } = require('node:path')
const ts = require('typescript')

// Compile the production module with browser dependencies supplied by each test.
function loadModule(path, dependencies = {}, globals = {}) {
  path = relative(resolve(__dirname, '..'), resolve(__dirname, '..', path))
  const source = readFileSync(resolve(__dirname, '..', path), 'utf8')
  const { outputText } = process.env.MEMORY_COMPILED_DIR
    ? { outputText: readFileSync(resolve(process.env.MEMORY_COMPILED_DIR, path.replace(/\.ts$/, '.cjs')), 'utf8') }
    : ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  })
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ...Object.keys(globals),
    outputText
  )(
    name => {
      if (name in dependencies) return dependencies[name]
      if (process.env.MEMORY_COMPILED_DIR && name.endsWith('.js')) {
        return require(resolve(process.env.MEMORY_COMPILED_DIR, dirname(path), name))
      }
      if (name.startsWith('.')) {
        const target = resolve(__dirname, '..', dirname(path), name)
        return loadModule(target + '.ts', dependencies, globals)
      }
      return require(name)
    },
    module,
    module.exports,
    ...Object.values(globals)
  )
  return module.exports
}

module.exports = { loadModule }
