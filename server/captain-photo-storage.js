import './config.js'
import {
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const CAPTAIN_PHOTO_KEY = 'official/captain-portrait'
export const OFFICIAL_PHOTO_KEYS = Object.freeze({
  captain: CAPTAIN_PHOTO_KEY,
  secretary: 'official/secretary-portrait',
  treasurer: 'official/treasurer-portrait',
})
export const OFFICIAL_PHOTO_ROLES = Object.keys(OFFICIAL_PHOTO_KEYS)
const bucket = process.env.OBJECT_STORAGE_BUCKET
const client = bucket && process.env.OBJECT_STORAGE_ACCESS_KEY_ID && process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY
  ? new S3Client({
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT || undefined,
      region: process.env.OBJECT_STORAGE_REGION || 'auto',
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
    })
  : null

export const isOfficialPhotoStorageConfigured = () => Boolean(client && bucket)
export const isCaptainPhotoStorageConfigured = isOfficialPhotoStorageConfigured
const isOfficialPhotoRole = (role) => Object.hasOwn(OFFICIAL_PHOTO_KEYS, role)

export async function createOfficialPhotoUpload(role, contentType) {
  if (!isOfficialPhotoStorageConfigured()) throw new Error('Object storage is not configured.')
  if (!isOfficialPhotoRole(role)) throw new Error('Invalid official profile.')
  if (!CONTENT_TYPES.has(contentType)) throw new Error('Unsupported image type.')

  const key = `${OFFICIAL_PHOTO_KEYS[role]}/pending/${randomUUID()}`
  const upload = await createPresignedPost(client, {
    Bucket: bucket,
    Key: key,
    Expires: 300,
    Fields: { 'Content-Type': contentType },
    Conditions: [
      ['content-length-range', 1, MAX_IMAGE_BYTES],
    ],
  })
  return { ...upload, key }
}

export async function createCaptainPhotoUpload(contentType) {
  return createOfficialPhotoUpload('captain', contentType)
}

const hasImageSignature = (bytes, contentType) => {
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (contentType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (contentType === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  return false
}

export async function finalizeOfficialPhotoUpload(role, key) {
  if (!isOfficialPhotoStorageConfigured()) throw new Error('Object storage is not configured.')
  if (!isOfficialPhotoRole(role)) throw new Error('Invalid official profile.')
  const photoKey = OFFICIAL_PHOTO_KEYS[role]
  const pendingPhotoPrefix = `${photoKey}/pending/`
  const uploadId = typeof key === 'string' && key.startsWith(pendingPhotoPrefix)
    ? key.slice(pendingPhotoPrefix.length)
    : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    throw new Error('Invalid official photo upload.')
  }

  const metadata = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  if (!CONTENT_TYPES.has(metadata.ContentType) || !Number.isInteger(metadata.ContentLength)
    || metadata.ContentLength < 1 || metadata.ContentLength > MAX_IMAGE_BYTES) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    throw new Error('Upload must be a supported image of 5 MB or smaller.')
  }

  const image = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-11' }))
  const signature = await image.Body.transformToByteArray()
  if (!hasImageSignature(Buffer.from(signature), metadata.ContentType)) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    throw new Error('Uploaded file is not a valid supported image.')
  }

  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: photoKey,
    CopySource: `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
    ContentType: metadata.ContentType,
    MetadataDirective: 'REPLACE',
  }))
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: photoKey }), { expiresIn: 900 })
}

export async function finalizeCaptainPhotoUpload(key) {
  return finalizeOfficialPhotoUpload('captain', key)
}

export async function getOfficialPhotoUrl(role) {
  if (!isOfficialPhotoStorageConfigured()) return null
  if (!isOfficialPhotoRole(role)) throw new Error('Invalid official profile.')
  const photoKey = OFFICIAL_PHOTO_KEYS[role]
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: photoKey }))
  } catch (error) {
    if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null
    throw error
  }
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: photoKey }), { expiresIn: 900 })
}

export async function getCaptainPhotoUrl() {
  return getOfficialPhotoUrl('captain')
}

export async function deleteOfficialPhoto(role, key = OFFICIAL_PHOTO_KEYS[role]) {
  if (!isOfficialPhotoStorageConfigured()) throw new Error('Object storage is not configured.')
  if (!isOfficialPhotoRole(role) || key !== OFFICIAL_PHOTO_KEYS[role]) {
    throw new Error('Invalid official photo.')
  }

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

export async function deleteCaptainPhoto(key) {
  return deleteOfficialPhoto('captain', key)
}

export const CAPTAIN_PHOTO_MAX_BYTES = MAX_IMAGE_BYTES
export const CAPTAIN_PHOTO_CONTENT_TYPES = [...CONTENT_TYPES]
