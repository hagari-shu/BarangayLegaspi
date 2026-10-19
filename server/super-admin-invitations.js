import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const hashSuperAdminInvitationToken = (token) => createHash('sha256').update(token).digest('hex')

export const isValidSuperAdminInvitationToken = (token) => /^[A-Za-z0-9_-]{43}$/.test(String(token || ''))

export function validateSuperAdminInvitationDeliveryConfig({ deliveryUrl, deliveryToken }) {
  if (!deliveryUrl || !deliveryToken) {
    throw new Error('Private Super Admin invitation delivery URL and token must be configured.')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(deliveryUrl)
  } catch {
    throw new Error('Private Super Admin invitation delivery URL must be a valid HTTPS URL.')
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
    throw new Error('Private Super Admin invitation delivery URL must use HTTPS and contain no credentials or fragment.')
  }

  return parsedUrl
}

export async function deliverSuperAdminInvitation({
  deliveryUrl,
  deliveryToken,
  email,
  inviteUrl,
  expiresAt,
  fetchImpl = fetch,
}) {
  const parsedUrl = validateSuperAdminInvitationDeliveryConfig({ deliveryUrl, deliveryToken })
  const response = await fetchImpl(parsedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deliveryToken}`,
    },
    body: JSON.stringify({
      event: 'super_admin_invitation',
      recipient: email,
      inviteUrl,
      expiresAt,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`Private invitation delivery failed with status ${response.status}.`)
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
