import { randomUUID } from 'node:crypto'
import { verifyToken } from './auth.js'

const validDateKey = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const manilaDateKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

const shiftDateKeyByYears = (value, years) => {
  const [year, month, day] = value.split('-').map(Number)
  const targetYear = year + years
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

const shiftDateKeyByDays = (value, days) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const calculateAge = (birthDate, today) => {
  if (!birthDate) return null
  const [birthYear] = birthDate.split('-').map(Number)
  const [todayYear] = today.split('-').map(Number)
  return todayYear - birthYear - (birthDate.slice(5) > today.slice(5) ? 1 : 0)
}

const cleanText = (value) => String(value || '').replace(/[<>]/g, '').trim()

const makeAuditEntry = (actor, action, targetType, targetId, metadata = {}) => ({
  id: randomUUID(),
  actorId: actor.id,
  actorRole: actor.role,
  action,
  targetType,
  targetId: targetId || null,
  metadata,
  createdAt: new Date().toISOString(),
})

export function registerResidentRegistryRoutes(app, { store }) {
  const authorizeStaff = async (req, res) => {
    const authorization = req.headers.authorization || ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null
    if (!token) {
      res.status(401).json({ message: 'Authentication required.' })
      return null
    }

    let payload
    try {
      payload = verifyToken(token)
    } catch {
      res.status(401).json({ message: 'Invalid or expired token.' })
      return null
    }
    if (payload.purpose === 'mfa_pending') {
      res.status(401).json({ message: 'Invalid or expired token.' })
      return null
    }
    let user
    try {
      user = await store.findUserById(payload.sub)
    } catch (error) {
      console.error('staff resident registry authentication lookup failed', error)
      res.status(500).json({ message: 'Unable to verify staff account access.' })
      return null
    }
    if (!user || ['Suspended', 'Disabled'].includes(user.status)) {
      res.status(403).json({ message: 'Account access is disabled.' })
      return null
    }
    if (user.role !== 'staff') {
      res.status(403).json({ message: 'Access denied for this role.' })
      return null
    }
    return { id: user.id, role: user.role }
  }

  const requireStorage = (...methods) => {
    const missing = methods.filter((method) => typeof store[method] !== 'function')
    if (missing.length) throw new Error(`Resident registry storage is missing: ${missing.join(', ')}`)
  }

  app.get('/api/staff/residents', async (req, res) => {
    if (!await authorizeStaff(req, res)) return
    const search = String(req.query.search || '').trim()
    const birthDate = String(req.query.birthDate || '').trim()
    const ageRaw = req.query.age
    const age = ageRaw === undefined || ageRaw === '' ? null : Number(ageRaw)
    const zoneRaw = req.query.zone
    const zone = zoneRaw === undefined || zoneRaw === '' ? null : Number(zoneRaw)
    const purok = String(req.query.purok || '').trim()
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 25))
    const today = manilaDateKey()

    if (search.length > 120 || purok.length > 100) return res.status(400).json({ message: 'Search filters are too long.' })
    if (birthDate && (!validDateKey(birthDate) || birthDate > today)) return res.status(400).json({ message: 'Enter a valid birthdate that is not in the future.' })
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130)) return res.status(400).json({ message: 'Age must be a whole number from 0 to 130.' })
    if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })

    let ageStart = null
    let ageEnd = null
    if (age !== null) {
      ageStart = shiftDateKeyByDays(shiftDateKeyByYears(today, -(age + 1)), 1)
      ageEnd = shiftDateKeyByYears(today, -age)
    }

    try {
      requireStorage('listResidentRegistry')
      const result = await store.listResidentRegistry({ search, birthDate, ageStart, ageEnd, zone, purok, page, pageSize })
      const residents = result.residents.map((resident) => ({
        id: resident.id,
        firstName: resident.firstName || resident.first_name,
        lastName: resident.lastName || resident.last_name,
        birthDate: resident.birthDate || resident.birth_date || null,
        age: calculateAge(resident.birthDate || resident.birth_date, today),
        sex: resident.sex || 'Unclassified',
        householdId: resident.householdId || resident.household_id || null,
        purok: resident.purok || null,
        zone: resident.zone === null || resident.zone === undefined ? null : Number(resident.zone),
        address: resident.address || null,
        status: resident.status || resident.recordStatus || resident.record_status || 'active',
        verificationStatus: resident.verificationStatus || resident.verification_status || 'pending',
        sourceReference: resident.sourceReference || resident.source_reference || null,
        sourceFilename: resident.sourceFilename || resident.source_filename || null,
      }))
      return res.json({ residents, total: result.total, page, pageSize, filters: { search, birthDate, age, zone, purok } })
    } catch (error) {
      console.error('staff resident registry query failed', error)
      return res.status(500).json({ message: 'Unable to load the resident registry.' })
    }
  })

  app.get('/api/staff/demographics', async (req, res) => {
    if (!await authorizeStaff(req, res)) return
    const zoneRaw = req.query.zone
    const zone = zoneRaw === undefined || zoneRaw === '' ? null : Number(zoneRaw)
    const purok = String(req.query.purok || '').trim()
    if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })
    if (purok.length > 100) return res.status(400).json({ message: 'Purok filter is too long.' })
    try {
      requireStorage('getResidentDemographics')
      return res.json(await store.getResidentDemographics({ zone, purok }))
    } catch (error) {
      console.error('staff resident demographics query failed', error)
      return res.status(500).json({ message: 'Unable to load demographic totals.' })
    }
  })

  app.post('/api/staff/residents', async (req, res) => {
    const actor = await authorizeStaff(req, res)
    if (!actor) return
    const firstName = cleanText(req.body?.firstName)
    const lastName = cleanText(req.body?.lastName)
    const birthDate = req.body?.birthDate || null
    const sex = req.body?.sex || null
    const householdId = cleanText(req.body?.householdId || '')
    const purok = cleanText(req.body?.purok || '')
    const address = cleanText(req.body?.address || '')
    const sourceReference = cleanText(req.body?.sourceReference || '')
    const sourceFilename = cleanText(req.body?.sourceFilename || '')
    const zoneText = req.body?.zone === null || req.body?.zone === undefined ? '' : String(req.body.zone)
    const zone = zoneText ? Number(zoneText) : null
    const today = manilaDateKey()

    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      return res.status(400).json({ message: 'Enter the resident’s first and last names (up to 100 characters each).' })
    }
    if (birthDate && (typeof birthDate !== 'string' || !validDateKey(birthDate) || birthDate > today)) {
      return res.status(400).json({ message: 'Enter a valid birthdate that is not in the future.' })
    }
    if (sex !== null && !['Male', 'Female', 'Unclassified'].includes(sex)) {
      return res.status(400).json({ message: 'Choose Male, Female, or Unclassified for sex.' })
    }
    if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) {
      return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })
    }
    if (householdId.length > 100 || purok.length > 100 || address.length > 255 || sourceReference.length > 255 || sourceFilename.length > 255) {
      return res.status(400).json({ message: 'One or more resident fields exceed the allowed length.' })
    }

    try {
      requireStorage('findPotentialRegistryMatches', 'insertRegistryResidents')
      const potentialMatches = await store.findPotentialRegistryMatches(firstName, lastName, birthDate)
      if (potentialMatches.length && req.body?.confirmPotentialMatch !== true) {
        return res.status(409).json({
          message: 'Review the possible matching records before confirming this registration.',
          potentialMatches,
          reviewRequired: true,
        })
      }
      const createdAt = new Date().toISOString()
      const resident = {
        id: randomUUID(),
        firstName,
        lastName,
        birthDate,
        sex,
        householdId: householdId || null,
        purok: purok || null,
        zone,
        address: address || null,
        status: 'active',
        recordStatus: 'active',
        verificationStatus: 'pending',
        sourceReference: sourceReference || null,
        sourceFilename: sourceFilename || null,
        sourceFingerprint: null,
        createdBy: actor.id,
        verifiedBy: null,
        verifiedAt: null,
        createdAt,
        updatedAt: createdAt,
      }
      const auditEntry = makeAuditEntry(actor, 'resident_registry.created', 'resident_registry', resident.id, {
        verificationStatus: 'pending',
        hasSourceReference: Boolean(sourceReference),
      })
      await store.insertRegistryResidents([resident], auditEntry)
      return res.status(201).json({
        resident: {
          id: resident.id,
          firstName,
          lastName,
          birthDate,
          age: calculateAge(birthDate, today),
          sex: sex || 'Unclassified',
          householdId: householdId || null,
          purok: purok || null,
          zone,
          address: address || null,
          status: 'active',
          verificationStatus: 'pending',
          sourceReference: sourceReference || null,
          sourceFilename: sourceFilename || null,
        },
        potentialMatches,
        reviewRequired: true,
      })
    } catch (error) {
      console.error('staff resident registration failed', error)
      return res.status(500).json({ message: 'Unable to save the resident record.' })
    }
  })

  app.post('/api/staff/residents/import', async (req, res) => {
    const actor = await authorizeStaff(req, res)
    if (!actor) return
    const { residents, filename, confirmPotentialMatches } = req.body || {}
    if (!Array.isArray(residents) || residents.length < 1 || residents.length > 500) {
      return res.status(400).json({ message: 'Upload between 1 and 500 resident records.' })
    }
    if (typeof filename !== 'string' || !filename.trim() || filename.trim().length > 255) {
      return res.status(400).json({ message: 'A source filename of up to 255 characters is required.' })
    }
    if (confirmPotentialMatches !== undefined && typeof confirmPotentialMatches !== 'boolean') {
      return res.status(400).json({ message: 'Duplicate confirmation must be true or false.' })
    }

    const today = manilaDateKey()
    const validationErrors = []
    const normalized = residents.map((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        validationErrors.push({ row: index + 2, field: 'record', message: 'Expected a resident record.' })
        return null
      }
      const rawString = (key) => {
        const value = record[key]
        if (value !== null && value !== undefined && typeof value !== 'string') {
          validationErrors.push({ row: index + 2, field: key, message: 'Must be text.' })
          return ''
        }
        return cleanText(value || '')
      }
      const firstName = rawString('firstName')
      const lastName = rawString('lastName')
      const birthDate = rawString('birthDate')
      const sex = rawString('sex')
      const householdId = rawString('householdId')
      const purok = rawString('purok')
      const address = rawString('address')
      const sourceReference = rawString('sourceReference')
      const zoneText = rawString('zone')
      const zone = zoneText ? Number(zoneText) : null

      if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
        validationErrors.push({ row: index + 2, field: 'name', message: 'First and last names are required and must not exceed 100 characters.' })
      }
      if (birthDate && (!validDateKey(birthDate) || birthDate > today)) {
        validationErrors.push({ row: index + 2, field: 'birthDate', message: 'Birthdate must be a valid date no later than today.' })
      }
      if (sex && !['Male', 'Female', 'Unclassified'].includes(sex)) {
        validationErrors.push({ row: index + 2, field: 'sex', message: 'Use Male, Female, or Unclassified.' })
      }
      if (zoneText && (!Number.isInteger(zone) || zone < 1 || zone > 7)) {
        validationErrors.push({ row: index + 2, field: 'zone', message: 'Zone must be a whole number from 1 to 7.' })
      }
      if (householdId.length > 100 || purok.length > 100 || address.length > 255 || sourceReference.length > 255) {
        validationErrors.push({ row: index + 2, field: 'length', message: 'A field exceeds its maximum length.' })
      }
      return {
        firstName,
        lastName,
        birthDate: birthDate || null,
        sex: sex || null,
        householdId: householdId || null,
        purok: purok || null,
        zone,
        address: address || null,
        sourceReference: sourceReference || null,
      }
    })
    if (validationErrors.length) return res.status(400).json({ message: 'Correct the invalid rows before importing.', validationErrors })

    try {
      requireStorage('findPotentialRegistryMatches', 'insertRegistryResidents')
      const potentialMatches = []
      const seenRows = new Map()
      for (const [index, resident] of normalized.entries()) {
        const identityKey = `${resident.firstName.toLowerCase()}\u0000${resident.lastName.toLowerCase()}\u0000${resident.birthDate || ''}`
        const earlierRow = seenRows.get(identityKey)
        if (earlierRow !== undefined) {
          potentialMatches.push({
            row: index + 2,
            records: [{
              id: `upload-row-${earlierRow + 2}`,
              firstName: normalized[earlierRow].firstName,
              lastName: normalized[earlierRow].lastName,
              birthDate: normalized[earlierRow].birthDate,
              source: 'same import file',
            }],
          })
        } else {
          seenRows.set(identityKey, index)
        }
        const existing = await store.findPotentialRegistryMatches(resident.firstName, resident.lastName, resident.birthDate)
        if (existing.length) potentialMatches.push({ row: index + 2, records: existing })
      }
      if (potentialMatches.length && confirmPotentialMatches !== true) {
        return res.status(409).json({
          message: 'Review every possible duplicate before confirming the import.',
          potentialMatches,
          reviewRequired: true,
        })
      }

      const createdAt = new Date().toISOString()
      const records = normalized.map((resident) => ({
        ...resident,
        id: randomUUID(),
        status: 'active',
        recordStatus: 'active',
        verificationStatus: 'pending',
        sourceFilename: filename.trim(),
        sourceFingerprint: null,
        createdBy: actor.id,
        verifiedBy: null,
        verifiedAt: null,
        createdAt,
        updatedAt: createdAt,
      }))
      const auditEntry = makeAuditEntry(actor, 'resident_registry.bulk_imported', 'resident_registry_batch', null, {
        count: records.length,
        filename: filename.trim(),
        potentialMatchCount: potentialMatches.length,
      })
      await store.insertRegistryResidents(records, auditEntry)
      return res.status(201).json({ imported: records.length, verificationStatus: 'pending', potentialMatches })
    } catch (error) {
      console.error('staff resident registry import failed', error)
      return res.status(500).json({ message: 'Unable to import resident records.' })
    }
  })

  app.patch('/api/staff/residents/:id/verify', async (req, res) => {
    const actor = await authorizeStaff(req, res)
    if (!actor) return
    const verificationStatus = req.body?.verificationStatus
    if (!['verified', 'needs_review'].includes(verificationStatus)) return res.status(400).json({ message: 'Choose verified or needs_review.' })
    try {
      requireStorage('updateRegistryResidentWithAudit')
      const verifiedAt = new Date().toISOString()
      const resident = await store.updateRegistryResidentWithAudit(req.params.id, {
        verificationStatus,
        verifiedBy: actor.id,
        verifiedAt,
      }, makeAuditEntry(actor, `resident_registry.${verificationStatus}`, 'resident_registry', req.params.id))
      if (!resident) return res.status(404).json({ message: 'Resident record not found.' })
      return res.json({ resident: { id: resident.id, firstName: resident.firstName, lastName: resident.lastName, verificationStatus, verifiedBy: actor.id, verifiedAt } })
    } catch (error) {
      console.error('resident verification update failed', error)
      return res.status(500).json({ message: 'Unable to update resident verification.' })
    }
  })

  app.patch('/api/staff/residents/:id/status', async (req, res) => {
    const actor = await authorizeStaff(req, res)
    if (!actor) return
    const status = req.body?.status
    if (!['active', 'inactive', 'deceased', 'archived'].includes(status)) return res.status(400).json({ message: 'Choose active, inactive, deceased, or archived.' })
    try {
      requireStorage('updateRegistryResidentWithAudit')
      const resident = await store.updateRegistryResidentWithAudit(req.params.id, { status },
        makeAuditEntry(actor, 'resident_registry.status_changed', 'resident_registry', req.params.id, { status }))
      if (!resident) return res.status(404).json({ message: 'Resident record not found.' })
      return res.json({ resident: { id: resident.id, status } })
    } catch (error) {
      console.error('resident record status update failed', error)
      return res.status(500).json({ message: 'Unable to update resident record status.' })
    }
  })
}
