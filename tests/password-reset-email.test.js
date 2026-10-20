import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverPasswordResetEmail, validatePasswordResetEmailConfig } from '../server/password-reset-email.js'

test('password reset Resend delivery sends the one-time code to the configured recipient', async () => {
  let request
  await deliverPasswordResetEmail({
    apiKey: 'test-only-resend-api-key',
    fromEmail: 'no-reply@example.org',
    email: 'resident@example.com',
    token: 'a'.repeat(64),
    expiresAt: Date.now() + 15 * 60 * 1000,
    fetchImpl: async (url, options) => {
      request = { url, ...options }
      return { ok: true, status: 200 }
    },
  })

  assert.equal(request.url, 'https://api.resend.com/emails')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.Authorization, 'Bearer test-only-resend-api-key')
  const payload = JSON.parse(request.body)
  assert.equal(payload.to[0], 'resident@example.com')
  assert.match(payload.text, new RegExp('a{64}'))
  assert.match(payload.html, new RegExp('a{64}'))
  assert.equal(request.signal.aborted, false)
})

test('password reset Resend delivery rejects an unverified provider response', async () => {
  await assert.rejects(
    deliverPasswordResetEmail({
      apiKey: 'test-only-resend-api-key',
      fromEmail: 'no-reply@example.org',
      email: 'resident@example.com',
      token: 'a'.repeat(64),
      expiresAt: Date.now() + 15 * 60 * 1000,
      fetchImpl: async () => ({ ok: false, status: 422 }),
    }),
    /status 422/,
  )
})

test('password reset Resend delivery requires a valid sender address', () => {
  assert.throws(
    () => validatePasswordResetEmailConfig({ apiKey: 'test-only-resend-api-key', fromEmail: 'not-an-email' }),
    /valid sender email/,
  )
})
