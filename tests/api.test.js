import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import * as jsonDb from '../server/db.js'
import { randomUUID } from 'node:crypto'

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
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
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
      }),
    })

    assert.equal(updateResponse.status, 200)
    const updateData = await updateResponse.json()
    assert.equal(updateData.user.role, 'staff')
    assert.equal(updateData.user.status, 'On Duty')
    assert.equal(updateData.user.zone, 4)

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
