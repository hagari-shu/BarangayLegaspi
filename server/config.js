import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDir = path.join(__dirname, 'data')
const dbPath = path.join(dataDir, 'db.json')

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
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters in production.')
}
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGINS) {
  throw new Error('CORS_ORIGINS must be configured in production.')
}

export const JWT_SECRET = process.env.JWT_SECRET || 'brgy-legaspi-demo-secret'
export const PORT = Number(process.env.PORT || 3001)
