import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { RESIDENT_DATA_ENCRYPTION_KEY, RESIDENT_DATA_ENCRYPTION_KEY_PREVIOUS } from './config.js'

const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 16)
const nameSearchKeys = [RESIDENT_DATA_ENCRYPTION_KEY, ...RESIDENT_DATA_ENCRYPTION_KEY_PREVIOUS.split(',').map((key) => key.trim())]
  .filter(Boolean)
const encryptionKey = RESIDENT_DATA_ENCRYPTION_KEY
  ? createHash('sha256').update(RESIDENT_DATA_ENCRYPTION_KEY).digest()
  : null
const encryptionKeys = new Map(
  nameSearchKeys
    .map((key) => [keyId(key), createHash('sha256').update(key).digest()])
)
const configuredNameSearchKeyIds = nameSearchKeys.map(keyId)

const tokenizeNameSearch = (value) => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase('en')
  .split(/[^\p{L}\p{N}]+/u)
  .filter(Boolean)

const hashNameSearchTerm = (term, key) => createHmac(
  'sha256',
  createHash('sha256').update(`resident-name-search:v1:${key}`).digest()
).update(term).digest('base64url')

export const createResidentNameSearchTokens = (firstName, lastName) => {
  const tokens = new Set()
  const nameParts = tokenizeNameSearch(`${firstName || ''} ${lastName || ''}`)

  for (const part of nameParts) {
    const characters = Array.from(part)
    for (let length = 1; length <= characters.length; length += 1) {
      const prefix = characters.slice(0, length).join('')
      for (const key of nameSearchKeys) {
        tokens.add(`${keyId(key)}:${hashNameSearchTerm(prefix, key)}`)
      }
    }
  }
  return [...tokens]
}

export const residentNameSearchCandidates = (search) => String(search || '')
  .normalize('NFKC')
  .toLocaleLowerCase('en')
  .split(/[^\p{L}\p{N}]+/u)
  .filter(Boolean)
  .map((term) => nameSearchKeys.map((key) => `${keyId(key)}:${hashNameSearchTerm(term, key)}`))

export const residentNameSearchTokensNeedRefresh = (tokens) => (
  !Array.isArray(tokens)
  || configuredNameSearchKeyIds.some((id) => !tokens.some((token) => token.startsWith(`${id}:`)))
)

export const residentNameSearchKeyIds = () => [...configuredNameSearchKeyIds]

export const encryptResidentPrivateData = (privateData, recordId) => {
  if (!encryptionKey) throw new Error('RESIDENT_DATA_ENCRYPTION_KEY is required to store resident private data.')
  if (typeof recordId !== 'string' || recordId === '') throw new Error('A resident record ID is required to encrypt private data.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ recordId, privateData }), 'utf8'),
    cipher.final(),
  ])

  return [
    'v1',
    keyId(RESIDENT_DATA_ENCRYPTION_KEY),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export const decryptResidentPrivateData = (encryptedData, recordId) => {
  if (typeof encryptedData !== 'string' || encryptedData === '') {
    throw new Error('Resident private data is missing its encrypted payload.')
  }
  if (typeof recordId !== 'string' || recordId === '') throw new Error('A resident record ID is required to decrypt private data.')
  const [version, id, encodedIv, encodedTag, encodedCiphertext, ...extra] = encryptedData.split('.')
  if (version !== 'v1' || !id || !encodedIv || !encodedTag || !encodedCiphertext || extra.length > 0) {
    throw new Error('Resident private data has an invalid encrypted payload.')
  }
  const key = encryptionKeys.get(id)
  if (!key) throw new Error('A configured resident data encryption key is required to decrypt this record.')

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encodedIv, 'base64url'))
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  const payload = JSON.parse(plaintext)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.recordId !== recordId || !payload.privateData
    || typeof payload.privateData !== 'object' || Array.isArray(payload.privateData)) {
    throw new Error('Resident private data has an invalid payload shape.')
  }

  return payload.privateData
}
