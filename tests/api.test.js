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
import { randomUUID } from 'node:crypto'

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

test('authenticated roles save private quality ratings and admins receive anonymous aggregates only', async () => {
  const { server, baseUrl } = await createTestServer()
  const staffPassword = 'StaffPass123!'
  await jsonDb.saveUser({
    id: randomUUID(),
    firstName: 'Quality',
    lastName: 'Staff',
    mobile: `091${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `quality.staff.${Date.now()}@example.com`,
    passwordHash: await hashPassword(staffPassword),
    role: 'staff',
    status: 'On Duty',
    createdAt: new Date().toISOString(),
  })

  const database = await jsonDb.readDb()
  const staff = database.users.find((user) => user.role === 'staff' && user.email.startsWith('quality.staff.'))

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
    const [residentToken, staffToken, adminToken] = await Promise.all([
      login('maria.delacruz@email.com', 'ResidentPass123!'),
      login(staff.email, staffPassword),
      login('admin@barangay.gov.ph', 'AdminPass123'),
    ])
    const factorScores = (correctness) => ({
      correctness,
      reliability: null,
      efficiency: null,
      integrity: null,
      usability: null,
      maintainability: null,
      flexibility: null,
      testability: null,
      portability: null,
      reusability: null,
      interoperability: null,
    })
    const save = (token, scores) => fetch(`${baseUrl}/api/quality-assessment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scores, notes: { correctness: 'This private browser note must not reach the API.' } }),
    })

    assert.equal((await fetch(`${baseUrl}/api/quality-assessment`)).status, 401)
    assert.equal((await save(residentToken, { ...factorScores(5), unsupported: 4 })).status, 400)

    for (const [token, score] of [[residentToken, 5], [staffToken, 3], [adminToken, 1]]) {
      const saveResponse = await save(token, factorScores(score))
      assert.equal(saveResponse.status, 200)
      const saveData = await saveResponse.json()
      assert.equal(saveData.assessment.scores.correctness, score)

      const ownAssessmentResponse = await fetch(`${baseUrl}/api/quality-assessment`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      assert.equal(ownAssessmentResponse.status, 200)
      assert.equal((await ownAssessmentResponse.json()).assessment.scores.correctness, score)
    }

    const aggregateResponse = await fetch(`${baseUrl}/api/admin/quality-assessments`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(aggregateResponse.status, 200)
    const { summary } = await aggregateResponse.json()
    assert.equal(summary.responseCount, 3)
    assert.equal(summary.totalRatings, 3)
    assert.equal(summary.average, 3)
    assert.equal(summary.factors.correctness.average, 3)
    assert.equal(summary.factors.correctness.ratedCount, 3)
    assert.equal(JSON.stringify(summary).includes(staff.email), false)
    assert.equal(JSON.stringify(summary).includes('private browser note'), false)

    const forbiddenSummaryResponse = await fetch(`${baseUrl}/api/admin/quality-assessments`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    })
    assert.equal(forbiddenSummaryResponse.status, 403)

    const storedAssessments = await jsonDb.listQualityAssessments()
    assert.equal(storedAssessments.length, 3)
    assert.equal(JSON.stringify(storedAssessments).includes('private browser note'), false)
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
