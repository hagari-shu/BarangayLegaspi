import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { hashPassword } from './auth.js'

const { Pool } = pg
const jsonDbPath = path.join(process.cwd(), 'server', 'data', 'db.json')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
})

const normalizeUser = (user = null) => {
  if (!user) return null
  return {
   ...user,
   firstName: user.firstName ?? user.first_name ?? '',
   lastName: user.lastName ?? user.last_name ?? '',
   householdId: user.householdId ?? user.household_id ?? null,
   familyMembers: user.familyMembers ?? user.family_members ?? null,
   passwordHash: user.passwordHash ?? user.password_hash ?? null,
   createdAt: user.createdAt ?? user.created_at ?? null,
   zone: user.zone ?? user.zone_number ?? null,
  }
}

export async function readDb() {
  try {
   const raw = await fs.readFile(jsonDbPath, 'utf8')
   return JSON.parse(raw)
  } catch {
   return { users: [], requests: [], reports: [], approvals: [] }
  }
}

export async function writeDb(data) {
  await fs.mkdir(path.dirname(jsonDbPath), { recursive: true })
  await fs.writeFile(jsonDbPath, JSON.stringify(data, null, 2), 'utf8')
  return data
}

export async function query(text, params = []) {
  const client = await pool.connect()

  try {
    return await client.query(text, params)
  } finally {
    client.release()
  }
}

export async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      mobile VARCHAR(20) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(30) NOT NULL DEFAULT 'resident',
      household_id VARCHAR(50),
      family_members INTEGER DEFAULT 4,
      status VARCHAR(80) DEFAULT 'Active Resident',
      address TEXT,
      zone INTEGER,
      position VARCHAR(120),
      availability VARCHAR(50) DEFAULT 'Available',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS requests (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(100) NOT NULL,
      purpose TEXT NOT NULL,
      notes TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ')

  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY,
      actor_id UUID,
      actor_role VARCHAR(30),
      action VARCHAR(100) NOT NULL,
      target_type VARCHAR(50),
      target_id VARCHAR(100),
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  const adminCheck = await query('SELECT id FROM users WHERE email = $1', ['admin@barangay.gov.ph'])
  if (adminCheck.rows.length === 0) {
    const { randomUUID } = await import('node:crypto')
    await query(
      `INSERT INTO users (id, first_name, last_name, mobile, email, password_hash, role, household_id, family_members, status, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        'Carmen',
        'Santos',
        '09999999999',
        'admin@barangay.gov.ph',
        await hashPassword('AdminPass123'),
        'admin',
        '2024-ADMIN',
        1,
        'Administrator',
        'Barangay Hall, Legaspi',
      ]
    )
  }
}

export async function findUserByIdentifier(identifier) {
  const value = String(identifier).trim()

  try {
    const result = await query(
      `SELECT * FROM users WHERE mobile = $1 OR email = $2 LIMIT 1`,
      [value, value.toLowerCase()]
    )
    if (result.rows[0]) return normalizeUser(result.rows[0])
  } catch (error) {
    console.warn('findUserByIdentifier fallback triggered', error.message)
  }

  const db = await readDb()
  return db.users.find((user) => user.mobile === value || String(user.email || '').toLowerCase() === value.toLowerCase()) || null
}

export async function findUserById(id) {
  try {
    const result = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id])
    if (result.rows[0]) return normalizeUser(result.rows[0])
  } catch (error) {
    console.warn('findUserById fallback triggered', error.message)
  }

  const db = await readDb()
  return db.users.find((user) => user.id === id) || null
}

export async function createUser(user) {
  const { id, firstName, lastName, mobile, email, passwordHash, role, householdId, familyMembers, status, address, zone, position, availability } = user
  try {
    await query(
      `INSERT INTO users (id, first_name, last_name, mobile, email, password_hash, role, household_id, family_members, status, address, zone, position, availability)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, firstName, lastName, mobile, email, passwordHash, role, householdId, familyMembers, status, address, zone ?? null, position ?? null, availability ?? 'Available']
    )
    return { ...user, firstName, lastName, mobile, email }
  } catch (error) {
    console.warn('createUser fallback triggered', error.message)
    const db = await readDb()
    db.users = db.users || []
    db.users.push({
      ...user,
      firstName: user.firstName ?? user.first_name,
      lastName: user.lastName ?? user.last_name,
      householdId: user.householdId ?? user.household_id,
      familyMembers: user.familyMembers ?? user.family_members,
      passwordHash: user.passwordHash ?? user.password_hash,
      createdAt: user.createdAt ?? new Date().toISOString(),
    })
    await writeDb(db)
    return { ...user, firstName, lastName, mobile, email }
  }
}

