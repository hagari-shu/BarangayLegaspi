import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp, seedDemoResident } from '../server/app.js'
import { hashPassword, verifyToken } from '../server/auth.js'
import { signToken } from '../server/auth.js'
import * as jsonDb from '../server/db.js'
import { DB_PATH } from '../server/config.js'
import { isCaptainPhotoStorageConfigured } from '../server/captain-photo-storage.js'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createTotpSecret, encryptTotpSecret } from '../server/mfa.js'
import { registryAgeDateRange } from '../server/resident-registry.js'

const testDbPath = DB_PATH

const createTotpCode = (secret, timestamp = Date.now()) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let buffer = 0
  let bits = 0
  const bytes = []
  for (const character of secret) {
    buffer = ((buffer << 5) | alphabet.indexOf(character)) & 0xffff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 0xff)
    }
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

beforeEach(async () => {
  await fs.mkdir(path.dirname(testDbPath), { recursive: true })
  await fs.writeFile(testDbPath, JSON.stringify({ users: [], requests: [], announcements: [], reports: [], approvals: [], auditLogs: [] }, null, 2), 'utf8')
  await seedDemoResident()
})

test('Super Admin has the Admin dashboard access plus isolated monitoring access', async () => {
  const { server, baseUrl } = await createTestServer()
  const superAdmin = {
    id: randomUUID(),
    firstName: 'System',
    lastName: 'Oversight',
    mobile: '09170000111',
    email: 'super.admin@example.test',
    passwordHash: await hashPassword('SuperAdminPass123!'),
    role: 'super_admin',
    status: 'Administrator',
  }
  const admin = {
    id: randomUUID(),
    firstName: 'Daily',
    lastName: 'Admin',
    mobile: '09170000112',
    email: 'daily.admin@example.test',
    passwordHash: await hashPassword('RegularAdminPass123!'),
    role: 'admin',
    status: 'Administrator',
  }
  const staff = {
    id: randomUUID(),
    firstName: 'Portal',
    lastName: 'Staff',
    mobile: '09170000113',
    email: 'portal.staff@example.test',
    passwordHash: await hashPassword('PortalStaffPass123!'),
    role: 'staff',
    status: 'On Duty',
  }

  try {
    await jsonDb.saveUser(superAdmin)
    await jsonDb.saveUser(admin)
    await jsonDb.saveUser(staff)
    const tokenFor = (user) => signToken({ sub: user.id })
    const get = (path, user) => fetch(`${baseUrl}${path}`, {
      headers: user ? { Authorization: `Bearer ${tokenFor(user)}` } : {},
    })

    const superAdminLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: superAdmin.email, password: 'SuperAdminPass123!' }),
    })
    assert.equal(superAdminLogin.status, 200)
    assert.equal((await superAdminLogin.json()).user.role, 'super_admin')
    assert.equal((await get('/api/admin/users', superAdmin)).status, 200)
    assert.equal((await get('/api/admin/users', admin)).status, 200)
    assert.equal((await get('/api/super-admin/monitoring')).status, 401)
    assert.equal((await get('/api/super-admin/monitoring', admin)).status, 403)
    assert.equal((await get('/api/super-admin/monitoring', staff)).status, 403)

    const monitoringResponse = await get('/api/super-admin/monitoring', superAdmin)
    assert.equal(monitoringResponse.status, 200)
    const monitoring = await monitoringResponse.json()
    const users = await jsonDb.listAllUsers()
    assert.equal(monitoring.summary.totalAdmins, users.filter((user) => user.role === 'admin').length)
    assert.equal(monitoring.summary.totalSuperAdmins, 1)
    assert.ok(Array.isArray(monitoring.recentActivity))
    assert.equal(Object.hasOwn(monitoring.recentActivity[0] || {}, 'metadata'), false)

    const resident = users.find((user) => user.role === 'resident')
    const attemptedRoleChange = await fetch(`${baseUrl}/api/admin/users/${resident.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenFor(admin)}`,
      },
      body: JSON.stringify({ role: 'super_admin' }),
    })
    assert.equal(attemptedRoleChange.status, 403)

    const superAdminEditAttempt = await fetch(`${baseUrl}/api/admin/users/${superAdmin.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenFor(admin)}`,
      },
      body: JSON.stringify({ status: 'Disabled' }),
    })
    assert.equal(superAdminEditAttempt.status, 403)

    await jsonDb.updateUser(superAdmin.id, { status: 'Disabled' })
    assert.equal((await get('/api/super-admin/monitoring', superAdmin)).status, 401)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

const createTestServer = async () => {
  const app = createApp()
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  }
}

test('registry age bounds include February 29 birthdays under the displayed-age convention', () => {
  const cases = [
    { today: '2024-02-28', birthDate: '2000-02-29', age: 23 },
    { today: '2024-02-29', birthDate: '2000-02-29', age: 24 },
    { today: '2025-02-28', birthDate: '2000-02-29', age: 24 },
    { today: '2025-03-01', birthDate: '2000-02-29', age: 25 },
  ]
  for (const { today, birthDate, age } of cases) {
    const { ageStart, ageEnd } = registryAgeDateRange(today, age)
    assert.ok(birthDate >= ageStart && birthDate <= ageEnd, `${birthDate} should match age ${age} on ${today}`)
  }
})

test('registry demographic household totals and labels retain location context', async () => {
  const db = await jsonDb.readDb()
  db.residentRegistry = [
    { id: 'b', firstName: 'Alex', lastName: 'Same', zone: 1, purok: 'Purok 1', householdId: 'H-1', sex: 'Male', status: 'active', verificationStatus: 'verified' },
    { id: 'a', firstName: 'Alex', lastName: 'Same', zone: 1, purok: 'Purok 1', householdId: 'H-1', sex: 'Female', status: 'active', verificationStatus: 'verified' },
    { id: 'c', firstName: 'Alex', lastName: 'Same', zone: 2, purok: 'Purok 1', householdId: 'H-1', sex: 'Male', status: 'active', verificationStatus: 'verified' },
  ]
  await jsonDb.writeDb(db)

  const demographics = await jsonDb.getResidentDemographics()
  assert.equal(demographics.overall.households, 2)
  assert.deepEqual(demographics.byPurok.map((group) => group.label), ['Purok 1 · Zone 1', 'Purok 1 · Zone 2'])
  assert.equal(demographics.byHousehold.length, 2)

  const page = await jsonDb.listResidentRegistry({ page: 1, pageSize: 1 })
  assert.equal(page.residents[0].id, 'a')
})

test('API rate-limit responses retain CORS headers for the frontend origin', async () => {
  const { server, baseUrl } = await createTestServer()
  const origin = 'http://localhost:5173'

  try {
    let response
    for (let request = 0; request <= 300; request += 1) {
      response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: origin } })
    }

    assert.equal(response.status, 429)
    assert.equal(response.headers.get('access-control-allow-origin'), origin)
  } finally {
    server.close()
  }
})

test('JSON storage removes plaintext passwords from existing and future user records', async () => {
  const legacyPlaintext = 'plaintext-only-test-sentinel'
  await fs.writeFile(testDbPath, JSON.stringify({
    users: [{ id: 'legacy-user', password: legacyPlaintext, passwordHash: 'hashed-password' }],
    requests: [],
    announcements: [],
    reports: [],
  }), 'utf8')

  await jsonDb.readDb()
  const stored = await fs.readFile(testDbPath, 'utf8')
  assert.equal(stored.includes(legacyPlaintext), false)
  assert.equal((await jsonDb.findUserById('legacy-user')).password, undefined)

  await jsonDb.writeDb({
    users: [{ id: 'new-user', password: legacyPlaintext, passwordHash: 'hashed-password' }],
    requests: [],
    announcements: [],
    reports: [],
  })
  assert.equal((await fs.readFile(testDbPath, 'utf8')).includes(legacyPlaintext), false)
})

test('staff request dashboard returns authorized, filtered, paginated records and real totals', async () => {
  const { server, baseUrl } = await createTestServer()
  const users = await jsonDb.listAllUsers()
  const resident = users.find((user) => user.role === 'resident')
  const staff = {
    id: randomUUID(),
    firstName: 'Staff',
    lastName: 'Dashboard',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `staff.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
    zone: 1,
  }

  try {
    await jsonDb.saveUser(staff)
    const requestIds = [randomUUID(), randomUUID()]
    await jsonDb.saveRequest({
      id: requestIds[0],
      userId: resident.id,
      type: 'Barangay Clearance',
      purpose: 'Employment',
      status: 'Pending',
      date: '2026-10-09T10:00:00+08:00',
    })


    await jsonDb.saveRequest({
      id: requestIds[1],
      userId: resident.id,
      type: 'Certificate of Residency',
      purpose: 'School enrollment',
      status: 'In Review',
      date: '2026-10-10T10:00:00+08:00',
    })

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'StaffPass123!' }),
    })
    assert.equal(loginResponse.status, 200)
    const { token } = await loginResponse.json()

    const response = await fetch(`${baseUrl}/api/staff/dashboard-requests?status=all&page=1&pageSize=1&sort=date&direction=desc`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(response.status, 200)
    const dashboard = await response.json()
    assert.equal(dashboard.total, 2)
    assert.equal(dashboard.requests.length, 1)
    assert.equal(dashboard.requests[0].id, requestIds[1])
    assert.equal(dashboard.requests[0].first_name, resident.firstName)
    assert.equal(dashboard.summary.pending, 1)
    assert.equal(dashboard.summary.inReview, 1)
    assert.equal(dashboard.summary.deadlineTracking, false)
    assert.equal(dashboard.summary.releaseTracking, false)

    const searchResponse = await fetch(`${baseUrl}/api/staff/dashboard-requests?status=all&search=${requestIds[0]}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const searchResult = await searchResponse.json()
    assert.equal(searchResult.total, 1)
    assert.equal(searchResult.requests[0].id, requestIds[0])

    const reportResponse = await fetch(`${baseUrl}/api/staff/reports?from=2026-10-09&to=2026-10-10`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(reportResponse.status, 200)
    const report = await reportResponse.json()
    assert.equal(report.summary.received, 2)
    assert.equal(Object.hasOwn(report, 'requests'), false)
    assert.equal(JSON.stringify(report).includes(resident.email), false)
    assert.equal(JSON.stringify(report).includes(resident.mobile), false)

    const exportResponse = await fetch(`${baseUrl}/api/staff/reports/export.csv?from=2026-10-09&to=2026-10-10`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(exportResponse.status, 200)
    const exportedCsv = await exportResponse.text()
    assert.match(exportedCsv, /Barangay Clearance/)
    assert.equal(exportedCsv.includes(resident.email), false)
    assert.equal(exportedCsv.includes(resident.mobile), false)

    const residentLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: resident.email, password: 'ResidentPass123!' }),
    })
    const residentToken = (await residentLoginResponse.json()).token
    const forbiddenResponse = await fetch(`${baseUrl}/api/staff/dashboard-requests`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    })
    assert.equal(forbiddenResponse.status, 403)
    const forbiddenReportResponse = await fetch(`${baseUrl}/api/staff/reports`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    })
    assert.equal(forbiddenReportResponse.status, 403)

    const invalidPageSize = await fetch(`${baseUrl}/api/staff/dashboard-requests?pageSize=500`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(invalidPageSize.status, 400)
  } finally {
    server.close()
  }
})


