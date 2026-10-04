import { JWT_SECRET, MFA_ENCRYPTION_KEY } from '../server/config.js'
import { closeDatabase, query } from '../server/db-postgres.js'
import { decryptTotpSecret, encryptTotpSecret } from '../server/mfa.js'

const argumentsList = process.argv.slice(2)
const applyChanges = argumentsList.includes('--apply')

if (argumentsList.some((argument) => argument !== '--apply') || argumentsList.length > 1) {
  throw new Error('Usage: npm run mfa:rotate-key [-- --apply]')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point to the PostgreSQL database to migrate.')
}
if (!MFA_ENCRYPTION_KEY || MFA_ENCRYPTION_KEY.length < 32) {
  throw new Error('Set MFA_ENCRYPTION_KEY to a distinct random value of at least 32 characters.')
}
if (MFA_ENCRYPTION_KEY === JWT_SECRET) {
  throw new Error('MFA_ENCRYPTION_KEY must be different from JWT_SECRET.')
}

try {
  const { rows } = await query(
    "SELECT id, mfa_secret FROM users WHERE mfa_secret LIKE 'v1.%' OR mfa_secret LIKE 'v2.%' ORDER BY id"
  )

  let converted = 0
  for (const row of rows) {
    const plaintext = decryptTotpSecret(row.mfa_secret)
    if (applyChanges) {
      const encrypted = encryptTotpSecret(plaintext)
      const result = await query(
        "UPDATE users SET mfa_secret = $1 WHERE id = $2 AND mfa_secret = $3",
        [encrypted, row.id, row.mfa_secret]
      )
      if (result.rowCount !== 1) {
        throw new Error('An MFA record changed during rotation; rerun the dry run before applying again.')
      }
      decryptTotpSecret(encrypted, { allowPrevious: false })
      converted += 1
    }
  }

  const { rows: legacyRows } = await query(
    "SELECT COUNT(*)::int AS count FROM users WHERE mfa_secret LIKE 'v1.%'"
  )
  const { rows: currentRows } = await query(
    "SELECT id, mfa_secret FROM users WHERE mfa_secret LIKE 'v2.%' ORDER BY id"
  )
  if (applyChanges) {
    for (const row of currentRows) {
      decryptTotpSecret(row.mfa_secret, { allowPrevious: false })
    }
  }

  const legacyCount = legacyRows[0].count
  console.log(`${applyChanges ? 'Re-encrypted' : 'Validated'} ${applyChanges ? converted : rows.length} MFA record(s).`)
  console.log(`${legacyCount} legacy MFA record(s) remain.`)
  if (applyChanges) {
    console.log(`${currentRows.length} record(s) verified with the current key.`)
  }

  if (applyChanges && legacyCount > 0) {
    throw new Error('Some legacy MFA records remain; rerun after checking concurrent updates.')
  }
} finally {
  await closeDatabase()
}
