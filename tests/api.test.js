import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp, seedDemoResident } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import * as jsonDb from '../server/db.js'
import { ADMIN_SEED, DB_PATH } from '../server/config.js'
import { isCaptainPhotoStorageConfigured } from '../server/captain-photo-storage.js'
import { registryAgeDateRange } from '../server/resident-registry.js'
import { decryptResidentPrivateData, encryptResidentPrivateData } from '../server/resident-registry-crypto.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

const testDbPath = DB_PATH

beforeEach(async () => {
  await fs.mkdir(path.dirname(testDbPath), { recursive: true })
  await fs.writeFile(testDbPath, JSON.stringify({ users: [], requests: [], announcements: [], reports: [], approvals: [], auditLogs: [] }, null, 2), 'utf8')
  await seedDemoResident()
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

test('JSON storage preserves concurrent audit writes', async () => {
  const auditEntries = Array.from({ length: 20 }, (_, index) => ({
    id: `concurrent-audit-${index}`,
    action: 'test.concurrent_audit',
    targetType: 'test',
    targetId: String(index),
    createdAt: new Date().toISOString(),
  }))

  await Promise.all(auditEntries.map((entry) => jsonDb.addAuditLog(entry)))

  const storedLogs = await jsonDb.listAuditLogs(100)
  assert.equal(storedLogs.filter((entry) => entry.action === 'test.concurrent_audit').length, auditEntries.length)
})

test('resident registry encryption authenticates ciphertext and binds it to its record', () => {
  const recordId = randomUUID()
  const encrypted = encryptResidentPrivateData({ firstName: 'Private' }, recordId)

  assert.deepEqual(decryptResidentPrivateData(encrypted, recordId), { firstName: 'Private' })
  assert.throws(() => decryptResidentPrivateData(encrypted, randomUUID()))
  const parts = encrypted.split('.')
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`
  const tampered = parts.join('.')
  assert.throws(() => decryptResidentPrivateData(tampered, recordId))
})

test('JSON storage encrypts legacy resident entries on first read', async () => {
  await fs.writeFile(testDbPath, JSON.stringify({
    users: [],
    requests: [],
    announcements: [],
    reports: [],
    residentRegistry: [{
      id: 'legacy-resident',
      firstName: 'Legacy',
      lastName: 'Resident',
      householdId: 'HH-LEGACY',
      zone: 2,
      purok: 'Purok 2',
      status: 'active',
      verificationStatus: 'pending',
    }],
  }), 'utf8')

  const database = await jsonDb.readDb()
  assert.equal(database.residentRegistry[0].firstName, 'Legacy')
  const persisted = JSON.parse(await fs.readFile(testDbPath, 'utf8'))
  assert.ok(persisted.residentRegistry[0].encryptedData)
  assert.equal(JSON.stringify(persisted.residentRegistry[0]).includes('Legacy'), false)
  assert.equal(JSON.stringify(persisted.residentRegistry[0]).includes('HH-LEGACY'), false)
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

    const invalidPageSize = await fetch(`${baseUrl}/api/staff/dashboard-requests?pageSize=500`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(invalidPageSize.status, 400)
  } finally {
    server.close()
  }
})

test('staff reports and CSV exports are role-protected and use selected real request data', async () => {
  const { server, baseUrl } = await createTestServer()
  const users = await jsonDb.listAllUsers()
  const resident = users.find((user) => user.role === 'resident')
  const staff = {
    id: randomUUID(),
    firstName: 'Staff',
    lastName: 'Reports',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `staff.reports.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
    zone: 1,
  }

  try {
    await jsonDb.saveUser(staff)
    await jsonDb.saveRequest({
      id: randomUUID(),
      userId: resident.id,
      type: 'Barangay Certificate',
      purpose: 'Should not be exported',
      status: 'Approved',
      date: '2026-10-09T00:00:00+08:00',
      statusHistory: [
        { status: 'Pending', createdAt: '2026-10-09T00:00:00+08:00' },
        { status: 'Approved', createdAt: '2026-10-10T00:00:00+08:00' },
      ],
    })

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'StaffPass123!' }),
    })
    const { token } = await loginResponse.json()
    const authorization = { Authorization: `Bearer ${token}` }
    const reportResponse = await fetch(`${baseUrl}/api/staff/reports?from=2026-10-09&to=2026-10-10`, {
      headers: authorization,
    })
    assert.equal(reportResponse.status, 200)
    const report = await reportResponse.json()
    assert.equal(report.summary.received, 1)
    assert.equal(report.summary.approvedDecisions, 1)
    assert.equal(Object.hasOwn(report, 'requests'), false)
    assert.equal(JSON.stringify(report).includes('Should not be exported'), false)
    assert.equal(JSON.stringify(report).includes(resident.email), false)
    assert.equal(JSON.stringify(report).includes(resident.mobile), false)

    const exportResponse = await fetch(`${baseUrl}/api/staff/reports/export.csv?from=2026-10-09&to=2026-10-10`, {
      headers: authorization,
    })
    assert.equal(exportResponse.status, 200)
    assert.match(exportResponse.headers.get('content-type'), /text\/csv/)
    const exportedCsv = await exportResponse.text()
    assert.match(exportedCsv, /Barangay Certificate/)
    assert.equal(exportedCsv.includes(resident.email), false)
    assert.equal(exportedCsv.includes(resident.mobile), false)

    const invalidDateResponse = await fetch(`${baseUrl}/api/staff/reports?from=2026-02-30`, {
      headers: authorization,
    })
    assert.equal(invalidDateResponse.status, 400)

    const residentLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: resident.email, password: 'ResidentPass123!' }),
    })
    const residentToken = (await residentLogin.json()).token
    const deniedResponse = await fetch(`${baseUrl}/api/staff/reports`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    })
    assert.equal(deniedResponse.status, 403)
  } finally {
    server.close()
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

test('registers a resident and waits for staff account review', async () => {
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
    assert.match(loginData.message, /staff review/i)
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
    const emergencyAccessResponse = await fetch(`${baseUrl}/api/admin/emergency-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({
        reason: 'Temporary staff absence requires processing a resident request.',
        currentPassword: ADMIN_SEED.password,
      }),
    })
    assert.equal(emergencyAccessResponse.status, 201)

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

test('staff invitation creates a staff account once and keeps invitation secrets out of audit logs', async () => {
  const { server, baseUrl } = await createTestServer()
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const email = `invited.${randomUUID()}@example.com`
  const mobile = `091${Math.floor(10000000 + Math.random() * 90000000)}`
  const now = new Date()
  const invitationId = randomUUID()
  await jsonDb.createStaffInvitation({
    id: invitationId,
    tokenHash,
    email,
    mobile,
    operatorId: 'deployment-operator-test',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  })

  try {
    const accept = () => fetch(`${baseUrl}/api/staff-invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        firstName: 'Test',
        lastName: 'Invitee',
        password: 'SecurePass123!',
      }),
    })
    const [firstResponse, replayResponse] = await Promise.all([accept(), accept()])
    assert.equal(firstResponse.status, 201)
    assert.equal(replayResponse.status, 400)
    assert.equal(firstResponse.headers.get('cache-control'), 'no-store')

    const stored = await jsonDb.readDb()
    const staff = stored.users.filter((user) => user.email === email)
    assert.equal(staff.length, 1)
    assert.equal(staff[0].role, 'staff')
    assert.equal(staff[0].mobile, mobile)
    assert.equal(staff[0].passwordHash === 'SecurePass123!', false)
    assert.equal(stored.staffInvitations.find((item) => item.id === invitationId).acceptedAt !== null, true)

    const invitationAudits = stored.auditLogs.filter((entry) => entry.targetId === invitationId || entry.metadata?.invitationId === invitationId)
    assert.deepEqual(invitationAudits.map((entry) => entry.action).sort(), ['staff.invitation.created', 'staff.invitation.redeemed'])
    assert.equal(invitationAudits.find((entry) => entry.action === 'staff.invitation.created').metadata.operatorId, 'deployment-operator-test')
    assert.equal(JSON.stringify(invitationAudits).includes(token), false)
    assert.equal(JSON.stringify(invitationAudits).includes(tokenHash), false)
    assert.equal(JSON.stringify(invitationAudits).includes(email), false)
    assert.equal(JSON.stringify(invitationAudits).includes(mobile), false)

    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: 'SecurePass123!' }),
    })
    assert.equal(loginResponse.status, 200)
    assert.equal((await loginResponse.json()).user.role, 'staff')
  } finally {
    server.close()
  }
})

