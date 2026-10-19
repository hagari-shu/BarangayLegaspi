import { createHash, randomUUID } from 'node:crypto'
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

export const registryAgeDateRange = (today, age) => ({
  ageStart: shiftDateKeyByDays(shiftDateKeyByYears(today, -(age + 1)), 1),
  ageEnd: shiftDateKeyByYears(today, -age),
})

const cleanText = (value) => String(value || '').replace(/[<>]/g, '').trim()
const residentFingerprint = (resident) => createHash('sha256').update(JSON.stringify([
  resident.firstName.trim().toLocaleLowerCase(),
  resident.lastName.trim().toLocaleLowerCase(),
  resident.birthDate || null,
  resident.sex || null,
  resident.maritalStatus || null,
  resident.occupation || null,
  resident.householdId || null,
  resident.purok || null,
  resident.zone ?? null,
  resident.address || null,
  resident.sourceReference || null,
])).digest('hex')

const matchIdentity = (resident) => `${resident.firstName.trim().toLocaleLowerCase()}\u0000${resident.lastName.trim().toLocaleLowerCase()}`

const findBatchMatches = (residents, existingMatches) => {
  const matches = []
  for (const [index, resident] of residents.entries()) {
    const records = [...(existingMatches[index] || [])]
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex += 1) {
      const earlier = residents[earlierIndex]
      if (matchIdentity(resident) === matchIdentity(earlier)) {
        records.push({
          id: `upload-row-${earlierIndex + 2}`,
          firstName: earlier.firstName,
          lastName: earlier.lastName,
          birthDate: earlier.birthDate,
          source: 'same import file',
        })
      }
    }
    if (records.length) matches.push({ row: index + 2, records })
  }
  return matches
}

const savedMatchSnapshot = (matches) => matches.map((match) => ({
  row: match.row,
  ids: match.records.filter((record) => record.source !== 'same import file').map((record) => String(record.id)).sort(),
})).filter((match) => match.ids.length)

const matchSnapshotsEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right)

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

  app.get('/api/staff/registry-source-reviews', async (req, res) => {
    if (!await authorizeStaff(req, res)) return
    try {
      requireStorage('listRegistrySourceReviews')
      const reviews = await store.listRegistrySourceReviews()
      return res.json({ reviews: reviews.map(({ id, zone, purok, status, createdAt }) => ({ id, zone, purok, status, createdAt })) })
    } catch (error) {
      console.error('staff registry source review query failed', error)
      return res.status(500).json({ message: 'Unable to load source-review warnings.' })
    }
  })

  app.post('/api/staff/registry-source-reviews', async (req, res) => {
    const actor = await authorizeStaff(req, res)
    if (!actor) return
    if (typeof req.body?.purok !== 'string') return res.status(400).json({ message: 'Enter a purok name of up to 100 characters.' })
    const purok = cleanText(req.body?.purok)
    const zoneText = req.body?.zone === null || req.body?.zone === undefined ? '' : String(req.body.zone)
    const zone = zoneText ? Number(zoneText) : null
    if (!purok || purok.length > 100) return res.status(400).json({ message: 'Enter a purok name of up to 100 characters.' })
    if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) {
      return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })
    }
    try {
      requireStorage('openRegistrySourceReview')
      const createdAt = new Date().toISOString()
      const review = {
        id: randomUUID(),
        zone,
        purok,
        status: 'open',
        createdBy: actor.id,
        createdAt,
        resolvedBy: null,
        resolvedAt: null,
      }
      const outcome = await store.openRegistrySourceReview(review, makeAuditEntry(
        actor,
        'resident_registry.source_review_opened',
        'resident_registry_source_review',
        review.id,
        { zone, purok }
      ))
      const { id, status, createdAt: openedAt } = outcome.review
      return res.status(outcome.created ? 201 : 200).json({
        review: { id, zone: outcome.review.zone, purok: outcome.review.purok, status, createdAt: openedAt },
        created: outcome.created,
      })
    } catch (error) {
      console.error('staff registry source review creation failed', error)
      return res.status(500).json({ message: 'Unable to create the source-review warning.' })
    }
  })

  app.patch('/api/staff/registry-source-reviews/:id/resolve', async (req, res) => {
    const actor = await authorizeStaff(req, res)
    if (!actor) return
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ message: 'Choose a valid source-review warning.' })
    }
    try {
      requireStorage('resolveRegistrySourceReview')
      const resolvedAt = new Date().toISOString()
      const review = await store.resolveRegistrySourceReview(req.params.id, actor.id, resolvedAt, makeAuditEntry(
        actor,
        'resident_registry.source_review_resolved',
        'resident_registry_source_review',
        req.params.id
      ))
      if (!review) return res.status(404).json({ message: 'Open source-review warning not found.' })
      return res.json({ review: { id: review.id, status: review.status, resolvedAt: review.resolvedAt } })
    } catch (error) {
      console.error('staff registry source review resolution failed', error)
      return res.status(500).json({ message: 'Unable to resolve the source-review warning.' })
    }
  })

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
      ({ ageStart, ageEnd } = registryAgeDateRange(today, age))
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
        sex: resident.sex || null,
        maritalStatus: resident.maritalStatus || resident.marital_status || null,
        occupation: resident.occupation || null,
        householdId: resident.householdId || resident.household_id || null,
        purok: resident.purok || null,
        zone: resident.zone === null || resident.zone === undefined ? null : Number(resident.zone),
        status: resident.status || resident.recordStatus || resident.record_status || 'active',
        verificationStatus: resident.verificationStatus || resident.verification_status || 'pending',
      }))
      return res.json({ residents, total: result.total, page, pageSize, filters: { search, birthDate, age, zone, purok } })
    } catch (error) {
      console.error('staff resident registry query failed', error)
      return res.status(500).json({ message: 'Unable to load the resident registry.' })
    }
  })

  app.get('/api/staff/residents/zones', async (req, res) => {
    if (!await authorizeStaff(req, res)) return
    try {
      requireStorage('listResidentRegistry')
      const zones = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
        const zone = index + 1
        const result = await store.listResidentRegistry({ zone, page: 1, pageSize: 1 })
        return { zone, total: result.total }
      }))
      return res.json({ zones })
    } catch (error) {
      console.error('staff resident zone counts query failed', error)
      return res.status(500).json({ message: 'Unable to load resident zone totals.' })
    }
  })

  app.get('/api/staff/residents/:id', async (req, res) => {
    if (!await authorizeStaff(req, res)) return
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ message: 'Choose a valid resident record.' })
    }
    try {
      requireStorage('getResidentRegistryById')
      const resident = await store.getResidentRegistryById(req.params.id)
      if (!resident) return res.status(404).json({ message: 'Resident record not found.' })
      return res.json({ resident: {
        id: resident.id,
        firstName: resident.firstName,
        lastName: resident.lastName,
        birthDate: resident.birthDate,
        sex: resident.sex || null,
        maritalStatus: resident.maritalStatus || null,
        occupation: resident.occupation || null,
        householdId: resident.householdId || null,
        zone: resident.zone === null || resident.zone === undefined ? null : Number(resident.zone),
        address: resident.address || null,
      } })
    } catch (error) {
      console.error('resident registry record lookup failed', error)
      return res.status(500).json({ message: 'Unable to load resident information.' })
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
    const maritalStatus = cleanText(req.body?.maritalStatus || '')
    const occupation = cleanText(req.body?.occupation || '')
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
    if (sex !== null && !['Male', 'Female'].includes(sex)) {
      return res.status(400).json({ message: 'Choose Male or Female, or leave sex blank.' })
    }
    if (maritalStatus && !['Single', 'Married', 'Widowed', 'Legally Separated', 'Annulled'].includes(maritalStatus)) {
      return res.status(400).json({ message: 'Choose a valid marital status or leave it blank.' })
    }
    if (occupation.length > 120) {
      return res.status(400).json({ message: 'Occupation must be 120 characters or fewer.' })
    }
    if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) {
      return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })
    }
    if (householdId.length > 100 || purok.length > 100 || address.length > 255 || sourceReference.length > 255 || sourceFilename.length > 255) {
      return res.status(400).json({ message: 'One or more resident fields exceed the allowed length.' })
    }
    if (req.body?.confirmPotentialMatch !== undefined && typeof req.body.confirmPotentialMatch !== 'boolean') {
      return res.status(400).json({ message: 'Duplicate confirmation must be true or false.' })
    }
    if (req.body?.reviewedMatches !== undefined && !Array.isArray(req.body.reviewedMatches)) {
      return res.status(400).json({ message: 'Reviewed duplicate matches must be a list.' })
    }

    try {
      requireStorage('findPotentialRegistryMatches', 'insertRegistryResidents')
      const potentialMatches = await store.findPotentialRegistryMatches(firstName, lastName, birthDate)
      const reviewedMatches = savedMatchSnapshot([{ row: 1, records: potentialMatches }])
      const confirmPotentialMatch = req.body?.confirmPotentialMatch === true
      if (potentialMatches.length && (!confirmPotentialMatch || !matchSnapshotsEqual(reviewedMatches, req.body?.reviewedMatches))) {
        return res.status(409).json({
          message: 'Review the possible matching records before confirming this registration.',
          potentialMatches,
          reviewedMatches,
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
        maritalStatus: maritalStatus || null,
        occupation: occupation || null,
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
      resident.sourceFingerprint = residentFingerprint(resident)
      const auditEntry = makeAuditEntry(actor, 'resident_registry.created', 'resident_registry', resident.id, {
        verificationStatus: 'pending',
        hasSourceReference: Boolean(sourceReference),
      })
      const outcome = await store.insertRegistryResidents([resident], auditEntry, {
        confirmPotentialMatches: confirmPotentialMatch,
        reviewedMatches,
        rowOffset: 1,
      })
      if (outcome.reviewRequired) return res.status(409).json({
        message: 'The matching records changed. Review them before confirming this registration.',
        potentialMatches: outcome.potentialMatches,
        reviewedMatches: outcome.reviewedMatches,
        reviewRequired: true,
      })
      return res.status(outcome.inserted.length ? 201 : 200).json({
        resident: { id: outcome.inserted[0]?.id || outcome.existing[0]?.id || resident.id, verificationStatus: 'pending' },
        created: outcome.inserted.length > 0,
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
    const { residents, filename, confirmPotentialMatches, reviewedMatches } = req.body || {}
    if (!Array.isArray(residents) || residents.length < 1 || residents.length > 500) {
      return res.status(400).json({ message: 'Upload between 1 and 500 resident records.' })
    }
    if (typeof filename !== 'string' || !filename.trim() || filename.trim().length > 255) {
      return res.status(400).json({ message: 'A source filename of up to 255 characters is required.' })
    }
    if (req.body?.familyBatch !== undefined && typeof req.body.familyBatch !== 'boolean') {
      return res.status(400).json({ message: 'Family batch mode must be true or false.' })
    }
    if (confirmPotentialMatches !== undefined && typeof confirmPotentialMatches !== 'boolean') {
      return res.status(400).json({ message: 'Duplicate confirmation must be true or false.' })
    }
    if (reviewedMatches !== undefined && !Array.isArray(reviewedMatches)) {
      return res.status(400).json({ message: 'Reviewed duplicate matches must be a list.' })
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
      const maritalStatus = rawString('maritalStatus')
      const occupation = rawString('occupation')
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
      if (sex && !['Male', 'Female'].includes(sex)) {
        validationErrors.push({ row: index + 2, field: 'sex', message: 'Use Male or Female, or leave blank.' })
      }
      if (maritalStatus && !['Single', 'Married', 'Widowed', 'Legally Separated', 'Annulled'].includes(maritalStatus)) {
        validationErrors.push({ row: index + 2, field: 'maritalStatus', message: 'Choose a valid marital status or leave it blank.' })
      }
      if (occupation.length > 120) {
        validationErrors.push({ row: index + 2, field: 'occupation', message: 'Occupation must be 120 characters or fewer.' })
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
        maritalStatus: maritalStatus || null,
        occupation: occupation || null,
        householdId: householdId || null,
        purok: purok || null,
        zone,
        address: address || null,
        sourceReference: sourceReference || null,
      }
    })
    if (validationErrors.length) return res.status(400).json({ message: 'Correct the invalid rows before importing.', validationErrors })

    try {
      requireStorage('findPotentialRegistryMatchesForResidents', 'insertRegistryResidents')
      const existingMatches = await store.findPotentialRegistryMatchesForResidents(normalized)
      const potentialMatches = findBatchMatches(normalized, existingMatches)
      const currentReviewedMatches = savedMatchSnapshot(potentialMatches)
      if (potentialMatches.length && (confirmPotentialMatches !== true
        || !matchSnapshotsEqual(currentReviewedMatches, reviewedMatches))) {
        return res.status(409).json({
          message: 'Review every possible duplicate before confirming the import.',
          potentialMatches,
          reviewedMatches: currentReviewedMatches,
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
        sourceFilename: req.body?.familyBatch === true ? null : filename.trim(),
        sourceFingerprint: residentFingerprint(resident),
        createdBy: actor.id,
        verifiedBy: null,
        verifiedAt: null,
        createdAt,
        updatedAt: createdAt,
      }))
      const auditEntry = makeAuditEntry(actor, req.body?.familyBatch === true ? 'resident_registry.family_added' : 'resident_registry.bulk_imported', 'resident_registry_batch', null, {
        count: records.length,
        hasFilename: req.body?.familyBatch === true ? false : Boolean(filename.trim()),
        potentialMatchCount: potentialMatches.length,
      })

      const outcome = await store.insertRegistryResidents(records, auditEntry, {
        confirmPotentialMatches: confirmPotentialMatches === true,
        reviewedMatches: currentReviewedMatches,
      })
      if (outcome.reviewRequired) return res.status(409).json({
        message: 'The matching records changed. Review them before confirming the import.',
        potentialMatches: outcome.potentialMatches,
        reviewedMatches: outcome.reviewedMatches,
        reviewRequired: true,
      })
      return res.status(201).json({
        imported: outcome.inserted.length,
        skipped: outcome.skipped,
        verificationStatus: 'pending',
        potentialMatches,
      })
    } catch (error) {
      console.error('staff resident registry import failed', error)
      return res.status(500).json({ message: 'Unable to import resident records.' })
    }
  })

  app.patch('/api/staff/residents/:id', async (req, res) => {
    const actor = await authorizeStaff(req, res)
    if (!actor) return
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ message: 'Choose a valid resident record.' })
    }
    const allowedFields = ['firstName', 'lastName', 'birthDate', 'sex', 'maritalStatus', 'occupation', 'householdId', 'zone', 'address']
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some((key) => !allowedFields.includes(key))) {
      return res.status(400).json({ message: 'The resident information contains unsupported fields.' })
    }
    const updates = {}
    const has = (key) => Object.hasOwn(req.body, key)
    for (const key of ['firstName', 'lastName']) {
      if (!has(key)) continue
      if (typeof req.body[key] !== 'string' || !cleanText(req.body[key]) || cleanText(req.body[key]).length > 100) {
        return res.status(400).json({ message: 'First and last names are required and must be 100 characters or fewer.' })
      }
      updates[key] = cleanText(req.body[key])
    }
    if (has('birthDate')) {
      const value = req.body.birthDate
      if (value !== null && (typeof value !== 'string' || !validDateKey(value) || value > manilaDateKey())) {
        return res.status(400).json({ message: 'Enter a valid birthdate that is not in the future.' })
      }
      updates.birthDate = value
    }
    if (has('sex')) {
      const value = req.body.sex || null
      if (value !== null && !['Male', 'Female'].includes(value)) return res.status(400).json({ message: 'Choose Male or Female, or leave sex blank.' })
      updates.sex = value
    }
    if (has('maritalStatus')) {
      const value = cleanText(req.body.maritalStatus || '')
      if (value && !['Single', 'Married', 'Widowed', 'Legally Separated', 'Annulled'].includes(value)) {
        return res.status(400).json({ message: 'Choose a valid marital status or leave it blank.' })
      }
      updates.maritalStatus = value || null
    }
    if (has('occupation')) {
      if (typeof req.body.occupation !== 'string' || cleanText(req.body.occupation).length > 120) {
        return res.status(400).json({ message: 'Occupation must be text up to 120 characters.' })
      }
      updates.occupation = cleanText(req.body.occupation) || null
    }
    for (const [key, limit] of [['householdId', 100], ['address', 255]]) {
      if (!has(key)) continue
      if (req.body[key] !== null && typeof req.body[key] !== 'string') {
        return res.status(400).json({ message: 'Household and address fields must be text.' })
      }
      const value = cleanText(req.body[key] || '')
      if (value.length > limit) return res.status(400).json({ message: 'A resident field exceeds its maximum length.' })
      updates[key] = value || null
    }
    if (has('zone')) {
      const zone = req.body.zone === '' || req.body.zone === null ? null : Number(req.body.zone)
      if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) {
        return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })
      }
      updates.zone = zone
    }
    if (!Object.keys(updates).length) return res.status(400).json({ message: 'Provide at least one resident field to update.' })

    try {
      requireStorage('updateRegistryResidentWithAudit')
      const resident = await store.updateRegistryResidentWithAudit(req.params.id, updates, makeAuditEntry(
        actor,
        'resident_registry.details_updated',
        'resident_registry',
        req.params.id,
        { fields: Object.keys(updates) }
      ))
      if (!resident) return res.status(404).json({ message: 'Resident record not found.' })
      return res.json({ resident: {
        id: resident.id,
        firstName: resident.firstName,
        lastName: resident.lastName,
        birthDate: resident.birthDate,
        sex: resident.sex || null,
        maritalStatus: resident.maritalStatus || null,
        occupation: resident.occupation || null,
        householdId: resident.householdId || null,
        zone: resident.zone === null || resident.zone === undefined ? null : Number(resident.zone),
        address: resident.address || null,
      } })
    } catch (error) {
      console.error('resident registry details update failed', error)
      return res.status(500).json({ message: 'Unable to update resident information.' })
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
        verifiedBy: verificationStatus === 'verified' ? actor.id : null,
        verifiedAt: verificationStatus === 'verified' ? verifiedAt : null,
      }, makeAuditEntry(actor, `resident_registry.${verificationStatus}`, 'resident_registry', req.params.id))
      if (!resident) return res.status(404).json({ message: 'Resident record not found.' })
      return res.json({ resident: { id: resident.id, verificationStatus, verifiedBy: verificationStatus === 'verified' ? actor.id : null, verifiedAt: verificationStatus === 'verified' ? verifiedAt : null } })
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
