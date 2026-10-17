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
   lastSeen: user.lastSeen ?? user.last_seen ?? null,
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
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ')

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
    CREATE TABLE IF NOT EXISTS staff_invitations (
      id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
  `)
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_pending_email_idx
    ON staff_invitations (LOWER(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL`)

  await query(`
    CREATE TABLE IF NOT EXISTS resident_registry (
      id UUID PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      birth_date DATE,
      sex VARCHAR(20),
      household_id VARCHAR(100),
      purok VARCHAR(100),
      zone SMALLINT,
      address VARCHAR(255),
      record_status VARCHAR(20) NOT NULL DEFAULT 'active',
      verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      source_reference VARCHAR(255),
      source_filename VARCHAR(255),
      source_fingerprint CHAR(64) UNIQUE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `)
  await query('CREATE INDEX IF NOT EXISTS resident_registry_location_status_idx ON resident_registry (zone, purok, record_status, verification_status)')
  await query('CREATE INDEX IF NOT EXISTS resident_registry_household_location_idx ON resident_registry (household_id, zone, purok)')
  await query('CREATE INDEX IF NOT EXISTS resident_registry_first_name_prefix_idx ON resident_registry (LOWER(first_name) text_pattern_ops)')
  await query('CREATE INDEX IF NOT EXISTS resident_registry_last_name_prefix_idx ON resident_registry (LOWER(last_name) text_pattern_ops)')

  await query(`
    CREATE TABLE IF NOT EXISTS registry_source_reviews (
      id UUID PRIMARY KEY,
      zone SMALLINT,
      purok VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      resolved_at TIMESTAMPTZ
    );
  `)
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS registry_source_reviews_open_location_idx
    ON registry_source_reviews ((COALESCE(zone, 0)), (LOWER(purok))) WHERE status = 'open'`)

  await query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id UUID PRIMARY KEY,
      tag VARCHAR(30) NOT NULL DEFAULT 'green',
      title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      date VARCHAR(100),
      social_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      social_delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
      facebook_post_id TEXT,
      retraction_announcement_id UUID,
      related_announcement_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)
  await query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS social_channels JSONB NOT NULL DEFAULT '[]'::jsonb")
  await query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS social_delivery JSONB NOT NULL DEFAULT '{}'::jsonb")
  await query('ALTER TABLE announcements ADD COLUMN IF NOT EXISTS facebook_post_id TEXT')
  await query('ALTER TABLE announcements ADD COLUMN IF NOT EXISTS retraction_announcement_id UUID')
  await query('ALTER TABLE announcements ADD COLUMN IF NOT EXISTS related_announcement_id UUID')

  await query(`
    CREATE TABLE IF NOT EXISTS messenger_subscribers (
      psid TEXT PRIMARY KEY,
      opted_in BOOLEAN NOT NULL DEFAULT false,
      last_message_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS announcement_messenger_deliveries (
      announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      psid TEXT NOT NULL REFERENCES messenger_subscribers(psid) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (announcement_id, psid)
    );
  `)

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

const writeProvisioningAudit = async (client, entry) => {
  await client.query(
    `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.id, entry.actorId || null, entry.actorRole, entry.action, entry.targetType, entry.targetId, entry.metadata || {}],
  )
}

export async function issueStaffInvitation(invitation, auditEntry) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existingUser = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1 FOR UPDATE',
      [invitation.email],
    )
    if (existingUser.rows.length) {
      await client.query('ROLLBACK')
      return { status: 'account_exists' }
    }

    await client.query(
      `UPDATE staff_invitations SET revoked_at = $2
       WHERE LOWER(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [invitation.email, invitation.issuedAt],
    )
    await client.query(
      `INSERT INTO staff_invitations (id, email, token_hash, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [invitation.id, invitation.email, invitation.tokenHash, invitation.issuedAt, invitation.expiresAt],
    )
    await writeProvisioningAudit(client, auditEntry)
    await client.query('COMMIT')
    return { status: 'created' }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') return { status: 'invitation_conflict' }
    console.error('PostgreSQL staff invitation issuance failed', error)
    throw error
  } finally {
    client.release()
  }
}

