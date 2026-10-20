const resendApiUrl = 'https://api.resend.com/emails'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function deliverProfileEmailVerification({
  apiKey,
  fromEmail,
  email,
  code,
  expiresAt,
  fetchImpl = fetch,
}) {
  if (!apiKey || !fromEmail || !emailPattern.test(fromEmail) || fromEmail.length > 254) {
    throw new Error('Resend API key and a valid sender email must be configured.')
  }

  const response = await fetchImpl(resendApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `Barangay Legaspi <${fromEmail}>`,
      to: [email],
      subject: 'Verify your Barangay Legaspi account email',
      html: `<p>Enter this one-time code in your account settings to verify your Gmail address:</p><p><strong>${code}</strong></p><p>This code expires at ${new Date(expiresAt).toISOString()} and can only be used once.</p><p>If you did not request this change, you can ignore this email.</p>`,
      text: `Enter this one-time code in your account settings to verify your Gmail address:\n\n${code}\n\nThis code expires at ${new Date(expiresAt).toISOString()} and can only be used once.\nIf you did not request this change, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`Resend email verification delivery failed with status ${response.status}.`)
  }
}