test('expired, invalid-password, and missing staff invitations cannot create staff accounts', async () => {
  const { server, baseUrl } = await createTestServer()
  const expiredToken = randomBytes(32).toString('base64url')
  const validToken = randomBytes(32).toString('base64url')
  const now = Date.now()
  await jsonDb.createStaffInvitation({
    id: randomUUID(),
    tokenHash: createHash('sha256').update(expiredToken).digest('hex'),
    email: `expired.${randomUUID()}@example.com`,
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    createdAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
  })
  const pendingId = randomUUID()
  await jsonDb.createStaffInvitation({
    id: pendingId,
    tokenHash: createHash('sha256').update(validToken).digest('hex'),
    email: `pending.${randomUUID()}@example.com`,
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  })

  try {
    for (const body of [
      { token: expiredToken, firstName: 'Test', lastName: 'Person', password: 'SecurePass123!' },
      { token: validToken, firstName: 'Test', lastName: 'Person', password: 'weak' },
      { firstName: 'Test', lastName: 'Person', password: 'SecurePass123!' },
    ]) {
      const response = await fetch(`${baseUrl}/api/staff-invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      assert.equal(response.status, 400)
    }

    const stored = await jsonDb.readDb()
    assert.equal(stored.users.filter((user) => user.role === 'staff').length, 0)
    assert.equal(stored.staffInvitations.find((item) => item.id === pendingId).acceptedAt, null)
  } finally {
    server.close()
  }
})

test('staff invitation issuance rejects existing accounts and duplicate pending identities', async () => {
  const resident = {
    id: randomUUID(),
    firstName: 'Existing',
    lastName: 'Resident',
    email: `existing.${randomUUID()}@example.com`,
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    passwordHash: 'not-a-login-hash',
    role: 'resident',
    status: 'Pending Verification',
  }
  await jsonDb.saveUser(resident)
  await assert.rejects(
    jsonDb.createStaffInvitation({
      id: randomUUID(),
      tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      email: resident.email.toUpperCase(),
      mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    /STAFF_INVITATION_ACCOUNT_EXISTS/
  )

  const sharedEmail = `duplicate.${randomUUID()}@example.com`
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await jsonDb.createStaffInvitation({
    id: randomUUID(),
    tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    email: sharedEmail,
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    createdAt: new Date().toISOString(),
    expiresAt,
  })
  await assert.rejects(
    jsonDb.createStaffInvitation({
      id: randomUUID(),
      tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      email: sharedEmail,
      mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      createdAt: new Date().toISOString(),
      expiresAt,
    }),
    /STAFF_INVITATION_ALREADY_PENDING/
  )
})

test('staff can review pending resident accounts but emergency Admin cannot', async () => {
  const { server, baseUrl } = await createTestServer()
  const residentEmail = `staff-review.${Date.now()}@example.com`
  const staff = {
    id: randomUUID(),
    firstName: 'Account',
    lastName: 'Reviewer',
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `reviewer.${Date.now()}@example.com`,
    passwordHash: await hashPassword('StaffPass123!'),
    role: 'staff',
    status: 'On Duty',
  }

  try {
    await jsonDb.saveUser(staff)
    const registerResponse = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Pending',
        lastName: 'Resident',
        mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: residentEmail,
        password: 'ResidentPass123!',
      }),
    })
    assert.equal(registerResponse.status, 201)
    const residentId = (await registerResponse.json()).user.id

    const staffLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'StaffPass123!' }),
    })
    const adminLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: ADMIN_SEED.email, password: ADMIN_SEED.password }),
    })
    assert.equal(staffLogin.status, 200)
    assert.equal(adminLogin.status, 200)
    const staffToken = (await staffLogin.json()).token
    const adminToken = (await adminLogin.json()).token
    const staffHeaders = { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' }
    const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }

    const pending = await fetch(`${baseUrl}/api/staff/account-approvals`, { headers: staffHeaders })
    assert.equal(pending.status, 200)
    assert.equal((await pending.json()).approvals.some((account) => account.id === residentId), true)
    assert.equal((await fetch(`${baseUrl}/api/staff/account-approvals`, { headers: adminHeaders })).status, 403)

    const activation = await fetch(`${baseUrl}/api/admin/emergency-access`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ reason: 'Staff review access boundary verification.', currentPassword: ADMIN_SEED.password }),
    })
    assert.equal(activation.status, 201)
    const deniedAdminDecision = await fetch(`${baseUrl}/api/staff/account-approvals/${residentId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'Active Resident' }),
    })
    assert.equal(deniedAdminDecision.status, 403)

    const invalidDecision = await fetch(`${baseUrl}/api/staff/account-approvals/${residentId}`, {
      method: 'PATCH',
      headers: staffHeaders,
      body: JSON.stringify({ status: 'admin' }),
    })
    assert.equal(invalidDecision.status, 400)
    const decision = await fetch(`${baseUrl}/api/staff/account-approvals/${residentId}`, {
      method: 'PATCH',
      headers: staffHeaders,
      body: JSON.stringify({ status: 'Active Resident' }),
    })
    assert.equal(decision.status, 200)
    assert.equal((await jsonDb.findUserById(residentId)).status, 'Active Resident')
    assert.equal((await jsonDb.listAuditLogs(10)).some((entry) => entry.action === 'resident_account.approved'), true)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('admin cannot update resident accounts while in monitoring mode', async () => {
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
    assert.equal((await jsonDb.findUserById(residentId)).role, 'resident')
    return

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
    assert.ok(usersData.users.some((user) => user.id === residentId && user.role === 'staff'))
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('staff cannot create staff accounts', async () => {
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

    const createResponse = await fetch(`${baseUrl}/api/staff/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({
        firstName: 'Unauthorized',
        lastName: 'Staff',
        email: `unauthorized.${Date.now()}@example.com`,
        mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
      }),
    })

    assert.equal(createResponse.status, 403)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('admin cannot create staff accounts while in monitoring mode', async () => {
  const { server, baseUrl } = await createTestServer()
  const email = `secretary.${Date.now()}@example.com`
  const mobile = `091${Math.floor(10000000 + Math.random() * 90000000)}`

  try {
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
    assert.equal(createResponse.status, 403)
    return
    const { staffMember } = await createResponse.json()
    assert.equal(staffMember.position, 'Secretary')

    const staffLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: 'StaffPass123!' }),
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

test('admin cannot change the captain photo while in monitoring mode', async () => {
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
      assert.equal(photoResponse.status, 404)
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
    assert.equal(adminResponse.status, 403)
    return

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

test('admin cannot delete staff or administrator accounts while in monitoring mode', async () => {
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
    assert.equal(residentDeleteResponse.status, 403)

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

test('admin cannot archive a resident account while in monitoring mode', async () => {
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
    const forbiddenArchiveResponse = await fetch(`${baseUrl}/api/admin/residents/${resident.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${residentToken}` },
    })
    assert.equal(forbiddenArchiveResponse.status, 403)

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
    assert.equal(wrongTargetResponse.status, 403)

    const archiveResponse = await fetch(`${baseUrl}/api/admin/residents/${resident.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(archiveResponse.status, 403)
    assert.equal((await jsonDb.findUserById(resident.id)).status, 'Active Resident')
    assert.equal((await jsonDb.listRequestsForUser(resident.id)).some((request) => request.id === requestId), true)
    return

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

test('admin cannot archive residents by zone while in monitoring mode', async () => {
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

    assert.equal(zoneUpdateResponse.status, 403)

    const archiveResponse = await fetch(`${baseUrl}/api/admin/archive-users-by-zone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })

    assert.equal(archiveResponse.status, 403)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('reset password request sends a delivery webhook payload when configured', async () => {
  const originalDeliveryUrl = process.env.RESET_DELIVERY_URL
  const deliveryRequests = []
  const deliveryServer = await new Promise((resolve) => {
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        deliveryRequests.push({
          method: request.method,
          path: request.url,
          body: JSON.parse(body || '{}'),
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
      })
    })
    server.listen(0, () => resolve(server))
  })

  process.env.RESET_DELIVERY_URL = `http://127.0.0.1:${deliveryServer.address().port}`
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
  } finally {
    if (originalDeliveryUrl === undefined) delete process.env.RESET_DELIVERY_URL
    else process.env.RESET_DELIVERY_URL = originalDeliveryUrl
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

test('staff resident registry keeps pending records out of verified totals and requires duplicate review', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Registry',
    lastName: 'Staff',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `registry.staff.${Date.now()}@example.com`,
    passwordHash: await hashPassword('RegistryPass123!'),
    role: 'staff',
    status: 'On Duty',
    zone: 1,
  }

  try {
    await jsonDb.saveUser(staff)
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'RegistryPass123!' }),
    })
    const { token } = await loginResponse.json()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    const createResponse = await fetch(`${baseUrl}/api/staff/residents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'Ana',
        lastName: 'Santos',
        birthDate: '2000-05-20',
        sex: 'Female',
        householdId: 'HH-001',
        purok: 'Purok 3 Daya',
        zone: 3,
        sourceReference: 'Roster page 1',
      }),
    })
    assert.equal(createResponse.status, 201)
    const created = await createResponse.json()
    assert.equal(created.resident.verificationStatus, 'pending')
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
    const [todayYear, todayMonth, todayDay] = today.split('-').map(Number)
    const expectedAge = todayYear - 2000 - (todayMonth < 5 || (todayMonth === 5 && todayDay < 20) ? 1 : 0)
    assert.equal(created.resident.age, expectedAge)

    const persisted = JSON.parse(await fs.readFile(testDbPath, 'utf8'))
    const storedResident = persisted.residentRegistry[0]
    assert.ok(storedResident.encryptedData)
    assert.equal(JSON.stringify(storedResident).includes('Ana'), false)
    assert.equal(JSON.stringify(storedResident).includes('Santos'), false)
    assert.equal(JSON.stringify(storedResident).includes('HH-001'), false)

    const registryResponse = await fetch(`${baseUrl}/api/staff/residents?search=Ana`, { headers })
    assert.equal(registryResponse.status, 200)
    assert.equal((await registryResponse.json()).residents[0].firstName, 'Ana')
    const readAudit = (await jsonDb.listAuditLogs(10)).find((entry) => entry.action === 'resident_registry.read')
    assert.ok(readAudit)
    assert.equal(JSON.stringify(readAudit).includes('Ana'), false)
    assert.equal(JSON.stringify(readAudit).includes('Purok 3 Daya'), false)

    const duplicateResponse = await fetch(`${baseUrl}/api/staff/residents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'Ana',
        lastName: 'Santos',
        birthDate: '2000-05-20',
        sex: 'Female',
        householdId: 'HH-001',
        purok: 'Purok 3 Daya',
        zone: 3,
      }),
    })
    assert.equal(duplicateResponse.status, 409)
    assert.equal((await duplicateResponse.json()).potentialMatches.length, 1)

    const pendingTotalsResponse = await fetch(`${baseUrl}/api/staff/demographics?zone=3&purok=Purok%203%20Daya`, { headers })
    assert.equal(pendingTotalsResponse.status, 200)
    assert.equal((await pendingTotalsResponse.json()).overall.total, 0)

    const verifyResponse = await fetch(`${baseUrl}/api/staff/residents/${created.resident.id}/verify`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ verificationStatus: 'verified' }),
    })
    assert.equal(verifyResponse.status, 200)

    const verifiedTotalsResponse = await fetch(`${baseUrl}/api/staff/demographics?zone=3&purok=Purok%203%20Daya`, { headers })
    const verifiedTotals = await verifiedTotalsResponse.json()
    assert.equal(verifiedTotals.overall.total, 1)
    assert.equal(verifiedTotals.overall.female, 1)
    assert.equal(verifiedTotals.byPurok[0].purok, 'Purok 3 Daya')
    assert.equal(verifiedTotals.byHousehold[0].householdId, 'HH-001')

    const invalidZone = await fetch(`${baseUrl}/api/staff/residents?zone=8`, { headers })
    assert.equal(invalidZone.status, 400)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test('staff source-review warnings are protected, deduplicated, auditable, and resolvable', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Source',
    lastName: 'Reviewer',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `source.reviewer.${Date.now()}@example.com`,
    passwordHash: await hashPassword('SourceReviewPass123!'),
    role: 'staff',
    status: 'On Duty',
    zone: 1,
  }

  try {
    await jsonDb.saveUser(staff)
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'SourceReviewPass123!' }),
    })
    assert.equal(loginResponse.status, 200)
    const { token } = await loginResponse.json()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const endpoint = `${baseUrl}/api/staff/registry-source-reviews`

    assert.equal((await fetch(endpoint)).status, 401)

    const createResponse = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ zone: 2, purok: 'Purok 4' }),
    })
    assert.equal(createResponse.status, 201)
    const created = await createResponse.json()
    assert.equal(created.review.status, 'open')
    assert.equal(created.review.zone, 2)
    assert.equal(Object.hasOwn(created.review, 'createdBy'), false)

    const duplicateResponse = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ zone: 2, purok: 'purok 4' }),
    })
    assert.equal(duplicateResponse.status, 200)
    assert.equal((await duplicateResponse.json()).created, false)

    const listResponse = await fetch(endpoint, { headers })
    assert.equal(listResponse.status, 200)
    assert.equal((await listResponse.json()).reviews.length, 1)

    const resolveResponse = await fetch(`${endpoint}/${created.review.id}/resolve`, { method: 'PATCH', headers })
    assert.equal(resolveResponse.status, 200)
    assert.equal((await resolveResponse.json()).review.status, 'resolved')

    const remainingResponse = await fetch(endpoint, { headers })
    assert.deepEqual((await remainingResponse.json()).reviews, [])
    const auditActions = (await jsonDb.listAuditLogs(10)).map((entry) => entry.action)
    assert.ok(auditActions.includes('resident_registry.source_review_opened'))
    assert.ok(auditActions.includes('resident_registry.source_review_resolved'))
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test('admin emergency access is password-confirmed, scoped, audited, and revocable', async () => {
  const { server, baseUrl } = await createTestServer()
  const admin = (await jsonDb.listAllUsers()).find((user) => user.role === 'admin')

  try {
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: admin.email, password: ADMIN_SEED.password }),
    })
    assert.equal(loginResponse.status, 200)
    const { token } = await loginResponse.json()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    const deniedDashboard = await fetch(`${baseUrl}/api/staff/dashboard-requests`, { headers })
    assert.equal(deniedDashboard.status, 403)
    const deniedGeneralRequests = await fetch(`${baseUrl}/api/requests`, { headers })
    assert.equal(deniedGeneralRequests.status, 403)
    const deniedRegistry = await fetch(`${baseUrl}/api/staff/residents`, { headers })
    assert.equal(deniedRegistry.status, 403)
    const deniedDemographics = await fetch(`${baseUrl}/api/staff/demographics`, { headers })
    assert.equal(deniedDemographics.status, 403)
    const accountManagement = await fetch(`${baseUrl}/api/admin/users`, { headers })
    assert.equal(accountManagement.status, 200)
    const accountUpdate = await fetch(`${baseUrl}/api/admin/users/${admin.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'Disabled' }),
    })
    assert.equal(accountUpdate.status, 403)
    const announcementManagement = await fetch(`${baseUrl}/api/announcements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Preview notice', content: 'Admin announcements are read-only.' }),
    })
    assert.equal(announcementManagement.status, 403)

    const badPassword = await fetch(`${baseUrl}/api/admin/emergency-access`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Urgent staff absence requiring request processing.', currentPassword: 'wrong-password' }),
    })
    assert.equal(badPassword.status, 401)

    const activationResponse = await fetch(`${baseUrl}/api/admin/emergency-access`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Urgent staff absence requiring request processing.', currentPassword: ADMIN_SEED.password }),
    })
    assert.equal(activationResponse.status, 201)
    const activated = await activationResponse.json()
    assert.equal(activated.grant.isOwnGrant, true)
    assert.deepEqual(activated.grant.scopes, ['resident-registry.read', 'resident-registry.manage', 'request-processing'])
    assert.ok(new Date(activated.grant.expiresAt).getTime() > Date.now())
    const concurrentActivation = await fetch(`${baseUrl}/api/admin/emergency-access`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Urgent staff absence requiring request processing.', currentPassword: ADMIN_SEED.password }),
    })
    assert.equal(concurrentActivation.status, 409)

    const allowedDashboard = await fetch(`${baseUrl}/api/staff/dashboard-requests`, { headers })
    assert.equal(allowedDashboard.status, 200)
    assert.equal((await fetch(`${baseUrl}/api/staff/residents`, { headers })).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/staff/demographics`, { headers })).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/admin/users/${admin.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'Disabled' }),
    })).status, 403)
    assert.equal((await fetch(`${baseUrl}/api/announcements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Emergency bypass attempt', content: 'Should remain blocked.' }),
    })).status, 403)
    const statusResponse = await fetch(`${baseUrl}/api/admin/emergency-access`, { headers })
    assert.equal((await statusResponse.json()).active, true)

    const revokeResponse = await fetch(`${baseUrl}/api/admin/emergency-access/revoke`, { method: 'POST', headers })
    assert.equal(revokeResponse.status, 200)
    const deniedAfterRevoke = await fetch(`${baseUrl}/api/staff/dashboard-requests`, { headers })
    assert.equal(deniedAfterRevoke.status, 403)
    assert.equal((await fetch(`${baseUrl}/api/staff/residents`, { headers })).status, 403)

    const secondActivation = await fetch(`${baseUrl}/api/admin/emergency-access`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Urgent staff absence requiring request processing.', currentPassword: ADMIN_SEED.password }),
    })
    assert.equal(secondActivation.status, 201)
    const database = await jsonDb.readDb()
    database.emergencyAccessGrants.at(-1).expiresAt = new Date(Date.now() - 1000).toISOString()
    await jsonDb.writeDb(database)
    const expiredStatus = await fetch(`${baseUrl}/api/admin/emergency-access`, { headers })
    assert.equal((await expiredStatus.json()).active, false)
    const deniedAfterExpiry = await fetch(`${baseUrl}/api/staff/dashboard-requests`, { headers })
    assert.equal(deniedAfterExpiry.status, 403)

    const logs = await jsonDb.listAuditLogs(50)
    assert.ok(logs.some((entry) => entry.action === 'emergency_access.activated'))
    assert.ok(logs.some((entry) => entry.action === 'emergency_access.used'))
    assert.ok(logs.some((entry) => entry.action === 'emergency_access.revoked'))
    assert.ok(logs.some((entry) => entry.action === 'emergency_access.denied'))
    assert.ok(logs.some((entry) => entry.action === 'admin.read_only.denied'))
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test('registry CSV import validates every row, pauses on duplicates, and audits only the batch', async () => {
  const { server, baseUrl } = await createTestServer()
  const staff = {
    id: randomUUID(),
    firstName: 'Registry',
    lastName: 'Importer',
    mobile: `092${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `registry.import.${Date.now()}@example.com`,
    passwordHash: await hashPassword('RegistryPass123!'),
    role: 'staff',
    status: 'On Duty',
    zone: 1,
  }

  try {
    await jsonDb.saveUser(staff)
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: staff.email, password: 'RegistryPass123!' }),
    })
    const { token } = await login.json()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const file = 'purok-3-roster.csv'
    const residents = [
      { firstName: 'Lina', lastName: 'Reyes', birthDate: '1988-02-29', sex: 'Female', householdId: 'HH-03-01', zone: '3', purok: 'Purok 3 Daya', sourceReference: 'Page 1 row 2' },
      { firstName: 'Marco', lastName: 'Reyes', birthDate: null, sex: null, householdId: 'HH-03-01', zone: '3', purok: 'Purok 3 Daya', sourceReference: 'Page 1 row 3' },
    ]

    const invalidResponse = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename: file, residents: [{ ...residents[0], zone: '8' }] }),
    })
    assert.equal(invalidResponse.status, 400)
    assert.equal(((await jsonDb.readDb()).residentRegistry || []).length, 0)

    const importResponse = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename: file, residents }),
    })
    assert.equal(importResponse.status, 201)
    const imported = await importResponse.json()
    assert.equal(imported.imported, 2)
    assert.equal(imported.verificationStatus, 'pending')

    const duplicateResponse = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename: file, residents: [residents[0]] }),
    })
    assert.equal(duplicateResponse.status, 409)
    const duplicateBody = await duplicateResponse.json()
    assert.equal(duplicateBody.reviewRequired, true)
    assert.equal(duplicateBody.potentialMatches[0].row, 2)
    assert.equal(((await jsonDb.readDb()).residentRegistry || []).length, 2)

    const confirmedResponse = await fetch(`${baseUrl}/api/staff/residents/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename: file, residents: [residents[0]], confirmPotentialMatches: true }),
    })
    assert.equal(confirmedResponse.status, 201)
    assert.equal(((await jsonDb.readDb()).residentRegistry || []).length, 3)

    const printAudit = await fetch(`${baseUrl}/api/staff/residents/print-audit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ count: 3, filters: { zone: '3', purok: 'Purok 3 Daya', page: 1 } }),
    })
    assert.equal(printAudit.status, 503)
    const logs = await jsonDb.listAuditLogs(10)
    const importLogs = logs.filter((entry) => entry.action === 'resident_registry.bulk_imported')
    const printLog = logs.find((entry) => entry.action === 'resident_registry.print.blocked')
    assert.ok(importLogs.some((entry) => entry.metadata.count === 2))
    assert.ok(importLogs.every((entry) => !JSON.stringify(entry).includes('Lina')))
    assert.ok(importLogs.every((entry) => !JSON.stringify(entry).includes(file)))
    assert.equal(printLog.metadata.recordCount, 3)
    assert.equal(JSON.stringify(printLog).includes('Lina'), false)
    assert.equal(JSON.stringify(printLog).includes('Purok 3 Daya'), false)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