export async function getStaffInvitationByTokenHash(tokenHash) {
  const result = await query(
    `SELECT id, email, expires_at AS "expiresAt", accepted_at AS "acceptedAt", revoked_at AS "revokedAt"
     FROM staff_invitations WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  )
  return result.rows[0] || null
}

export async function acceptStaffInvitation({ tokenHash, user, acceptedAt, auditEntry }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const invitationResult = await client.query(
      `SELECT id, email, expires_at AS "expiresAt", accepted_at AS "acceptedAt", revoked_at AS "revokedAt"
       FROM staff_invitations WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    )
    const invitation = invitationResult.rows[0]
    if (
      !invitation
      || invitation.acceptedAt
      || invitation.revokedAt
      || Date.parse(invitation.expiresAt) <= Date.parse(acceptedAt)
    ) {
      await client.query('ROLLBACK')
      return { status: 'invalid_invitation' }
    }

    const existingUser = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 OR mobile = $2 LIMIT 1 FOR UPDATE',
      [invitation.email.toLowerCase(), user.mobile],
    )
    if (existingUser.rows.length) {
      await client.query('ROLLBACK')
      return { status: 'account_exists' }
    }

    await client.query(
      `INSERT INTO users (id, first_name, last_name, mobile, email, password_hash, role, household_id, family_members, household_members, status, address, zone, position, availability, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'staff', $7, 1, '[]'::jsonb, 'On Duty', 'Barangay Hall, Legaspi', 0, 'Staff', 'Available', $8)`,
      [user.id, user.firstName, user.lastName, user.mobile, invitation.email, user.passwordHash, user.householdId, acceptedAt],
    )
    await client.query(
      'UPDATE staff_invitations SET accepted_at = $2 WHERE id = $1',
      [invitation.id, acceptedAt],
    )
    await writeProvisioningAudit(client, auditEntry)
    await client.query('COMMIT')
    return { status: 'created', userId: user.id }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') return { status: 'account_exists' }
    console.error('PostgreSQL staff invitation acceptance failed', error)
    throw error
  } finally {
    client.release()
  }
}

