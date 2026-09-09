import fs from 'node:fs/promises'
import path from 'node:path'
import { DB_PATH } from './config.js'

const dbDir = path.dirname(DB_PATH)

async function writeJsonFile(data) {
  await fs.mkdir(dbDir, { recursive: true })
  const tempPath = `${DB_PATH}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tempPath, DB_PATH)
}

export async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error.code === 'ENOENT') {
      const fallbackDb = { users: [], requests: [], announcements: [], reports: [], approvals: [], auditLogs: [] }
      await writeJsonFile(fallbackDb)
      return fallbackDb
    }

    throw error
  }
}

export async function writeDb(data) {
  await writeJsonFile(data)
}

export async function findUserByIdentifier(identifier) {
  const db = await readDb()
  const target = String(identifier).trim()
  return db.users.find(
    (user) => user.mobile === target || user.email.toLowerCase() === target.toLowerCase()
  ) || null
}

export async function findUserById(id) {
  const db = await readDb()
  return db.users.find((user) => user.id === id) || null
}

export async function saveUser(user) {
  const db = await readDb()
  db.users.push(user)
  await writeDb(db)
  return user
}

export async function saveRequest(request) {
  const db = await readDb()
  db.requests.push(request)
  await writeDb(db)
  return request
}

export async function updateUser(userId, updates = {}) {
  const db = await readDb()
  const index = db.users.findIndex((user) => user.id === userId)
  if (index === -1) return null

  db.users[index] = {
    ...db.users[index],
    ...updates,
  }

  await writeDb(db)
  return db.users[index]
}

export async function deleteUser(userId) {
  const db = await readDb()
  const user = db.users.find((item) => item.id === userId)
  if (!user) return null

  db.users = db.users.filter((item) => item.id !== userId)
  await writeDb(db)
  return user
}

export async function listRequestsForUser(userId) {
  const db = await readDb()
  return db.requests.filter((request) => request.userId === userId)
}

export async function listAllRequests() {
  const db = await readDb()
  return db.requests.map((request) => ({
    ...request,
    userId: request.userId,
  }))
}

export async function listAllUsers() {
  const db = await readDb()
  return db.users
}

export async function updateRequestStatus(requestId, status) {
  const db = await readDb()
  const request = db.requests.find((item) => item.id === requestId)
  if (!request) return null
  const previous = request.status
  request.status = status
  request.updatedAt = new Date().toISOString()
  // record a simple history on the request itself
  db.requests = db.requests.map((r) => (r.id === requestId ? request : r))
  await writeDb(db)
  return { ...request, previousStatus: previous }
}

export async function addApproval(approval) {
  const db = await readDb()
  db.approvals = db.approvals || []
  db.approvals.push(approval)
  await writeDb(db)
  return approval
}

export async function listApprovals() {
  const db = await readDb()
  return db.approvals || []
}

export async function listAnnouncements() {
  const db = await readDb()
  return Array.isArray(db.announcements) ? db.announcements : []
}

export async function saveAnnouncement(announcement) {
  const db = await readDb()
  db.announcements = Array.isArray(db.announcements) ? db.announcements : []
  db.announcements.unshift(announcement)
  await writeDb(db)
  return announcement
}

export async function deleteAnnouncement(id) {
  const db = await readDb()
  db.announcements = Array.isArray(db.announcements) ? db.announcements : []
  const announcement = db.announcements.find((item) => String(item.id || item.title) === String(id))
  if (!announcement) return null
  db.announcements = db.announcements.filter((item) => String(item.id || item.title) !== String(id))
  await writeDb(db)
  return announcement
}

export async function addAuditLog(entry) {
  const db = await readDb()
  db.auditLogs = db.auditLogs || []
  db.auditLogs.push(entry)
  await writeDb(db)
  return entry
}

export async function listAuditLogs(limit = 100) {
  const db = await readDb()
  return (db.auditLogs || []).slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).reverse()
}

export async function archiveApprovalsOlderThan(days = 7) {
  const db = await readDb()
  db.approvals = db.approvals || []

  let old = []
  if (days === 0) {
    old = db.approvals
  } else {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    old = db.approvals.filter((a) => new Date(a.dateApproved).getTime() <= cutoff)
  }

  if (old.length === 0) return { count: 0, filename: null }

  const path = DB_PATH.replace('db.json', '')
  const archiveDir = `${path}archives/`
  try {
    await fs.mkdir(archiveDir, { recursive: true })
  } catch (err) {
    // ignore
  }

  const from = new Date(Math.min(...old.map((o) => new Date(o.dateApproved).getTime()))).toISOString().slice(0,10)
  const to = new Date(Math.max(...old.map((o) => new Date(o.dateApproved).getTime()))).toISOString().slice(0,10)
  const filename = `${archiveDir}approvals-${from}_to_${to}.json`
  await fs.writeFile(filename, JSON.stringify(old, null, 2), 'utf8')

  db.approvals = db.approvals.filter((a) => !old.find((o) => o.id === a.id))
  await writeDb(db)

  return { filename, count: old.length }
}

export async function archiveProcessedRequestsOlderThan(days = 1) {
  const db = await readDb()
  db.requests = db.requests || []

  const processed = db.requests.filter((request) => ['Approved', 'Rejected'].includes(request.status))
  const daysValue = Number(days) || 1
  const cutoff = Date.now() - daysValue * 24 * 60 * 60 * 1000

  const old = daysValue === 0
    ? processed
    : processed.filter((request) => {
        const source = request.updatedAt || request.date || request.createdAt || new Date().toISOString()
        const timestamp = new Date(source).getTime()
        return Number.isFinite(timestamp) && timestamp <= cutoff
      })

  if (old.length === 0) {
    return { count: 0, filename: null, archivedAt: null }
  }

  const archiveDir = `${DB_PATH.replace('db.json', '')}archives/`
  await fs.mkdir(archiveDir, { recursive: true })

  const today = new Date().toISOString().slice(0, 10)
  const filename = `${archiveDir}queue-approvals-${today}.json`
  const archivePayload = {
    archivedAt: new Date().toISOString(),
    archivedFor: daysValue === 0 ? 'manual' : `${daysValue} day(s)`,
    total: old.length,
    records: old,
  }
  await fs.writeFile(filename, JSON.stringify(archivePayload, null, 2), 'utf8')

  db.requests = db.requests.filter((request) => !old.some((archived) => archived.id === request.id))
  await writeDb(db)

  return { count: old.length, filename, archivedAt: archivePayload.archivedAt }
}

export async function clearData(options = { keepAdmins: true }) {
  const db = await readDb()
  if (options.keepAdmins) {
    db.users = (db.users || []).filter((u) => ['admin', 'staff'].includes(u.role))
  } else {
    db.users = []
  }
  db.requests = []
  db.reports = []
  db.approvals = []
  await writeDb(db)
  return true
}
