import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { hashPassword } from './auth.js'
import { ADMIN_SEED, IS_PRODUCTION, SHOULD_SKIP_SEED } from './config.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/i, '')

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
})

const normalizeUser = (user = null) => {
  if (!user) return null
  return {
   ...user,
   firstName: user.firstName ?? user.first_name ?? '',
   lastName: user.lastName ?? user.last_name ?? '',
   householdId: user.householdId ?? user.household_id ?? null,
   familyMembers: user.familyMembers ?? user.family_members ?? null,
  householdMembers: user.householdMembers ?? user.household_members ?? [],
   passwordHash: user.passwordHash ?? user.password_hash ?? null,
  mfaSecret: user.mfaSecret ?? user.mfa_secret ?? '',
  mfaEnabled: user.mfaEnabled ?? user.mfa_enabled ?? false,
  mfaLastStep: Number(user.mfaLastStep ?? user.mfa_last_step ?? 0),
   createdAt: user.createdAt ?? user.created_at ?? null,
   zone: user.zone ?? user.zone_number ?? null,
  }
}

const normalizeRequest = (request = null) => {
  if (!request) return null
  return {
    ...request,
    userId: request.userId ?? request.user_id,
    date: request.date ?? request.createdAt ?? request.created_at,
    deliveryMethod: request.deliveryMethod ?? request.delivery_method ?? 'online',
    deliveryNote: request.deliveryNote ?? request.delivery_note ?? '',
    followUps: request.followUps ?? request.follow_ups ?? [],
    statusHistory: request.statusHistory ?? request.status_history ?? [],
    updatedAt: request.updatedAt ?? request.updated_at ?? null,
  }
}

export async function readDb() {
  throw new Error('Direct JSON database access is disabled when PostgreSQL storage is configured.')
}

export async function writeDb(data) {
  void data
  throw new Error('Direct JSON database writes are disabled when PostgreSQL storage is configured.')
}

export async function query(text, params = []) {
  const client = await pool.connect()

  try {
    return await client.query(text, params)
  } finally {
    client.release()
  }
}