export async function promoteExistingUserToAdmin({ email, mobile, auditEntry }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, role, status FROM users
       WHERE LOWER(email) = $1 AND mobile = $2
       FOR UPDATE`,
      [email.toLowerCase(), mobile],
    )
    if (result.rows.length !== 1) {
      await client.query('ROLLBACK')
      return { status: 'not_found' }
    }

    const user = result.rows[0]
    if (user.role === 'admin') {
      await client.query('ROLLBACK')
      return { status: 'already_admin', userId: user.id }
    }
    if (user.role !== 'resident') {
      await client.query('ROLLBACK')
      return { status: 'role_conflict' }
    }
    if (['Suspended', 'Disabled'].includes(user.status)) {
      await client.query('ROLLBACK')
      return { status: 'account_disabled' }
    }

    await client.query(
      "UPDATE users SET role = 'admin', position = 'Administrator' WHERE id = $1",
      [user.id],
    )
    await writeProvisioningAudit(client, auditEntry(user.id, user.role))
    await client.query('COMMIT')
    return { status: 'promoted', userId: user.id }
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('PostgreSQL admin promotion failed', error)
    throw error
  } finally {
    client.release()
  }
}

export async function listAnnouncements() {
  const result = await query('SELECT id, tag, title, content, date, social_channels AS "socialChannels", social_delivery AS "socialDelivery", facebook_post_id AS "facebookPostId", retraction_announcement_id AS "retractionAnnouncementId", related_announcement_id AS "relatedAnnouncementId", created_at AS "createdAt" FROM announcements ORDER BY created_at DESC')
  return result.rows.map((row) => ({ ...row, socialChannels: Array.isArray(row.socialChannels) ? row.socialChannels : [] }))
}

export async function getAnnouncement(id) {
  const result = await query('SELECT id, tag, title, content, date, social_channels AS "socialChannels", social_delivery AS "socialDelivery", facebook_post_id AS "facebookPostId", retraction_announcement_id AS "retractionAnnouncementId", related_announcement_id AS "relatedAnnouncementId", created_at AS "createdAt" FROM announcements WHERE id = $1', [id])
  const row = result.rows[0]
  return row ? { ...row, socialChannels: Array.isArray(row.socialChannels) ? row.socialChannels : [] } : null
}

export async function saveAnnouncement(announcement) {
  const result = await query(
    `INSERT INTO announcements (id, tag, title, content, date, social_channels, social_delivery, facebook_post_id, retraction_announcement_id, related_announcement_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, tag, title, content, date, social_channels AS "socialChannels", social_delivery AS "socialDelivery", facebook_post_id AS "facebookPostId", retraction_announcement_id AS "retractionAnnouncementId", related_announcement_id AS "relatedAnnouncementId", created_at AS "createdAt"`,
    [
      announcement.id,
      announcement.tag,
      announcement.title,
      announcement.content,
      announcement.date,
      JSON.stringify(Array.isArray(announcement.socialChannels) ? announcement.socialChannels : []),
      JSON.stringify(announcement.socialDelivery || {}),
      announcement.facebookPostId || null,
      announcement.retractionAnnouncementId || null,
      announcement.relatedAnnouncementId || null,
      announcement.createdAt,
    ]
  )
  return result.rows[0] ? { ...result.rows[0], socialChannels: Array.isArray(result.rows[0].socialChannels) ? result.rows[0].socialChannels : [] } : null
}

export async function updateAnnouncement(id, updates = {}) {
  const columns = {
    socialDelivery: ['social_delivery', (value) => JSON.stringify(value || {})],
    facebookPostId: ['facebook_post_id', (value) => value || null],
    retractionAnnouncementId: ['retraction_announcement_id', (value) => value || null],
  }
  const entries = Object.entries(columns)
    .filter(([key]) => Object.hasOwn(updates, key))
    .map(([key, [column, transform]]) => [column, transform(updates[key])])
  if (!entries.length) return getAnnouncement(id)
  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`)
  const result = await query(
    `UPDATE announcements SET ${assignments.join(', ')} WHERE id = $1
     RETURNING id, tag, title, content, date, social_channels AS "socialChannels", social_delivery AS "socialDelivery", facebook_post_id AS "facebookPostId", retraction_announcement_id AS "retractionAnnouncementId", related_announcement_id AS "relatedAnnouncementId", created_at AS "createdAt"`,
    [id, ...entries.map(([, value]) => value)],
  )
  const row = result.rows[0]
  return row ? { ...row, socialChannels: Array.isArray(row.socialChannels) ? row.socialChannels : [] } : null
}

export async function deleteAnnouncement(id) {
  const result = await query('DELETE FROM announcements WHERE id = $1 RETURNING id', [id])
  return result.rows[0] || null
}

export async function upsertMessengerSubscriber({ psid, optedIn, lastMessageAt }) {
  await query(
    `INSERT INTO messenger_subscribers (psid, opted_in, last_message_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (psid) DO UPDATE SET opted_in = EXCLUDED.opted_in, last_message_at = EXCLUDED.last_message_at, updated_at = NOW()`,
    [psid, Boolean(optedIn), lastMessageAt],
  )
}

export async function recordMessengerContact({ psid, lastMessageAt }) {
  await query(
    `INSERT INTO messenger_subscribers (psid, opted_in, last_message_at)
     VALUES ($1, false, $2)
     ON CONFLICT (psid) DO UPDATE SET last_message_at = EXCLUDED.last_message_at, updated_at = NOW()`,
    [psid, lastMessageAt],
  )
}

