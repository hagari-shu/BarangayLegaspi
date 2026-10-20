const resendApiUrl = 'https://api.resend.com/emails'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validatePasswordResetEmailConfig({ apiKey, fromEmail }) {
  if (!apiKey || !fromEmail) {
    throw new Error('Resend API key and password reset sender email must be configured.')
  }
  if (!emailPattern.test(fromEmail) || fromEmail.length > 254) {
    throw new Error('PASSWORD_RESET_FROM_EMAIL must be a valid sender email address.')
  }
}

export async function deliverPasswordResetEmail({
  apiKey,
  fromEmail,
  email,
  token,
  expiresAt,
  fetchImpl = fetch,
}) {
  validatePasswordResetEmailConfig({ apiKey, fromEmail })

  const response = await fetchImpl(resendApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `Barangay Legaspi <${fromEmail}>`,
      to: [email],
      subject: 'Your Barangay Legaspi password reset code',
      html: `<p>Use this one-time code to reset your Barangay Legaspi password:</p><p><strong>${token}</strong></p><p>This code expires at ${new Date(expiresAt).toISOString()} and can only be used once.</p><p>If you did not request a password reset, you can ignore this email.</p>`,
      text: `Use this one-time code to reset your Barangay Legaspi password:\n\n${token}\n\nThis code expires at ${new Date(expiresAt).toISOString()} and can only be used once.\nIf you did not request a password reset, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`Resend password reset delivery failed with status ${response.status}.`)
  }
}
