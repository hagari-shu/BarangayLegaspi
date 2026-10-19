import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const hashSuperAdminInvitationToken = (token) => createHash('sha256').update(token).digest('hex')

export const isValidSuperAdminInvitationToken = (token) => /^[A-Za-z0-9_-]{43}$/.test(String(token || ''))

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