export async function listEligibleMessengerSubscribers(since, until) {
  const result = await query(
    'SELECT psid, opted_in AS "optedIn", last_message_at AS "lastMessageAt" FROM messenger_subscribers WHERE opted_in = true AND last_message_at BETWEEN $1 AND $2',
    [since, until],
  )
  return result.rows
}

export async function recordMessengerAnnouncementDelivery({ announcementId, psid, sentAt }) {
  await query(
    `INSERT INTO announcement_messenger_deliveries (announcement_id, psid, sent_at)
     VALUES ($1, $2, $3) ON CONFLICT (announcement_id, psid) DO NOTHING`,
    [announcementId, psid, sentAt],
  )
}

export async function listEligibleMessengerAnnouncementRecipients(announcementId, since, until) {
  const result = await query(
    `SELECT deliveries.psid
     FROM announcement_messenger_deliveries AS deliveries
     JOIN messenger_subscribers AS subscribers ON subscribers.psid = deliveries.psid
     WHERE deliveries.announcement_id = $1
       AND subscribers.opted_in = true
       AND subscribers.last_message_at BETWEEN $2 AND $3`,
    [announcementId, since, until],
  )
  return result.rows
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
    lastSeen: updates.lastSeen ?? updates.last_seen,
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
    lastSeen: 'last_seen',
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

export async function listRequestsForStaffReports() {
  const result = await query(
    `SELECT id, type, status, created_at, status_history
     FROM requests
     ORDER BY created_at DESC`
  )
  return result.rows.map((request) => ({
    id: request.id,
    type: request.type,
    status: request.status,
    date: request.created_at,
    statusHistory: request.status_history || [],
  }))
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

const normalizeRegistrySourceReview = (review) => ({
  id: review.id,
  zone: review.zone === null || review.zone === undefined ? null : Number(review.zone),
  purok: review.purok,
  status: review.status,
  createdBy: review.createdBy ?? review.created_by ?? null,
  createdAt: review.createdAt ?? review.created_at ?? null,
  resolvedBy: review.resolvedBy ?? review.resolved_by ?? null,
  resolvedAt: review.resolvedAt ?? review.resolved_at ?? null,
})

const registrySourceReviewColumns = `id, zone, purok, status, created_by AS "createdBy",
  created_at AS "createdAt", resolved_by AS "resolvedBy", resolved_at AS "resolvedAt"`

export async function listRegistrySourceReviews() {
  const result = await query(
    `SELECT ${registrySourceReviewColumns} FROM registry_source_reviews
     WHERE status = 'open' ORDER BY created_at`
  )
  return result.rows.map(normalizeRegistrySourceReview)
}

export async function openRegistrySourceReview(review, auditEntry) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO registry_source_reviews (id, zone, purok, status, created_by, created_at)
       VALUES ($1, $2, $3, 'open', $4, $5)
       ON CONFLICT ((COALESCE(zone, 0)), (LOWER(purok))) WHERE status = 'open' DO NOTHING
       RETURNING ${registrySourceReviewColumns}`,
      [review.id, review.zone, review.purok, review.createdBy || null, review.createdAt]
    )
    if (!inserted.rows.length) {
      const existing = await client.query(
        `SELECT ${registrySourceReviewColumns} FROM registry_source_reviews
         WHERE status = 'open' AND zone IS NOT DISTINCT FROM $1
           AND LOWER(purok) = LOWER($2)`,
        [review.zone, review.purok]
      )
      if (!existing.rows.length) throw new Error('Open registry source review conflict could not be resolved.')
      await client.query('COMMIT')
      return { review: normalizeRegistrySourceReview(existing.rows[0]), created: false }
    }
    await client.query(
      `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [auditEntry.id, auditEntry.actorId || null, auditEntry.actorRole || null, auditEntry.action,
        auditEntry.targetType || null, auditEntry.targetId || null, auditEntry.metadata || {}]
    )
    await client.query('COMMIT')
    return { review: normalizeRegistrySourceReview(inserted.rows[0]), created: true }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function resolveRegistrySourceReview(id, actorId, resolvedAt, auditEntry) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query(
      `SELECT ${registrySourceReviewColumns} FROM registry_source_reviews
       WHERE id = $1 AND status = 'open' FOR UPDATE`,
      [id]
    )
    if (!current.rows.length) {
      await client.query('COMMIT')
      return null
    }
    const updated = await client.query(
      `UPDATE registry_source_reviews SET status = 'resolved', resolved_by = $2, resolved_at = $3
       WHERE id = $1 RETURNING ${registrySourceReviewColumns}`,
      [id, actorId, resolvedAt]
    )
    await client.query(
      `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [auditEntry.id, auditEntry.actorId || null, auditEntry.actorRole || null, auditEntry.action,
        auditEntry.targetType || null, auditEntry.targetId || null, auditEntry.metadata || {}]
    )
    await client.query('COMMIT')
    return normalizeRegistrySourceReview(updated.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const normalizeRegistryResident = (record) => ({
  ...record,
  firstName: record.firstName ?? record.first_name ?? '',
  lastName: record.lastName ?? record.last_name ?? '',
  birthDate: (() => {
    const value = record.birthDate ?? record.birth_date ?? null
    return value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null
  })(),
  householdId: record.householdId ?? record.household_id ?? null,
  verificationStatus: record.verificationStatus ?? record.verification_status ?? 'pending',
  sourceReference: record.sourceReference ?? record.source_reference ?? null,
  sourceFilename: record.sourceFilename ?? record.source_filename ?? null,
  verifiedBy: record.verifiedBy ?? record.verified_by ?? null,
  verifiedAt: record.verifiedAt ?? record.verified_at ?? null,
  createdBy: record.createdBy ?? record.created_by ?? null,
  status: record.status ?? record.recordStatus ?? record.record_status ?? 'active',
  recordStatus: record.recordStatus ?? record.record_status ?? record.status ?? 'active',
})

const registryWhere = (filters = {}) => {
  const clauses = []
  const params = []
  const add = (sql, value) => {
    params.push(value)
    clauses.push(sql.replace('?', `$${params.length}`))
  }
  if (filters.search) {
    for (const term of String(filters.search).toLowerCase().split(/\s+/).filter(Boolean)) {
      params.push(`${term.replace(/[\\%_]/g, '\\$&')}%`)
      const placeholder = `$${params.length}`
      clauses.push(`(LOWER(first_name) LIKE ${placeholder} ESCAPE '\\' OR LOWER(last_name) LIKE ${placeholder} ESCAPE '\\')`)
    }
  }
  if (filters.birthDate) add('birth_date = ?', filters.birthDate)
  if (filters.ageStart && filters.ageEnd) {
    params.push(filters.ageStart, filters.ageEnd)
    clauses.push(`birth_date BETWEEN $${params.length - 1} AND $${params.length}`)
  }
  if (filters.zone) add('zone = ?', Number(filters.zone))
  if (filters.purok) add('purok = ?', filters.purok)
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export async function listResidentRegistry(filters = {}) {
  const where = registryWhere(filters)
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const countResult = await client.query(`SELECT COUNT(*)::integer AS total FROM resident_registry ${where.sql}`, where.params)
    const offset = (filters.page - 1) * filters.pageSize
    const params = [...where.params, filters.pageSize, offset]
    const rows = await client.query(
      `SELECT * FROM resident_registry ${where.sql}
       ORDER BY zone NULLS LAST, purok NULLS LAST, last_name, first_name, id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    await client.query('COMMIT')
    return { residents: rows.rows.map(normalizeRegistryResident), total: Number(countResult.rows[0]?.total || 0) }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function getResidentDemographics(filters = {}) {
  const where = registryWhere({ zone: filters.zone, purok: filters.purok })
  const eligibleSql = `${where.sql ? `${where.sql} AND ` : 'WHERE '}record_status = 'active' AND verification_status = 'verified'`
  const counts = `COUNT(*)::integer AS total,
    COUNT(*) FILTER (WHERE LOWER(sex) = 'male')::integer AS male,
    COUNT(*) FILTER (WHERE LOWER(sex) = 'female')::integer AS female,
    COUNT(*) FILTER (WHERE sex IS NULL OR BTRIM(sex) = '' OR LOWER(sex) NOT IN ('male', 'female'))::integer AS unclassified,
    COUNT(DISTINCT (zone, purok, NULLIF(BTRIM(household_id), '')))
      FILTER (WHERE NULLIF(BTRIM(household_id), '') IS NOT NULL)::integer AS households`
  const client = await pool.connect()
  let overallResult
  let groupResult
  let householdResult
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    overallResult = await client.query(
      `SELECT ${counts} FROM resident_registry ${eligibleSql}`,
      where.params
    )
    groupResult = await client.query(
      `SELECT zone, purok, ${counts} FROM resident_registry ${eligibleSql}
       GROUP BY zone, purok ORDER BY zone NULLS LAST, purok NULLS LAST`,
      where.params
    )
    householdResult = await client.query(
      `SELECT zone, purok, household_id,
       COUNT(*)::integer AS total,
       COUNT(*) FILTER (WHERE LOWER(sex) = 'male')::integer AS male,
       COUNT(*) FILTER (WHERE LOWER(sex) = 'female')::integer AS female,
       COUNT(*) FILTER (WHERE sex IS NULL OR BTRIM(sex) = '' OR LOWER(sex) NOT IN ('male', 'female'))::integer AS unclassified
       FROM resident_registry ${eligibleSql}
       AND NULLIF(BTRIM(household_id), '') IS NOT NULL
       GROUP BY zone, purok, household_id ORDER BY zone NULLS LAST, purok NULLS LAST, household_id`,
      where.params
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  const byPurok = groupResult.rows.map((row) => ({
    zone: row.zone === null ? null : Number(row.zone),
    purok: row.purok,
    label: row.purok ? `${row.purok}${row.zone ? ` · Zone ${row.zone}` : ''}` : (row.zone ? `Zone ${row.zone}` : 'Unassigned / needs verification'),
    total: Number(row.total),
    male: Number(row.male),
    female: Number(row.female),
    unclassified: Number(row.unclassified),
    households: Number(row.households),
  }))
  const byHousehold = householdResult.rows.map((row) => ({
    zone: row.zone === null ? null : Number(row.zone),
    purok: row.purok,
    householdId: row.household_id,
    total: Number(row.total),
    male: Number(row.male),
    female: Number(row.female),
    unclassified: Number(row.unclassified),
  }))
  const row = overallResult.rows[0] || {}
  return {
    eligibility: 'Active records with verified household/resident status; unclassified sex is reported separately.',
    overall: {
      total: Number(row.total || 0),
      male: Number(row.male || 0),
      female: Number(row.female || 0),
      unclassified: Number(row.unclassified || 0),
      households: Number(row.households || 0),
    },
    byPurok,
    byHousehold,
    filters: { zone: filters.zone || null, purok: filters.purok || '' },
  }
}

export async function findPotentialRegistryMatches(firstName, lastName, birthDate) {
  const result = await query(
    `SELECT id, first_name, last_name, birth_date, household_id, purok, zone, verification_status
     FROM resident_registry
     WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2)
     AND ($3::date IS NULL OR birth_date = $3::date OR birth_date IS NULL)
     ORDER BY created_at`,
    [firstName, lastName, birthDate || null]
  )
  return result.rows.map((row) => {
    const resident = normalizeRegistryResident(row)
    return {
      id: resident.id,
      firstName: resident.firstName,
      lastName: resident.lastName,
      birthDate: resident.birthDate,
      householdId: resident.householdId,
      purok: resident.purok,
      zone: resident.zone === null ? null : Number(resident.zone),
      verificationStatus: resident.verificationStatus,
    }
  })
}

const matchResidentsToRows = (residents, rows, rowOffset = 2) => residents.map((resident, index) => ({
  row: index + rowOffset,
  records: rows.filter((row) => (
    row.firstName.trim().toLocaleLowerCase() === resident.firstName.trim().toLocaleLowerCase()
    && row.lastName.trim().toLocaleLowerCase() === resident.lastName.trim().toLocaleLowerCase()
    && (!resident.birthDate || !row.birthDate || resident.birthDate === row.birthDate)
  )).map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    birthDate: row.birthDate,
    householdId: row.householdId,
    purok: row.purok,
    zone: row.zone === null ? null : Number(row.zone),
    verificationStatus: row.verificationStatus,
  })),
})).filter((match) => match.records.length)