export async function updateUser(userId, updates = {}) {
  const entries = Object.entries({
    passwordHash: updates.passwordHash ?? updates.password_hash,
    firstName: updates.firstName ?? updates.first_name,
    lastName: updates.lastName ?? updates.last_name,
    mobile: updates.mobile,
    email: updates.email,
    role: updates.role,
    status: updates.status,
    householdId: updates.householdId ?? updates.household_id,
    familyMembers: updates.familyMembers ?? updates.family_members,
    address: updates.address,
    zone: updates.zone,
    position: updates.position,
    availability: updates.availability,
  }).filter(([, value]) => value !== undefined && value !== null)

  if (entries.length === 0) {
    return null
  }

  const columns = {
    passwordHash: 'password_hash',
    firstName: 'first_name',
    lastName: 'last_name',
    mobile: 'mobile',
    email: 'email',
    role: 'role',
    status: 'status',
    householdId: 'household_id',
    familyMembers: 'family_members',
    address: 'address',
    zone: 'zone',
    position: 'position',
    availability: 'availability',
  }

  const assignments = entries.map(([key]) => `${columns[key]} = $${entries.indexOf([key, entries.find(([, value]) => value === updates[key] || value === updates[key])?.[1]]) + 1}`)

  try {
    const values = entries.map(([, value]) => value)
    const result = await query(
      `UPDATE users SET ${entries.map(([key], index) => `${columns[key]} = $${index + 1}`).join(', ')} WHERE id = $${entries.length + 1} RETURNING *`,
      [...values, userId]
    )
    return result.rows[0] ? normalizeUser(result.rows[0]) : null
  } catch (error) {
    console.warn('updateUser fallback triggered', error.message)
    const db = await readDb()
    const index = (db.users || []).findIndex((user) => user.id === userId)
    if (index === -1) return null
    db.users[index] = { ...db.users[index], ...updates }
    await writeDb(db)
    return { ...db.users[index] }
  }
}

export async function createRequest(request) {
  try {
    await query(
      `INSERT INTO requests (id, user_id, type, purpose, notes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [request.id, request.userId, request.type, request.purpose, request.notes || '', request.status, new Date(request.date || Date.now()).toISOString()]
    )
    return request
  } catch (error) {
    console.warn('createRequest fallback triggered', error.message)
    const db = await readDb()
    db.requests = db.requests || []
    db.requests.push(request)
    await writeDb(db)
    return request
  }
}

export async function deleteUser(userId) {
  try {
    const result = await query('DELETE FROM users WHERE id = $1 RETURNING *', [userId])
    return result.rows[0] ? normalizeUser(result.rows[0]) : null
  } catch (error) {
    console.warn('deleteUser fallback triggered', error.message)
    const db = await readDb()
    const user = (db.users || []).find((item) => item.id === userId)
    if (!user) return null
    await writeDb({ ...db, users: db.users.filter((item) => item.id !== userId) })
    return user
  }
}

export async function listRequestsForUser(userId) {
  try {
    const result = await query(
      `SELECT * FROM requests WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    )
    return result.rows
  } catch (error) {
    console.warn('listRequestsForUser fallback triggered', error.message)
    const db = await readDb()
    return (db.requests || []).filter((request) => request.userId === userId)
  }
}

export async function listAllRequests() {
  try {
    const result = await query(
      `SELECT r.*, u.first_name, u.last_name, u.email, u.mobile
       FROM requests r
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`
    )
    return result.rows
  } catch (error) {
    console.warn('listAllRequests fallback triggered', error.message)
    const db = await readDb()
    return db.requests || []
  }
}

export async function listAllUsers() {
  try {
    const result = await query(
      `SELECT id, first_name, last_name, mobile, email, role, status, household_id, family_members, address, created_at
       FROM users ORDER BY created_at DESC`
    )
    return result.rows.map(normalizeUser)
  } catch (error) {
    console.warn('listAllUsers fallback triggered', error.message)
    const db = await readDb()
    return (db.users || []).map((user) => ({
      ...user,
      firstName: user.firstName ?? user.first_name,
      lastName: user.lastName ?? user.last_name,
      householdId: user.householdId ?? user.household_id,
      familyMembers: user.familyMembers ?? user.family_members,
      createdAt: user.createdAt ?? user.created_at,
    }))
  }
}

