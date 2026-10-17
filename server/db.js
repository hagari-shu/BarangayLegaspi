import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DB_PATH } from './config.js'
import {
  createResidentNameSearchTokens,
  decryptResidentPrivateData,
  encryptResidentPrivateData,
  residentNameSearchCandidates,
  residentNameSearchTokensNeedRefresh,
} from './resident-registry-crypto.js'

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
  'maritalStatus',
  'occupation',
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
  const privateData = record.encryptedData
    ? null
    : Object.fromEntries(residentPrivateFields.map((field) => [
        field,
        record[field] ?? record[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] ?? null,
      ]))
  const encryptedData = record.encryptedData || encryptResidentPrivateData(Object.fromEntries(
    residentPrivateFields.map((field) => [field, privateData[field]])
  ), record.id)
  const refreshNameSearchTokens = residentNameSearchTokensNeedRefresh(record.nameSearchTokens)
  const searchData = privateData || (refreshNameSearchTokens ? decryptResidentPrivateData(encryptedData, record.id) : null)
  const safeRecord = {
    ...record,
    encryptedData,
    nameSearchTokens: refreshNameSearchTokens
      ? createResidentNameSearchTokens(searchData.firstName, searchData.lastName)
      : record.nameSearchTokens,
  }
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

export async function readDb({ decryptRegistry = true } = {}) {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8')
    const { data, changed: passwordsChanged } = stripPlaintextUserPasswords(JSON.parse(raw))
    const registry = Array.isArray(data.residentRegistry) ? data.residentRegistry : []
    const needsRegistryEncryption = registry.some((record) => !record.encryptedData)
    const needsNameSearchTokens = registry.some((record) => residentNameSearchTokensNeedRefresh(record.nameSearchTokens))
    const protectedData = {
      ...data,
      residentRegistry: registry.map(encryptRegistryRecord),
    }
    if (passwordsChanged || needsRegistryEncryption || needsNameSearchTokens) await writeJsonFile(protectedData)

    return {
      ...data,
      residentRegistry: decryptRegistry
        ? protectedData.residentRegistry.map(decryptRegistryRecord)
        : protectedData.residentRegistry,
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
        staffInvitations: [],
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

export async function createStaffInvitation(invitation) {
  return serializeRegistryMutation(async () => {
    const email = String(invitation.email || '').trim().toLowerCase()
    const mobile = String(invitation.mobile || '').trim()
    const db = await readDb()
    db.staffInvitations = Array.isArray(db.staffInvitations) ? db.staffInvitations : []
    db.users = Array.isArray(db.users) ? db.users : []

    const now = Date.now()
    db.staffInvitations = db.staffInvitations.map((item) => (
      !item.acceptedAt && !item.revokedAt && Date.parse(item.expiresAt) <= now
        ? { ...item, revokedAt: new Date(now).toISOString() }
        : item
    ))

    const identityExists = db.users.some((user) => (
      String(user.email || '').toLowerCase() === email
      || String(user.mobile || '') === mobile
    ))
    const invitationExists = db.staffInvitations.some((item) => (
      !item.acceptedAt && !item.revokedAt
      && (item.email === email || item.mobile === mobile)
    ))
    if (identityExists) throw new Error('STAFF_INVITATION_ACCOUNT_EXISTS')
    if (invitationExists) throw new Error('STAFF_INVITATION_ALREADY_PENDING')

    db.staffInvitations.push({
      id: invitation.id,
      tokenHash: invitation.tokenHash,
      email,
      mobile,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      acceptedAt: null,
      revokedAt: null,
    })
    db.auditLogs = Array.isArray(db.auditLogs) ? db.auditLogs : []
    db.auditLogs.push({
      id: randomUUID(),
      actorId: null,
      actorRole: 'deployment_operator',
      action: 'staff.invitation.created',
      targetType: 'staff_invitation',
      targetId: invitation.id,
      metadata: { expiresAt: invitation.expiresAt, operatorId: invitation.operatorId },
      createdAt: invitation.createdAt,
    })
    await writeDb(db)
    return { id: invitation.id, expiresAt: invitation.expiresAt }
  })
}

export async function redeemStaffInvitation({ tokenHash, firstName, lastName, passwordHash, userId, now = new Date().toISOString() }) {
  return serializeRegistryMutation(async () => {
    const db = await readDb()
    db.staffInvitations = Array.isArray(db.staffInvitations) ? db.staffInvitations : []
    db.users = Array.isArray(db.users) ? db.users : []
    const invitation = db.staffInvitations.find((item) => item.tokenHash === tokenHash)
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || Date.parse(invitation.expiresAt) <= Date.parse(now)) {
      return null
    }

    const identityExists = db.users.some((user) => (
      String(user.email || '').toLowerCase() === invitation.email
      || String(user.mobile || '') === invitation.mobile
    ))
    if (identityExists) return null

    const user = {
      id: userId,
      firstName,
      lastName,
      mobile: invitation.mobile,
      email: invitation.email,
      passwordHash,
      role: 'staff',
      householdId: null,
      familyMembers: 1,
      householdMembers: [],
      status: 'On Duty',
      address: 'Barangay Hall, Legaspi',
      zone: 0,
      position: 'Staff',
      availability: 'Available',
      createdAt: now,
    }
    invitation.acceptedAt = now
    invitation.redeemedUserId = userId
    db.users.push(user)
    db.auditLogs = Array.isArray(db.auditLogs) ? db.auditLogs : []
    db.auditLogs.push({
      id: randomUUID(),
      actorId: userId,
      actorRole: 'staff',
      action: 'staff.invitation.redeemed',
      targetType: 'user',
      targetId: userId,
      metadata: { invitationId: invitation.id },
      createdAt: now,
    })
    await writeDb(db)
    return { id: user.id, email: user.email }
  })
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
  household: record.household ?? record.householdId ?? record.household_id ?? null,
  maritalStatus: record.maritalStatus ?? record.marital_status ?? null,
  occupation: record.occupation ?? null,
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
  const db = await readDb({ decryptRegistry: false })
  const searchCandidates = residentNameSearchCandidates(filters.search)
  const rawMatches = (db.residentRegistry || []).filter((record) => {
    if (searchCandidates.some((candidates) => !candidates.some((token) => record.nameSearchTokens?.includes(token)))) return false
    if (filters.zone && Number(record.zone) !== Number(filters.zone)) return false
    if (filters.purok && record.purok !== filters.purok) return false
    return true
  })
  const offset = (filters.page - 1) * filters.pageSize
  const recordsToRead = searchCandidates.length || filters.birthDate || filters.ageStart || filters.ageEnd || filters.maritalStatus || filters.occupation
    ? rawMatches.map(decryptRegistryRecord).map(normalizeRegistryResident).filter((resident) => {
    if (filters.birthDate && resident.birthDate !== filters.birthDate) return false
    if (filters.ageStart && filters.ageEnd && (!resident.birthDate || resident.birthDate < filters.ageStart || resident.birthDate > filters.ageEnd)) return false
    if (filters.maritalStatus && String(resident.maritalStatus || '').trim().toLocaleLowerCase('en') !== filters.maritalStatus.trim().toLocaleLowerCase('en')) return false
    if (filters.occupation && String(resident.occupation || '').trim().toLocaleLowerCase('en') !== filters.occupation.trim().toLocaleLowerCase('en')) return false
    return true
    }).sort((left, right) => (
      Number(left.zone || 99) - Number(right.zone || 99)
      || String(left.purok || '').localeCompare(String(right.purok || ''))
      || left.lastName.localeCompare(right.lastName)
      || left.firstName.localeCompare(right.firstName)
      || String(left.id).localeCompare(String(right.id))
    ))
    : rawMatches
      .sort((left, right) => (
        Number(left.zone || 99) - Number(right.zone || 99)
        || String(left.purok || '').localeCompare(String(right.purok || ''))
        || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
        || String(left.id).localeCompare(String(right.id))
      ))
      .slice(offset, offset + filters.pageSize)
      .map(decryptRegistryRecord)
      .map(normalizeRegistryResident)
  const total = searchCandidates.length || filters.birthDate || filters.ageStart || filters.ageEnd || filters.maritalStatus || filters.occupation
    ? recordsToRead.length
    : rawMatches.length
  const residents = searchCandidates.length || filters.birthDate || filters.ageStart || filters.ageEnd || filters.maritalStatus || filters.occupation
    ? recordsToRead.slice(offset, offset + filters.pageSize)
    : recordsToRead
  return { residents, total }
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
    }
  }) : undefined

  return {
    eligibility: 'Active records with verified household/resident status.',
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
    if (Object.keys(updates).some((field) => residentPrivateFields.includes(field))) {
      delete resident.encryptedData
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'firstName') || Object.prototype.hasOwnProperty.call(updates, 'lastName')) {
      resident.nameSearchTokens = []
    }
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