const registryMatchSnapshot = (matches) => matches.map((match) => ({
  row: match.row,
  ids: match.records.map((record) => String(record.id)).sort(),
}))

export async function findPotentialRegistryMatchesForResidents(residents) {
  if (!residents.length) return []
  const firstNames = [...new Set(residents.map((resident) => resident.firstName.trim().toLocaleLowerCase()))]
  const lastNames = [...new Set(residents.map((resident) => resident.lastName.trim().toLocaleLowerCase()))]
  const result = await query(
    `SELECT id, first_name, last_name, birth_date, household_id, purok, zone, verification_status
     FROM resident_registry
     WHERE LOWER(first_name) = ANY($1::text[]) AND LOWER(last_name) = ANY($2::text[])
     ORDER BY created_at, id`,
    [firstNames, lastNames]
  )
  return residents.map((resident) => matchResidentsToRows([resident], result.rows.map(normalizeRegistryResident), 0)[0]?.records || [])
}

export async function insertRegistryResidents(residents, auditEntry, options = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const identityKeys = [...new Set(residents.map((resident) => (
      `${resident.firstName.trim().toLocaleLowerCase()}\u0000${resident.lastName.trim().toLocaleLowerCase()}`
    )))].sort()
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(identity_key, 0))
       FROM unnest($1::text[]) AS identities(identity_key)
       ORDER BY identity_key`,
      [identityKeys]
    )
    const firstNames = [...new Set(residents.map((resident) => resident.firstName.trim().toLocaleLowerCase()))]
    const lastNames = [...new Set(residents.map((resident) => resident.lastName.trim().toLocaleLowerCase()))]
    const existingResult = await client.query(
      `SELECT id, first_name, last_name, birth_date, household_id, purok, zone, verification_status
       FROM resident_registry
       WHERE LOWER(first_name) = ANY($1::text[]) AND LOWER(last_name) = ANY($2::text[])
       ORDER BY created_at, id`,
      [firstNames, lastNames]
    )
    const existingResidents = existingResult.rows.map(normalizeRegistryResident)
    const rowOffset = options.rowOffset ?? 2
    const potentialMatches = matchResidentsToRows(residents, existingResidents, rowOffset)
    const reviewedMatches = registryMatchSnapshot(potentialMatches)
    if ((potentialMatches.length && options.confirmPotentialMatches !== true)
      || JSON.stringify(reviewedMatches) !== JSON.stringify(options.reviewedMatches || [])) {
      await client.query('ROLLBACK')
      return { inserted: [], skipped: 0, reviewRequired: true, potentialMatches, reviewedMatches }
    }

    const columns = [
      'id', 'first_name', 'last_name', 'birth_date', 'sex', 'household_id', 'purok', 'zone', 'address',
      'record_status', 'verification_status', 'source_reference', 'source_filename', 'source_fingerprint',
      'created_by', 'created_at', 'updated_at',
    ]
    const values = []
    const tuples = residents.map((resident, index) => {
      const row = [
        resident.id, resident.firstName, resident.lastName, resident.birthDate, resident.sex,
        resident.householdId, resident.purok, resident.zone, resident.address, 'active', 'pending',
        resident.sourceReference, resident.sourceFilename, resident.sourceFingerprint, resident.createdBy,
        resident.createdAt, resident.updatedAt || resident.createdAt,
      ]
      values.push(...row)
      const start = index * columns.length
      return `(${columns.map((_, columnIndex) => `$${start + columnIndex + 1}`).join(', ')})`
    })
    const insertedResult = await client.query(
      `INSERT INTO resident_registry (${columns.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (source_fingerprint) DO NOTHING
       RETURNING source_fingerprint`,
      values
    )
    const insertedFingerprints = new Set(insertedResult.rows.map((row) => row.source_fingerprint.trim()))
    const inserted = residents.filter((resident) => insertedFingerprints.has(resident.sourceFingerprint))
    const existingFingerprintResult = inserted.length === residents.length
      ? { rows: [] }
      : await client.query(
        `SELECT id, source_fingerprint FROM resident_registry
         WHERE source_fingerprint = ANY($1::char(64)[])`,
        [residents.map((resident) => resident.sourceFingerprint)]
      )
    const existing = existingFingerprintResult.rows.map((row) => ({
      id: row.id,
      sourceFingerprint: row.source_fingerprint.trim(),
    })).filter((record) => !insertedFingerprints.has(record.sourceFingerprint))
    if (inserted.length) {
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [auditEntry.id, auditEntry.actorId || null, auditEntry.actorRole || null, auditEntry.action,
          auditEntry.targetType || null, auditEntry.targetId || null, { ...auditEntry.metadata, count: inserted.length }]
      )
    }
    await client.query('COMMIT')
    return { inserted, existing, skipped: residents.length - inserted.length, reviewRequired: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function updateRegistryResidentWithAudit(id, updates, auditEntry) {
  const columns = {
    verificationStatus: 'verification_status',
    verifiedBy: 'verified_by',
    verifiedAt: 'verified_at',
    status: 'record_status',
  }
  const entries = Object.entries(updates).filter(([key]) => columns[key])
  if (!entries.length) return null
  const values = entries.map(([, value]) => value)
  const assignments = entries.map(([key], index) => `${columns[key]} = $${index + 1}`)
  values.push(id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE resident_registry SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length} RETURNING *`,
      values
    )
    if (!result.rows.length) {
      await client.query('ROLLBACK')
      return null
    }
    await client.query(
      `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [auditEntry.id, auditEntry.actorId || null, auditEntry.actorRole || null, auditEntry.action,
        auditEntry.targetType || null, auditEntry.targetId || null, auditEntry.metadata || {}]
    )
    await client.query('COMMIT')
    return normalizeRegistryResident(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function archiveApprovalsOlderThan(days = 30) {
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
    const filename = `approvals-${from}_to_${to}-${Date.now()}-${randomUUID().slice(0, 8)}.json`
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

export async function archiveProcessedRequestsOlderThan(days = 30) {
  const daysValue = Number(days)
  if (!Number.isInteger(daysValue) || daysValue < 0) {
    throw new TypeError('Archive retention days must be a non-negative whole number.')
  }
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
    const filename = `queue-approvals-${archivedAt.slice(0, 10)}-${Date.now()}-${randomUUID().slice(0, 8)}.json`
    const payload = {
      archivedAt,
      archivedFor: daysValue === 0 ? 'all processed requests' : `${daysValue} day(s)`,
      total: records.length,
      records,
    }
    await client.query(
      `INSERT INTO archives (id, name, category, contents, created_at)
       VALUES ($1, $2, 'queue-approvals', $3, $4)`,
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
