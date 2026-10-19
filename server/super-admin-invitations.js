import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const hashSuperAdminInvitationToken = (token) => createHash('sha256').update(token).digest('hex')

export const isValidSuperAdminInvitationToken = (token) => /^[A-Za-z0-9_-]{43}$/.test(String(token || ''))

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const resendApiUrl = 'https://api.resend.com/emails'
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character])

export function validateSuperAdminInvitationDeliveryConfig({ apiKey, fromEmail }) {
  if (!apiKey || !fromEmail) {
    throw new Error('Resend API key and verified Super Admin invitation sender email must be configured.')
  }
  if (!emailPattern.test(fromEmail) || fromEmail.length > 254) {
    throw new Error('SUPER_ADMIN_INVITATION_FROM_EMAIL must be a valid sender email address.')
  }
}

export async function deliverSuperAdminInvitation({
  apiKey,
  fromEmail,
  email,
  inviteUrl,
  expiresAt,
  fetchImpl = fetch,
}) {
  validateSuperAdminInvitationDeliveryConfig({ apiKey, fromEmail })
  const safeInviteUrl = escapeHtml(inviteUrl)
  const response = await fetchImpl(resendApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `Barangay Legaspi <${fromEmail}>`,
      to: [email],
      subject: 'Super Admin account setup invitation',
      html: `<p>You have been invited to set up a Barangay Legaspi Super Admin account.</p><p><a href="${safeInviteUrl}">Set up your account</a></p><p>This single-use link expires at ${escapeHtml(expiresAt)}.</p><p>If you were not expecting this invitation, you can ignore this email.</p>`,
      text: `You have been invited to set up a Barangay Legaspi Super Admin account.\n\nSet up your account: ${inviteUrl}\n\nThis single-use link expires at ${expiresAt}.\nIf you were not expecting this invitation, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`Resend invitation delivery failed with status ${response.status}.`)
  }
}

export async function issueSuperAdminInvitation({ email, publicAppUrl, store, now = new Date() }) {
  const token = randomBytes(32).toString('base64url')
  const invitation = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    tokenHash: hashSuperAdminInvitationToken(token),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  }
  const result = await store.issueSuperAdminInvitation(invitation, {
    id: randomUUID(),
    actorId: null,
    actorRole: 'deployment_operator',
    action: 'super_admin.invitation.issued',
    targetType: 'super_admin_invitation',
    targetId: invitation.id,
    metadata: { expiresAt: invitation.expiresAt },
  })
  if (result.status !== 'created') return result

  const inviteUrl = new URL('/super-admin-invite', publicAppUrl)
  inviteUrl.hash = new URLSearchParams({ token }).toString()
  return { status: 'created', expiresAt: invitation.expiresAt, inviteUrl: inviteUrl.toString() }
}

export function createSuperAdminInvitationAcceptanceAudit(userId, invitationId) {
  return {
    id: randomUUID(),
    actorId: userId,
    actorRole: 'super_admin',
    action: 'super_admin.invitation.accepted',
    targetType: 'user',
    targetId: userId,
    metadata: { invitationId },
  }
}
