import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp, seedDemoResident } from '../server/app.js'
import { DB_PATH } from '../server/config.js'

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

test('resident can schedule and fetch due reminders', async () => {
  const { server, baseUrl } = await createTestServer()
  const testEmail = `reminder.${Date.now()}@example.com`
  const testMobile = `091${Math.floor(10000000 + Math.random() * 90000000)}`

  try {
    const residentRegister = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Reminder',
        lastName: 'User',
        mobile: testMobile,
        email: testEmail,
        password: 'SecurePass123!',
        address: 'Barangay Legaspi, Tayug, Pangasinan',
        zone: 2,
      }),
    })
    assert.equal(residentRegister.status, 201)

    const adminLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@barangay.gov.ph',
        password: 'AdminPass123',
      }),
    })
    assert.equal(adminLogin.status, 200)
    const adminSession = await adminLogin.json()

    const residentUser = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminSession.token}` },
    })
    const residentList = await residentUser.json()
    const createdResident = residentList.users.find((user) => user.email === testEmail)

    if (!createdResident) {
      assert.fail('Resident was not created in the admin user list')
    }

    const approvalResponse = await fetch(`${baseUrl}/api/admin/users/${createdResident.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSession.token}`,
      },
      body: JSON.stringify({
        status: 'Active Resident',
        role: 'resident',
      }),
    })
    assert.equal(approvalResponse.status, 200)

    const residentSessionResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: testEmail,
        password: 'SecurePass123!',
      }),
    })
    assert.equal(residentSessionResponse.status, 200)
    const residentSession = await residentSessionResponse.json()

    const createRequest = await fetch(`${baseUrl}/api/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${residentSession.token}`,
      },
      body: JSON.stringify({
        type: 'Barangay Clearance',
        purpose: 'For school requirement',
        notes: 'Need follow-up due soon',
        deliveryMethod: 'online',
        deliveryNote: 'Please send digitally.',
      }),
    })
    assert.equal(createRequest.status, 201)
    const requestData = await createRequest.json()

    const reminderTime = new Date(Date.now() + 60_000).toISOString()
    const reminderResponse = await fetch(`${baseUrl}/api/requests/${requestData.request.id}/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${residentSession.token}`,
      },
      body: JSON.stringify({ scheduledAt: reminderTime }),
    })

    assert.equal(reminderResponse.status, 201)
    const reminderData = await reminderResponse.json()
    assert.equal(reminderData.reminder.requestId, requestData.request.id)

    const dueResponse = await fetch(`${baseUrl}/api/reminders?due=true`, {
      headers: { Authorization: `Bearer ${residentSession.token}` },
    })
    assert.equal(dueResponse.status, 200)
    const dueData = await dueResponse.json()
    assert.ok(Array.isArray(dueData.reminders))
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