test('staff processed-request archives use a safe retention default and preserve separate archives', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Staff',
    lastName: 'Archive',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `staff.archive.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
  }
  const archiveNames = []

  try {
    await jsonDb.saveUser(staff)
    const resident = (await jsonDb.listAllUsers()).find((user) => user.role === 'resident')
    const olderThan30Days = {
      id: randomUUID(),
      userId: resident.id,
      type: 'Barangay Certificate',
      purpose: 'Older processed request',
      status: 'Approved',
      date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    }
    const recentProcessed = {
      id: randomUUID(),
      userId: resident.id,
      type: 'Barangay Clearance',
      purpose: 'Recent processed request',
      status: 'Rejected',
      date: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const pending = {
      id: randomUUID(),
      userId: resident.id,
      type: 'Medical Assistance',
      purpose: 'Unprocessed request',
      status: 'Pending',
      date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    }
    await jsonDb.saveRequest(olderThan30Days)
    await jsonDb.saveRequest(recentProcessed)
    await jsonDb.saveRequest(pending)

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'StaffPass123!' }),
    })
    assert.equal(loginResponse.status, 200)
    const { token } = await loginResponse.json()
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const endpoint = `${baseUrl}/api/staff/archive-requests`

    const invalidRetention = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 1.5 }),
    })
    assert.equal(invalidRetention.status, 400)

    const invalidBooleanRetention = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: false }),
    })
    assert.equal(invalidBooleanRetention.status, 400)

    const defaultArchiveResponse = await fetch(endpoint, { method: 'POST', headers })
    assert.equal(defaultArchiveResponse.status, 200)
    const defaultArchive = (await defaultArchiveResponse.json()).archive
    assert.equal(defaultArchive.count, 1)
    archiveNames.push(path.basename(defaultArchive.filename))
    assert.deepEqual((await jsonDb.getArchive(archiveNames[0])).records.map((request) => request.id), [olderThan30Days.id])
    assert.deepEqual((await jsonDb.listAllRequests()).map((request) => request.id).sort(), [pending.id, recentProcessed.id].sort())

    const archiveAllResponse = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 0 }),
    })
    assert.equal(archiveAllResponse.status, 200)
    const archiveAll = (await archiveAllResponse.json()).archive
    assert.equal(archiveAll.count, 1)
    archiveNames.push(path.basename(archiveAll.filename))
    assert.notEqual(archiveNames[0], archiveNames[1])
    assert.deepEqual((await jsonDb.getArchive(archiveNames[1])).records.map((request) => request.id), [recentProcessed.id])
    assert.deepEqual((await jsonDb.listAllRequests()).map((request) => request.id), [pending.id])

    const archiveListResponse = await fetch(`${baseUrl}/api/staff/archives`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(archiveListResponse.status, 200)
    const listedNames = (await archiveListResponse.json()).archives.map((archive) => archive.name)
    assert.ok(archiveNames.every((name) => listedNames.includes(name)))
  } finally {
    await Promise.all(archiveNames.map((name) => jsonDb.deleteArchive(name)))
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('disabled accounts cannot log in or continue using an existing session', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Inactive',
    lastName: 'Staff',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `inactive.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
  }

  try {
    await jsonDb.saveUser(staff)
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'StaffPass123!' }),
    })
    assert.equal(login.status, 200)
    const { token } = await login.json()

    await jsonDb.updateUser(staff.id, { status: 'Disabled' })
    const dashboard = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(dashboard.status, 403)

    const protectedQueue = await fetch(`${baseUrl}/api/staff/dashboard-requests`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(protectedQueue.status, 403)

    const secondLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'StaffPass123!' }),
    })
    assert.equal(secondLogin.status, 403)
  } finally {
    server.close()
  }
})

test('reports, announcements, and events do not return seeded demonstration content', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@barangay.gov.ph', password: 'AdminPass123' }),
    })
    assert.equal(login.status, 200)
    const { token } = await login.json()

    const reports = await fetch(`${baseUrl}/api/admin/reports`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.deepEqual((await reports.json()).reports, [])

    const announcements = await fetch(`${baseUrl}/api/announcements`)
    assert.deepEqual((await announcements.json()).announcements, [])

    const events = await fetch(`${baseUrl}/api/events`)
    assert.deepEqual((await events.json()).events, [])
  } finally {
    server.close()
  }
})

test('staff can publish, retract, and delete announcements from the staff workflow', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Announcement',
    lastName: 'Staff',
    mobile: `093${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `announcement-staff.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
    position: 'Staff',
  }
  try {
    await jsonDb.saveUser(staff)
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'StaffPass123!' }),
    })
    assert.equal(login.status, 200)
    const { token } = await login.json()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    const unsupportedChannel = await fetch(`${baseUrl}/api/announcements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Test', content: 'Test notice', socialChannels: ['instagram'] }),
    })
    assert.equal(unsupportedChannel.status, 400)

    const createResponse = await fetch(`${baseUrl}/api/announcements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Test notice', content: 'Original content', socialChannels: [] }),
    })
    assert.equal(createResponse.status, 201)
    const { announcement } = await createResponse.json()

    const retractionResponse = await fetch(`${baseUrl}/api/announcements/${announcement.id}/retract`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'Correction: please disregard the earlier time.' }),
    })
    assert.equal(retractionResponse.status, 201)
    const { announcement: retraction } = await retractionResponse.json()
    assert.equal(retraction.relatedAnnouncementId, announcement.id)

    const deleteResponse = await fetch(`${baseUrl}/api/announcements/${announcement.id}`, {
      method: 'DELETE',
      headers,
    })
    assert.equal(deleteResponse.status, 200)
    assert.equal((await deleteResponse.json()).messengerMessagesCannotBeUnsent, false)
  } finally {
    server.close()
  }
})

