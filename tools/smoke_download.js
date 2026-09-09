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

async function createRequest(token, type = 'Certificate', purpose = 'Test Smoke Download') {
  const resp = await fetch(`${API}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, purpose, notes: 'Automated smoke download test' }),
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

async function listArchives(token) {
  const resp = await fetch(`${API}/admin/archives`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await resp.json()
  return { ok: resp.ok, data }
}

async function downloadArchive(token, name, outPath) {
  const url = `${API}/admin/archive-file?name=${encodeURIComponent(name)}`
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) throw new Error('Download failed: ' + resp.status)
  const buffer = await resp.arrayBuffer()
  fs.writeFileSync(outPath, Buffer.from(buffer))
}

async function run() {
  console.log('Login resident')
  let r = await login('maria.delacruz@email.com', 'SecurePass123')
  if (!r.ok) { console.error('resident login failed', r.data); return }
  const residentToken = r.data.token

  console.log('Create request')
  r = await createRequest(residentToken)
  if (!r.ok) { console.error('create request failed', r.data); return }
  const requestId = r.data.request?.id
  console.log('requestId', requestId)

  console.log('Login staff')
  r = await login('staff@barangay.gov.ph', 'StaffPass123')
  if (!r.ok) { console.error('staff login failed', r.data); return }
  const staffToken = r.data.token

  console.log('Approve request')
  r = await approveRequest(staffToken, requestId)
  if (!r.ok) { console.error('approve failed', r.data); return }

  console.log('Login admin')
  r = await login('admin@barangay.gov.ph', 'AdminPass123')
  if (!r.ok) { console.error('admin login failed', r.data); return }
  const adminToken = r.data.token

  console.log('Archive approvals (days=0)')
  r = await archiveApprovals(adminToken, 0)
  console.log('archive response', r.data)

  console.log('List archives')
  r = await listArchives(adminToken)
  if (!r.ok) { console.error('list archives failed', r.data); return }
  const archives = r.data.archives || []
  console.log('archives found:', archives.length)
  if (archives.length === 0) { console.error('No archives to download'); return }
  const newest = archives[0].name
  console.log('Downlading newest archive', newest)

  const outPath = 'tools/downloaded_archive.json'
  await downloadArchive(adminToken, newest, outPath)
  console.log('Downloaded to', outPath)

  const head = fs.readFileSync(outPath, 'utf8').slice(0, 800)
  console.log('Head of downloaded file:\n', head)
}

run().catch(e => { console.error('smoke download error', e) })
