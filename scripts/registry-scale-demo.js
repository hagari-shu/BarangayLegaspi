import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const parseRecordCount = (args) => {
  if (args.length === 0) return 2500
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: npm run demo:registry [-- --count 100..10000]')
    process.exit(0)
  }
  if (args.length !== 2 || args[0] !== '--count' || !/^\d+$/.test(args[1])) {
    throw new Error('Usage: npm run demo:registry [-- --count 100..10000]')
  }
  const count = Number(args[1])
  if (!Number.isSafeInteger(count) || count < 100 || count > 10000) {
    throw new Error('Choose a synthetic record count from 100 to 10,000.')
  }
  return count
}

const getAvailablePort = async () => {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

const closeServer = (server) => new Promise((resolve, reject) => {
  if (!server?.listening) return resolve()
  server.close((error) => error ? reject(error) : resolve())
})

const makeSyntheticResidents = (count) => Array.from({ length: count }, (_, offset) => {
  const index = offset + 1
  const householdNumber = Math.floor(offset / 4) + 1
  const zone = (householdNumber - 1) % 7 + 1
  const purokNumber = Math.floor((householdNumber - 1) / 7) % 5 + 1
  const birthDate = new Date(Date.UTC(
    2025 - (offset * 7) % 90,
    (offset * 5) % 12,
    (offset * 11) % 27 + 1
  )).toISOString().slice(0, 10)

  return {
    id: randomUUID(),
    firstName: `Demo${String(index).padStart(5, '0')}`,
    lastName: `Resident${String(index).padStart(5, '0')}`,
    birthDate,
    sex: offset % 2 === 0 ? 'Male' : 'Female',
    householdId: `DEMO-Z${zone}-P${purokNumber}-HH${String(householdNumber).padStart(5, '0')}`,
    purok: `Purok ${purokNumber}`,
    zone,
    status: 'active',
    verificationStatus: offset % 10 < 7 ? 'verified' : offset % 10 < 9 ? 'pending' : 'needs_review',
    address: 'FICTIONAL DEMO DATA — NOT A REAL ADDRESS',
    sourceReference: null,
    sourceFilename: null,
    createdAt: new Date().toISOString(),
  }
})

const main = async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The synthetic registry demo refuses to run in production.')
  }
  if (process.env.DATABASE_URL?.trim()) {
    throw new Error('The synthetic registry demo refuses to run while DATABASE_URL is set. Clear it and retry; no database was contacted.')
  }
  const recordCount = parseRecordCount(process.argv.slice(2))
  const demoDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'barangay-registry-scale-demo-'))
  let apiServer
  let vite
  let shutdownRequested = false
  let finishShutdown
  const shutdownSignal = new Promise((resolve) => { finishShutdown = resolve })
  const requestShutdown = () => {
    if (shutdownRequested) return
    shutdownRequested = true
    finishShutdown()
  }
  process.once('SIGINT', requestShutdown)
  process.once('SIGTERM', requestShutdown)

  try {
    const apiPort = await getAvailablePort()
    const webPort = await getAvailablePort()
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = ''
    process.env.BRGY_TEST_DATA_DIR = demoDataDir
    process.env.JWT_SECRET = randomBytes(48).toString('base64url')
    process.env.RESIDENT_DATA_ENCRYPTION_KEY = randomBytes(48).toString('base64url')
    process.env.RESIDENT_DATA_ENCRYPTION_KEY_PREVIOUS = ''
    process.env.MFA_ENCRYPTION_KEY = randomBytes(48).toString('base64url')
    process.env.MFA_ENCRYPTION_KEY_PREVIOUS = ''
    process.env.PORT = String(apiPort)
    process.env.CORS_ORIGINS = `http://127.0.0.1:${webPort}`
    process.env.VITE_API_BASE = `http://127.0.0.1:${apiPort}/api`
    process.env.VITE_REGISTRY_SCALE_DEMO = 'true'

    const [{ createApp }, { hashPassword }, jsonDb, { createServer: createViteServer }] = await Promise.all([
      import('../server/app.js'),
      import('../server/auth.js'),
      import('../server/db.js'),
      import('vite'),
    ])

    const staffPassword = `Demo-${randomBytes(18).toString('base64url')}!9aA`
    const demoStaff = {
      id: randomUUID(),
      firstName: 'Synthetic',
      lastName: 'Demo Operator',
      mobile: '09100000001',
      email: 'demo.staff@local.test',
      passwordHash: await hashPassword(staffPassword),
      role: 'staff',
      householdId: null,
      familyMembers: 1,
      householdMembers: [],
      status: 'On Duty',
      address: 'FICTIONAL DEMO DATA — NOT A REAL ADDRESS',
      zone: 0,
      position: 'Synthetic demo only',
      availability: 'Available',
      createdAt: new Date().toISOString(),
    }
    const residents = makeSyntheticResidents(recordCount)
    await jsonDb.writeDb({
      users: [demoStaff],
      requests: [],
      announcements: [],
      reports: [],
      approvals: [],
      residentRegistry: residents,
      registrySourceReviews: [],
      emergencyAccessGrants: [],
      auditLogs: [],
      staffInvitations: [],
    })

    apiServer = createApp().listen(apiPort, '127.0.0.1')
    await new Promise((resolve, reject) => {
      apiServer.once('listening', resolve)
      apiServer.once('error', reject)
    })
    vite = await createViteServer({
      configFile: path.resolve('vite.config.js'),
      server: { host: '127.0.0.1', port: webPort, strictPort: true },
      logLevel: 'warn',
    })
    await vite.listen()

    console.log('Synthetic registry scale demo is running locally only.')
    console.log(`Fictional resident records: ${recordCount}`)
    console.log(`Temporary isolated data directory: ${demoDataDir}`)
    console.log(`Open: http://127.0.0.1:${webPort}/`)
    console.log('Sign in with: demo.staff@local.test')
    console.log(`Demo-only password: ${staffPassword}`)
    console.log('Open Staff Portal > Resident registry. Use search and pagination to inspect the synthetic records.')
    console.log('The data store and encryption keys are temporary and will be removed when this process stops.')
    console.log('Press Ctrl+C to stop the demo and delete its temporary data.')
    await shutdownSignal
  } finally {
    process.removeListener('SIGINT', requestShutdown)
    process.removeListener('SIGTERM', requestShutdown)
    await vite?.close()
    await closeServer(apiServer)
    await fs.rm(demoDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`Unable to start the isolated registry demo: ${error.message}`)
  process.exitCode = 1
})
