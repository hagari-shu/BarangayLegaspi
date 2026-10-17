import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused'
process.env.ADMIN_PASSWORD = 'TestAdminPass123!'

const [{ default: pg }, {
  archiveProcessedRequestsOlderThan,
  createStaffInvitation,
  initDatabase,
  redeemStaffInvitation,
  restoreArchivedRequests,
  updateRegistryResident,
}, { decryptResidentPrivateData }] = await Promise.all([
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
  assert.ok(queries.some((sql) => sql.includes('using gin (name_search_tokens)')))
  assert.ok(queries.some((sql) => sql.startsWith('create table if not exists resident_registry_search_key_state')))
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

test('PostgreSQL resident edits re-encrypt private fields and refresh keyed name search', async () => {
  const { encryptResidentPrivateData, residentNameSearchCandidates } = await import('../server/resident-registry-crypto.js')
  const id = 'edited-resident-id'
  const initialPrivateData = {
    firstName: 'Before',
    lastName: 'Name',
    birthDate: '1990-01-01',
    sex: 'Female',
    householdId: 'HH-1',
    maritalStatus: 'Married',
    occupation: 'Teacher',
    address: 'Old address',
    sourceReference: 'Sheet 1',
    sourceFilename: 'roster.csv',
  }
  const initialEncryptedData = encryptResidentPrivateData(initialPrivateData, id)
  let updatedQuery = null
  const originalConnect = pg.Pool.prototype.connect
  pg.Pool.prototype.connect = async function () {
    return {
      query: async (sql, params = []) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        if (normalizedSql.startsWith('select * from resident_registry where id = $1 for update')) {
          return { rows: [{
            id,
            encrypted_data: initialEncryptedData,
            name_search_tokens: [],
            purok: 'Purok 1',
            zone: 1,
            record_status: 'active',
            verification_status: 'verified',
          }] }
        }
        if (normalizedSql.startsWith('update resident_registry set encrypted_data')) {
          updatedQuery = { sql: normalizedSql, params }
          return { rows: [{
            id,
            encrypted_data: params[0],
            name_search_tokens: params[1],
            zone: params[2],
            purok: 'Purok 1',
            record_status: 'active',
            verification_status: 'verified',
          }] }
        }
        return { rows: [] }
      },
      release() {},
    }
  }

  let resident
  try {
    resident = await updateRegistryResident(id, {
      firstName: 'Updated',
      birthDate: '1991-02-03',
      maritalStatus: 'Single',
      occupation: 'Nurse',
      zone: 2,
    })
  } finally {
    pg.Pool.prototype.connect = originalConnect
  }

  assert.ok(updatedQuery)
  assert.match(updatedQuery.sql, /name_search_tokens = \$2/)
  assert.deepEqual(decryptResidentPrivateData(updatedQuery.params[0], id), {
    ...initialPrivateData,
    firstName: 'Updated',
    birthDate: '1991-02-03',
    maritalStatus: 'Single',
    occupation: 'Nurse',
  })
  assert.equal(resident.firstName, 'Updated')
  assert.equal(resident.birthDate, '1991-02-03')
  assert.equal(resident.maritalStatus, 'Single')
  assert.equal(resident.occupation, 'Nurse')
  assert.equal(resident.zone, 2)
  const nameSearchCandidates = residentNameSearchCandidates('Updated')
  assert.ok(nameSearchCandidates[0].some((token) => updatedQuery.params[1].includes(token)))
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

test('PostgreSQL request archives are bounded, uniquely named, and restored without deleting the archive', async () => {
  const archiveQueries = []
  const requestId = 'e1281819-ef45-4fae-a418-1e47ce2ce58b'
  const userId = 'd7c58338-b3b2-43c3-8fa9-e4b2f6eaef35'
  const originalConnect = pg.Pool.prototype.connect
  pg.Pool.prototype.connect = async function () {
    return {
      query: async (sql, params = []) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        archiveQueries.push({ sql: normalizedSql, params })
        if (normalizedSql.startsWith('select * from requests')) {
          return { rows: [{
            id: requestId,
            user_id: userId,
            type: 'Certificate',
            purpose: 'Synthetic archive test',
            status: 'Approved',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
          }] }
        }
        if (normalizedSql.startsWith('select count(*)::int as total from requests')) {
          return { rows: [{ total: 2 }] }
        }
        if (normalizedSql.startsWith('select contents from archives')) {
          return { rows: [{
            contents: {
              records: [{
                id: requestId,
                userId,
                type: 'Certificate',
                purpose: 'Synthetic archive test',
                status: 'Approved',
                date: '2026-01-01T00:00:00.000Z',
              }],
            },
          }] }
        }
        if (normalizedSql.startsWith('insert into requests')) return { rowCount: 1, rows: [{ id: requestId }] }
        return { rows: [], rowCount: 0 }
      },
      release() {},
    }
  }

  try {
    const archived = await archiveProcessedRequestsOlderThan()
    assert.equal(archived.count, 1)
    assert.equal(archived.remaining, 2)
    assert.match(archived.filename, /^queue-approvals-.*-[0-9a-f-]{36}\.json$/)
    const select = archiveQueries.find(({ sql }) => sql.startsWith('select * from requests'))
    assert.match(select.sql, /limit 500 for update skip locked/)
    const insertArchive = archiveQueries.find(({ sql }) => sql.startsWith('insert into archives'))
    const payload = JSON.parse(insertArchive.params[2])
    assert.equal(payload.archivedFor, 'manual')
    assert.equal(payload.total, 1)
    assert.equal(archiveQueries.some(({ sql }) => sql.includes('on conflict (name) do update')), false)

    archiveQueries.length = 0
    const restored = await restoreArchivedRequests(archived.filename)
    assert.deepEqual(restored, { restoredCount: 1, conflictCount: 0 })
    assert.ok(archiveQueries.some(({ sql }) => sql.startsWith('select contents from archives')))
    assert.ok(archiveQueries.some(({ sql }) => sql.startsWith('insert into requests')))
    assert.equal(archiveQueries.some(({ sql }) => sql.startsWith('delete from archives')), false)
  } finally {
    pg.Pool.prototype.connect = originalConnect
  }
})
