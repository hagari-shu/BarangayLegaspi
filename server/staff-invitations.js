import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const hashStaffInvitationToken = (token) => createHash('sha256').update(token).digest('hex')

export const isValidStaffInvitationToken = (token) => /^[A-Za-z0-9_-]{43}$/.test(String(token || ''))

export async function issueStaffInvitation({ email, publicAppUrl, position = 'Staff', store, now = new Date() }) {
  const token = randomBytes(32).toString('base64url')
  const invitation = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    position,
    tokenHash: hashStaffInvitationToken(token),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  }
  const result = await store.issueStaffInvitation(invitation, {
    id: randomUUID(),
    actorId: null,
    actorRole: 'deployment_operator',
    action: 'staff.invitation.issued',
    targetType: 'staff_invitation',
    targetId: invitation.id,
    metadata: { expiresAt: invitation.expiresAt },
  })
  if (result.status !== 'created') return result

  const inviteUrl = new URL('/staff-invite', publicAppUrl)
  inviteUrl.hash = new URLSearchParams({ token }).toString()
  return { status: 'created', expiresAt: invitation.expiresAt, inviteUrl: inviteUrl.toString() }
}

export function createStaffInvitationAcceptanceAudit(userId, invitationId) {
  return {
    id: randomUUID(),
    actorId: userId,
    actorRole: 'staff',
    action: 'staff.invitation.accepted',
    targetType: 'user',
    targetId: userId,
    metadata: { invitationId },
  }
}