export async function closeDatabase() {
  await pool.end()
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
      household_members JSONB DEFAULT '[]'::jsonb,
      status VARCHAR(80) DEFAULT 'Active Resident',
      address TEXT,
      zone INTEGER,
      position VARCHAR(120),
      availability VARCHAR(50) DEFAULT 'Available',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS household_members JSONB DEFAULT '[]'::jsonb")
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT DEFAULT NULL')
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false')
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step BIGINT NOT NULL DEFAULT 0')

  await query(`
    CREATE TABLE IF NOT EXISTS requests (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(100) NOT NULL,
      purpose TEXT NOT NULL,
      notes TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'Pending',
      delivery_method VARCHAR(30) NOT NULL DEFAULT 'online',
      delivery_note TEXT,
      follow_ups JSONB NOT NULL DEFAULT '[]'::jsonb,
      status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(30) NOT NULL DEFAULT 'online'")
  await query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS delivery_note TEXT')
  await query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS follow_ups JSONB NOT NULL DEFAULT '[]'::jsonb")
  await query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS status_history JSONB NOT NULL DEFAULT '[]'::jsonb")
  await query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ')

  await query(`
    CREATE TABLE IF NOT EXISTS approvals (
      id VARCHAR(100) PRIMARY KEY,
      request_id UUID,
      approved_by UUID,
      approved_by_role VARCHAR(30),
      date_approved TIMESTAMPTZ,
      request_snapshot JSONB,
      archived_at TIMESTAMPTZ
    );
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS reports (
      id VARCHAR(100) PRIMARY KEY,
      type VARCHAR(100) NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      severity VARCHAR(50),
      zone INTEGER,
      status VARCHAR(50) NOT NULL DEFAULT 'Open',
      report_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS archives (
      id UUID PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      category VARCHAR(50) NOT NULL,
      contents JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

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

  await query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id UUID PRIMARY KEY,
      tag VARCHAR(30) NOT NULL DEFAULT 'green',
      title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      date VARCHAR(100),
      social_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)
  await query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS social_channels JSONB NOT NULL DEFAULT '[]'::jsonb")

  if (SHOULD_SKIP_SEED || (IS_PRODUCTION && !ADMIN_SEED.password)) {
    return
  }

  const adminCheck = await query(
    'SELECT id FROM users WHERE email = $1 OR mobile = $2 LIMIT 1',
    [ADMIN_SEED.email, ADMIN_SEED.mobile],
  )
  if (adminCheck.rows.length > 0) {
    console.info('Administrator seed skipped because an account already matches its email or mobile.')
    return
  }

  const { randomUUID } = await import('node:crypto')
  await query(
    `INSERT INTO users (id, first_name, last_name, mobile, email, password_hash, role, household_id, family_members, status, address, zone, position, availability)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      randomUUID(),
      ADMIN_SEED.firstName,
      ADMIN_SEED.lastName,
      ADMIN_SEED.mobile,
      ADMIN_SEED.email,
      await hashPassword(ADMIN_SEED.password),
      ADMIN_SEED.role,
      ADMIN_SEED.householdId,
      ADMIN_SEED.familyMembers,
      ADMIN_SEED.status,
      ADMIN_SEED.address,
      ADMIN_SEED.zone,
      'Administrator',
      'Available',
    ]
  )
}

export async function findUserByIdentifier(identifier) {
  const value = String(identifier).trim()
  const result = await query(
    `SELECT * FROM users WHERE mobile = $1 OR email = $2 LIMIT 1`,
    [value, value.toLowerCase()]
  )
  return result.rows[0] ? normalizeUser(result.rows[0]) : null
}

export async function findUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id])
  return result.rows[0] ? normalizeUser(result.rows[0]) : null
}

export async function createUser(user) {
  const { id, firstName, lastName, mobile, email, passwordHash, role, householdId, familyMembers, householdMembers = [], status, address, zone, position, availability } = user
  await query(
    `INSERT INTO users (id, first_name, last_name, mobile, email, password_hash, role, household_id, family_members, household_members, status, address, zone, position, availability)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [id, firstName, lastName, mobile, email, passwordHash, role, householdId, familyMembers, JSON.stringify(householdMembers), status, address, zone ?? null, position ?? null, availability ?? 'Available']
  )
  return { ...user, firstName, lastName, mobile, email }
}

export async function listAnnouncements() {
  const result = await query('SELECT id, tag, title, content, date, social_channels AS "socialChannels", created_at AS "createdAt" FROM announcements ORDER BY created_at DESC')
  return result.rows.map((row) => ({ ...row, socialChannels: Array.isArray(row.socialChannels) ? row.socialChannels : [] }))
}

export async function saveAnnouncement(announcement) {
  const result = await query(
    `INSERT INTO announcements (id, tag, title, content, date, social_channels, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, tag, title, content, date, social_channels AS "socialChannels", created_at AS "createdAt"`,
    [announcement.id, announcement.tag, announcement.title, announcement.content, announcement.date, JSON.stringify(Array.isArray(announcement.socialChannels) ? announcement.socialChannels : []), announcement.createdAt]
  )
  return result.rows[0] ? { ...result.rows[0], socialChannels: Array.isArray(result.rows[0].socialChannels) ? result.rows[0].socialChannels : [] } : null
}

export async function deleteAnnouncement(id) {
  const result = await query('DELETE FROM announcements WHERE id = $1 RETURNING id', [id])
  return result.rows[0] || null
}

export async function saveUser(user) {
  return createUser(user)
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
    householdMembers: updates.householdMembers ?? updates.household_members,
    address: updates.address,
    zone: updates.zone,
    position: updates.position,
    availability: updates.availability,
    mfaSecret: updates.mfaSecret,
    mfaEnabled: updates.mfaEnabled,
    mfaLastStep: updates.mfaLastStep,
  }).filter(([, value]) => value !== undefined)

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
    householdMembers: 'household_members',
    address: 'address',
    zone: 'zone',
    position: 'position',
    availability: 'availability',
    mfaSecret: 'mfa_secret',
    mfaEnabled: 'mfa_enabled',
    mfaLastStep: 'mfa_last_step',
  }

  const values = entries.map(([key, value]) => key === 'householdMembers' ? JSON.stringify(value) : value)
  const result = await query(
    `UPDATE users SET ${entries.map(([key], index) => `${columns[key]} = $${index + 1}`).join(', ')} WHERE id = $${entries.length + 1} RETURNING *`,
    [...values, userId]
  )
  return result.rows[0] ? normalizeUser(result.rows[0]) : null
}

