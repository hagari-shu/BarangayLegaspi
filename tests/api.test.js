import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp, seedDemoResident } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import * as jsonDb from '../server/db.js'
import { DB_PATH } from '../server/config.js'
import { isCaptainPhotoStorageConfigured } from '../server/captain-photo-storage.js'
import { createHmac, randomUUID } from 'node:crypto'
import { createTotpSecret, encryptTotpSecret } from '../server/mfa.js'

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

test('admin can update user role and status', async () => {
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

    assert.equal(updateResponse.status, 200)
    const updateData = await updateResponse.json()
    assert.equal(updateData.user.role, 'staff')
    assert.equal(updateData.user.status, 'On Duty')
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

test('admin-assigned staff positions persist in login profiles and the staff directory', async () => {
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
    assert.equal(createResponse.status, 201)
    const { staffMember } = await createResponse.json()
    assert.equal(staffMember.role, 'staff')
    assert.equal(staffMember.status, 'On Duty')
    assert.equal(staffMember.password, undefined)
    assert.equal(staffMember.passwordHash, undefined)
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
