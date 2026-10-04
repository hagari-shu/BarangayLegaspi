import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDir = path.join(__dirname, 'data')
const isTestRun = process.env.NODE_ENV === 'test'
  || process.execArgv.some((arg) => arg.includes('--test'))
  || process.argv.some((arg) => arg.includes('--test') || /\.test\.[cm]?[jt]s$/i.test(arg))
const dbPath = path.join(dataDir, isTestRun ? `db-${process.pid}.json` : 'db.json')

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(
    dbPath,
    JSON.stringify({ users: [], requests: [], announcements: [], reports: [] }, null, 2),
    'utf8'
  )
}

export const DB_PATH = dbPath
export const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const defaultCorsOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174']
const configuredCorsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
export const CORS_ORIGINS = [...new Set([
  ...configuredCorsOrigins,
  ...(IS_PRODUCTION ? [] : defaultCorsOrigins),
])]
export const SHOULD_SKIP_SEED = String(process.env.SKIP_SEED || '').toLowerCase() === 'true'
const resolvedJwtSecret = process.env.JWT_SECRET || 'development-secret-change-me-in-production-123!'

if (IS_PRODUCTION && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters in production.')
}

if (IS_PRODUCTION && CORS_ORIGINS.length === 0) {
  throw new Error('CORS_ORIGINS must be configured in production.')
}

export const ADMIN_SEED = {
  firstName: String(process.env.ADMIN_FIRST_NAME || 'Carmen').trim(),
  lastName: String(process.env.ADMIN_LAST_NAME || 'Santos').trim(),
  mobile: String(process.env.ADMIN_MOBILE || '09999999999').trim(),
  email: String(process.env.ADMIN_EMAIL || 'admin@barangay.gov.ph').trim().toLowerCase(),
  password: String(process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'AdminPass123')).trim(),
  role: 'admin',
  householdId: String(process.env.ADMIN_HOUSEHOLD_ID || '2024-ADMIN').trim(),
  familyMembers: Number(process.env.ADMIN_FAMILY_MEMBERS || 1),
  status: String(process.env.ADMIN_STATUS || 'Administrator').trim(),
  address: String(process.env.ADMIN_ADDRESS || 'Barangay Hall, Legaspi').trim(),
  zone: Number(process.env.ADMIN_ZONE ?? 0),
}

export const JWT_SECRET = resolvedJwtSecret
export const PORT = Number(process.env.PORT || 3001)
