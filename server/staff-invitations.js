import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const hashStaffInvitationToken = (token) => createHash('sha256').update(token).digest('hex')

export const isValidStaffInvitationToken = (token) => /^[A-Za-z0-9_-]{43}$/.test(String(token || ''))

export async function issueStaffInvitation({
  email,
  publicAppUrl,
  role = 'staff',
  position = 'Staff',
  actor = null,
  store,
  now = new Date(),
}) {
  const token = randomBytes(32).toString('base64url')
  const invitation = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    role,
    position,
    tokenHash: hashStaffInvitationToken(token),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  }
  if (!['admin', 'staff'].includes(invitation.role)) {
    throw new Error('Account invitations support only Admin and Staff roles.')
  }
  const result = await store.issueStaffInvitation(invitation, {
    id: randomUUID(),
    actorId: actor?.id || null,
    actorRole: actor?.role || 'deployment_operator',
    action: `${role}.invitation.issued`,
    targetType: `${role}_invitation`,
    targetId: invitation.id,
    metadata: { expiresAt: invitation.expiresAt, role },
  })
  if (result.status !== 'created') return result

  const inviteUrl = new URL('/staff-invite', publicAppUrl)
  inviteUrl.hash = new URLSearchParams({ token }).toString()
  return { status: 'created', id: invitation.id, expiresAt: invitation.expiresAt, inviteUrl: inviteUrl.toString() }
}

export function createStaffInvitationAcceptanceAudit(userId, invitationId, role = 'staff') {
  return {
    id: randomUUID(),
    actorId: userId,
    actorRole: role,
    action: `${role}.invitation.accepted`,
    targetType: 'user',
    targetId: userId,
    metadata: { invitationId },
  }
}
