const resendApiUrl = 'https://api.resend.com/emails'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character])

export function validateAccountInvitationEmailConfig({ apiKey, fromEmail }) {
  if (!apiKey || !fromEmail) {
    throw new Error('Resend API key and verified account invitation sender email must be configured.')
  }
  if (!emailPattern.test(fromEmail) || fromEmail.length > 254) {
    throw new Error('SUPER_ADMIN_INVITATION_FROM_EMAIL must be a valid sender email address.')
  }
}

export async function deliverAccountInvitationEmail({
  apiKey,
  fromEmail,
  email,
  inviteUrl,
  expiresAt,
  role,
  fetchImpl = fetch,
}) {
  validateAccountInvitationEmailConfig({ apiKey, fromEmail })
  const labels = {
    admin: { label: 'Administrator', subject: 'Administrator account setup invitation' },
    staff: { label: 'Staff', subject: 'Staff account setup invitation' },
    super_admin: { label: 'Super Admin', subject: 'Super Admin account setup invitation' },
  }
  const account = labels[role]
  if (!account) throw new Error('Unsupported account invitation role.')

  const safeInviteUrl = escapeHtml(inviteUrl)
  const safeExpiresAt = escapeHtml(expiresAt)
  const response = await fetchImpl(resendApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `Barangay Legaspi <${fromEmail}>`,
      to: [email],
      subject: account.subject,
      html: `<p>You have been invited to set up a Barangay Legaspi ${account.label} account.</p><p><a href="${safeInviteUrl}">Set up your account</a></p><p>This single-use link expires at ${safeExpiresAt}.</p><p>If you were not expecting this invitation, you can ignore this email.</p>`,
      text: `You have been invited to set up a Barangay Legaspi ${account.label} account.\n\nSet up your account: ${inviteUrl}\n\nThis single-use link expires at ${expiresAt}.\nIf you were not expecting this invitation, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`Resend invitation delivery failed with status ${response.status}.`)
  }
}