test('Messenger corrections stay limited to recipients of the original announcement', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Messenger',
    lastName: 'Staff',
    mobile: `093${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `messenger-staff.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
    position: 'Staff',
  }
  const metaKeys = [
    'META_PAGE_ID',
    'META_PAGE_ACCESS_TOKEN',
    'META_APP_SECRET',
    'META_WEBHOOK_VERIFY_TOKEN',
    'META_GRAPH_API_VERSION',
  ]
  const originalMetaEnv = Object.fromEntries(metaKeys.map((key) => [key, process.env[key]]))
  const originalFetch = globalThis.fetch
  const sentRecipients = []
  Object.assign(process.env, {
    META_PAGE_ID: 'test-page-id',
    META_PAGE_ACCESS_TOKEN: 'test-page-token',
    META_APP_SECRET: 'test-app-secret',
    META_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
    META_GRAPH_API_VERSION: 'v23.0',
  })
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://graph.facebook.com/')) {
      const params = new URLSearchParams(options.body)
      sentRecipients.push(JSON.parse(params.get('recipient')).id)
      return new Response(JSON.stringify({ message_id: `mid.${sentRecipients.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return originalFetch(input, options)
  }
  await jsonDb.saveUser(staff)

  try {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'StaffPass123!' }),
    })
    assert.equal(login.status, 200)
    const { token } = await login.json()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const integrationStatus = await fetch(`${baseUrl}/api/social-integrations/status`, { headers })
    assert.equal(integrationStatus.status, 200)
    assert.deepEqual((await integrationStatus.json()).integrations, { facebook: true, messenger: true })
    const unrelatedPagePayload = JSON.stringify({
      object: 'page',
      entry: [{
        id: 'another-page-id',
        messaging: [{
          sender: { id: 'unrelated-psid' },
          timestamp: Date.now(),
          message: { text: 'SUBSCRIBE' },
        }],
      }],
    })
    const webhookSignature = `sha256=${createHmac('sha256', process.env.META_APP_SECRET).update(unrelatedPagePayload).digest('hex')}`
    const unrelatedWebhook = await fetch(`${baseUrl}/api/meta/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': webhookSignature },
      body: unrelatedPagePayload,
    })
    assert.equal(unrelatedWebhook.status, 200)
    assert.deepEqual(sentRecipients, [])
    assert.equal((await jsonDb.readDb()).messengerSubscribers?.length || 0, 0)

    const lastMessageAt = new Date().toISOString()
    await jsonDb.upsertMessengerSubscriber({ psid: 'original-1', optedIn: true, lastMessageAt })
    await jsonDb.upsertMessengerSubscriber({ psid: 'original-2', optedIn: true, lastMessageAt })
    await jsonDb.upsertMessengerSubscriber({
      psid: 'future-contact',
      optedIn: true,
      lastMessageAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })

    const createResponse = await fetch(`${baseUrl}/api/announcements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Original notice', content: 'Original message', socialChannels: ['messenger'] }),
    })
    assert.equal(createResponse.status, 201)
    const { announcement } = await createResponse.json()
    assert.equal(announcement.socialDelivery.messenger.sent, 2)

    const configuredAppSecret = process.env.META_APP_SECRET
    delete process.env.META_APP_SECRET
    let unavailableRetraction
    try {
      unavailableRetraction = await fetch(`${baseUrl}/api/announcements/${announcement.id}/retract`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: 'This must not be recorded without Messenger.' }),
      })
    } finally {
      process.env.META_APP_SECRET = configuredAppSecret
    }
    assert.equal(unavailableRetraction.status, 503)
    assert.equal((await jsonDb.listAnnouncements()).length, 1)

    await jsonDb.upsertMessengerSubscriber({ psid: 'new-subscriber', optedIn: true, lastMessageAt })
    const retractResponse = await fetch(`${baseUrl}/api/announcements/${announcement.id}/retract`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'Correction for the original notice.' }),
    })
    assert.equal(retractResponse.status, 201)
    assert.equal((await retractResponse.json()).socialDelivery.messenger.sent, 2)
    assert.deepEqual(sentRecipients, ['original-1', 'original-2', 'original-1', 'original-2'])
  } finally {
    globalThis.fetch = originalFetch
    for (const key of metaKeys) {
      if (originalMetaEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalMetaEnv[key]
    }
    server.close()
  }
})

test('registers a resident and waits for administrator approval', async () => {
  const { server, baseUrl } = await createTestServer()
  const mobile = `091${Math.floor(10000000 + Math.random() * 90000000)}`
  const email = `resident.${Date.now()}@example.com`

  try {
    const registerResponse = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Maria',
        lastName: 'Dela Cruz',
        mobile,
        email,
        password: 'SecurePass123!',
      }),
    })

    assert.equal(registerResponse.status, 201)
    const registerData = await registerResponse.json()
    assert.equal(registerData.user.mobile, mobile)
    assert.equal(registerData.user.status, 'Pending Verification')
    assert.equal(registerData.requiresApproval, true)

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: mobile,
        password: 'SecurePass123!',
      }),
    })

    assert.equal(loginResponse.status, 403)
    const loginData = await loginResponse.json()
    assert.match(loginData.message, /administrator approval/i)
    assert.equal(loginData.code, 'resident_not_approved')

    const adminLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@barangay.gov.ph',
        password: 'AdminPass123',
      }),
    })
    assert.equal(adminLoginResponse.status, 200)
    const adminToken = (await adminLoginResponse.json()).token
    const auditResponse = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(auditResponse.status, 200)
    const auditData = await auditResponse.json()
    const blockedLogin = auditData.logs.find((entry) => entry.action === 'auth.login.rejected_unapproved_resident')
    assert.ok(blockedLogin)
    assert.equal(blockedLogin.targetId, registerData.user.id)
    assert.equal(blockedLogin.actorRole, 'anonymous')
    assert.equal(blockedLogin.metadata.status, 'Pending Verification')
    assert.equal(blockedLogin.metadata.residentName, 'Maria Dela Cruz')
    assert.equal(JSON.stringify(blockedLogin).includes('SecurePass123!'), false)

    const invalidPasswordResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: mobile,
        password: 'WrongPassword123!',
      }),
    })
    assert.equal(invalidPasswordResponse.status, 401)
    const auditAfterInvalidPassword = await jsonDb.listAuditLogs()
    assert.equal(auditAfterInvalidPassword.filter((entry) => entry.action === 'auth.login.rejected_unapproved_resident').length, 1)

    const unknownLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'unknown.resident@example.com',
        password: 'SecurePass123!',
      }),
    })
    assert.equal(unknownLoginResponse.status, 401)
    const auditAfterUnknownLogin = await jsonDb.listAuditLogs()
    assert.equal(auditAfterUnknownLogin.filter((entry) => entry.action === 'auth.login.rejected_unapproved_resident').length, 1)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('client error reports log only allowlisted metadata and omit error contents', async () => {
  const { server, baseUrl } = await createTestServer()
  const capturedWarnings = []
  const originalWarn = console.warn
  console.warn = (...args) => capturedWarnings.push(args)

  try {
    const reportResponse = await fetch(`${baseUrl}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'unhandled-rejection',
        route: '/admin/users/123?email=private@example.com',
        role: 'admin',
        language: 'fil',
        message: 'private@example.com SecurePass123!',
      }),
    })

    assert.equal(reportResponse.status, 202)
    assert.deepEqual(await reportResponse.json(), { received: true })
    assert.deepEqual(capturedWarnings[0], [
      'client-side error reported',
      { type: 'unhandled-rejection', route: '/admin', role: 'admin', language: 'fil' },
    ])
    assert.equal(JSON.stringify(capturedWarnings).includes('private@example.com'), false)
    assert.equal(JSON.stringify(capturedWarnings).includes('SecurePass123!'), false)

    const invalidResponse = await fetch(`${baseUrl}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'arbitrary', message: 'do not log this' }),
    })
    assert.equal(invalidResponse.status, 400)
    assert.equal(capturedWarnings.length, 1)
  } finally {
    console.warn = originalWarn
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('request lifecycle preserves copy preference, status history, and resident follow-ups', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
    const login = async (identifier, password) => {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      assert.equal(response.status, 200)
      return (await response.json()).token
    }
    const residentToken = await login('maria.delacruz@email.com', 'ResidentPass123!')
    const staffToken = await login('admin@barangay.gov.ph', 'AdminPass123')

    const createResponse = await fetch(`${baseUrl}/api/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${residentToken}`,
      },
      body: JSON.stringify({
        type: 'Barangay Certificate',
        purpose: 'School enrollment',
        deliveryMethod: 'physical',
        deliveryNote: 'Please advise when it is ready.',
      }),
    })
    assert.equal(createResponse.status, 201)
    const { request: createdRequest } = await createResponse.json()
    assert.equal(createdRequest.deliveryMethod, 'physical')
    assert.equal(createdRequest.deliveryNote, 'Please advise when it is ready.')
    assert.equal(createdRequest.statusHistory[0].status, 'Pending')

    const missingNoteResponse = await fetch(`${baseUrl}/api/requests/${createdRequest.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({ status: 'Needs Information' }),
    })
    assert.equal(missingNoteResponse.status, 400)

    const needsInformationResponse = await fetch(`${baseUrl}/api/requests/${createdRequest.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({ status: 'Needs Information', note: 'Please provide your school name.' }),
    })
    assert.equal(needsInformationResponse.status, 200)
    const { request: needsInformationRequest } = await needsInformationResponse.json()
    assert.equal(needsInformationRequest.status, 'Needs Information')
    assert.equal(needsInformationRequest.statusHistory.at(-1).note, 'Please provide your school name.')

    const followUpResponse = await fetch(`${baseUrl}/api/requests/${createdRequest.id}/follow-ups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${residentToken}`,
      },
      body: JSON.stringify({ message: 'The school is Legaspi Elementary School.' }),
    })
    assert.equal(followUpResponse.status, 201)
    const { request: followedUpRequest } = await followUpResponse.json()
    assert.equal(followedUpRequest.status, 'In Review')
    assert.equal(followedUpRequest.followUps.at(-1).message, 'The school is Legaspi Elementary School.')
    assert.equal(followedUpRequest.statusHistory.at(-2).kind, 'follow-up')
    assert.equal(followedUpRequest.statusHistory.at(-1).status, 'In Review')

    const missingRejectionReasonResponse = await fetch(`${baseUrl}/api/requests/${createdRequest.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({ status: 'Rejected' }),
    })
    assert.equal(missingRejectionReasonResponse.status, 400)

    const completeResponse = await fetch(`${baseUrl}/api/requests/${createdRequest.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({ status: 'Approved' }),
    })
    assert.equal(completeResponse.status, 200)
    const { request: completedRequest } = await completeResponse.json()
    assert.equal(completedRequest.status, 'Approved')
    assert.equal(completedRequest.deliveryMethod, 'physical')
    assert.equal(completedRequest.statusHistory.at(-1).status, 'Approved')

    const invalidTransitionResponse = await fetch(`${baseUrl}/api/requests/${createdRequest.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({ status: 'In Review' }),
    })
    assert.equal(invalidTransitionResponse.status, 409)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
})

