import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DB_PATH } from './config.js'
import { decryptResidentPrivateData, encryptResidentPrivateData } from './resident-registry-crypto.js'

const dbDir = path.dirname(DB_PATH)
let registryMutationQueue = Promise.resolve()

const serializeRegistryMutation = (operation) => {
  const result = registryMutationQueue.then(operation, operation)
  registryMutationQueue = result.then(() => undefined, () => undefined)
  return result
}
const residentPrivateFields = [
  'firstName',
  'lastName',
  'birthDate',
  'sex',
  'householdId',
  'address',
  'sourceReference',
  'sourceFilename',
]

let writeQueue = Promise.resolve()
let auditWriteQueue = Promise.resolve()

async function writeJsonFile(data) {
  const write = writeQueue.then(async () => {
    await fs.mkdir(dbDir, { recursive: true })
    const tempPath = `${DB_PATH}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')

    try {
      await fs.rename(tempPath, DB_PATH)
    } catch (error) {
      if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        await fs.rm(DB_PATH, { force: true })
        await fs.rename(tempPath, DB_PATH)
        return
      }

      await fs.rm(tempPath, { force: true })
      throw error
    }
  })
  writeQueue = write.then(() => undefined, () => undefined)
  return write
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

function encryptRegistryRecord(record) {
  const encryptedData = record.encryptedData || encryptResidentPrivateData(Object.fromEntries(
    residentPrivateFields.map((field) => [field, record[field] ?? record[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] ?? null])
  ), record.id)
  const safeRecord = { ...record, encryptedData }
  for (const field of residentPrivateFields) {
    delete safeRecord[field]
    delete safeRecord[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]
  }

  return safeRecord
}

function decryptRegistryRecord(record) {
  return {
    ...record,
    ...decryptResidentPrivateData(record.encryptedData, record.id),
  }
}

export async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8')
    const { data, changed: passwordsChanged } = stripPlaintextUserPasswords(JSON.parse(raw))
    const registry = Array.isArray(data.residentRegistry) ? data.residentRegistry : []
    const needsRegistryEncryption = registry.some((record) => !record.encryptedData)
    const protectedData = {
      ...data,
      residentRegistry: registry.map(encryptRegistryRecord),
    }
    if (passwordsChanged || needsRegistryEncryption) await writeJsonFile(protectedData)

    return {
      ...data,
      residentRegistry: protectedData.residentRegistry.map(decryptRegistryRecord),
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      const fallbackDb = {
        users: [],
        requests: [],
        announcements: [],
        reports: [],
        approvals: [],
        residentRegistry: [],
        registrySourceReviews: [],
        emergencyAccessGrants: [],
        auditLogs: [],
      }
      await writeJsonFile(fallbackDb)
      return fallbackDb
    }

    throw error
  }
}

export async function writeDb(data) {
  const safeData = stripPlaintextUserPasswords(data).data
  const residentRegistry = Array.isArray(safeData.residentRegistry)
    ? safeData.residentRegistry.map(encryptRegistryRecord)
    : safeData.residentRegistry
  await writeJsonFile({ ...safeData, residentRegistry })
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

export async function listRequestsForStaffReports() {
  const db = await readDb()
  return db.requests.map((request) => ({
    id: request.id,
    type: request.type,
    status: request.status,
    date: request.date || request.createdAt || request.created_at,
    statusHistory: request.statusHistory || request.status_history || [],
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
  const write = auditWriteQueue.then(async () => {
    const db = await readDb()
    db.auditLogs = db.auditLogs || []
    db.auditLogs.push(entry)
    await writeDb(db)
    return entry
  })
  auditWriteQueue = write.then(() => undefined, () => undefined)
  return write
}

export async function listAuditLogs(limit = 100) {
  const db = await readDb()
  return (db.auditLogs || []).slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).reverse()
}

const normalizeRegistrySourceReview = (review) => ({
  ...review,
  zone: review.zone === null || review.zone === undefined ? null : Number(review.zone),
  status: review.status || 'open',
  createdAt: review.createdAt ?? review.created_at ?? null,
  createdBy: review.createdBy ?? review.created_by ?? null,
  resolvedAt: review.resolvedAt ?? review.resolved_at ?? null,
  resolvedBy: review.resolvedBy ?? review.resolved_by ?? null,
})

export async function listRegistrySourceReviews() {
  const db = await readDb()
  return (db.registrySourceReviews || [])
    .map(normalizeRegistrySourceReview)
    .filter((review) => review.status === 'open')
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))
}

export async function openRegistrySourceReview(review, auditEntry) {
  return serializeRegistryMutation(async () => {
    const db = await readDb()
    db.registrySourceReviews = db.registrySourceReviews || []
    db.auditLogs = db.auditLogs || []
    const existing = db.registrySourceReviews.find((item) => (
      item.status === 'open'
      && Number(item.zone || 0) === Number(review.zone || 0)
      && String(item.purok || '').trim().toLocaleLowerCase() === review.purok.trim().toLocaleLowerCase()
    ))
    if (existing) return { review: normalizeRegistrySourceReview(existing), created: false }

    const created = normalizeRegistrySourceReview(review)
    db.registrySourceReviews.push(created)
    db.auditLogs.push(auditEntry)
    await writeDb(db)
    return { review: created, created: true }
  })
}

export async function resolveRegistrySourceReview(id, actorId, resolvedAt, auditEntry) {
  return serializeRegistryMutation(async () => {
    const db = await readDb()
    const review = (db.registrySourceReviews || []).find((item) => item.id === id && item.status === 'open')
    if (!review) return null
    Object.assign(review, { status: 'resolved', resolvedBy: actorId, resolvedAt })
    db.auditLogs = db.auditLogs || []
    db.auditLogs.push(auditEntry)
    await writeDb(db)
    return normalizeRegistrySourceReview(review)
  })
}

const normalizeRegistryResident = (record) => ({
  ...record,
  firstName: record.firstName ?? record.first_name ?? '',
  lastName: record.lastName ?? record.last_name ?? '',
  birthDate: record.birthDate ?? record.birth_date ?? null,
  householdId: record.householdId ?? record.household_id ?? null,
  verificationStatus: record.verificationStatus ?? record.verification_status ?? 'pending',
  sourceReference: record.sourceReference ?? record.source_reference ?? null,
  sourceFilename: record.sourceFilename ?? record.source_filename ?? null,
  verifiedBy: record.verifiedBy ?? record.verified_by ?? null,
  verifiedAt: record.verifiedAt ?? record.verified_at ?? null,
  createdBy: record.createdBy ?? record.created_by ?? null,
  status: record.status ?? record.recordStatus ?? record.record_status ?? 'active',
  recordStatus: record.recordStatus ?? record.record_status ?? record.status ?? 'active',
})

export async function listResidentRegistry(filters = {}) {
  const db = await readDb()
  const matches = (db.residentRegistry || []).map(normalizeRegistryResident).filter((resident) => {
    const nameParts = String(filters.search || '').toLowerCase().split(/\s+/).filter(Boolean)
    const fullName = `${resident.firstName} ${resident.lastName}`.toLowerCase()
    if (nameParts.some((part) => !fullName.includes(part))) return false
    if (filters.birthDate && resident.birthDate !== filters.birthDate) return false
    if (filters.ageStart && filters.ageEnd && (!resident.birthDate || resident.birthDate < filters.ageStart || resident.birthDate > filters.ageEnd)) return false
    if (filters.zone && Number(resident.zone) !== Number(filters.zone)) return false
    if (filters.purok && resident.purok !== filters.purok) return false
    return true
  }).sort((left, right) => (
    Number(left.zone || 99) - Number(right.zone || 99)
    || String(left.purok || '').localeCompare(String(right.purok || ''))
    || left.lastName.localeCompare(right.lastName)
    || left.firstName.localeCompare(right.firstName)
    || String(left.id).localeCompare(String(right.id))
  ))
  const offset = (filters.page - 1) * filters.pageSize
  return { residents: matches.slice(offset, offset + filters.pageSize), total: matches.length }
}

export async function getResidentDemographics(filters = {}, includeHouseholds = true) {
  const db = await readDb()
  const eligible = (db.residentRegistry || []).map(normalizeRegistryResident).filter((resident) => (
    resident.recordStatus === 'active'
    && resident.verificationStatus === 'verified'
    && (!filters.zone || Number(resident.zone) === Number(filters.zone))
    && (!filters.purok || resident.purok === filters.purok)
  ))
  const count = (residents) => ({
    total: residents.length,
    male: residents.filter((item) => String(item.sex || '').toLowerCase() === 'male').length,
    female: residents.filter((item) => String(item.sex || '').toLowerCase() === 'female').length,
    unclassified: residents.filter((item) => !['male', 'female'].includes(String(item.sex || '').toLowerCase())).length,
    households: new Set(residents.filter((item) => item.householdId).map((item) => (
      `${item.zone || ''}\u0000${item.purok || ''}\u0000${item.householdId}`
    ))).size,
  })
  const groups = new Map()
  const households = new Map()
  for (const resident of eligible) {
    const groupKey = `${resident.zone || ''}\u0000${resident.purok || ''}`
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(resident)
    const householdKey = `${groupKey}\u0000${resident.householdId || ''}`
    if (resident.householdId && !households.has(householdKey)) households.set(householdKey, [])
    if (resident.householdId) households.get(householdKey).push(resident)
  }
  const byPurok = [...groups.entries()].map(([key, residents]) => {
    const [zoneValue, purok] = key.split('\u0000')
    const counts = count(residents)
    const zone = zoneValue ? Number(zoneValue) : null
    return {
      zone,
      purok: purok || null,
      label: purok ? `${purok}${zone ? ` · Zone ${zone}` : ''}` : (zone ? `Zone ${zone}` : 'Unassigned / needs verification'),
      ...counts,
    }
  }).sort((left, right) => (left.zone || 99) - (right.zone || 99) || String(left.purok || '').localeCompare(String(right.purok || '')))
  const byHousehold = includeHouseholds ? [...households.entries()].map(([key, residents]) => {
    const [zoneValue, purok, householdId] = key.split('\u0000')
    const counts = count(residents)
    return {
      zone: zoneValue ? Number(zoneValue) : null,
      purok: purok || null,
      householdId,
      total: counts.total,
      male: counts.male,
      female: counts.female,
      unclassified: counts.unclassified,
    }
  }) : undefined

  return {
    eligibility: 'Active records with verified household/resident status; unclassified sex is reported separately.',
    overall: count(eligible),
    byPurok,
    ...(includeHouseholds ? { byHousehold } : {}),
    filters: { zone: filters.zone || null, purok: filters.purok || '' },
  }
}

export async function findPotentialRegistryMatches(firstName, lastName, birthDate) {
  const db = await readDb()
  return (db.residentRegistry || []).map(normalizeRegistryResident).filter((resident) => (
    resident.firstName.trim().toLowerCase() === firstName.trim().toLowerCase()
    && resident.lastName.trim().toLowerCase() === lastName.trim().toLowerCase()
    && (!birthDate || !resident.birthDate || resident.birthDate === birthDate)
  )).slice(0, 5).map((resident) => ({
    id: resident.id,
    firstName: resident.firstName,
    lastName: resident.lastName,
    birthDate: resident.birthDate,
    householdId: resident.householdId,
    purok: resident.purok,
    zone: resident.zone,
    verificationStatus: resident.verificationStatus,
  }))
}

export async function insertRegistryResident(resident, auditEntry = null) {
  return serializeRegistryMutation(async () => {
    const db = await readDb()
    db.residentRegistry = db.residentRegistry || []
    db.residentRegistry.push(resident)
    if (auditEntry) {
      db.auditLogs = db.auditLogs || []
      db.auditLogs.push(auditEntry)
    }
    await writeDb(db)
    return resident
  })
}

export async function insertRegistryResidents(residents, auditEntry) {
  return serializeRegistryMutation(async () => {
    const db = await readDb()
    db.residentRegistry = db.residentRegistry || []
    db.auditLogs = db.auditLogs || []
    db.residentRegistry.push(...residents)
    db.auditLogs.push(auditEntry)
    await writeDb(db)
    return residents
  })
}

export async function updateRegistryResident(id, updates) {
  return serializeRegistryMutation(async () => {
    const db = await readDb()
    const resident = (db.residentRegistry || []).find((item) => item.id === id)
    if (!resident) return null
    Object.assign(resident, updates)
    await writeDb(db)
    return normalizeRegistryResident(resident)
  })
}

export async function getActiveEmergencyAccessGrant() {
  const db = await readDb()
  const now = Date.now()
  const grant = (db.emergencyAccessGrants || []).find((item) => (
    item.activeSlot === 'global' && !item.revokedAt && new Date(item.expiresAt).getTime() > now
  ))
  return grant || null
}

export async function createEmergencyAccessGrant(grant, mfaStep = null, auditEntry = null) {
  return serializeRegistryMutation(async () => {
    const db = await readDb()
    db.emergencyAccessGrants = db.emergencyAccessGrants || []
    for (const prior of db.emergencyAccessGrants) {
      if (prior.activeSlot === 'global' && new Date(prior.expiresAt).getTime() <= Date.now()) prior.activeSlot = null
    }
    if (db.emergencyAccessGrants.some((item) => item.activeSlot === 'global' && !item.revokedAt)) return { conflict: true }
    if (mfaStep !== null) {
      const user = db.users.find((item) => item.id === grant.adminId)
      if (!user || Number(user.mfaLastStep || user.mfa_last_step || 0) >= mfaStep) return { replayedMfa: true }
      user.mfaLastStep = mfaStep
    }
    db.emergencyAccessGrants.push(grant)
    if (auditEntry) {
      db.auditLogs = db.auditLogs || []
      db.auditLogs.push(auditEntry)
    }
    await writeDb(db)
    return { grant }
  })
}

export async function revokeEmergencyAccessGrant(grantId, revokedBy, revokedAt, auditEntry = null) {
  return serializeRegistryMutation(async () => {
    const db = await readDb()
    const grant = (db.emergencyAccessGrants || []).find((item) => item.id === grantId && item.activeSlot === 'global')
    if (!grant) return null
    grant.activeSlot = null
    grant.revokedBy = revokedBy
    grant.revokedAt = revokedAt
    if (auditEntry) {
      db.auditLogs = db.auditLogs || []
      db.auditLogs.push(auditEntry)
    }
    await writeDb(db)
    return grant
  })
}

export async function archiveApprovalsOlderThan(days = 30) {
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