export async function createRequest(request) {
  await query(
    `INSERT INTO requests (id, user_id, type, purpose, notes, status, delivery_method, delivery_note, follow_ups, status_history, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [request.id, request.userId, request.type, request.purpose, request.notes || '', request.status, request.deliveryMethod || 'online', request.deliveryNote || '', JSON.stringify(request.followUps || []), JSON.stringify(request.statusHistory || []), new Date(request.date || Date.now()).toISOString()]
  )
  return request
}

export async function saveRequest(request) {
  return createRequest(request)
}

export async function deleteUser(userId) {
  const result = await query('DELETE FROM users WHERE id = $1 RETURNING *', [userId])
  return result.rows[0] ? normalizeUser(result.rows[0]) : null
}

export async function listRequestsForUser(userId) {
  const result = await query(
    `SELECT * FROM requests WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  )
  return result.rows.map(normalizeRequest)
}

export async function listAllRequests() {
  const result = await query(
    `SELECT r.*, u.first_name, u.last_name, u.email, u.mobile
     FROM requests r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC`
  )
  return result.rows.map(normalizeRequest)
}

export async function listReports() {
  const result = await query(
    `SELECT id, type, title, description, severity, zone, status, report_date AS date
     FROM reports ORDER BY report_date DESC`
  )
  return result.rows
}

export async function createReport(report) {
  await query(
    `INSERT INTO reports (id, type, title, description, severity, zone, status, report_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [report.id, report.type, report.title, report.description || '', report.severity || null,
      report.zone || null, report.status, report.date]
  )
  return report
}

export async function listStaffRequestDashboard({
  search = '',
  status = '',
  type = '',
  zone = '',
  from = '',
  to = '',
  sort = 'date',
  direction = 'desc',
  page = 1,
  pageSize = 10,
} = {}) {
  const values = []
  const conditions = []
  const addValue = (value) => {
    values.push(value)
    return `$${values.length}`
  }

  if (search) {
    const term = addValue(`%${search}%`)
    conditions.push(`(r.id::text ILIKE ${term} OR r.type ILIKE ${term} OR r.purpose ILIKE ${term} OR u.first_name ILIKE ${term} OR u.last_name ILIKE ${term})`)
  }
  if (status === 'active') conditions.push(`r.status NOT IN ('Approved', 'Rejected')`)
  else if (status) conditions.push(`r.status = ${addValue(status)}`)
  if (type) conditions.push(`r.type = ${addValue(type)}`)
  if (zone) conditions.push(`u.zone::text = ${addValue(zone)}`)
  if (from) conditions.push(`(r.created_at AT TIME ZONE 'Asia/Manila')::date >= ${addValue(from)}::date`)
  if (to) conditions.push(`(r.created_at AT TIME ZONE 'Asia/Manila')::date <= ${addValue(to)}::date`)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const sortColumn = sort === 'status' ? 'r.status' : 'r.created_at'
  const order = direction === 'asc' ? 'ASC' : 'DESC'
  const limit = addValue(pageSize)
  const offset = addValue((page - 1) * pageSize)

  try {
    const [rows, total, summary] = await Promise.all([
      query(
        `SELECT r.*, u.first_name, u.last_name
         FROM requests r
         JOIN users u ON u.id = r.user_id
         ${where}
         ORDER BY ${sortColumn} ${order} NULLS LAST, r.id
         LIMIT ${limit} OFFSET ${offset}`,
        values.slice(0, values.length - 2)
          .concat([pageSize, (page - 1) * pageSize])
      ),
      query(
        `SELECT COUNT(*)::int AS count FROM requests r JOIN users u ON u.id = r.user_id ${where}`,
        values.slice(0, values.length - 2)
      ),
      query(
        `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'In Review')::int AS "inReview",
          COUNT(*) FILTER (WHERE status = 'Needs Information')::int AS "needsInformation",
          COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'Rejected')::int AS rejected,
          array_agg(DISTINCT type ORDER BY type) FILTER (WHERE type IS NOT NULL) AS "documentTypes"
         FROM requests`
      ),
    ])
    return {
      requests: rows.rows.map(normalizeRequest),
      total: total.rows[0].count,
      page,
      pageSize,
      documentTypes: summary.rows[0].documentTypes || [],
      summary: { ...summary.rows[0], deadlineTracking: false, releaseTracking: false },
    }
  } catch (error) {
    console.error('PostgreSQL staff request dashboard query failed', error)
    throw error
  }
}

export async function listAllUsers() {
  try {
    const result = await query(
      `SELECT id, first_name, last_name, mobile, email, role, status, household_id, family_members, household_members, address, zone, position, availability, created_at
       FROM users ORDER BY created_at DESC`
    )
    return result.rows.map(normalizeUser)
  } catch (error) {
    console.error('PostgreSQL user list query failed', error)
    throw error
  }
}

export async function updateRequestStatus(requestId, status, historyEntry) {
  try {
    const result = await query(
      `UPDATE requests
       SET status = $1,
           status_history = COALESCE(
             NULLIF(status_history, '[]'::jsonb),
             jsonb_build_array(jsonb_build_object(
               'kind', 'status',
               'status', requests.status,
               'createdAt', requests.created_at,
               'actorRole', 'system'
             ))
           ) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, JSON.stringify([historyEntry]), requestId]
    )
    return normalizeRequest(result.rows[0])
  } catch (error) {
    console.error('PostgreSQL request status update failed', error)
    throw error
  }
}

