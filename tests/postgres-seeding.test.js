import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused'
process.env.ADMIN_PASSWORD = 'TestAdminPass123!'

const [{ default: pg }, { initDatabase }, { decryptResidentPrivateData }] = await Promise.all([
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