export async function archiveProcessedRequestsOlderThan() {
  const db = await readDb()
  db.requests = db.requests || []

  const old = db.requests
    .filter((request) => ['Approved', 'Rejected'].includes(request.status))
    .slice(0, 500)

  if (old.length === 0) {
    return { count: 0, filename: null, archivedAt: null }
  }

  await fs.mkdir(archiveDirectory, { recursive: true })

  const archivedAt = new Date().toISOString()
  const filename = `queue-approvals-${archivedAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`
  const archivePath = path.join(archiveDirectory, filename)
  const archivePayload = {
    archivedAt,
    archivedFor: 'manual',
    total: old.length,
    records: old,
  }
  await fs.writeFile(archivePath, JSON.stringify(archivePayload, null, 2), { encoding: 'utf8', flag: 'wx' })

  const archivedIds = new Set(old.map((request) => request.id))
  db.requests = db.requests.filter((request) => !archivedIds.has(request.id))
  await writeDb(db)

  return {
    count: old.length,
    filename,
    archivedAt,
    remaining: db.requests.filter((request) => ['Approved', 'Rejected'].includes(request.status)).length,
  }
}

export async function restoreArchivedRequests(filename) {
  if (typeof filename !== 'string' || !/^queue-approvals-[\w.-]+\.json$/.test(filename)) {
    throw new TypeError('Only queue-approval archives can be restored.')
  }
  const archive = await getArchive(filename)
  if (!archive) return null
  if (!Array.isArray(archive.records)
    || archive.records.some((record) => !record || typeof record.id !== 'string' || !['Approved', 'Rejected'].includes(record.status))) {
    throw new TypeError('The selected archive is invalid or does not contain closed requests.')
  }

  const db = await readDb()
  db.requests = db.requests || []
  const activeIds = new Set(db.requests.map((request) => request.id))
  const restorable = archive.records.filter((record) => {
    if (activeIds.has(record.id)) return false
    activeIds.add(record.id)
    return true
  })
  const conflictCount = archive.records.length - restorable.length
  if (restorable.length) {
    db.requests.push(...restorable)
    await writeDb(db)
  }
  return { restoredCount: restorable.length, conflictCount }
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