export async function appendRequestFollowUp(requestId, followUp) {
  try {
    const result = await query(
      `UPDATE requests
       SET follow_ups = COALESCE(follow_ups, '[]'::jsonb) || $1::jsonb,
           status_history = COALESCE(
             NULLIF(status_history, '[]'::jsonb),
             jsonb_build_array(jsonb_build_object(
               'kind', 'status',
               'status', requests.status,
               'createdAt', requests.created_at,
               'actorRole', 'system'
             ))
           ) || $2::jsonb ||
             CASE WHEN status = 'Needs Information'
               THEN jsonb_build_array(jsonb_build_object(
                 'kind', 'status',
                 'status', 'In Review',
                 'note', 'Resident provided a follow-up.',
                 'createdAt', $3::timestamptz,
                 'actorRole', 'system'
               ))
               ELSE '[]'::jsonb
             END,
           status = CASE WHEN status = 'Needs Information' THEN 'In Review' ELSE status END,
           updated_at = $3
       WHERE id = $4
       RETURNING *`,
      [JSON.stringify([followUp]), JSON.stringify([{ ...followUp, kind: 'follow-up', actorRole: 'resident' }]), followUp.createdAt, requestId]
    )
    return normalizeRequest(result.rows[0])
  } catch (error) {
    console.error('PostgreSQL request follow-up update failed', error)
    throw error
  }
}

export async function addApproval(approval) {
  await query(
    `INSERT INTO approvals (id, request_id, approved_by, approved_by_role, date_approved, request_snapshot, archived_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
    [approval.id, approval.requestId, approval.approvedBy || null, approval.approvedByRole || null,
      approval.dateApproved, JSON.stringify(approval.requestSnapshot || {})]
  )
  return approval
}

export async function listApprovals() {
  const result = await query(
    `SELECT id, request_id AS "requestId", approved_by AS "approvedBy",
            approved_by_role AS "approvedByRole", date_approved AS "dateApproved",
            request_snapshot AS "requestSnapshot", archived_at AS "archivedAt"
     FROM approvals WHERE archived_at IS NULL ORDER BY date_approved DESC`
  )
  return result.rows
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
    console.error('PostgreSQL audit log insert failed', error)
    throw error
  }
}

export async function listAuditLogs(limit = 100) {
  try {
    const result = await query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1', [Math.max(1, Math.min(Number(limit) || 100, 500))])
    return result.rows
  } catch (error) {
    console.error('PostgreSQL audit log query failed', error)
    throw error
  }
}

export async function archiveApprovalsOlderThan(days = 7) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, request_id AS "requestId", approved_by AS "approvedBy",
              approved_by_role AS "approvedByRole", date_approved AS "dateApproved",
              request_snapshot AS "requestSnapshot", archived_at AS "archivedAt"
       FROM approvals
       WHERE archived_at IS NULL AND ($1 = 0 OR date_approved <= NOW() - ($1 * INTERVAL '1 day'))
       ORDER BY date_approved
       FOR UPDATE`,
      [Number(days)]
    )
    const approvals = result.rows
    if (approvals.length === 0) {
      await client.query('COMMIT')
      return { count: 0, filename: null }
    }
    const from = new Date(approvals[0].dateApproved).toISOString().slice(0, 10)
    const to = new Date(approvals[approvals.length - 1].dateApproved).toISOString().slice(0, 10)
    const filename = `approvals-${from}_to_${to}.json`
    await client.query(
      `INSERT INTO archives (id, name, category, contents, created_at)
       VALUES ($1, $2, 'approvals', $3, NOW())
       ON CONFLICT (name) DO UPDATE SET contents = EXCLUDED.contents, created_at = EXCLUDED.created_at`,
      [randomUUID(), filename, JSON.stringify(approvals)]
    )
    await client.query(
      'UPDATE approvals SET archived_at = NOW() WHERE id = ANY($1::varchar[])',
      [approvals.map((approval) => approval.id)]
    )
    await client.query('COMMIT')
    return { count: approvals.length, filename }
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('PostgreSQL approval archival failed', error)
    throw error
  } finally {
    client.release()
  }
}

