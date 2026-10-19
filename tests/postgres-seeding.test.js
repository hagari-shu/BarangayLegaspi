import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused'
process.env.ADMIN_PASSWORD = 'TestAdminPass123!'

const [{ default: pg }, { initDatabase, promoteExistingUserToSuperAdmin }] = await Promise.all([
  import('pg'),
  import('../server/db-postgres.js'),
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