test('admin can update user details but cannot change account roles', async () => {
  const { server, baseUrl } = await createTestServer()
  const mobile = `091${Math.floor(10000000 + Math.random() * 90000000)}`
  const email = `upgrade.${Date.now()}@example.com`

  try {
    const registerResponse = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Nina',
        lastName: 'Villanueva',
        mobile,
        email,
        password: 'SecurePass123!',
      }),
    })

    assert.equal(registerResponse.status, 201)
    const registerData = await registerResponse.json()
    const residentId = registerData.user.id

    const adminLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@barangay.gov.ph',
        password: 'AdminPass123',
      }),
    })

    assert.equal(adminLoginResponse.status, 200)
    const adminLoginData = await adminLoginResponse.json()
    const adminToken = adminLoginData.token

    const updateResponse = await fetch(`${baseUrl}/api/admin/users/${residentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        role: 'staff',
        status: 'On Duty',
        zone: 4,
        familyMembers: 3,
        householdMembers: [
          { name: 'Ana Villanueva', relationship: 'Spouse' },
          { name: 'Luis Villanueva', relationship: 'Child' },
        ],
      }),
    })

    assert.equal(updateResponse.status, 403)
    const detailUpdateResponse = await fetch(`${baseUrl}/api/admin/users/${residentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'Active Resident',
        zone: 4,
        familyMembers: 3,
        householdMembers: [
          { name: 'Ana Villanueva', relationship: 'Spouse' },
          { name: 'Luis Villanueva', relationship: 'Child' },
        ],
      }),
    })
    assert.equal(detailUpdateResponse.status, 200)
    const updateData = await detailUpdateResponse.json()
    assert.equal(updateData.user.role, 'resident')
    assert.equal(updateData.user.status, 'Active Resident')
    assert.equal(updateData.user.zone, 4)
    assert.equal(updateData.user.familyMembers, 3)
    assert.deepEqual(updateData.user.householdMembers, [
      { name: 'Ana Villanueva', relationship: 'Spouse' },
      { name: 'Luis Villanueva', relationship: 'Child' },
    ])

    const invalidHouseholdResponse = await fetch(`${baseUrl}/api/admin/users/${residentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        householdMembers: [{ name: 'No relationship' }],
      }),
    })
    assert.equal(invalidHouseholdResponse.status, 400)

    const usersResponse = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })

    assert.equal(usersResponse.status, 200)
    const usersData = await usersResponse.json()
    assert.ok(usersData.users.some((user) => user.id === residentId && user.role === 'resident'))

    const staffCreateResponse = await fetch(`${baseUrl}/api/staff/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        firstName: 'Portal',
        lastName: 'Staff',
        email: `portal.staff.${Date.now()}@example.com`,
        mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      }),
    })
    assert.equal(staffCreateResponse.status, 201)
    const staffCreateData = await staffCreateResponse.json()
    assert.equal(staffCreateData.user.role, 'staff')
    assert.equal(staffCreateData.user.mustChangePassword, true)
    assert.match(staffCreateData.temporaryPassword, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/)
    assert.equal(Object.hasOwn(staffCreateData.user, 'passwordHash'), false)
    assert.equal(staffCreateResponse.headers.get('cache-control'), 'no-store')

    const adminCreateResponse = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        firstName: 'Portal',
        lastName: 'Admin',
        email: `portal.admin.${Date.now()}@example.com`,
        mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      }),
    })
    assert.equal(adminCreateResponse.status, 201)
    const adminCreateData = await adminCreateResponse.json()
    assert.equal(adminCreateData.user.role, 'admin')
    assert.equal(adminCreateData.user.mustChangePassword, true)
    assert.ok(adminCreateData.temporaryPassword)

    const adminTempLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: adminCreateData.user.email,
        password: adminCreateData.temporaryPassword,
      }),
    })
    assert.equal(adminTempLoginResponse.status, 200)
    const adminTempLogin = await adminTempLoginResponse.json()
    const restrictedAdminList = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: 'Bearer ' + adminTempLogin.token },
    })
    assert.equal(restrictedAdminList.status, 403)
    assert.equal((await restrictedAdminList.json()).code, 'password_change_required')

    const portalInviteResponse = await fetch(`${baseUrl}/api/staff/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + adminToken,
      },
      body: JSON.stringify({ role: 'staff', email: 'unused@example.com' }),
    })
    assert.equal(portalInviteResponse.status, 410)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('staff can create staff accounts but not admins, and temporary passwords require a first-change', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
    const staffPassword = 'StaffPass123!'
    const staff = {
      id: randomUUID(),
      firstName: 'Test',
      lastName: 'Staff',
      mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      email: `staff.${Date.now()}@example.com`,
      passwordHash: await hashPassword(staffPassword),
      role: 'staff',
      status: 'On Duty',
      createdAt: new Date().toISOString(),
    }
    await jsonDb.saveUser(staff)

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: staff.email,
        password: staffPassword,
      }),
    })
    assert.equal(loginResponse.status, 200)
    const loginData = await loginResponse.json()

    const email = `created.staff.${Date.now()}@example.com`
    const createResponse = await fetch(`${baseUrl}/api/staff/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({
        firstName: 'Created',
        lastName: 'Staff',
        email,
        mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      }),
    })
    assert.equal(createResponse.status, 201)
    const created = await createResponse.json()
    assert.equal(created.user.role, 'staff')
    assert.equal(created.user.mustChangePassword, true)

    const adminCreateResponse = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + loginData.token,
      },
      body: JSON.stringify({
        firstName: 'Unauthorized',
        lastName: 'Admin',
        email: `unauthorized.admin.${Date.now()}@example.com`,
        mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      }),
    })
    assert.equal(adminCreateResponse.status, 403)

    const tempLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: created.temporaryPassword }),
    })
    assert.equal(tempLoginResponse.status, 200)
    const tempLogin = await tempLoginResponse.json()
    assert.equal(tempLogin.mustChangePassword, true)

    const restrictedResponse = await fetch(`${baseUrl}/api/staff/members`, {
      headers: { Authorization: 'Bearer ' + tempLogin.token },
    })
    assert.equal(restrictedResponse.status, 403)
    assert.equal((await restrictedResponse.json()).code, 'password_change_required')

    const profileResponse = await fetch(`${baseUrl}/api/profile`, {
      headers: { Authorization: 'Bearer ' + tempLogin.token },
    })
    assert.equal(profileResponse.status, 200)
    assert.equal((await profileResponse.json()).user.mustChangePassword, true)

    const changePasswordResponse = await fetch(`${baseUrl}/api/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + tempLogin.token,
      },
      body: JSON.stringify({ currentPassword: created.temporaryPassword, newPassword: 'ChangedStaff123!' }),
    })
    assert.equal(changePasswordResponse.status, 200)
    const changed = await changePasswordResponse.json()
    assert.ok(changed.token)
    assert.equal(changed.user.mustChangePassword, false)

    const fullAccessResponse = await fetch(`${baseUrl}/api/staff/members`, {
      headers: { Authorization: 'Bearer ' + changed.token },
    })
    assert.equal(fullAccessResponse.status, 200)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('pre-provisioned staff positions persist and duplicate account creation is rejected', async () => {
  const { server, baseUrl } = await createTestServer()
  const email = `secretary.${Date.now()}@example.com`
  const mobile = `091${Math.floor(10000000 + Math.random() * 90000000)}`

  try {
    const password = 'StaffPass123!'
    const staffMember = {
      id: randomUUID(),
      firstName: 'Maria',
      lastName: 'Secretary',
      position: 'Secretary',
      email,
      mobile,
      passwordHash: await hashPassword(password),
      role: 'staff',
      status: 'On Duty',
      createdAt: new Date().toISOString(),
    }
    await jsonDb.saveUser(staffMember)

    const adminLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@barangay.gov.ph', password: 'AdminPass123' }),
    })
    assert.equal(adminLogin.status, 200)
    const { token: adminToken } = await adminLogin.json()

    const createResponse = await fetch(`${baseUrl}/api/staff/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        firstName: 'Maria',
        lastName: 'Secretary',
        position: 'Secretary',
        email,
        mobile,
        password: 'StaffPass123!',
      }),
    })
    assert.equal(createResponse.status, 409)
    assert.equal(staffMember.role, 'staff')
    assert.equal(staffMember.status, 'On Duty')
    assert.equal(staffMember.position, 'Secretary')

    const staffLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password }),
    })
    assert.equal(staffLogin.status, 200)
    const { user } = await staffLogin.json()
    assert.equal(user.position, 'Secretary')

    const directoryResponse = await fetch(`${baseUrl}/api/staff/members`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(directoryResponse.status, 200)
    const { staffMembers } = await directoryResponse.json()
    assert.equal(staffMembers.find((member) => member.id === staffMember.id)?.position, 'Secretary')
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('only administrators can reset staff passwords, and reset secrets are never returned', async () => {
  const { server, baseUrl } = await createTestServer()
  const staffEmail = `password-reset.${Date.now()}@example.com`
  const staffPassword = 'StaffPass123!'
  const nextPassword = 'ChangedPass456!'
  const staff = {
    id: randomUUID(),
    firstName: 'Password',
    lastName: 'Reset',
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: staffEmail,
    passwordHash: await hashPassword(staffPassword),
    role: 'staff',
    status: 'On Duty',
  }

  try {
    await jsonDb.saveUser(staff)

    const adminLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@barangay.gov.ph', password: 'AdminPass123' }),
    })
    assert.equal(adminLogin.status, 200)
    const { token: adminToken } = await adminLogin.json()

    const staffLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staffEmail, password: staffPassword }),
    })
    assert.equal(staffLogin.status, 200)
    const { token: staffToken } = await staffLogin.json()

    const resetUrl = `${baseUrl}/api/admin/staff/${staff.id}/password`
    const forbiddenReset = await fetch(resetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ password: nextPassword }),
    })
    assert.equal(forbiddenReset.status, 403)

    const invalidPasswordReset = await fetch(resetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ password: 'weak' }),
    })
    assert.equal(invalidPasswordReset.status, 400)

    const resident = (await jsonDb.listAllUsers()).find((user) => user.role === 'resident')
    const residentReset = await fetch(`${baseUrl}/api/admin/staff/${resident.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ password: nextPassword }),
    })
    assert.equal(residentReset.status, 404)

    const resetResponse = await fetch(resetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ password: nextPassword }),
    })
    assert.equal(resetResponse.status, 200)
    assert.deepEqual(await resetResponse.json(), { ok: true })

    const oldPasswordLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staffEmail, password: staffPassword }),
    })
    assert.equal(oldPasswordLogin.status, 401)

    const newPasswordLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staffEmail, password: nextPassword }),
    })
    assert.equal(newPasswordLogin.status, 200)

    const auditResponse = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(auditResponse.status, 200)
    const { logs } = await auditResponse.json()
    assert.equal(logs.some((entry) => entry.action === 'staff.password_reset' && entry.targetId === staff.id), true)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('staff presence is updated by staff sessions and visible only to administrators', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Presence',
    lastName: 'Check',
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `presence.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
    lastSeen: null,
  }

  try {
    await jsonDb.saveUser(staff)
    const login = async (identifier, password) => {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      assert.equal(response.status, 200)
      return response.json()
    }
    const [{ token: adminToken }, { token: staffToken }] = await Promise.all([
      login('admin@barangay.gov.ph', 'AdminPass123'),
      login(staff.email, 'StaffPass123!'),
    ])

    const anonymousPresence = await fetch(`${baseUrl}/api/staff/presence`, { method: 'POST' })
    assert.equal(anonymousPresence.status, 401)

    const resident = (await jsonDb.listAllUsers()).find((user) => user.role === 'resident')
    const residentLogin = await login(resident.email, 'ResidentPass123!')
    const forbiddenHeartbeat = await fetch(`${baseUrl}/api/staff/presence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${residentLogin.token}` },
    })
    assert.equal(forbiddenHeartbeat.status, 403)

    const forbiddenList = await fetch(`${baseUrl}/api/admin/staff/presence`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal(forbiddenList.status, 403)

    const heartbeat = await fetch(`${baseUrl}/api/staff/presence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal(heartbeat.status, 200)
    const heartbeatData = await heartbeat.json()
    assert.equal(heartbeatData.ok, true)
    assert.equal(typeof heartbeatData.lastSeen, 'string')

    const adminList = await fetch(`${baseUrl}/api/admin/staff/presence`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(adminList.status, 200)
    const { staff: listedStaff } = await adminList.json()
    const listedAccount = listedStaff.find((member) => member.id === staff.id)
    assert.equal(listedAccount.lastSeen, heartbeatData.lastSeen)
    assert.equal(listedAccount.email, staff.email)
    assert.equal(listedAccount.passwordHash, undefined)
    assert.equal(listedAccount.password, undefined)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('quality assessment endpoints are no longer exposed', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
    assert.equal((await fetch(`${baseUrl}/api/quality-assessment`)).status, 404)
    assert.equal((await fetch(`${baseUrl}/api/quality-assessment`, { method: 'PUT' })).status, 404)
    assert.equal((await fetch(`${baseUrl}/api/admin/quality-assessments`)).status, 404)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('captain photo upload links require an administrator and bounded object storage', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
    const login = async (identifier, password) => {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      assert.equal(response.status, 200)
      return (await response.json()).token
    }
    const [adminToken, residentToken] = await Promise.all([
      login('admin@barangay.gov.ph', 'AdminPass123'),
      login('maria.delacruz@email.com', 'ResidentPass123!'),
    ])
    const endpoint = `${baseUrl}/api/admin/captain-photo/upload-url`
    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401)
    if (!isCaptainPhotoStorageConfigured()) {
      const photoResponse = await fetch(`${baseUrl}/api/captain-photo`)
      assert.equal(photoResponse.status, 204)
      assert.equal(photoResponse.headers.get('cross-origin-resource-policy'), 'cross-origin')
    }

    const residentResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${residentToken}` },
      body: JSON.stringify({ contentType: 'image/jpeg' }),
    })
    assert.equal(residentResponse.status, 403)

    const adminResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ contentType: 'image/svg+xml' }),
    })
    assert.equal(adminResponse.status, 400)

    if (isCaptainPhotoStorageConfigured()) {
      const uploadResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ contentType: 'image/webp' }),
      })
      assert.equal(uploadResponse.status, 200)
      const upload = await uploadResponse.json()
      assert.ok(upload.url)
      assert.match(upload.key, /^official\/captain-portrait\/pending\/[0-9a-f-]{36}$/i)
      assert.ok(upload.fields.Policy)
    } else {
      const unavailableResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ contentType: 'image/webp' }),
      })
      assert.equal(unavailableResponse.status, 503)
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('Admin-issued Staff temporary access is emailed, single-use, time-limited, and Staff-only', async () => {
  const { server, baseUrl } = await createTestServer()
  const deliveryPayloads = []
  const deliveryServer = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      deliveryPayloads.push(JSON.parse(body))
      response.writeHead(202)
      response.end()
    })
  })
  await new Promise((resolve) => deliveryServer.listen(0, '127.0.0.1', resolve))
  const originalDeliveryUrl = process.env.RESET_DELIVERY_URL
  const originalDeliveryToken = process.env.RESET_DELIVERY_TOKEN
  const originalAppUrl = process.env.PUBLIC_APP_URL
  process.env.RESET_DELIVERY_URL = `http://127.0.0.1:${deliveryServer.address().port}`
  process.env.RESET_DELIVERY_TOKEN = 'temporary-access-test-token'
  process.env.PUBLIC_APP_URL = 'https://barangay-legaspi.vercel.app'

  const staff = {
    id: randomUUID(),
    firstName: 'Temporary',
    lastName: 'Access',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `temporary.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
    mfaEnabled: false,
  }

  try {
    await jsonDb.saveUser(staff)
    const login = async (identifier, password) => {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      assert.equal(response.status, 200)
      return (await response.json()).token
    }
    const [adminToken, residentToken] = await Promise.all([
      login('admin@barangay.gov.ph', 'AdminPass123'),
      login('maria.delacruz@email.com', 'ResidentPass123!'),
    ])
    const endpoint = `${baseUrl}/api/admin/staff/${staff.id}/temporary-access`

    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401)
    assert.equal((await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${residentToken}` },
    })).status, 403)

    const issueResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(issueResponse.status, 202)
    const issueResult = await issueResponse.json()
    assert.equal(issueResult.message, 'Temporary access email queued.')
    const firstDelivery = deliveryPayloads[0]
    assert.equal(firstDelivery.event, 'staff_temporary_access')
    assert.equal(firstDelivery.recipient, staff.email)
    const firstToken = new URL(firstDelivery.metadata.actionUrl).hash.slice(1)

    const secondIssueResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(secondIssueResponse.status, 202)
    const secondIssueResult = await secondIssueResponse.json()
    const timeRemaining = new Date(secondIssueResult.expiresAt).getTime() - Date.now()
    assert.ok(timeRemaining <= 15 * 60 * 1000 && timeRemaining > 14 * 60 * 1000)
    const deliveryPayload = deliveryPayloads[1]
    assert.equal(deliveryPayload.event, 'staff_temporary_access')
    assert.equal(deliveryPayload.recipient, staff.email)
    const actionUrl = new URL(deliveryPayload.metadata.actionUrl)
    assert.equal(actionUrl.pathname, '/staff-access')
    const accessToken = actionUrl.hash.slice(1)
    assert.match(accessToken, /^[0-9a-f]{64}$/)
    assert.equal(new Date(issueResult.expiresAt).getTime() - Date.now() <= 15 * 60 * 1000, true)

    const stored = await jsonDb.readDb()
    assert.equal(stored.staffTemporaryAccessGrants.length, 2)
    assert.equal(stored.staffTemporaryAccessGrants[0].tokenHash, createHash('sha256').update(firstToken).digest('hex'))
    assert.ok(stored.staffTemporaryAccessGrants[0].revokedAt)
    assert.equal(stored.staffTemporaryAccessGrants[1].tokenHash, createHash('sha256').update(accessToken).digest('hex'))
    assert.equal(JSON.stringify(stored).includes(accessToken), false)

    const redeem = (value) => fetch(`${baseUrl}/api/staff/temporary-access/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: value }),
    })
    assert.equal((await redeem(firstToken)).status, 401)
    const redeemResponse = await redeem(accessToken)
    assert.equal(redeemResponse.status, 200)
    const session = await redeemResponse.json()
    assert.equal(session.user.role, 'staff')
    const sessionClaims = verifyToken(session.token)
    assert.equal(sessionClaims.role, 'staff')
    assert.ok(sessionClaims.exp * 1000 <= new Date(secondIssueResult.expiresAt).getTime())
    assert.equal((await fetch(`${baseUrl}/api/staff/members`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })).status, 403)
    assert.equal((await redeem(accessToken)).status, 401)

    const auditLog = await jsonDb.readDb()
    assert.equal(auditLog.auditLogs.filter((entry) => entry.action === 'staff.temporary_access.issued').length, 2)
    assert.ok(auditLog.auditLogs.some((entry) => entry.action === 'staff.temporary_access.redeemed'))
  } finally {
    if (originalDeliveryUrl === undefined) delete process.env.RESET_DELIVERY_URL
    else process.env.RESET_DELIVERY_URL = originalDeliveryUrl
    if (originalDeliveryToken === undefined) delete process.env.RESET_DELIVERY_TOKEN
    else process.env.RESET_DELIVERY_TOKEN = originalDeliveryToken
    if (originalAppUrl === undefined) delete process.env.PUBLIC_APP_URL
    else process.env.PUBLIC_APP_URL = originalAppUrl
    await Promise.all([
      new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => deliveryServer.close((error) => error ? reject(error) : resolve())),
    ])
  }
})

test('Staff temporary access keeps enrolled MFA mandatory and does not elevate the session', async () => {
  const { server, baseUrl } = await createTestServer()
  let deliveryPayload
  const deliveryServer = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      deliveryPayload = JSON.parse(body)
      response.writeHead(202)
      response.end()
    })
  })
  await new Promise((resolve) => deliveryServer.listen(0, '127.0.0.1', resolve))
  const originalDeliveryUrl = process.env.RESET_DELIVERY_URL
  const originalDeliveryToken = process.env.RESET_DELIVERY_TOKEN
  process.env.RESET_DELIVERY_URL = `http://127.0.0.1:${deliveryServer.address().port}`
  process.env.RESET_DELIVERY_TOKEN = 'temporary-access-test-token'
  const totpSecret = createTotpSecret()
  const staff = {
    id: randomUUID(),
    firstName: 'Mfa',
    lastName: 'Staff',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `mfa.staff.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
    mfaEnabled: true,
    mfaSecret: encryptTotpSecret(totpSecret),
    mfaLastStep: 0,
  }

  try {
    await jsonDb.saveUser(staff)
    const adminResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@barangay.gov.ph', password: 'AdminPass123' }),
    })
    const adminToken = (await adminResponse.json()).token
    const issueResponse = await fetch(`${baseUrl}/api/admin/staff/${staff.id}/temporary-access`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(issueResponse.status, 202)
    const accessToken = new URL(deliveryPayload.metadata.actionUrl).hash.slice(1)
    const redeemResponse = await fetch(`${baseUrl}/api/staff/temporary-access/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken }),
    })
    assert.equal(redeemResponse.status, 200)
    const challenge = await redeemResponse.json()
    assert.equal(challenge.requiresMfa, true)
    assert.equal(typeof challenge.challengeToken, 'string')

    const mfaResponse = await fetch(`${baseUrl}/api/login/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: challenge.challengeToken, code: createTotpCode(totpSecret) }),
    })
    assert.equal(mfaResponse.status, 200)
    const session = await mfaResponse.json()
    assert.equal(session.user.role, 'staff')
    assert.equal((await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })).status, 403)
    assert.equal((await fetch(`${baseUrl}/api/staff/members`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/login/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: challenge.challengeToken, code: createTotpCode(totpSecret) }),
    })).status, 401)
  } finally {
    if (originalDeliveryUrl === undefined) delete process.env.RESET_DELIVERY_URL
    else process.env.RESET_DELIVERY_URL = originalDeliveryUrl
    if (originalDeliveryToken === undefined) delete process.env.RESET_DELIVERY_TOKEN
    else process.env.RESET_DELIVERY_TOKEN = originalDeliveryToken
    await Promise.all([
      new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => deliveryServer.close((error) => error ? reject(error) : resolve())),
    ])
  }
})

test('temporary access delivery failure revokes the pending grant', async () => {
  const { server, baseUrl } = await createTestServer()
  const deliveryServer = createServer((_request, response) => {
    response.writeHead(503)
    response.end()
  })
  await new Promise((resolve) => deliveryServer.listen(0, '127.0.0.1', resolve))
  const originalDeliveryUrl = process.env.RESET_DELIVERY_URL
  const originalDeliveryToken = process.env.RESET_DELIVERY_TOKEN
  process.env.RESET_DELIVERY_URL = `http://127.0.0.1:${deliveryServer.address().port}`
  process.env.RESET_DELIVERY_TOKEN = 'temporary-access-test-token'
  const staff = {
    id: randomUUID(),
    firstName: 'Undelivered',
    lastName: 'Staff',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `undelivered.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
  }

  try {
    await jsonDb.saveUser(staff)
    const adminResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@barangay.gov.ph', password: 'AdminPass123' }),
    })
    const adminToken = (await adminResponse.json()).token
    const response = await fetch(`${baseUrl}/api/admin/staff/${staff.id}/temporary-access`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(response.status, 502)
    const db = await jsonDb.readDb()
    assert.equal(db.staffTemporaryAccessGrants.length, 1)
    assert.ok(db.staffTemporaryAccessGrants[0].revokedAt)
  } finally {
    if (originalDeliveryUrl === undefined) delete process.env.RESET_DELIVERY_URL
    else process.env.RESET_DELIVERY_URL = originalDeliveryUrl
    if (originalDeliveryToken === undefined) delete process.env.RESET_DELIVERY_TOKEN
    else process.env.RESET_DELIVERY_TOKEN = originalDeliveryToken
    await Promise.all([
      new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => deliveryServer.close((error) => error ? reject(error) : resolve())),
    ])
  }
})

test('public officer profiles are blank-ready and editable by Staff or Admin over HTTPS', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Officer',
    lastName: 'Profile Editor',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `officer.editor.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
  }

  try {
    await jsonDb.saveUser(staff)
    const profilesResponse = await fetch(`${baseUrl}/api/official-profiles`)
    assert.equal(profilesResponse.status, 200)
    const initial = await profilesResponse.json()
    assert.equal(initial.profiles.find((profile) => profile.role === 'captain').displayName, '')
    assert.equal(initial.profiles.find((profile) => profile.role === 'secretary').displayName, '')
    assert.equal(initial.profiles.find((profile) => profile.role === 'treasurer').displayName, '')

    const login = async (identifier, password) => {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      return (await response.json()).token
    }
    const [adminToken, residentToken, staffToken] = await Promise.all([
      login('admin@barangay.gov.ph', 'AdminPass123'),
      login('maria.delacruz@email.com', 'ResidentPass123!'),
      login(staff.email, 'StaffPass123!'),
    ])
    const endpoint = `${baseUrl}/api/admin/official-profiles/secretary`
    const body = { displayName: 'Secretary Name', profileUrl: 'https://example.com/profile', groupUrl: 'https://example.com/group' }
    assert.equal((await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${residentToken}` },
      body: JSON.stringify(body),
    })).status, 403)
    const staffSaveResponse = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify(body),
    })
    assert.equal(staffSaveResponse.status, 200)
    const invalidLinkResponse = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ ...body, profileUrl: 'javascript:alert(1)' }),
    })
    assert.equal(invalidLinkResponse.status, 400)
    const saveResponse = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(body),
    })
    assert.equal(saveResponse.status, 200)
    const saved = await (await fetch(`${baseUrl}/api/official-profiles`)).json()
    assert.equal(saved.profiles.find((profile) => profile.role === 'secretary').displayName, 'Secretary Name')
    assert.equal(saved.profiles.find((profile) => profile.role === 'secretary').profileUrl, body.profileUrl)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('admin deletion only allows staff members and blocks administrators', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@barangay.gov.ph',
        password: 'AdminPass123',
      }),
    })
    assert.equal(loginResponse.status, 200)
    const { token } = await loginResponse.json()

    const usersResponse = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { users } = await usersResponse.json()
    const resident = users.find((user) => user.role === 'resident')
    const administrator = users.find((user) => user.role === 'admin')

    const residentDeleteResponse = await fetch(`${baseUrl}/api/staff/members/${resident.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(residentDeleteResponse.status, 400)

    const adminDeleteResponse = await fetch(`${baseUrl}/api/staff/members/${administrator.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(adminDeleteResponse.status, 403)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('admin can archive a resident while preserving request history and blocking resident sign-in', async () => {
  const { server, baseUrl } = await createTestServer()
  const resident = {
    id: randomUUID(),
    firstName: 'Resident',
    lastName: 'Archive',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `resident.archive.${Date.now()}@example.com`,
    passwordHash: await hashPassword('ResidentPass123!'),
    role: 'resident',
    householdId: 'ARCHIVE-TEST',
    familyMembers: 3,
    status: 'Active Resident',
    zone: 1,
  }

  try {
    const missingTokenResponse = await fetch(`${baseUrl}/api/admin/residents/${resident.id}/archive`, { method: 'POST' })
    assert.equal(missingTokenResponse.status, 401)

    const invalidTokenResponse = await fetch(`${baseUrl}/api/admin/residents/${resident.id}/archive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-token' },
    })
    assert.equal(invalidTokenResponse.status, 401)

    await jsonDb.saveUser(resident)
    const requestId = randomUUID()
    await jsonDb.saveRequest({
      id: requestId,
      userId: resident.id,
      type: 'Barangay Clearance',
      purpose: 'Archive retention test',
      status: 'Pending',
      date: new Date().toISOString(),
    })

    const adminLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@barangay.gov.ph', password: 'AdminPass123' }),
    })
    const { token: adminToken } = await adminLoginResponse.json()

    const residentLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: resident.email, password: 'ResidentPass123!' }),
    })
    const { token: residentToken } = await residentLoginResponse.json()
    const forbiddenResponse = await fetch(`${baseUrl}/api/admin/residents/${resident.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${residentToken}` },
    })
    assert.equal(forbiddenResponse.status, 403)

    const staff = {
      id: randomUUID(),
      firstName: 'Staff',
      lastName: 'NotResident',
      mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
      email: `staff.archive.${Date.now()}@example.com`,
      passwordHash: await hashPassword('StaffPass123!'),
      role: 'staff',
      status: 'On Duty',
    }
    await jsonDb.saveUser(staff)
    const wrongTargetResponse = await fetch(`${baseUrl}/api/admin/residents/${staff.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(wrongTargetResponse.status, 400)

    const archiveResponse = await fetch(`${baseUrl}/api/admin/residents/${resident.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(archiveResponse.status, 200)
    const archived = await archiveResponse.json()
    assert.equal(archived.user.status, 'Disabled')
    assert.equal((await jsonDb.findUserById(resident.id)).status, 'Disabled')
    assert.equal((await jsonDb.listRequestsForUser(resident.id)).some((request) => request.id === requestId), true)

    const archivedLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: resident.email, password: 'ResidentPass123!' }),
    })
    assert.equal(archivedLoginResponse.status, 403)

    const repeatArchiveResponse = await fetch(`${baseUrl}/api/admin/residents/${resident.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(repeatArchiveResponse.status, 200)
    assert.equal((await repeatArchiveResponse.json()).alreadyArchived, true)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('admin-visible resident lists exclude generated test accounts', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
    await jsonDb.saveUser({
      id: randomUUID(),
      firstName: 'Generated',
      lastName: 'Test',
      mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      email: `resident.${Date.now()}@example.com`,
      passwordHash: await hashPassword('GeneratedPass123!'),
      role: 'resident',
      householdId: '2024-TEST',
      familyMembers: 4,
      status: 'Pending Verification',
      address: 'Barangay Legaspi, Tayug, Pangasinan',
      zone: 1,
      createdAt: new Date().toISOString(),
    })

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@barangay.gov.ph',
        password: 'AdminPass123',
      }),
    })
    assert.equal(loginResponse.status, 200)
    const { token } = await loginResponse.json()

    const usersResponse = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(usersResponse.status, 200)

    const usersData = await usersResponse.json()
    const generatedResident = usersData.users.find((user) => user.email && user.email.includes('@example.com') && user.role === 'resident')
    assert.equal(generatedResident, undefined)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('password reset uses a one-time token', async () => {
  const { server, baseUrl } = await createTestServer()
  const originalPassword = 'SecurePass123!'
  const resetPassword = 'ResetPass123!'

  try {
    const email = `reset.${Date.now()}@example.com`
    const registerResponse = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Reset',
        lastName: 'User',
        mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
        email,
        password: originalPassword,
      }),
    })
    assert.equal(registerResponse.status, 201)

    const requestResponse = await fetch(`${baseUrl}/api/reset-password/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email }),
    })
    assert.equal(requestResponse.status, 200)
    const requestData = await requestResponse.json()
    assert.ok(requestData.resetToken)

    const resetResponse = await fetch(`${baseUrl}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: requestData.resetToken, newPassword: resetPassword }),
    })
    assert.equal(resetResponse.status, 200)

    const reusedResponse = await fetch(`${baseUrl}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: requestData.resetToken, newPassword: originalPassword }),
    })
    assert.equal(reusedResponse.status, 400)

    const restoreRequest = await fetch(`${baseUrl}/api/reset-password/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email }),
    })
    const restoreData = await restoreRequest.json()
    const restoreResponse = await fetch(`${baseUrl}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: restoreData.resetToken, newPassword: originalPassword }),
    })
    assert.equal(restoreResponse.status, 200)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('login fails closed when MFA is enabled but the encrypted secret is missing', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
    const admin = await jsonDb.findUserByIdentifier('admin@barangay.gov.ph')
    await jsonDb.updateUser(admin.id, { mfaEnabled: true, mfaSecret: '' })

    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@barangay.gov.ph', password: 'AdminPass123' }),
    })
    const data = await response.json()

    assert.equal(response.status, 503)
    assert.equal(data.code, 'mfa_unavailable')
    assert.equal(data.token, undefined)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('MFA login requires a valid one-time authenticator code', async () => {
  const { server, baseUrl } = await createTestServer()
  const secret = createTotpSecret()

  try {
    const admin = await jsonDb.findUserByIdentifier('admin@barangay.gov.ph')
    await jsonDb.updateUser(admin.id, {
      mfaEnabled: true,
      mfaSecret: encryptTotpSecret(secret),
      mfaLastStep: 0,
    })

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@barangay.gov.ph', password: 'AdminPass123' }),
    })
    const loginData = await loginResponse.json()
    assert.equal(loginResponse.status, 200)
    assert.equal(loginData.requiresMfa, true)
    assert.equal(loginData.token, undefined)

    const verifyResponse = await fetch(`${baseUrl}/api/login/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: loginData.challengeToken,
        code: createTotpCode(secret),
      }),
    })
    const verifyData = await verifyResponse.json()
    assert.equal(verifyResponse.status, 200)
    assert.ok(verifyData.token)

    const replayResponse = await fetch(`${baseUrl}/api/login/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: loginData.challengeToken,
        code: createTotpCode(secret),
      }),
    })
    assert.equal(replayResponse.status, 401)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('authenticated users can change passwords with the current password', async () => {
  const { server, baseUrl } = await createTestServer()
  const currentPassword = 'CurrentPass123!'
  const nextPassword = 'NextPass123!'
  const email = `change.${Date.now()}@example.com`

  try {
    const registerResponse = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Change',
        lastName: 'Password',
        mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
        email,
        password: currentPassword,
      }),
    })
    assert.equal(registerResponse.status, 201)

    const user = await jsonDb.findUserByIdentifier(email)
    await jsonDb.updateUser(user.id, { status: 'Active Resident' })

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: currentPassword }),
    })
    const { token } = await loginResponse.json()

    const wrongPasswordResponse = await fetch(`${baseUrl}/api/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'WrongPass123!', newPassword: nextPassword }),
    })
    assert.equal(wrongPasswordResponse.status, 401)

    const changeResponse = await fetch(`${baseUrl}/api/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword, newPassword: nextPassword }),
    })
    assert.equal(changeResponse.status, 200)

    const nextLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: nextPassword }),
    })
    assert.equal(nextLoginResponse.status, 200)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('admin can archive residents by zone into separate files', async () => {
  const { server, baseUrl } = await createTestServer()
  const mobile = `091${Math.floor(10000000 + Math.random() * 90000000)}`
  const email = `zonearchive.${Date.now()}@example.com`

  try {
    const registerResponse = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Zone',
        lastName: 'Resident',
        mobile,
        email,
        password: 'SecurePass123!',
      }),
    })

    assert.equal(registerResponse.status, 201)
    const registeredUser = await registerResponse.json()
    const residentId = registeredUser.user.id

    const adminLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@barangay.gov.ph',
        password: 'AdminPass123',
      }),
    })

    assert.equal(adminLoginResponse.status, 200)
    const adminToken = (await adminLoginResponse.json()).token

    const zoneUpdateResponse = await fetch(`${baseUrl}/api/admin/users/${residentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ zone: 6 }),
    })

    assert.equal(zoneUpdateResponse.status, 200)

    const archiveResponse = await fetch(`${baseUrl}/api/admin/archive-users-by-zone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })

    assert.equal(archiveResponse.status, 200)
    const archiveData = await archiveResponse.json()
    assert.ok(archiveData.archives.some((archive) => archive.zone === 6))
    assert.ok(archiveData.archives.some((archive) => archive.filename.includes('zone-6')))
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('approval archives default to a safe retention period and never overwrite earlier archives', async () => {
  const { server, baseUrl } = await createTestServer()
  const archiveNames = []

  try {
    const adminLoginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@barangay.gov.ph',
        password: 'AdminPass123',
      }),
    })
    assert.equal(adminLoginResponse.status, 200)
    const adminToken = (await adminLoginResponse.json()).token
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + adminToken,
    }
    const invalidTokenResponse = await fetch(`${baseUrl}/api/admin/archive-approvals`, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-test-token' },
    })
    assert.equal(invalidTokenResponse.status, 401)

    const firstApproval = {
      id: randomUUID(),
      requestId: randomUUID(),
      approvedBy: 'admin',
      approvedByRole: 'admin',
      dateApproved: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      requestSnapshot: { type: 'Certificate', purpose: 'Archive regression test' },
    }
    await jsonDb.addApproval(firstApproval)

    const safeDefaultResponse = await fetch(`${baseUrl}/api/admin/archive-approvals`, {
      method: 'POST',
      headers,
    })
    assert.equal(safeDefaultResponse.status, 200)
    assert.deepEqual((await safeDefaultResponse.json()).archive, { count: 0, filename: null })
    assert.equal((await jsonDb.listApprovals()).length, 1)

    const invalidRetentionResponse = await fetch(`${baseUrl}/api/admin/archive-approvals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 1.5 }),
    })
    assert.equal(invalidRetentionResponse.status, 400)

    const archiveFirstResponse = await fetch(`${baseUrl}/api/admin/archive-approvals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 0 }),
    })
    assert.equal(archiveFirstResponse.status, 200)
    const firstArchive = (await archiveFirstResponse.json()).archive
    assert.equal(firstArchive.count, 1)
    archiveNames.push(firstArchive.filename.split(/[\\/]/).pop())

    const secondApproval = {
      ...firstApproval,
      id: randomUUID(),
      requestId: randomUUID(),
    }
    await jsonDb.addApproval(secondApproval)

    const archiveSecondResponse = await fetch(`${baseUrl}/api/admin/archive-approvals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 0 }),
    })
    assert.equal(archiveSecondResponse.status, 200)
    const secondArchive = (await archiveSecondResponse.json()).archive
    assert.equal(secondArchive.count, 1)
    archiveNames.push(secondArchive.filename.split(/[\\/]/).pop())
    assert.notEqual(archiveNames[0], archiveNames[1])

    assert.deepEqual(await jsonDb.getArchive(archiveNames[0]), [firstApproval])
    assert.deepEqual(await jsonDb.getArchive(archiveNames[1]), [secondApproval])
    assert.equal((await jsonDb.listApprovals()).length, 0)
  } finally {
    await Promise.all(archiveNames.map((name) => jsonDb.deleteArchive(name)))
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('reset password request sends a delivery webhook payload when configured', async () => {
  const originalDeliveryUrl = process.env.RESET_DELIVERY_URL
  const originalDeliveryToken = process.env.RESET_DELIVERY_TOKEN
  const deliveryToken = 'test-only-reset-delivery-token'
  const deliveryRequests = []
  const deliveryServer = await new Promise((resolve) => {
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        deliveryRequests.push({
          method: request.method,
          path: request.url,
          authorization: request.headers.authorization,
          body: JSON.parse(body || '{}'),
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
      })
    })
    server.listen(0, () => resolve(server))
  })

  process.env.RESET_DELIVERY_URL = `http://127.0.0.1:${deliveryServer.address().port}`
  process.env.RESET_DELIVERY_TOKEN = deliveryToken
  let appServer

  try {
    const testServer = await createTestServer()
    appServer = testServer.server
    const { baseUrl } = testServer
    const email = `delivery.${Date.now()}@example.com`
    const registerResponse = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Delivery',
        lastName: 'User',
        mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
        email,
        password: 'SecurePass123!',
      }),
    })
    assert.equal(registerResponse.status, 201)

    const requestResponse = await fetch(`${baseUrl}/api/reset-password/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email }),
    })

    assert.equal(requestResponse.status, 200)
    const requestBody = await requestResponse.json()
    assert.equal(requestBody.deliveryStatus, 'queued')
    assert.equal(requestBody.message, 'If the account exists, reset instructions have been sent.')
    assert.equal(deliveryRequests.length > 0, true)

    const passwordResetRequest = deliveryRequests.find((delivery) => delivery.body.event === 'password_reset')
    assert.ok(passwordResetRequest)
    assert.equal(passwordResetRequest.body.email, email)
    assert.equal(passwordResetRequest.body.event, 'password_reset')
    assert.equal(passwordResetRequest.authorization, `Bearer ${deliveryToken}`)
  } finally {
    if (originalDeliveryUrl === undefined) delete process.env.RESET_DELIVERY_URL
    else process.env.RESET_DELIVERY_URL = originalDeliveryUrl
    if (originalDeliveryToken === undefined) delete process.env.RESET_DELIVERY_TOKEN
    else process.env.RESET_DELIVERY_TOKEN = originalDeliveryToken
    if (appServer) {
      await new Promise((resolve, reject) => {
        appServer.close((error) => (error ? reject(error) : resolve()))
      })
    }
    await new Promise((resolve, reject) => {
      deliveryServer.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('resident registry imports are staff-only, duplicate-reviewed, pending, and audited', async () => {
  const { server, baseUrl } = await createTestServer()
  const staffPassword = 'StaffPass123!'
  const staff = {
    id: randomUUID(),
    firstName: 'Registry',
    lastName: 'Staff',
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `registry.${Date.now()}@example.com`,
    passwordHash: await hashPassword(staffPassword),
    role: 'staff',
    status: 'On Duty',
    createdAt: new Date().toISOString(),
  }

  try {
    await jsonDb.saveUser(staff)
    const staffLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: staffPassword }),
    })
    assert.equal(staffLogin.status, 200)
    const staffToken = (await staffLogin.json()).token
    const headers = { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' }
    const importBody = {
      filename: 'family-sheet.csv',
      residents: [
        { firstName: 'Ana', lastName: 'Reyes', birthDate: '2000-01-02', sex: 'Female', zone: '2', purok: 'Purok 2' },
        { firstName: 'Ana', lastName: 'Reyes', birthDate: '2000-01-02', sex: 'Female', zone: '2', purok: 'Purok 2' },
        { firstName: 'Ana', lastName: 'Reyes', birthDate: '2001-01-02', sex: 'Female', zone: '2', purok: 'Purok 2' },
        { firstName: 'Ana', lastName: 'Reyes', birthDate: '', sex: 'Female', zone: '2', purok: 'Purok 2' },
      ],
    }

    const oversizedFieldResponse = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filename: 'large-row.csv',
        residents: [{ firstName: 'Ana', lastName: 'Reyes', address: 'x'.repeat(120_000) }],
      }),
    })
    assert.equal(oversizedFieldResponse.status, 400)

    const duplicateReview = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify(importBody),
    })
    assert.equal(duplicateReview.status, 409)
    const reviewData = await duplicateReview.json()
    assert.equal(reviewData.reviewRequired, true)
    assert.equal(reviewData.potentialMatches.length, 3)
    assert.equal(reviewData.potentialMatches[0].records[0].source, 'same import file')
    assert.equal((await jsonDb.listResidentRegistry({ page: 1, pageSize: 25 })).total, 0)

    const importResponse = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...importBody, confirmPotentialMatches: true, reviewedMatches: reviewData.reviewedMatches }),
    })
    assert.equal(importResponse.status, 201)
    assert.deepEqual(await importResponse.json(), {
      imported: 3,
      skipped: 1,
      verificationStatus: 'pending',
      potentialMatches: reviewData.potentialMatches,
    })

    const retryReviewResponse = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify(importBody),
    })
    assert.equal(retryReviewResponse.status, 409)
    const retryReview = await retryReviewResponse.json()
    const retryResponse = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...importBody,
        confirmPotentialMatches: true,
        reviewedMatches: retryReview.reviewedMatches,
      }),
    })
    assert.equal(retryResponse.status, 201)
    assert.equal((await retryResponse.json()).imported, 0)

    const residentsResponse = await fetch(`${baseUrl}/api/staff/residents?page=1&pageSize=25`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal(residentsResponse.status, 200)
    assert.equal(residentsResponse.headers.get('cache-control'), 'private, no-store')
    const residentsData = await residentsResponse.json()
    assert.equal(residentsData.total, 3)
    assert.ok(residentsData.residents.every((resident) => resident.verificationStatus === 'pending'))
    assert.ok(residentsData.residents.every((resident) => !Object.hasOwn(resident, 'address')))
    assert.ok(residentsData.residents.every((resident) => !Object.hasOwn(resident, 'sourceReference')))
    assert.ok(residentsData.residents.every((resident) => !Object.hasOwn(resident, 'sourceFilename')))
    const storedResidents = await jsonDb.listResidentRegistry({ page: 1, pageSize: 25 })
    assert.ok(storedResidents.residents.every((resident) => resident.sourceFilename === importBody.filename))

    const demographicsResponse = await fetch(`${baseUrl}/api/staff/demographics`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal(demographicsResponse.status, 200)
    assert.equal(demographicsResponse.headers.get('cache-control'), 'private, no-store')
    assert.equal((await demographicsResponse.json()).overall.total, 0)

    const verifyResponse = await fetch(`${baseUrl}/api/staff/residents/${residentsData.residents[0].id}/verify`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ verificationStatus: 'verified' }),
    })
    assert.equal(verifyResponse.status, 200)
    const flagReviewResponse = await fetch(`${baseUrl}/api/staff/residents/${residentsData.residents[0].id}/verify`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ verificationStatus: 'needs_review' }),
    })
    assert.equal(flagReviewResponse.status, 200)
    assert.equal((await flagReviewResponse.json()).resident.verifiedAt, null)
    const flaggedDemographics = await fetch(`${baseUrl}/api/staff/demographics`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal((await flaggedDemographics.json()).overall.total, 0)
    const reverifyResponse = await fetch(`${baseUrl}/api/staff/residents/${residentsData.residents[0].id}/verify`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ verificationStatus: 'verified' }),
    })
    assert.equal(reverifyResponse.status, 200)
    const verifiedDemographics = await fetch(`${baseUrl}/api/staff/demographics`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal((await verifiedDemographics.json()).overall.total, 1)

    const inactiveResponse = await fetch(`${baseUrl}/api/staff/residents/${residentsData.residents[0].id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'inactive' }),
    })
    assert.equal(inactiveResponse.status, 200)
    const inactiveDemographics = await fetch(`${baseUrl}/api/staff/demographics`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal((await inactiveDemographics.json()).overall.total, 0)

    const residentLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'maria.delacruz@email.com', password: 'ResidentPass123!' }),
    })
    const residentToken = (await residentLogin.json()).token
    const deniedResponse = await fetch(`${baseUrl}/api/staff/residents`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    })
    assert.equal(deniedResponse.status, 403)

    const auditLogs = await jsonDb.listAuditLogs()
    const importAudit = auditLogs.find((entry) => entry.action === 'resident_registry.bulk_imported')
    assert.ok(importAudit)
    assert.equal(importAudit.actorId, staff.id)
    assert.equal(importAudit.metadata.count, 3)
    assert.equal(importAudit.metadata.hasFilename, true)
    assert.equal(JSON.stringify(importAudit).includes(importBody.filename), false)
    assert.ok(auditLogs.some((entry) => entry.action === 'resident_registry.verified'))
    assert.ok(auditLogs.some((entry) => entry.action === 'resident_registry.status_changed'))
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('registry source-review warnings are staff-only, persistent, idempotent, and audited', async () => {
  const { server, baseUrl } = await createTestServer()
  const staffPassword = 'ReviewStaffPass123!'
  const staff = {
    id: randomUUID(),
    firstName: 'Review',
    lastName: 'Staff',
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `source-review.${Date.now()}@example.com`,
    passwordHash: await hashPassword(staffPassword),
    role: 'staff',
    status: 'On Duty',
    createdAt: new Date().toISOString(),
  }
  try {
    await jsonDb.saveUser(staff)
    const login = async (email, password) => {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email, password }),
      })
      assert.equal(response.status, 200)
      return (await response.json()).token
    }
    const staffToken = await login(staff.email, staffPassword)
    const residentToken = await login('maria.delacruz@email.com', 'ResidentPass123!')
    const headers = { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' }
    const endpoint = `${baseUrl}/api/staff/registry-source-reviews`

    const anonymousResponse = await fetch(endpoint)
    assert.equal(anonymousResponse.status, 401)
    assert.equal(anonymousResponse.headers.get('cache-control'), 'private, no-store')

    const invalidLocation = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ purok: 'Purok 3 Laud', zone: 8 }),
    })
    assert.equal(invalidLocation.status, 400)

    const createResponse = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ purok: 'Purok 3 Laud' }),
    })
    assert.equal(createResponse.status, 201)
    assert.equal(createResponse.headers.get('cache-control'), 'private, no-store')
    assert.equal(createResponse.headers.get('vary'), 'Authorization')
    const created = await createResponse.json()
    assert.equal(created.review.purok, 'Purok 3 Laud')
    assert.equal(created.review.zone, null)
    assert.equal(created.review.status, 'open')
    assert.equal(Object.hasOwn(created.review, 'createdBy'), false)

    const duplicateResponse = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ purok: 'PUROK 3 LAUD' }),
    })
    assert.equal(duplicateResponse.status, 200)
    const duplicate = await duplicateResponse.json()
    assert.equal(duplicate.created, false)
    assert.equal(duplicate.review.id, created.review.id)

    const residentResponse = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${residentToken}` },
    })
    assert.equal(residentResponse.status, 403)

    const listResponse = await fetch(endpoint, { headers: { Authorization: `Bearer ${staffToken}` } })
    assert.equal(listResponse.status, 200)
    assert.deepEqual((await listResponse.json()).reviews.map(({ id, purok, status }) => ({ id, purok, status })), [
      { id: created.review.id, purok: 'Purok 3 Laud', status: 'open' },
    ])

    const invalidIdResponse = await fetch(`${endpoint}/not-a-uuid/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal(invalidIdResponse.status, 400)

    const resolveResponse = await fetch(`${endpoint}/${created.review.id}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal(resolveResponse.status, 200)
    assert.equal((await resolveResponse.json()).review.status, 'resolved')

    const resolvedListResponse = await fetch(endpoint, { headers: { Authorization: `Bearer ${staffToken}` } })
    assert.deepEqual((await resolvedListResponse.json()).reviews, [])
    const repeatResolve = await fetch(`${endpoint}/${created.review.id}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    assert.equal(repeatResolve.status, 404)

    const stored = await jsonDb.readDb()
    assert.equal(stored.registrySourceReviews[0].status, 'resolved')
    assert.equal(stored.registrySourceReviews[0].resolvedBy, staff.id)
    const auditLogs = await jsonDb.listAuditLogs()
    const warningAudits = auditLogs.filter((entry) => entry.targetType === 'resident_registry_source_review')
    assert.deepEqual(warningAudits.map((entry) => entry.action).sort(), [
      'resident_registry.source_review_opened',
      'resident_registry.source_review_resolved',
    ])
    assert.ok(warningAudits.every((entry) => entry.actorId === staff.id))
    assert.equal(warningAudits.some((entry) => JSON.stringify(entry).includes('Test Resident')), false)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('staff can add a manual resident with duplicate review and privacy safeguards', async () => {
  const { server, baseUrl } = await createTestServer()
  const staffPassword = 'ManualStaffPass123!'
  const staff = {
    id: randomUUID(),
    firstName: 'Manual',
    lastName: 'Entry',
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `manual-entry.${Date.now()}@example.com`,
    passwordHash: await hashPassword(staffPassword),
    role: 'staff',
    status: 'On Duty',
    createdAt: new Date().toISOString(),
  }

  try {
    await jsonDb.saveUser(staff)
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: staffPassword }),
    })
    assert.equal(loginResponse.status, 200)
    const token = (await loginResponse.json()).token
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const resident = {
      firstName: 'Luz',
      lastName: 'Santos',
      birthDate: '1980-02-03',
      sex: 'Female',
      address: 'Sensitive address',
      sourceFilename: 'confidential-source-sheet.csv',
    }

    const anonymousResponse = await fetch(`${baseUrl}/api/staff/residents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resident),
    })
    assert.equal(anonymousResponse.status, 401)
    assert.equal(anonymousResponse.headers.get('cache-control'), 'private, no-store')

    const createResponse = await fetch(`${baseUrl}/api/staff/residents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(resident),
    })
    assert.equal(createResponse.status, 201)
    assert.equal(createResponse.headers.get('cache-control'), 'private, no-store')
    const created = await createResponse.json()
    assert.equal(created.resident.verificationStatus, 'pending')
    assert.equal(Object.hasOwn(created.resident, 'firstName'), false)
    assert.equal(Object.hasOwn(created.resident, 'birthDate'), false)
    assert.equal(Object.hasOwn(created.resident, 'address'), false)
    assert.equal(JSON.stringify(created).includes('confidential-source-sheet.csv'), false)

    const duplicateResponse = await fetch(`${baseUrl}/api/staff/residents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(resident),
    })
    assert.equal(duplicateResponse.status, 409)
    const duplicateReview = await duplicateResponse.json()
    assert.equal(duplicateReview.reviewRequired, true)

    const concurrentRecords = Array.from({ length: 7 }, (_, index) => ({
      id: randomUUID(),
      firstName: resident.firstName,
      lastName: resident.lastName,
      birthDate: resident.birthDate,
      sex: resident.sex,
      householdId: null,
      purok: null,
      zone: null,
      address: null,
      status: 'active',
      recordStatus: 'active',
      verificationStatus: 'pending',
      sourceFingerprint: `concurrent-review-test-${index}`,
      createdBy: staff.id,
      createdAt: new Date().toISOString(),
    }))
    const db = await jsonDb.readDb()
    db.residentRegistry.push(...concurrentRecords)
    await jsonDb.writeDb(db)

    const staleConfirmation = await fetch(`${baseUrl}/api/staff/residents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...resident,
        confirmPotentialMatch: true,
        reviewedMatches: duplicateReview.reviewedMatches,
      }),
    })
    assert.equal(staleConfirmation.status, 409)
    const refreshedReview = await staleConfirmation.json()
    assert.equal(refreshedReview.potentialMatches.length, 8)

    const confirmedResponse = await fetch(`${baseUrl}/api/staff/residents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...resident,
        confirmPotentialMatch: true,
        reviewedMatches: refreshedReview.reviewedMatches,
      }),
    })
    assert.equal(confirmedResponse.status, 200)
    const confirmedData = await confirmedResponse.json()
    assert.equal(confirmedData.resident.verificationStatus, 'pending')
    assert.equal(confirmedData.created, false)

    const recordsResponse = await fetch(`${baseUrl}/api/staff/residents?page=1&pageSize=25`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const records = await recordsResponse.json()
    assert.equal(records.total, 8)
    assert.ok(records.residents.every((record) => record.verificationStatus === 'pending'))
    assert.ok(records.residents.every((record) => !Object.hasOwn(record, 'address')))
    assert.ok(records.residents.every((record) => !Object.hasOwn(record, 'sourceFilename')))

    const concurrentEntries = ['ConcurrentOne', 'ConcurrentTwo'].map((firstName) => fetch(`${baseUrl}/api/staff/residents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ firstName, lastName: 'Household' }),
    }))
    const concurrentResponses = await Promise.all(concurrentEntries)
    assert.ok(concurrentResponses.every((response) => response.status === 201))
    const afterConcurrentWrites = await jsonDb.listResidentRegistry({ page: 1, pageSize: 25 })
    assert.equal(afterConcurrentWrites.total, 10)

    const auditLogs = await jsonDb.listAuditLogs()
    const createAudits = auditLogs.filter((entry) => entry.action === 'resident_registry.created')
    assert.equal(createAudits.length, 3)
    assert.ok(createAudits.every((entry) => entry.actorId === staff.id))
    assert.ok(createAudits.every((entry) => !JSON.stringify(entry).includes('Luz')))
    assert.ok(createAudits.every((entry) => !JSON.stringify(entry).includes('confidential-source-sheet.csv')))
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
