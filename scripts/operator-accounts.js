import { randomUUID } from 'node:crypto'
import { ADMIN_SEED, IS_PRODUCTION } from '../server/config.js'
import * as postgres from '../server/db-postgres.js'
import { issueStaffInvitation } from '../server/staff-invitations.js'

const emailPattern = /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/
const command = process.argv[2]
const argumentsList = process.argv.slice(3)
const isConfirmed = argumentsList.includes('--confirm')
const getOption = (name) => {
  const index = argumentsList.indexOf(name)
  return index >= 0 ? argumentsList[index + 1] : ''
}

async function run() {
  if (!IS_PRODUCTION || !process.env.DATABASE_URL) {
    throw new Error('This operator command only runs with the active production PostgreSQL configuration.')
  }
  if (!isConfirmed) {
    throw new Error('No changes made. Re-run with --confirm after verifying the target account or invitation recipient.')
  }

  if (command === 'promote-admin') {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_MOBILE) {
      throw new Error('ADMIN_EMAIL and ADMIN_MOBILE must identify the verified account in the active service environment.')
    }
    const result = await postgres.promoteExistingUserToAdmin({
      email: ADMIN_SEED.email,
      mobile: ADMIN_SEED.mobile,
      auditEntry: (userId, previousRole) => ({
        id: randomUUID(),
        actorId: null,
        actorRole: 'deployment_operator',
        action: 'admin.promoted',
        targetType: 'user',
        targetId: userId,
        metadata: { previousRole, newRole: 'admin' },
      }),
    })
    if (result.status === 'promoted') {
      console.log('The verified account is now an administrator. Its password and other account details were not changed.')
      return
    }
    if (result.status === 'already_admin') {
      console.log('The verified account already has the administrator role. No changes made.')
      return
    }
    const messages = {
      not_found: 'No account matched both configured identifiers. No changes made.',
      role_conflict: 'The matching account has a non-resident role. No changes made.',
      account_disabled: 'The matching account is suspended or disabled. No changes made.',
    }
    throw new Error(messages[result.status] || 'Admin promotion did not complete.')
  }

  if (command === 'invite-staff') {
    const email = String(getOption('--email') || '').trim().toLowerCase()
    const publicAppUrl = String(process.env.PUBLIC_APP_URL || 'https://barangay-legaspi.vercel.app').trim()
    if (!emailPattern.test(email)) throw new Error('Provide a valid recipient email with --email.')
    if (!publicAppUrl) throw new Error('PUBLIC_APP_URL must be the official HTTPS portal origin.')
    const parsedUrl = new URL(publicAppUrl)
    if (
      parsedUrl.protocol !== 'https:'
      || parsedUrl.username
      || parsedUrl.password
      || parsedUrl.pathname !== '/'
      || parsedUrl.search
      || parsedUrl.hash
    ) {
      throw new Error('PUBLIC_APP_URL must be an HTTPS origin without credentials.')
    }
    const result = await issueStaffInvitation({ email, publicAppUrl: parsedUrl.origin, store: postgres })
    if (result.status === 'account_exists') {
      throw new Error('An account already uses that email. No invitation was created.')
    }
    if (result.status !== 'created') throw new Error('Invitation could not be created; no link was issued.')
    console.log(`Invitation expires at ${result.expiresAt}. Deliver this link securely to the invitee; it is not emailed automatically:`)
    console.log(result.inviteUrl)
    console.log('Treat the link as a temporary credential. Do not save it in chat, logs, or tickets.')
    return
  }

  throw new Error('Usage: node scripts/operator-accounts.js <promote-admin|invite-staff> --confirm [--email recipient]')
}

try {
  await run()
} catch (error) {
  console.error(`Operator account action failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await postgres.closeDatabase()
}
