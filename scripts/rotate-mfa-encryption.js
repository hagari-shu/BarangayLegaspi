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
    "SELECT id, mfa_secret FROM users WHERE mfa_secret LIKE 'v1.%' ORDER BY id"
  )

  for (const row of rows) {
    const plaintext = decryptTotpSecret(row.mfa_secret)
    if (applyChanges) {
      const encrypted = encryptTotpSecret(plaintext)
      await query(
        "UPDATE users SET mfa_secret = $1 WHERE id = $2 AND mfa_secret = $3",
        [encrypted, row.id, row.mfa_secret]
      )
    }
  }

  const { rows: remainingRows } = await query(
    "SELECT COUNT(*)::int AS count FROM users WHERE mfa_secret LIKE 'v1.%'"
  )
  const remaining = remainingRows[0].count
  console.log(`${applyChanges ? 'Converted' : 'Validated'} ${rows.length} legacy MFA record(s).`)
  console.log(`${remaining} legacy MFA record(s) remain.`)

  if (applyChanges && remaining > 0) {
    throw new Error('Some legacy MFA records remain; rerun after checking concurrent updates.')
  }
} finally {
  await closeDatabase()
}
