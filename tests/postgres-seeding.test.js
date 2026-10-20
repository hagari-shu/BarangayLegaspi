import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused'
process.env.ADMIN_PASSWORD = 'TestAdminPass123!'

const [{ default: pg }, {
  acceptSuperAdminInvitation,
  initDatabase,
  issueSuperAdminInvitation,
  promoteExistingUserToSuperAdmin,
  resolveDatabaseSslOption,
}] = await Promise.all([
  import('pg'),
  import('../server/db-postgres.js'),
])

test('PostgreSQL connection keeps TLS by default and allows disabling it for private local databases', () => {
  assert.deepEqual(resolveDatabaseSslOption('postgresql://localhost/database'), { rejectUnauthorized: false })
  assert.equal(resolveDatabaseSslOption('postgresql://postgres/database', 'false'), false)
  assert.equal(resolveDatabaseSslOption(undefined, 'true'), false)
})

test('PostgreSQL initialization skips admin seeding when a seed identifier already exists', async () => {
  const queries = []
  const originalConnect = pg.Pool.prototype.connect
  pg.Pool.prototype.connect = async function () {
    return {
      query: async (sql) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        queries.push(normalizedSql)
        if (normalizedSql === 'select id from users where email = $1 or mobile = $2 limit 1') {
          return { rows: [{ id: 'existing-account' }] }
        }
        return { rows: [] }
      },
      release() {},
    }
  }

  try {
    await initDatabase()
  } finally {
    pg.Pool.prototype.connect = originalConnect
  }

  assert.ok(queries.includes('select id from users where email = $1 or mobile = $2 limit 1'))
  assert.ok(queries.some((sql) => sql.startsWith('create table if not exists resident_registry')))
  assert.ok(queries.some((sql) => sql.startsWith('create table if not exists staff_temporary_access_grants')))
  assert.ok(queries.some((sql) => sql.startsWith('create table if not exists official_profiles')))
  assert.ok(queries.some((sql) => sql.includes('resident_registry_first_name_prefix_idx')))
  assert.ok(queries.some((sql) => sql.includes('resident_registry_last_name_prefix_idx')))
  assert.equal(queries.some((sql) => sql.startsWith('insert into users')), false)
})

test('PostgreSQL Super Admin promotion updates only a verified matching resident and audits it transactionally', async () => {
  const statements = []
  const parameters = []
  const originalConnect = pg.Pool.prototype.connect
  pg.Pool.prototype.connect = async function () {
    return {
      query: async (sql, values = []) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        statements.push(normalizedSql)
        parameters.push(values)
        if (normalizedSql.startsWith('select id, role, status from users')) {
          return { rows: [{ id: 'verified-resident', role: 'resident', status: 'Active Resident' }] }
        }
        return { rows: [] }
      },
      release() {},
    }
  }

  try {
    const result = await promoteExistingUserToSuperAdmin({
      email: 'verified@example.test',
      mobile: '09170000099',
      auditEntry: (userId, previousRole) => ({
        id: 'audit-super-admin-promotion',
        actorRole: 'deployment_operator',
        action: 'super_admin.promoted',
        targetType: 'user',
        targetId: userId,
        metadata: { previousRole, newRole: 'super_admin' },
      }),
    })

    assert.deepEqual(result, { status: 'promoted', userId: 'verified-resident' })
    assert.ok(statements.includes('begin'))
    assert.ok(statements.includes("update users set role = 'super_admin' where id = $1"))
    assert.ok(statements.includes('commit'))
    assert.deepEqual(
      parameters.find((values) => values[0] === 'audit-super-admin-promotion').slice(3, 6),
      ['super_admin.promoted', 'user', 'verified-resident'],
    )
    assert.equal(statements.some((sql) => sql.includes('password_hash =')), false)
  } finally {
    pg.Pool.prototype.connect = originalConnect
  }
})

test('PostgreSQL Super Admin setup invitations persist token hashes and create accounts transactionally', async () => {
  const statements = []
  const parameters = []
  const originalConnect = pg.Pool.prototype.connect
  pg.Pool.prototype.connect = async function () {
    return {
      query: async (sql, values = []) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        statements.push(normalizedSql)
        parameters.push(values)
        if (normalizedSql.startsWith('select id from users where lower(email) = $1 limit 1')) return { rows: [] }
        if (normalizedSql.startsWith('select id from staff_invitations')) return { rows: [] }
        if (normalizedSql.startsWith('select email from super_admin_invitations')) {
          return { rows: [{ email: 'invited@example.test' }] }
        }
        if (normalizedSql.startsWith('select id, email, expires_at as')) {
          return { rows: [{
            id: 'invitation-id',
            email: 'invited@example.test',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            acceptedAt: null,
            revokedAt: null,
          }] }
        }
        if (normalizedSql.startsWith('select id from users where lower(email) = $1 or mobile = $2')) return { rows: [] }
        return { rows: [] }
      },
      release() {},
    }
  }

  try {
    const invitation = {
      id: 'invitation-id',
      email: 'invited@example.test',
      tokenHash: 'a'.repeat(64),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    }
    const issued = await issueSuperAdminInvitation(invitation, {
      id: 'audit-issued',
      actorRole: 'deployment_operator',
      action: 'super_admin.invitation.issued',
      targetType: 'super_admin_invitation',
      targetId: invitation.id,
      metadata: { expiresAt: invitation.expiresAt },
    })
    assert.deepEqual(issued, { status: 'created' })

    const accepted = await acceptSuperAdminInvitation({
      tokenHash: invitation.tokenHash,
      user: {
        id: 'new-super-admin',
        firstName: 'New',
        lastName: 'Admin',
        mobile: '09170000091',
        passwordHash: 'hashed-password',
        householdId: 'ADMIN-TEST',
      },
      acceptedAt: new Date().toISOString(),
      auditEntry: {
        id: 'audit-accepted',
        actorRole: 'super_admin',
        action: 'super_admin.invitation.accepted',
        targetType: 'user',
        targetId: 'new-super-admin',
        metadata: { invitationId: invitation.id },
      },
    })

    assert.deepEqual(accepted, { status: 'created', userId: 'new-super-admin' })
    assert.ok(statements.includes('begin'))
    assert.ok(statements.includes('commit'))
    assert.ok(statements.some((sql) => sql.startsWith('insert into super_admin_invitations')))
    assert.ok(statements.some((sql) => sql.includes("'super_admin'")))
    assert.ok(statements.includes('update super_admin_invitations set accepted_at = $2 where id = $1'))
    assert.ok(parameters.some((values) => values.includes(invitation.tokenHash)))
    assert.equal(parameters.some((values) => values.includes('raw-invitation-token')), false)
  } finally {
    pg.Pool.prototype.connect = originalConnect
  }
})
