import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const serverRoot = join(repositoryRoot, 'server')
const laravelRoutesDirectory = join(repositoryRoot, 'laravel-api', 'routes')
const maximumMissingArgument = process.argv.find((argument) => argument.startsWith('--max-missing='))
const maximumMissing = maximumMissingArgument
  ? Number(maximumMissingArgument.slice('--max-missing='.length))
  : 0

if (!Number.isInteger(maximumMissing) || maximumMissing < 0) {
  throw new Error('--max-missing must be a non-negative integer.')
}

function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) return listJavaScriptFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : []
  })
}

function normalizePath(path) {
  return path
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/'
}

const nodeRoutes = new Map()
for (const filePath of listJavaScriptFiles(serverRoot)) {
  const source = readFileSync(filePath, 'utf8')
  for (const match of source.matchAll(/\bapp\.(get|post|put|patch|delete)\s*\(\s*['"`](\/api\/[^'"`]+)['"`]/gi)) {
    const method = match[1].toUpperCase()
    const path = normalizePath(match[2])
    nodeRoutes.set(`${method} ${path}`, relative(repositoryRoot, filePath))
  }
}

const laravelRoutes = new Set()
for (const entry of readdirSync(laravelRoutesDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.php')) continue
  const laravelSource = readFileSync(join(laravelRoutesDirectory, entry.name), 'utf8')
  for (const [, method, path] of laravelSource.matchAll(/(?:Route::|->)(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi)) {
    laravelRoutes.add(`${method.toUpperCase()} ${normalizePath(`/api${path}`)}`)
  }
}

const missingRoutes = [...nodeRoutes.entries()]
  .filter(([route]) => !laravelRoutes.has(route))
  .sort(([left], [right]) => left.localeCompare(right))
const extraRoutes = [...laravelRoutes]
  .filter((route) => !nodeRoutes.has(route))
  .sort((left, right) => left.localeCompare(right))

console.log(`Node API routes: ${nodeRoutes.size}`)
console.log(`Laravel API routes: ${laravelRoutes.size}`)
console.log(`Routes missing from Laravel: ${missingRoutes.length}`)
console.log(`Routes not present in Node: ${extraRoutes.length}`)

if (missingRoutes.length > 0) {
  for (const [route, source] of missingRoutes) {
    console.log(`- ${route} (${source})`)
  }
}
if (extraRoutes.length > 0) {
  console.log('Laravel-only routes:')
  for (const route of extraRoutes) console.log(`- ${route}`)
}

if (missingRoutes.length > maximumMissing) {
  console.error(`Laravel route parity check failed: ${missingRoutes.length} missing routes exceeds the allowed maximum of ${maximumMissing}.`)
  process.exitCode = 1
} else if (missingRoutes.length === 0) {
  console.log('All statically registered Node API routes are present in Laravel.')
} else {
  console.log(`Route gap is within the allowed maximum of ${maximumMissing}; Laravel is not yet API-parity complete.`)
}
