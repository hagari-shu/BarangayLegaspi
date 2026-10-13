import fs from 'node:fs/promises'
import path from 'node:path'
import { DB_PATH } from './config.js'

const dbDir = path.dirname(DB_PATH)

async function writeJsonFile(data) {
  await fs.mkdir(dbDir, { recursive: true })
  const tempPath = `${DB_PATH}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')

  try {
    await fs.rename(tempPath, DB_PATH)
  } catch (error) {
    if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
      await fs.rm(DB_PATH, { force: true })
      await fs.rename(tempPath, DB_PATH)
      return
    }

    throw error
  }
}

function stripPlaintextUserPasswords(data) {
  let changed = false
  const users = Array.isArray(data.users) ? data.users.map((user) => {
    if (!user || typeof user !== 'object' || Array.isArray(user) || !Object.prototype.hasOwnProperty.call(user, 'password')) {
      return user
    }

    changed = true
    const safeUser = { ...user }
    delete safeUser.password
    return safeUser
  }) : data.users

  return { data: changed ? { ...data, users } : data, changed }
}

export async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8')
    const { data, changed } = stripPlaintextUserPasswords(JSON.parse(raw))
    if (changed) await writeJsonFile(data)
    return data
  } catch (error) {
    if (error.code === 'ENOENT') {
      const fallbackDb = { users: [], requests: [], announcements: [], reports: [], approvals: [], auditLogs: [], qualityAssessments: [] }
      await writeJsonFile(fallbackDb)
      return fallbackDb
    }

    throw error
  }
}

export async function getQualityAssessment(userId) {
  const db = await readDb()
  return (db.qualityAssessments || []).find((assessment) => assessment.userId === userId) || null
}

export async function saveQualityAssessment(assessment) {
  const db = await readDb()
  db.qualityAssessments = db.qualityAssessments || []
  const index = db.qualityAssessments.findIndex((item) => item.userId === assessment.userId)
  if (index === -1) db.qualityAssessments.push(assessment)
  else db.qualityAssessments[index] = assessment
  await writeDb(db)
  return assessment
}

export async function listQualityAssessments() {
  const db = await readDb()
  return db.qualityAssessments || []
}

export async function writeDb(data) {
  await writeJsonFile(stripPlaintextUserPasswords(data).data)
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
  db.qualityAssessments = (db.qualityAssessments || []).filter((item) => item.userId !== userId)
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

export async function listReports() {
  const db = await readDb()
  return db.reports || []
}

export async function createReport(report) {
  const db = await readDb()
  db.reports = db.reports || []
  db.reports.push(report)
  await writeDb(db)
  return report
}

const archiveDirectory = path.join(dbDir, 'archives')

export async function createArchive(name, category, contents) {
  await fs.mkdir(archiveDirectory, { recursive: true })
  await fs.writeFile(path.join(archiveDirectory, name), JSON.stringify(contents, null, 2), 'utf8')
  return { name, category }
}

export async function listArchives() {
  try {
    const files = await fs.readdir(archiveDirectory)
    const list = await Promise.all(files.map(async (name) => {
      const stat = await fs.stat(path.join(archiveDirectory, name))
      return { name, size: stat.size, mtime: stat.mtime.toISOString() }
    }))
    return list.sort((left, right) => right.mtime.localeCompare(left.mtime))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

export async function getArchive(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(archiveDirectory, name), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function deleteArchive(name) {
  try {
    await fs.unlink(path.join(archiveDirectory, name))
    return { name }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function listStaffRequestDashboard({
  search = '',
  status = '',
  type = '',
  zone = '',
  from = '',
  to = '',
  sort = 'date',
  direction = 'desc',
  page = 1,
  pageSize = 10,
} = {}) {
  const db = await readDb()
  const usersById = new Map((db.users || []).map((user) => [user.id, user]))
  const requests = (db.requests || []).map((request) => {
    const user = usersById.get(request.userId || request.user_id) || {}
    return {
      ...request,
      first_name: request.first_name || request.firstName || user.firstName || user.first_name || '',
      last_name: request.last_name || request.lastName || user.lastName || user.last_name || '',
      zone: request.zone ?? request.zoneNumber ?? user.zone ?? user.zone_number ?? '',
    }
  })
  const fromTime = from ? Date.parse(`${from}T00:00:00+08:00`) : null
  const toTime = to ? Date.parse(`${to}T00:00:00+08:00`) + 24 * 60 * 60 * 1000 : null
  const needle = search.toLowerCase()
  const filtered = requests.filter((request) => {
    const createdAt = new Date(request.date || request.createdAt || request.created_at || 0).getTime()
    const searchable = [request.id, request.type, request.purpose, request.first_name, request.last_name]
      .join(' ')
      .toLowerCase()
    return (!needle || searchable.includes(needle))
      && (!status || (status === 'active' ? !['Approved', 'Rejected'].includes(request.status) : request.status === status))
      && (!type || request.type === type)
      && (!zone || String(request.zone) === zone)
      && (fromTime === null || (Number.isFinite(createdAt) && createdAt >= fromTime))
      && (toTime === null || (Number.isFinite(createdAt) && createdAt < toTime))
  })
  const statusCounts = requests.reduce((counts, request) => {
    counts[request.status] = (counts[request.status] || 0) + 1
    return counts
  }, {})
  const sortValue = (request) => sort === 'status'
    ? String(request.status || '')
    : new Date(request.date || request.createdAt || request.created_at || 0).getTime()
  filtered.sort((left, right) => {
    const leftValue = sortValue(left)
    const rightValue = sortValue(right)
    const order = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
    return direction === 'asc' ? order : -order
  })
  const offset = (page - 1) * pageSize
  return {
    requests: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    page,
    pageSize,
    documentTypes: [...new Set(requests.map((request) => request.type).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    summary: {
      total: requests.length,
      pending: statusCounts.Pending || 0,
      inReview: statusCounts['In Review'] || 0,
      needsInformation: statusCounts['Needs Information'] || 0,
      approved: statusCounts.Approved || 0,
      rejected: statusCounts.Rejected || 0,
      deadlineTracking: false,
      releaseTracking: false,
    },
  }
}

export async function listAllUsers() {
  const db = await readDb()
  return db.users
}

export async function updateRequestStatus(requestId, status, historyEntry) {
  const db = await readDb()
  const request = db.requests.find((item) => item.id === requestId)
  if (!request) return null
  const previous = request.status
  request.status = status
  request.updatedAt = new Date().toISOString()
  request.statusHistory = [
    ...(Array.isArray(request.statusHistory) && request.statusHistory.length
      ? request.statusHistory
      : [{ kind: 'status', status: previous, createdAt: request.date, actorRole: 'system' }]),
    historyEntry,
  ]
  db.requests = db.requests.map((r) => (r.id === requestId ? request : r))
  await writeDb(db)
  return { ...request, previousStatus: previous }
}

export async function appendRequestFollowUp(requestId, followUp) {
  const db = await readDb()
  const request = db.requests.find((item) => item.id === requestId)
  if (!request) return null
  request.followUps = [...(Array.isArray(request.followUps) ? request.followUps : []), followUp]
  request.updatedAt = followUp.createdAt
  request.statusHistory = [
    ...(Array.isArray(request.statusHistory) && request.statusHistory.length
      ? request.statusHistory
      : [{ kind: 'status', status: request.status, createdAt: request.date, actorRole: 'system' }]),
    { ...followUp, kind: 'follow-up', actorRole: 'resident' },
  ]
  if (request.status === 'Needs Information') {
    request.status = 'In Review'
    request.statusHistory.push({
      kind: 'status',
      status: 'In Review',
      note: 'Resident provided a follow-up.',
      createdAt: followUp.createdAt,
      actorRole: 'system',
    })
  }
  await writeDb(db)
  return request
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
