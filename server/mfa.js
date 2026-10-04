import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { JWT_SECRET, MFA_ENCRYPTION_KEY, MFA_ENCRYPTION_KEY_PREVIOUS } from './config.js'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const legacyEncryptionKey = createHash('sha256').update(JWT_SECRET).digest()
const encryptionKey = MFA_ENCRYPTION_KEY
  ? createHash('sha256').update(MFA_ENCRYPTION_KEY).digest()
  : legacyEncryptionKey
const previousEncryptionKey = MFA_ENCRYPTION_KEY_PREVIOUS
  ? createHash('sha256').update(MFA_ENCRYPTION_KEY_PREVIOUS).digest()
  : null

const encodeBase32 = (bytes) => {
  let buffer = 0
  let bits = 0
  let output = ''

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31]
  return output
}

const decodeBase32 = (value) => {
  let buffer = 0
  let bits = 0
  const output = []

  for (const character of String(value).replace(/=+$/g, '').toUpperCase()) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new Error('Invalid Base32 secret.')
    buffer = ((buffer << 5) | digit) & 0xffff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      output.push((buffer >>> bits) & 255)
    }
  }

  return Buffer.from(output)
}

export const createTotpSecret = () => encodeBase32(randomBytes(20))

export const createTotpUri = (secret, accountName) => {
  const label = encodeURIComponent(`Barangay Legaspi:${accountName}`)
  const query = new URLSearchParams({ secret, issuer: 'Barangay Legaspi', algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${query.toString()}`
}

export const encryptTotpSecret = (secret) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const version = MFA_ENCRYPTION_KEY ? 'v2' : 'v1'
  return `${version}.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

export const decryptTotpSecret = (value, { allowPrevious = true } = {}) => {
  const parts = String(value || '').split('.')
  const [version, ivValue, tagValue, ciphertextValue] = parts
  if (parts.length !== 4 || !['v1', 'v2'].includes(version) || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Invalid encrypted MFA secret.')
  }
  if (version === 'v2' && !MFA_ENCRYPTION_KEY) {
    throw new Error('MFA_ENCRYPTION_KEY is required to decrypt this secret.')
  }
  const iv = Buffer.from(ivValue, 'base64url')
  const tag = Buffer.from(tagValue, 'base64url')
  const ciphertext = Buffer.from(ciphertextValue, 'base64url')
  const keys = version === 'v1'
    ? [legacyEncryptionKey]
    : [encryptionKey, ...(allowPrevious && previousEncryptionKey ? [previousEncryptionKey] : [])]

  for (const key of keys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch (error) {
      if (key === keys.at(-1)) {
        throw new Error('Unable to decrypt authenticator secret.', { cause: error })
      }
    }
  }

  throw new Error('Unable to decrypt authenticator secret.')
}

const totpAtStep = (secret, step) => {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

export const verifyTotp = (secret, code, now = Date.now()) => {
  const submitted = String(code || '').trim()
  if (!/^\d{6}$/.test(submitted)) return null

  const currentStep = Math.floor(now / 30_000)
  const submittedBuffer = Buffer.from(submitted)
  for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
    const expectedBuffer = Buffer.from(totpAtStep(secret, step))
    if (timingSafeEqual(submittedBuffer, expectedBuffer)) return step
  }

  return null
}