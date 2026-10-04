import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'legacy-jwt-secret-used-only-by-this-test'
process.env.MFA_ENCRYPTION_KEY = 'separate-mfa-encryption-key-for-tests'

const { decryptTotpSecret, encryptTotpSecret } = await import('../server/mfa.js')

const encryptLegacySecret = (secret) => {
  const key = createHash('sha256').update(process.env.JWT_SECRET).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
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

test('invalid MFA ciphertext formats fail explicitly', () => {
  assert.throws(() => decryptTotpSecret('v3.invalid.value.here'), /Invalid encrypted MFA secret/)
  assert.throws(() => decryptTotpSecret('v1.a.b.c.extra'), /Invalid encrypted MFA secret/)
})
