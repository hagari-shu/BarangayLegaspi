import fs from 'fs'

const API = 'http://localhost:3001/api'

async function login(identifier, password) {
  const resp = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  const data = await resp.json()
  return { ok: resp.ok, data }
}

async function createRequest(token, type = 'Certificate', purpose = 'Test Smoke') {
  const resp = await fetch(`${API}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, purpose, notes: 'Automated smoke test' }),
  })
  return { ok: resp.ok, data: await resp.json() }
}

async function approveRequest(token, requestId) {
  const resp = await fetch(`${API}/requests/${requestId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'Approved' }),
  })
  return { ok: resp.ok, data: await resp.json() }
}

async function archiveApprovals(token, days = 0) {
  const resp = await fetch(`${API}/admin/archive-approvals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ days }),
  })
  return { ok: resp.ok, data: await resp.json() }
}

async function listArchives() {
  const dir = 'server/data/archives'
  try {
    const files = fs.readdirSync(dir)
    return files
  } catch (e) {
    return { error: String(e) }
  }
}

async function run() {
  console.log('1) Login as resident...')
  let r = await login('maria.delacruz@email.com', 'SecurePass123')
  console.log(' resident login ok=', r.ok)
  if (!r.ok) { console.log(' resident login failed', r.data); return }
  const residentToken = r.data.token

  console.log('2) Create request...')
  r = await createRequest(residentToken)
  console.log(' create request ok=', r.ok, 'resp=', r.data)
  if (!r.ok) { console.log('create failed'); return }
  const requestId = r.data.request?.id
  if (!requestId) { console.log('no request id returned'); return }

  console.log('3) Login as staff...')
  r = await login('staff@barangay.gov.ph', 'StaffPass123')
  console.log(' staff login ok=', r.ok)
  if (!r.ok) { console.log(' staff login failed', r.data); return }
  const staffToken = r.data.token

  console.log('4) Approve request as staff...')
  r = await approveRequest(staffToken, requestId)
  console.log(' approve ok=', r.ok, 'resp=', r.data)
  if (!r.ok) { console.log('approve failed', r.data); return }

  console.log('5) Login as admin...')
  r = await login('admin@barangay.gov.ph', 'AdminPass123')
  console.log(' admin login ok=', r.ok)
  if (!r.ok) { console.log(' admin login failed', r.data); return }
  const adminToken = r.data.token

  console.log('6) Archive approvals with days=0 (force archive of recent).')
  r = await archiveApprovals(adminToken, 0)
  console.log(' archive ok=', r.ok, 'resp=', r.data)

  console.log('7) List archive files on disk:')
  const files = await listArchives()
  console.log(files)
}

run().catch(e => { console.error('smoke test error', e) })