export async function archiveProcessedRequestsOlderThan(days = 1) {
  const daysValue = Math.max(0, Number(days) || 0)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT * FROM requests
       WHERE status IN ('Approved', 'Rejected')
         AND ($1 = 0 OR COALESCE(updated_at, created_at) <= NOW() - ($1 * INTERVAL '1 day'))
       ORDER BY created_at
       FOR UPDATE`,
      [daysValue]
    )
    const records = result.rows.map(normalizeRequest)
    if (records.length === 0) {
      await client.query('COMMIT')
      return { count: 0, filename: null, archivedAt: null }
    }
    const archivedAt = new Date().toISOString()
    const filename = `queue-approvals-${archivedAt.slice(0, 10)}.json`
    const payload = {
      archivedAt,
      archivedFor: daysValue === 0 ? 'manual' : `${daysValue} day(s)`,
      total: records.length,
      records,
    }
    await client.query(
      `INSERT INTO archives (id, name, category, contents, created_at)
       VALUES ($1, $2, 'queue-approvals', $3, $4)
       ON CONFLICT (name) DO UPDATE SET contents = EXCLUDED.contents, created_at = EXCLUDED.created_at`,
      [randomUUID(), filename, JSON.stringify(payload), archivedAt]
    )
    await client.query('DELETE FROM requests WHERE id = ANY($1::uuid[])', [records.map((request) => request.id)])
    await client.query('COMMIT')
    return { count: records.length, filename, archivedAt }
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('PostgreSQL processed request archival failed', error)
    throw error
  } finally {
    client.release()
  }
}

export async function createArchive(name, category, contents) {
  const result = await query(
    `INSERT INTO archives (id, name, category, contents, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category, contents = EXCLUDED.contents, created_at = EXCLUDED.created_at
     RETURNING id`,
    [randomUUID(), name, category, JSON.stringify(contents)]
  )
  return result.rows[0] || null
}

export async function listArchives() {
  const result = await query(
    `SELECT name, octet_length(contents::text) AS size, created_at AS mtime
     FROM archives ORDER BY created_at DESC`
  )
  return result.rows
}

export async function getArchive(name) {
  const result = await query('SELECT contents FROM archives WHERE name = $1', [name])
  return result.rows[0]?.contents ?? null
}

export async function deleteArchive(name) {
  const result = await query('DELETE FROM archives WHERE name = $1 RETURNING name', [name])
  return result.rows[0] || null
}

export async function clearData(options = { keepAdmins: true }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM requests')
    await client.query('DELETE FROM reports')
    await client.query('DELETE FROM approvals')
    if (options.keepAdmins) {
      await client.query("DELETE FROM users WHERE role = 'resident'")
    } else {
      await client.query('DELETE FROM users')
    }
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('PostgreSQL data clear failed', error)
    throw error
  } finally {
    client.release()
  }
}