export async function updateRequestStatus(requestId, status) {
  try {
    const result = await query(
      `UPDATE requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, requestId]
    )
    return result.rows[0] || null
  } catch (error) {
    console.warn('updateRequestStatus fallback triggered', error.message)
    const db = await readDb()
    const request = (db.requests || []).find((item) => item.id === requestId)
    if (!request) return null
    const previousStatus = request.status
    request.status = status
    request.updatedAt = new Date().toISOString()
    await writeDb({ ...db, requests: (db.requests || []).map((item) => item.id === requestId ? request : item) })
    return { ...request, previousStatus }
  }
}

export async function addApproval(approval) {
  const db = await readDb()
  db.approvals = db.approvals || []
  db.approvals.push(approval)
  await writeDb(db)
  return approval
}

export async function listApprovals() {
  const db = await readDb()
  return db.approvals || []
}

export async function addAuditLog(entry) {
  try {
    const result = await query(
      `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [entry.id, entry.actorId || null, entry.actorRole || null, entry.action, entry.targetType || null, entry.targetId || null, entry.metadata || {}]
    )
    return result.rows[0]
  } catch (error) {
    console.warn('audit log fallback triggered', error.message)
    const db = await readDb()
    db.auditLogs = db.auditLogs || []
    db.auditLogs.push(entry)
    await writeDb(db)
    return entry
  }
}

export async function listAuditLogs(limit = 100) {
  try {
    const result = await query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1', [Math.max(1, Math.min(Number(limit) || 100, 500))])
    return result.rows
  } catch (error) {
    const db = await readDb()
    return (db.auditLogs || []).slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).reverse()
  }
}

export async function archiveApprovalsOlderThan(days = 7) {
  const db = await readDb()
  db.approvals = db.approvals || []

  let old = []
  if (days === 0) {
    old = db.approvals
  } else {
    const cutoff = Date.now() - Number(days) * 24 * 60 * 60 * 1000
    old = db.approvals.filter((approval) => new Date(approval.dateApproved).getTime() <= cutoff)
  }

  if (old.length === 0) return { count: 0, filename: null }

  const archiveDir = path.join(process.cwd(), 'server', 'data', 'archives')
  await fs.mkdir(archiveDir, { recursive: true })
  const from = new Date(Math.min(...old.map((item) => new Date(item.dateApproved).getTime()))).toISOString().slice(0, 10)
  const to = new Date(Math.max(...old.map((item) => new Date(item.dateApproved).getTime()))).toISOString().slice(0, 10)
  const filename = path.join(archiveDir, `approvals-${from}_to_${to}.json`)
  await fs.writeFile(filename, JSON.stringify(old, null, 2), 'utf8')

  db.approvals = db.approvals.filter((item) => !old.some((oldItem) => oldItem.id === item.id))
  await writeDb(db)

  return { filename, count: old.length }
}

export async function archiveProcessedRequestsOlderThan(days = 1) {
  const db = await readDb()
  db.requests = db.requests || []

  const processed = db.requests.filter((request) => ['Approved', 'Rejected'].includes(request.status))
  const daysValue = Number(days) || 1
  const cutoff = Date.now() - daysValue * 24 * 60 * 60 * 1000

  const old = daysValue === 0
    ? processed
    : processed.filter((request) => {
        const source = request.updatedAt || request.date || request.createdAt || new Date().toISOString()
        const timestamp = new Date(source).getTime()
        return Number.isFinite(timestamp) && timestamp <= cutoff
      })

  if (old.length === 0) {
    return { count: 0, filename: null, archivedAt: null }
  }

  const archiveDir = path.join(process.cwd(), 'server', 'data', 'archives')
  await fs.mkdir(archiveDir, { recursive: true })

  const today = new Date().toISOString().slice(0, 10)
  const filename = path.join(archiveDir, `queue-approvals-${today}.json`)
  const payload = {
    archivedAt: new Date().toISOString(),
    archivedFor: daysValue === 0 ? 'manual' : `${daysValue} day(s)`,
    total: old.length,
    records: old,
  }
  await fs.writeFile(filename, JSON.stringify(payload, null, 2), 'utf8')

  db.requests = db.requests.filter((request) => !old.some((archived) => archived.id === request.id))
  await writeDb(db)

  return { count: old.length, filename, archivedAt: payload.archivedAt }
}

export async function clearData(options = { keepAdmins: true }) {
  const db = await readDb()
  if (options.keepAdmins) {
    db.users = (db.users || []).filter((user) => ['admin', 'staff'].includes(user.role))
  } else {
    db.users = []
  }
  db.requests = []
  db.reports = []
  db.approvals = []
  await writeDb(db)
  return true
}
