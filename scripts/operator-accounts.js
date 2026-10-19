import { randomUUID } from 'node:crypto'
import { ADMIN_SEED, IS_PRODUCTION } from '../server/config.js'
import * as postgres from '../server/db-postgres.js'
import {
  deliverAccountInvitationEmail,
  validateAccountInvitationEmailConfig,
} from '../server/account-invitation-email.js'
import { issueStaffInvitation } from '../server/staff-invitations.js'
import {
  deliverSuperAdminInvitation,
  issueSuperAdminInvitation,
  validateSuperAdminInvitationDeliveryConfig,
} from '../server/super-admin-invitations.js'

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
      account_unverified: 'The matching resident is not an active, verified resident. No changes made.',
    }
    throw new Error(messages[result.status] || 'Admin promotion did not complete.')
  }

  if (command === 'promote-super-admin') {
    const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase()
    const mobile = String(process.env.SUPER_ADMIN_MOBILE || '').trim()
    if (!emailPattern.test(email) || !/^09\d{9}$/.test(mobile)) {
      throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_MOBILE must identify the verified account.')
    }
    const result = await postgres.promoteExistingUserToSuperAdmin({
      email,
      mobile,
      auditEntry: (userId, previousRole) => ({
        id: randomUUID(),
        actorId: null,
        actorRole: 'deployment_operator',
        action: 'super_admin.promoted',
        targetType: 'user',
        targetId: userId,
        metadata: { previousRole, newRole: 'super_admin' },
      }),
    })
    if (result.status === 'promoted') {
      console.log('The verified account is now a Super Admin. Its password and other account details were not changed.')
      return
    }
    if (result.status === 'already_super_admin') {
      console.log('The verified account already has the Super Admin role. No changes made.')
      return
    }
    const messages = {
      not_found: 'No account matched both configured identifiers. No changes made.',
      role_conflict: 'The matching account is not an active resident. No changes made.',
      account_unverified: 'The matching resident is not an active, verified resident. No changes made.',
    }
    throw new Error(messages[result.status] || 'Super Admin promotion did not complete.')
  }

  if (command === 'invite-super-admin') {
    const email = String(process.env.SUPER_ADMIN_INVITATION_EMAIL || '').trim().toLowerCase()
    const publicAppUrl = String(process.env.PUBLIC_APP_URL || 'https://barangay-legaspi.vercel.app').trim()
    if (!emailPattern.test(email)) throw new Error('SUPER_ADMIN_INVITATION_EMAIL must be a valid recipient email.')
    const apiKey = process.env.RESEND_API_KEY || ''
    const fromEmail = String(process.env.SUPER_ADMIN_INVITATION_FROM_EMAIL || '').trim()
    validateSuperAdminInvitationDeliveryConfig({ apiKey, fromEmail })
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
    const result = await issueSuperAdminInvitation({ email, publicAppUrl: parsedUrl.origin, store: postgres })
    if (result.status === 'account_exists') {
      throw new Error('An account already uses that email. Promote the existing verified resident instead.')
    }
    if (result.status === 'invitation_pending') {
      throw new Error('A staff invitation is already pending for that email. Resolve it before issuing a Super Admin invitation.')
    }
    if (result.status !== 'created') throw new Error('Super Admin invitation could not be created; no link was issued.')
    try {
      await deliverSuperAdminInvitation({
        apiKey,
        fromEmail,
        email,
        inviteUrl: result.inviteUrl,
        expiresAt: result.expiresAt,
      })
    } catch (error) {
      throw new Error(`Invitation was created but private email delivery failed; the setup link was not printed. Reissue after fixing delivery. ${error.message}`)
    }
    console.log(`Super Admin setup invitation was emailed to the intended account holder. It expires at ${result.expiresAt}. The link was not printed.`)
    return
  }

  if (command === 'invite-admin' || command === 'invite-staff') {
    const role = command === 'invite-admin' ? 'admin' : 'staff'
    const email = String(getOption('--email') || '').trim().toLowerCase()
    const position = role === 'admin' ? 'Administrator' : String(getOption('--position') || 'Staff').trim()
    const hasControlCharacter = [...position].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
    })
    const publicAppUrl = String(process.env.PUBLIC_APP_URL || 'https://barangay-legaspi.vercel.app').trim()
    if (!emailPattern.test(email)) throw new Error('Provide a valid recipient email with --email.')
    if (role === 'staff' && (!position || position.length > 120 || hasControlCharacter || position.includes('<') || position.includes('>'))) {
      throw new Error('Provide a staff position with 1 to 120 printable characters using --position.')
    }
    const apiKey = process.env.RESEND_API_KEY || ''
    const fromEmail = String(process.env.SUPER_ADMIN_INVITATION_FROM_EMAIL || '').trim()
    validateAccountInvitationEmailConfig({ apiKey, fromEmail })
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
    const result = await issueStaffInvitation({ email, position, role, publicAppUrl: parsedUrl.origin, store: postgres })
    if (result.status === 'account_exists') {
      throw new Error('An account already uses that email. No invitation was created.')
    }
    if (result.status !== 'created') throw new Error('Invitation could not be created; no link was issued.')
    try {
      await deliverAccountInvitationEmail({
        apiKey,
        fromEmail,
        email,
        inviteUrl: result.inviteUrl,
        expiresAt: result.expiresAt,
        role,
      })
    } catch (deliveryError) {
      const revoked = await postgres.revokeStaffInvitation({
        invitationId: result.id,
        revokedAt: new Date().toISOString(),
        auditEntry: {
          id: randomUUID(),
          actorId: null,
          actorRole: 'deployment_operator',
          action: `${role}.invitation.delivery_failed`,
          targetType: `${role}_invitation`,
          targetId: result.id,
          metadata: { role: 'staff' },
        },
      })
      if (revoked.status !== 'revoked') {
        throw new Error(`Invitation delivery failed and revocation was not confirmed (${revoked.status}).`)
      }
      throw new Error(`Invitation email delivery failed; the invitation was revoked and its link was not printed. ${deliveryError.message}`)
    }
    console.log(`${role === 'admin' ? 'Admin' : 'Staff'} setup invitation was emailed to the intended account holder. It expires at ${result.expiresAt}. The link was not printed.`)
    return
  }

  throw new Error('Usage: node scripts/operator-accounts.js <promote-admin|promote-super-admin|invite-admin|invite-super-admin|invite-staff> --confirm [--email recipient] [--position title]')
}

try {
  await run()
} catch (error) {
  console.error(`Operator account action failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await postgres.closeDatabase()
}
