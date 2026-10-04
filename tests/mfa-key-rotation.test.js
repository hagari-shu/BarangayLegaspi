import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'legacy-jwt-secret-used-only-by-this-test'
process.env.MFA_ENCRYPTION_KEY = 'separate-mfa-encryption-key-for-tests'
process.env.MFA_ENCRYPTION_KEY_PREVIOUS = [
  'previous-mfa-encryption-key-for-tests',
  'second-previous-mfa-encryption-key-for-tests',
].join(',')

const { decryptTotpSecret, encryptTotpSecret } = await import('../server/mfa.js')

const encryptWithKey = (secret, rawKey) => {
  const key = createHash('sha256').update(rawKey).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

const encryptLegacySecret = (secret) => encryptWithKey(secret, process.env.JWT_SECRET)

const encryptPreviousMfaSecret = (secret) => {
  const value = encryptWithKey(secret, process.env.MFA_ENCRYPTION_KEY_PREVIOUS.split(',')[0])
  return value.replace(/^v1\./, 'v2.')
}

const encryptSecondPreviousMfaSecret = (secret) => {
  const value = encryptWithKey(secret, process.env.MFA_ENCRYPTION_KEY_PREVIOUS.split(',')[1])
  return value.replace(/^v1\./, 'v2.')
}

test('new MFA secrets use v2 and decrypt with the separate MFA key', () => {
  const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP')

  assert.match(encrypted, /^v2\./)
  assert.equal(decryptTotpSecret(encrypted), 'JBSWY3DPEHPK3PXP')
})

test('legacy v1 MFA secrets remain decryptable for backfill', () => {
  const encrypted = encryptLegacySecret('JBSWY3DPEHPK3PXP')

  assert.equal(decryptTotpSecret(encrypted), 'JBSWY3DPEHPK3PXP')
})

test('multiple previous v2 MFA keys decrypt for rollover and current-key checks reject old ciphertext', () => {
  const encrypted = encryptPreviousMfaSecret('JBSWY3DPEHPK3PXP')
  const encryptedWithSecondPreviousKey = encryptSecondPreviousMfaSecret('JBSWY3DPEHPK3PXP')

  assert.equal(decryptTotpSecret(encrypted), 'JBSWY3DPEHPK3PXP')
  assert.equal(decryptTotpSecret(encryptedWithSecondPreviousKey), 'JBSWY3DPEHPK3PXP')
  assert.throws(() => decryptTotpSecret(encrypted, { allowPrevious: false }), /Unable to decrypt/)

  const rotated = encryptTotpSecret(decryptTotpSecret(encrypted))
  assert.match(rotated, /^v2\./)
  assert.equal(decryptTotpSecret(rotated, { allowPrevious: false }), 'JBSWY3DPEHPK3PXP')
})

test('invalid MFA ciphertext formats fail explicitly', () => {
  assert.throws(() => decryptTotpSecret('v3.invalid.value.here'), /Invalid encrypted MFA secret/)
  assert.throws(() => decryptTotpSecret('v1.a.b.c.extra'), /Invalid encrypted MFA secret/)
})
