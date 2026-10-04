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

test('payment endpoints do not expose or mutate fictitious invoice records', async () => {
  const { server, baseUrl } = await createTestServer()

  try {
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
    const paymentId = 'INV-1049'

    const listResponse = await fetch(`${baseUrl}/api/payments`, {
      headers: {
        Authorization: `Bearer ${adminSession.token}`,
      },
    })
    assert.equal(listResponse.status, 200)
    assert.deepEqual((await listResponse.json()).payments, [])

    const approvalResponse = await fetch(`${baseUrl}/api/payments/${paymentId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSession.token}`,
      },
      body: JSON.stringify({ status: 'Approved' }),
    })

    assert.equal(approvalResponse.status, 404)
    assert.equal((await approvalResponse.json()).message, 'Payment record not found.')
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
