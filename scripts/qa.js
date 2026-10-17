import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

if (process.env.DATABASE_URL) {
  console.error('Local QA mode refuses to start while DATABASE_URL is set. Unset it to protect database records.')
  process.exitCode = 1
} else {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const demoDataIndex = process.argv.indexOf('--demo-data')
  const demoDataPath = demoDataIndex >= 0 ? process.argv[demoDataIndex + 1] : ''
  const environment = {
    ...process.env,
    NODE_ENV: 'development',
    QA_MODE: 'true',
    PORT: '3002',
    SKIP_SEED: 'false',
    CORS_ORIGINS: 'http://127.0.0.1:5174,http://localhost:5174',
    VITE_API_BASE: 'http://127.0.0.1:3002/api',
    JWT_SECRET: randomBytes(32).toString('hex'),
    ADMIN_FIRST_NAME: 'QA',
    ADMIN_LAST_NAME: 'Administrator',
    ADMIN_MOBILE: '09000000001',
    ADMIN_EMAIL: 'qa.admin@example.test',
    ADMIN_PASSWORD: 'QaAdminPass123!',
    ADMIN_STATUS: 'Administrator',
    ADMIN_ADDRESS: 'QA Sandbox',
    ADMIN_ZONE: '0',
  }

  for (const key of [
    'RESET_DELIVERY_URL',
    'RESET_DELIVERY_TOKEN',
    'NOTIFICATION_WEBHOOK_URL',
    'META_PAGE_ID',
    'META_PAGE_ACCESS_TOKEN',
    'META_APP_SECRET',
    'META_WEBHOOK_VERIFY_TOKEN',
    'META_GRAPH_API_VERSION',
    'OBJECT_STORAGE_ENDPOINT',
    'OBJECT_STORAGE_REGION',
    'OBJECT_STORAGE_BUCKET',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_FORCE_PATH_STYLE',
  ]) {
    delete environment[key]
  }

  if (demoDataIndex >= 0 && !demoDataPath) {
    console.error('Provide a JSON path after --demo-data.')
    process.exitCode = 1
  } else if (demoDataPath) {
    const seedScript = path.join(projectRoot, 'scripts', 'seed-qa-demo.js')
    const seedResult = spawnSync(process.execPath, [seedScript, path.resolve(demoDataPath)], {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
    })
    if (seedResult.error) {
      console.error('Unable to prepare the local QA demo accounts:', seedResult.error.message)
      process.exitCode = 1
    } else if (seedResult.status !== 0) {
      process.exitCode = seedResult.status || 1
    }
  }

  if (process.exitCode) {
    process.exit(process.exitCode)
  }

  const children = []
  let shuttingDown = false

  const stop = (exitCode) => {
    if (shuttingDown) return
    shuttingDown = true
    process.exitCode = exitCode
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
  }

  const startChild = (command, args, name) => {
    const child = spawn(command, args, { cwd: projectRoot, env: environment, stdio: 'inherit' })
    children.push(child)
    child.on('error', (error) => {
      console.error(`Unable to start the local QA ${name}:`, error.message)
      stop(1)
    })
    child.on('exit', (code) => {
      if (!shuttingDown) stop(code ?? 1)
    })
  }

  process.once('SIGINT', () => stop(130))
  process.once('SIGTERM', () => stop(143))

  startChild(process.execPath, ['server.js'], 'API')
  startChild(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '5174', '--strictPort'], 'frontend')
}
