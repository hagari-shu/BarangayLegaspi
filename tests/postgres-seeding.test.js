import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused'
process.env.ADMIN_PASSWORD = 'TestAdminPass123!'

const [{ default: pg }, { initDatabase, createStaffInvitation, redeemStaffInvitation }, { decryptResidentPrivateData }] = await Promise.all([
  import('pg'),
  import('../server/db-postgres.js'),
  import('../server/resident-registry-crypto.js'),
])

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
  assert.ok(queries.some((sql) => sql.startsWith('create table if not exists staff_invitations')))
  assert.ok(queries.some((sql) => sql.includes('staff_invitations_pending_email_unique')))
  assert.ok(queries.some((sql) => sql.includes('staff_invitations_pending_mobile_unique')))
  assert.ok(queries.some((sql) => sql.startsWith('create table if not exists resident_registry')))
  assert.ok(queries.some((sql) => sql.includes('encrypted_data text')))
  assert.ok(queries.some((sql) => sql.includes('drop index if exists resident_registry_household_location_idx')))
  assert.equal(queries.some((sql) => sql.includes('resident_registry_first_name_prefix_idx')), false)
  assert.equal(queries.some((sql) => sql.includes('resident_registry_last_name_prefix_idx')), false)
  assert.equal(queries.some((sql) => sql.startsWith('insert into users')), false)
})

test('PostgreSQL startup encrypts legacy registry data and clears plaintext columns', async () => {
  let encryptedUpdate = null
  const originalConnect = pg.Pool.prototype.connect
  pg.Pool.prototype.connect = async function () {
    return {
      query: async (sql, params = []) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        if (normalizedSql.startsWith('select id, first_name, last_name, birth_date')) {
          return {
            rows: [{
              id: 'legacy-resident-id',
              first_name: 'Legacy',
              last_name: 'Resident',
              birth_date: '1990-01-02',
              sex: 'Female',
              household_id: 'HH-LEGACY',
              address: 'Private address',
              source_reference: 'Roster line 1',
              source_filename: 'private-roster.csv',
            }],
          }
        }
        if (normalizedSql.startsWith('update resident_registry set encrypted_data')) {
          encryptedUpdate = { sql: normalizedSql, params }
        }
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

  assert.ok(encryptedUpdate)
  assert.match(encryptedUpdate.sql, /first_name = '', last_name = ''/)
  assert.match(encryptedUpdate.sql, /household_id = null/)
  assert.deepEqual(decryptResidentPrivateData(encryptedUpdate.params[0], encryptedUpdate.params[1]), {
    firstName: 'Legacy',
    lastName: 'Resident',
    birthDate: '1990-01-02',
    sex: 'Female',
    householdId: 'HH-LEGACY',
    address: 'Private address',
    sourceReference: 'Roster line 1',
    sourceFilename: 'private-roster.csv',
  })
})

test('PostgreSQL staff invitation issuance and redemption are transactional and audit without contact details', async () => {
  const queries = []
  const invite = {
    id: 'b4c34e0d-7518-45a7-a489-b65d2e7f584f',
    tokenHash: 'a'.repeat(64),
    email: 'staff.invitee@example.com',
    mobile: '09123456789',
    operatorId: 'operator-test-id',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }
  const originalConnect = pg.Pool.prototype.connect
  pg.Pool.prototype.connect = async function () {
    return {
      query: async (sql, params = []) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        queries.push({ sql: normalizedSql, params })
        if (normalizedSql.startsWith('select * from staff_invitations where token_hash')) {
          return { rows: [{
            id: invite.id,
            token_hash: invite.tokenHash,
            email: invite.email,
            mobile: invite.mobile,
            expires_at: invite.expiresAt,
            accepted_at: null,
            revoked_at: null,
          }] }
        }
        if (normalizedSql.startsWith('select id from users')) return { rows: [] }
        return { rows: [] }
      },
      release() {},
    }
  }

  try {
    await createStaffInvitation(invite)
    const result = await redeemStaffInvitation({
      tokenHash: invite.tokenHash,
      firstName: 'Test',
      lastName: 'Invitee',
      passwordHash: 'hashed-password',
      userId: 'b9c7519c-583a-4e23-ae6c-63113cc2c07f',
    })
    assert.equal(result.email, invite.email)
  } finally {
    pg.Pool.prototype.connect = originalConnect
  }

  assert.equal(queries.filter(({ sql }) => sql === 'begin').length, 2)
  assert.equal(queries.filter(({ sql }) => sql === 'commit').length, 2)
  assert.ok(queries.some(({ sql }) => sql.includes("values ($1, $2, $3, $4, $5, $6, 'staff'")))
  const auditQueries = queries.filter(({ sql }) => sql.startsWith('insert into audit_logs'))
  assert.equal(auditQueries.length, 2)
  assert.equal(JSON.stringify(auditQueries).includes(invite.email), false)
  assert.equal(JSON.stringify(auditQueries).includes(invite.mobile), false)
  assert.equal(JSON.stringify(auditQueries).includes(invite.tokenHash), false)
})
