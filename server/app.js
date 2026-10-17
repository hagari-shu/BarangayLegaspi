import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { comparePassword, hashPassword, signToken, verifyToken } from './auth.js'
import { createTotpSecret, createTotpUri, decryptTotpSecret, encryptTotpSecret, verifyTotp } from './mfa.js'
import { createRequestReportCsv, filterStaffReportRequests, getStaffRequestReport, isValidReportDate } from './request-reporting.js'
import * as jsonDb from './db.js'
import * as pgDb from './db-postgres.js'
import {
  CAPTAIN_PHOTO_CONTENT_TYPES,
  CAPTAIN_PHOTO_KEY,
  createCaptainPhotoUpload,
  deleteCaptainPhoto,
  finalizeCaptainPhotoUpload,
  getCaptainPhotoUrl,
  isCaptainPhotoStorageConfigured,
} from './captain-photo-storage.js'
import { registerResidentRegistryRoutes } from './resident-registry.js'
import { ADMIN_SEED, CORS_ORIGINS, IS_PRODUCTION, IS_TEST_RUN, PORT, SHOULD_SKIP_SEED } from './config.js'

const usePostgres = !IS_TEST_RUN && Boolean(process.env.DATABASE_URL)
let store = usePostgres ? pgDb : jsonDb

const sanitizeText = (value = '') => String(value).replace(/[<>]/g, '').trim()
const sanitizeUserRecord = (user = {}) => {
  if (!user || typeof user !== 'object') return {}
  const { password, passwordHash, password_hash, mfaSecret, mfa_secret, mfaLastStep, mfa_last_step, ...safeUser } = user
  const mfaEnabled = Boolean(safeUser.mfaEnabled ?? safeUser.mfa_enabled)
  const role = String(safeUser.role || safeUser.userRole || 'resident').toLowerCase()
  return {
    ...safeUser,
    mfaEnabled,
    mfaSetupPending: !mfaEnabled && Boolean(mfaSecret || mfa_secret),
    role,
  }
}

const toAccessUserSummary = (user = {}) => {
  const normalized = sanitizeUserRecord(user)
  const role = normalized.role || 'resident'
  const zone = Number(user.zone ?? user.zone_number ?? user.zoneNumber ?? 0)
  return {
    ...normalized,
    id: user.id,
    firstName: user.firstName ?? user.first_name ?? '',
    lastName: user.lastName ?? user.last_name ?? '',
    email: user.email || '',
    mobile: user.mobile || '',
    zone: Number.isFinite(zone) && zone >= 1 && zone <= 7 ? zone : (role === 'resident' ? 1 : 0),
    createdAt: user.createdAt ?? user.created_at ?? null,
    status: user.status || 'Active Resident',
    position: user.position || null,
    availability: user.availability || 'Available',
    householdId: user.householdId ?? user.household_id ?? null,
  }
}

const isSyntheticTestAccount = (user = {}) => {
  if (!user || typeof user !== 'object') return false
  if (user.isTestAccount || user.isDemo || user.isSynthetic === true || user.source === 'demo') {
    return true
  }

  const normalizedRole = String(user.role || user.userRole || '').toLowerCase()
  const searchable = [
    user.email,
    user.firstName,
    user.first_name,
    user.lastName,
    user.last_name,
    user.mobile,
    user.householdId,
    user.household_id,
    user.status,
  ].join(' ').toLowerCase()

  if (normalizedRole === 'resident' && /@test\./.test(String(user.email || '').toLowerCase())) {
    return true
  }

  return /generated|dummy|demo\b|test account|2024-test|household.*test/i.test(searchable)
}

const filterVisibleUsers = (users = []) => (Array.isArray(users) ? users.filter((user) => !isSyntheticTestAccount(user)) : [])

const isValidEmail = (value) => /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(String(value).trim())
const isValidMobile = (value) => /^09\d{9}$/.test(String(value).trim())
const isValidPassword = (value) => {
  const password = String(value).trim()
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9\s]/.test(password)
}
const passwordRequirements = 'at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character'
const getManilaDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}
const isValidDateKey = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
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
const calculateAge = (birthDate, today = getManilaDateKey()) => {
  if (!birthDate) return null
  const [birthYear] = birthDate.split('-').map(Number)
  const [todayYear] = today.split('-').map(Number)
  const birthMonthDay = birthDate.slice(5)
  const todayMonthDay = today.slice(5)
  return todayYear - birthYear - (birthMonthDay > todayMonthDay ? 1 : 0)
}
const serviceCatalog = [
  { icon: '📄', title: 'Barangay Certificate', subtitle: 'Request and claim', tone: 'green' },
  { icon: '🏥', title: 'Health Assistance', subtitle: 'Access public health support', tone: 'blue' },
  { icon: '🧾', title: 'Barangay Clearance', subtitle: 'Update and renew', tone: 'amber' },
  { icon: '🚨', title: 'Emergency Help', subtitle: 'Call for immediate support', tone: 'red' },
]

const reminderStore = new Map()

export async function seedDemoResident() {
  if (usePostgres) {
    await pgDb.initDatabase()
    return
  }

  if (IS_PRODUCTION) {
    throw new Error('JSON demo accounts cannot be seeded in production.')
  }

  if (SHOULD_SKIP_SEED) {
    return
  }

  const db = await jsonDb.readDb()

  const demoNonAdminIdentifiers = new Set([
    'staff@barangay.gov.ph',
    'captain@barangay.gov.ph',
    'treasurer@barangay.gov.ph',
  ])
  const usersBeforeCleanup = db.users.length
  db.users = db.users.filter((user) => !demoNonAdminIdentifiers.has(String(user.email || '').toLowerCase()))

  let changed = db.users.length !== usersBeforeCleanup
  for (const user of db.users) {
    if (!user.role) {
      if (user.email === 'staff@barangay.gov.ph' || user.mobile === '09111111111') {
        user.role = 'staff'
      } else if (String(user.email || '').toLowerCase() === ADMIN_SEED.email.toLowerCase() || user.mobile === ADMIN_SEED.mobile) {
        user.role = 'admin'
      } else {
        user.role = 'resident'
      }
      changed = true
    }
  }

  if (changed) {
    await jsonDb.writeDb(db)
  }

  const defaultResidentSeed = {
    firstName: 'Maria',
    lastName: 'Dela Cruz',
    mobile: '09123456789',
    email: 'maria.delacruz@email.com',
    password: 'ResidentPass123!',
    role: 'resident',
    householdId: '2024-RESIDENT',
    familyMembers: 4,
    status: 'Active Resident',
    address: 'Barangay Legaspi, Tayug, Pangasinan',
    zone: 1,
  }

  const requiredSeeds = [ADMIN_SEED, defaultResidentSeed]

  if (SHOULD_SKIP_SEED || (IS_PRODUCTION && !ADMIN_SEED.password)) {
    return
  }

  const missingSeeds = requiredSeeds.filter((seed) => !db.users.some((user) => user.mobile === seed.mobile || user.email.toLowerCase() === seed.email.toLowerCase()))

  if (missingSeeds.length > 0) {
    for (const seed of missingSeeds) {
      db.users.push({
        id: randomUUID(),
        ...seed,
        passwordHash: await hashPassword(seed.password),
        createdAt: new Date().toISOString(),
      })
    }

    await jsonDb.writeDb(db)
  }
}

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false }))
  const allowedOrigins = CORS_ORIGINS
  app.use(cors({
    origin: (origin, callback) => {
      const allowLocalNetwork = !IS_PRODUCTION && /^https?:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin || '')
      if (!origin || allowedOrigins.includes(origin) || allowLocalNetwork) {
        return callback(null, true)
      }
      return callback(new Error('Origin not allowed'))
    },
  }))
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
  }))
  app.use(['/api/staff/residents', '/api/staff/demographics', '/api/staff/registry-source-reviews'], (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store')
    res.set('Vary', 'Authorization')
    next()
  })
  app.use('/api/staff/residents/import', express.json({ limit: '2mb' }))
  app.use(express.json({ limit: '100kb' }))
  app.use(express.urlencoded({ extended: true, limit: '100kb' }))

  const getCurrentActor = async (token) => {
    const payload = verifyToken(token)
    if (payload.purpose === 'mfa_pending') return null
    const user = await store.findUserById?.(payload.sub)
    if (!user || ['Suspended', 'Disabled'].includes(user.status)) return null
    return { payload, user }
  }

  const hasCurrentRole = async (token, roles) => {
    const actor = await getCurrentActor(token)
    return Boolean(actor && roles.includes(actor.user.role) && !['Suspended', 'Disabled'].includes(actor.user.status))
  }

  const writeAudit = async (actor, action, targetType, targetId, metadata = {}) => {
    await store.addAuditLog?.({
      id: randomUUID(),
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      action,
      targetType,
      targetId: targetId || null,
      metadata,
      createdAt: new Date().toISOString(),
    })
  }

  app.use('/api', async (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return next()

    let payload
    try {
      payload = verifyToken(token)
    } catch {
      return next()
    }
    if (payload.purpose === 'mfa_pending') return next()

    let user
    try {
      user = await store.findUserById?.(payload.sub)
    } catch (error) {
      console.error('admin read-only policy role lookup failed', error)
      return res.status(500).json({ message: 'Unable to verify account access.' })
    }
    if (!user || ['Suspended', 'Disabled'].includes(user.status) || user.role !== 'admin') return next()

    const path = (req.originalUrl || '').split('?')[0]
    const allowedMethods = new Map([
      ['/api/logout', ['POST']],
      ['/api/change-password', ['POST']],
      ['/api/mfa/setup', ['POST']],
      ['/api/mfa/enable', ['POST']],
      ['/api/mfa/disable', ['POST']],
      ['/api/admin/emergency-access', ['POST']],
      ['/api/admin/emergency-access/revoke', ['POST']],
      ['/api/staff/residents', ['POST']],
      ['/api/staff/residents/import', ['POST']],
      ['/api/staff/residents/print-audit', ['POST']],
      ['/api/staff/archive-requests', ['POST']],
      ['/api/staff/archive-file', ['DELETE']],
    ])
    const scopedStaffOperation = (
      (req.method === 'PATCH' && (
        /^\/api\/staff\/residents\/[^/]+\/(?:verify|status)$/.test(path)
        || /^\/api\/requests\/[^/]+\/status$/.test(path)
      ))
    )

    if (allowedMethods.get(path)?.includes(req.method) || scopedStaffOperation) return next()

    await writeAudit(
      { id: user.id, role: user.role },
      'admin.read_only.denied',
      'permission',
      req.route?.path || path,
      { method: req.method },
    )
    return res.status(403).json({ message: 'Administrator access is read-only. Use an approved emergency staff scope for staff operations.' })
  })

  const authorizeCurrentActor = async (req, res, roles, emergencyScope = null) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
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
      res.status(403).json({ message: 'Complete multi-factor authentication first.' })
      return null
    }

    let user
    try {
      user = await store.findUserById?.(payload.sub)
    } catch (error) {
      console.error('authenticated API role lookup failed', error)
      res.status(500).json({ message: 'Unable to verify account access.' })
      return null
    }
    if (!user || ['Suspended', 'Disabled'].includes(user.status) || !roles.includes(user.role)) {
      res.status(403).json({ message: 'Access denied for this role.' })
      return null
    }

    if (emergencyScope && user.role === 'admin') {
      let grant
      try {
        grant = await store.getActiveEmergencyAccessGrant?.()
      } catch (error) {
        console.error('emergency access lookup failed', error)
        res.status(500).json({ message: 'Unable to verify emergency access.' })
        return null
      }
      if (!grant || grant.adminId !== user.id || !grant.scopes.includes(emergencyScope)) {
        try {
          await writeAudit(user, 'emergency_access.denied', 'permission', emergencyScope, { scope: emergencyScope })
        } catch (error) {
          console.error('emergency access denial audit failed', error)
          res.status(500).json({ message: 'Unable to record the emergency access denial.' })
          return null
        }
        res.status(403).json({ message: 'Activate the required emergency access scope before using this staff operation.' })
        return null
      }
      try {
        await writeAudit(user, 'emergency_access.used', 'permission', emergencyScope, { scope: emergencyScope, grantId: grant.id })
      } catch (error) {
        console.error('emergency access use audit failed', error)
        res.status(500).json({ message: 'Unable to record emergency access use.' })
        return null
      }
    }

    return user
  }
  registerResidentRegistryRoutes(app, { store, sourceReviewsOnly: true })

  const authAttempts = new Map()
  const resetTokens = new Map()
  const mfaChallenges = new Map()

  const ensureSeededAccounts = async () => {
    if (usePostgres) return
    if (!SHOULD_SKIP_SEED) await seedDemoResident()
  }

  const sendDeliveryWebhook = async ({ event, recipient, token, expiresAt, user, title, message, metadata = {} }) => {
    const deliveryUrl = process.env.RESET_DELIVERY_URL || process.env.NOTIFICATION_WEBHOOK_URL
    if (!deliveryUrl) {
      return { queued: false, deliveryStatus: 'disabled', event }
    }

    const payload = {
      event,
      recipient,
      token,
      expiresAt,
      userId: user?.id || null,
      email: user?.email || null,
      mobile: user?.mobile || null,
      title,
      message,
      metadata,
      sentAt: new Date().toISOString(),
    }

    const response = await fetch(deliveryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Delivery webhook failed with status ${response.status}`)
    }

    return { queued: true, deliveryStatus: 'queued', event, responseStatus: response.status }
  }

  const authRateLimit = (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const windowStart = now - 60_000
    const recent = (authAttempts.get(key) || []).filter((timestamp) => timestamp > windowStart)
    if (recent.length >= 12) {
      return res.status(429).json({ message: 'Too many authentication attempts. Please try again later.' })
    }
    recent.push(now)
    authAttempts.set(key, recent)
    if (authAttempts.size > 10000) {
      for (const [attemptKey, timestamps] of authAttempts) {
        if (timestamps.every((timestamp) => timestamp <= windowStart)) authAttempts.delete(attemptKey)
      }
    }
    return next()
  }

  const clientErrorRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  })

  app.post('/api/client-errors', clientErrorRateLimit, (req, res) => {
    const allowedTypes = new Set(['render', 'window-error', 'unhandled-rejection'])
    const allowedRoutes = new Set(['/', '/register', '/dashboard', '/requests', '/staff', '/admin', '/settings', '/events', '/payments'])
    const type = req.body?.type
    if (!allowedTypes.has(type)) {
      return res.status(400).json({ message: 'Unsupported client error type.' })
    }

    const requestedRoute = typeof req.body?.route === 'string' ? req.body.route.split(/[?#]/, 1)[0] : '/'
    const routeSegment = requestedRoute.split('/').filter(Boolean)[0]
    const route = routeSegment ? `/${routeSegment}` : '/'
    const normalizedRoute = allowedRoutes.has(route) ? route : '/other'
    const role = ['resident', 'staff', 'admin'].includes(req.body?.role) ? req.body.role : 'unknown'
    const language = ['en', 'fil'].includes(req.body?.language) ? req.body.language : 'unknown'

    console.warn('client-side error reported', { type, route: normalizedRoute, role, language })
    return res.status(202).json({ received: true })
  })

  app.get('/api/health', async (_req, res) => {
    try {
      if (store === pgDb) {
        await pgDb.query('SELECT 1')
      }
      res.json({
        ok: true,
        message: 'Barangay Legaspi API is running',
        storage: store === pgDb ? 'postgres' : 'json-fallback',
      })
    } catch (error) {
      console.error('health check failed', error)
      res.status(503).json({ ok: false, message: 'Database unavailable.' })
    }
  })

  app.get('/api/captain-photo', async (_req, res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Cache-Control', 'no-store')
    try {
      const photoUrl = await getCaptainPhotoUrl()
      if (!photoUrl) return res.status(404).end()
      return res.redirect(302, photoUrl)
    } catch (error) {
      console.error('load captain photo failed', error)
      return res.status(502).json({ message: 'Unable to load the captain photo.' })
    }
  })

  app.post('/api/admin/captain-photo/upload-url', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })
      if (!CAPTAIN_PHOTO_CONTENT_TYPES.includes(req.body?.contentType)) {
        return res.status(400).json({ message: 'Choose a JPEG, PNG, or WebP image.' })
      }
      if (!isCaptainPhotoStorageConfigured()) return res.status(503).json({ message: 'Image storage is not configured.' })
      const upload = await createCaptainPhotoUpload(req.body.contentType)
      return res.json(upload)
    } catch (error) {
      console.error('create captain photo upload failed', error)
      return res.status(502).json({ message: 'Unable to prepare the image upload.' })
    }
  })

  app.post('/api/admin/captain-photo', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Admin access required.' })
      }
      if (!isCaptainPhotoStorageConfigured()) return res.status(503).json({ message: 'Image storage is not configured.' })
      if (req.body?.key !== CAPTAIN_PHOTO_KEY) return res.status(400).json({ message: 'Invalid image upload.' })

      await finalizeCaptainPhotoUpload(req.body.key)
      await writeAudit(actor.user, 'captain-photo.updated', 'image', CAPTAIN_PHOTO_KEY)
      return res.json({ ok: true })
    } catch (error) {
      if (error.message?.startsWith('Invalid captain photo upload')
        || error.message?.startsWith('Upload must be')
        || error.message?.startsWith('Uploaded file is not')) {
        return res.status(400).json({ message: error.message })
      }
      console.error('verify captain photo upload failed', error)
      return res.status(502).json({ message: 'Unable to verify the uploaded image.' })
    }
  })

  app.delete('/api/admin/captain-photo', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Admin access required.' })
      }
      if (!isCaptainPhotoStorageConfigured()) return res.status(503).json({ message: 'Image storage is not configured.' })
      await deleteCaptainPhoto(CAPTAIN_PHOTO_KEY)
      await writeAudit(actor.user, 'captain-photo.deleted', 'image', CAPTAIN_PHOTO_KEY)
      return res.json({ ok: true })
    } catch (error) {
      console.error('delete captain photo failed', error)
      return res.status(502).json({ message: 'Unable to remove the captain photo.' })
    }
  })

  app.post('/api/register', authRateLimit, async (req, res) => {
    try {
      const firstName = sanitizeText(req.body?.firstName)
      const lastName = sanitizeText(req.body?.lastName)
      const mobile = sanitizeText(req.body?.mobile)
      const email = sanitizeText(req.body?.email).toLowerCase()
      const password = sanitizeText(req.body?.password)
      const address = sanitizeText(req.body?.address || 'Barangay Legaspi, Tayug, Pangasinan')
      const zone = req.body?.zone === undefined ? 1 : Number(req.body.zone)
      const householdMembers = Array.isArray(req.body?.householdMembers)
        ? req.body.householdMembers.slice(0, 12).map((member) => ({
          name: sanitizeText(member?.name),
          relationship: ['Parent', 'Sibling', 'Relative', 'Spouse', 'Child', 'Other'].includes(member?.relationship) ? member.relationship : 'Other',
        })).filter((member) => member.name)
        : []

      if (!firstName || !lastName || !mobile || !email || !password) {
        return res.status(400).json({ message: 'Please complete all required fields.' })
      }

      if (!isValidMobile(mobile) || !isValidEmail(email) || !isValidPassword(password)) {
        return res.status(400).json({ message: `Please enter a valid mobile number, email, and password with ${passwordRequirements}.` })
      }

      if (!address || !Number.isInteger(zone) || zone < 1 || zone > 7) {
        return res.status(400).json({ message: 'Please provide a valid address and a zone from 1 to 7.' })
      }

      const existingUser = await store.findUserByIdentifier(mobile)
      if (existingUser) {
        return res.status(409).json({ message: 'A resident with this mobile number already exists.' })
      }

      const existingEmail = await store.findUserByIdentifier(email)
      if (existingEmail) {
        return res.status(409).json({ message: 'A resident with this email already exists.' })
      }

      const user = {
        id: randomUUID(),
        firstName,
        lastName,
        mobile,
        email,
        passwordHash: await hashPassword(password),
        role: 'resident',
        householdId: `2024-${String(Date.now()).slice(-4)}`,
        familyMembers: 4,
        status: 'Pending Verification',
        address,
        zone,
        householdMembers,
        createdAt: new Date().toISOString(),
      }

      await store.saveUser(user)
      await writeAudit(null, 'user.registered', 'user', user.id, { status: user.status })

      const delivery = await sendDeliveryWebhook({
        event: 'resident_registered',
        recipient: user.email,
        token: null,
        expiresAt: null,
        user,
        title: 'Account registered',
        message: 'Your account has been created and is waiting for barangay Staff review.',
        metadata: { status: user.status },
      }).catch((error) => {
        console.error('registration notification error', error)
        return { queued: false, deliveryStatus: 'failed', event: 'resident_registered' }
      })

      const { passwordHash, ...safeUser } = user

      return res.status(201).json({
        message: 'Account created and is awaiting barangay Staff review.',
        requiresApproval: true,
        user: safeUser,
        deliveryStatus: delivery.deliveryStatus || 'disabled',
      })
    } catch (error) {
      console.error('Register error:', error)
      return res.status(500).json({ message: 'Registration failed.' })
    }
  })

  app.post('/api/login', authRateLimit, async (req, res) => {
    try {
      const identifier = sanitizeText(req.body?.identifier)
      const password = sanitizeText(req.body?.password)

      if (!identifier || !password) {
        return res.status(400).json({ message: 'Identifier and password are required.' })
      }

      if (identifier.toLowerCase() === ADMIN_SEED.email.toLowerCase() || identifier.toLowerCase() === ADMIN_SEED.mobile.toLowerCase()) {
        await ensureSeededAccounts()
      }

      const user = await store.findUserByIdentifier(identifier)
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials.' })
      }

      const isValid = await comparePassword(password, user.passwordHash || user.password_hash)
      if (!isValid) {
        return res.status(401).json({ message: 'Invalid credentials.' })
      }

      const normalizedRole = String(user.role || '').toLowerCase() || 'resident'
      const normalizedStatus = String(user.status || '').trim()
      if (['Suspended', 'Disabled'].includes(normalizedStatus)) {
        await writeAudit({ role: 'anonymous' }, 'auth.login.rejected_inactive_account', 'user', user.id, {
          status: normalizedStatus,
        })
        return res.status(403).json({ message: 'Your account is disabled. Please contact the barangay office for assistance.' })
      }
      const isApprovedUser = ['admin', 'staff'].includes(normalizedRole) || ['Administrator', 'On Duty', 'Active Resident'].includes(normalizedStatus)

      if (normalizedRole === 'resident' && !isApprovedUser) {
        if (normalizedStatus.toLowerCase() === 'pending verification') {
          await writeAudit({ role: 'anonymous' }, 'auth.login.rejected_unapproved_resident', 'user', user.id, {
            status: normalizedStatus,
            residentName: `${user.firstName || user.first_name || ''} ${user.lastName || user.last_name || ''}`.trim(),
          })
          return res.status(403).json({
            code: 'resident_not_approved',
            message: 'Your account is awaiting barangay Staff review before you can access the web app.',
          })
        }
        return res.status(403).json({ message: 'Your account is not active. Please contact the barangay office for assistance.' })
      }

      const safeUser = sanitizeUserRecord({ ...user, role: normalizedRole })

      if (safeUser.mfaEnabled && user.mfaSecret) {
        if (mfaChallenges.size > 10000) {
          for (const [key, challenge] of mfaChallenges) {
            if (challenge.expiresAt <= Date.now()) mfaChallenges.delete(key)
          }
        }
        const challengeToken = randomBytes(32).toString('hex')
        mfaChallenges.set(createHash('sha256').update(challengeToken).digest('hex'), {
          userId: user.id,
          expiresAt: Date.now() + 5 * 60 * 1000,
        })
        return res.json({ message: 'Authenticator verification required.', requiresMfa: true, challengeToken })
      }

      const token = signToken({ sub: user.id, role: normalizedRole })

      return res.json({
        message: 'Login successful',
        token,
        user: safeUser,
      })
    } catch (error) {
      console.error('Login error:', error)
      return res.status(500).json({ message: 'Login failed.' })
    }
  })

  app.post('/api/login/mfa', authRateLimit, async (req, res) => {
    try {
      const challengeToken = String(req.body?.challengeToken || '')
      const code = String(req.body?.code || '').trim()
      if (!challengeToken || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ message: 'A valid 6-digit authenticator code is required.' })
      }

      const challengeKey = createHash('sha256').update(challengeToken).digest('hex')
      const challenge = mfaChallenges.get(challengeKey)
      if (!challenge || challenge.expiresAt <= Date.now()) {
        mfaChallenges.delete(challengeKey)
        return res.status(401).json({ message: 'MFA challenge is invalid or expired. Please sign in again.' })
      }

      const user = await store.findUserById?.(challenge.userId)
      if (!user || !user.mfaEnabled || !user.mfaSecret || ['Suspended', 'Disabled'].includes(user.status)) {
        return res.status(401).json({ message: 'MFA challenge is no longer valid.' })
      }

      const secret = decryptTotpSecret(user.mfaSecret)
      const matchedStep = verifyTotp(secret, code)
      const lastStep = Number(user.mfaLastStep || user.mfa_last_step || 0)
      if (matchedStep === null || matchedStep <= lastStep) {
        return res.status(401).json({ message: 'The authenticator code is invalid or has already been used.' })
      }

      mfaChallenges.delete(challengeKey)
      await store.updateUser?.(user.id, { mfaLastStep: matchedStep })
      const role = String(user.role || 'resident').toLowerCase()
      const token = signToken({ sub: user.id, role })
      return res.json({ message: 'Login successful.', token, user: sanitizeUserRecord({ ...user, role }) })
    } catch (error) {
      console.error('MFA login error:', error)
      return res.status(500).json({ message: 'Unable to verify authenticator code.' })
    }
  })

  app.post('/api/mfa/setup', authRateLimit, async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor) return res.status(401).json({ message: 'Authentication required.' })
      if (actor.user.mfaEnabled) return res.status(409).json({ message: 'Disable MFA before replacing its authenticator.' })

      if (!req.body?.rotate && (actor.user.mfaSecret || actor.user.mfa_secret)) {
        try {
          const secret = decryptTotpSecret(actor.user.mfaSecret || actor.user.mfa_secret)
          return res.json({ secret, otpauthUri: createTotpUri(secret, actor.user.email || actor.user.mobile) })
        } catch {
          // Replace invalid pending setup data so the account can enroll again.
        }
      }

      const secret = createTotpSecret()
      await store.updateUser?.(actor.user.id, {
        mfaSecret: encryptTotpSecret(secret),
        mfaEnabled: false,
        mfaLastStep: 0,
      })
      return res.json({ secret, otpauthUri: createTotpUri(secret, actor.user.email || actor.user.mobile) })
    } catch (error) {
      console.error('MFA setup error:', error)
      return res.status(500).json({ message: 'Unable to start authenticator setup.' })
    }
  })

  app.post('/api/mfa/enable', authRateLimit, async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor) return res.status(401).json({ message: 'Authentication required.' })
      const encryptedSecret = actor.user.mfaSecret || actor.user.mfa_secret
      if (!encryptedSecret || actor.user.mfaEnabled) return res.status(409).json({ message: 'Start authenticator setup before enabling MFA.' })

      const matchedStep = verifyTotp(decryptTotpSecret(encryptedSecret), req.body?.code)
      if (matchedStep === null) return res.status(400).json({ message: 'Authenticator code is invalid. Check your device time and try again.' })

      const updatedUser = await store.updateUser?.(actor.user.id, { mfaEnabled: true, mfaLastStep: matchedStep })
      await writeAudit(actor.user, 'mfa.enabled', 'user', actor.user.id)
      return res.json({ message: 'Authenticator MFA is enabled.', user: sanitizeUserRecord(updatedUser || { ...actor.user, mfaEnabled: true }) })
    } catch (error) {
      console.error('MFA enable error:', error)
      return res.status(500).json({ message: 'Unable to enable authenticator MFA.' })
    }
  })

  app.post('/api/mfa/disable', authRateLimit, async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor) return res.status(401).json({ message: 'Authentication required.' })
      if (!actor.user.mfaEnabled || !actor.user.mfaSecret) return res.status(409).json({ message: 'Authenticator MFA is not enabled.' })

      const currentPassword = String(req.body?.currentPassword || '')
      if (!await comparePassword(currentPassword, actor.user.passwordHash || actor.user.password_hash)) {
        return res.status(401).json({ message: 'Current password is incorrect.' })
      }

      const matchedStep = verifyTotp(decryptTotpSecret(actor.user.mfaSecret || actor.user.mfa_secret), req.body?.code)
      const lastStep = Number(actor.user.mfaLastStep || actor.user.mfa_last_step || 0)
      if (matchedStep === null || matchedStep <= lastStep) {
        return res.status(401).json({ message: 'Authenticator code is invalid or has already been used.' })
      }

      await store.updateUser?.(actor.user.id, { mfaEnabled: false, mfaSecret: '', mfaLastStep: 0 })
      await writeAudit(actor.user, 'mfa.disabled', 'user', actor.user.id)
      return res.json({ message: 'Authenticator MFA is disabled.' })
    } catch (error) {
      console.error('MFA disable error:', error)
      return res.status(500).json({ message: 'Unable to disable authenticator MFA.' })
    }
  })

  app.post('/api/reset-password/request', authRateLimit, async (req, res) => {
    const identifier = sanitizeText(req.body?.identifier || '')
    if (!identifier) return res.status(400).json({ message: 'Account identifier is required.' })

    try {
      const user = await store.findUserByIdentifier(identifier)
      const genericMessage = 'If the account exists, reset instructions have been sent.'
      if (!user) return res.json({ message: genericMessage })

      const token = randomBytes(32).toString('hex')
      const expiresAt = Date.now() + 15 * 60 * 1000
      resetTokens.set(createHash('sha256').update(token).digest('hex'), { userId: user.id, expiresAt })

      const webhookResult = await sendDeliveryWebhook({
        event: 'password_reset',
        recipient: user.email,
        token,
        expiresAt,
        user,
        title: 'Password reset requested',
        message: 'Use the reset code below to continue resetting your password.',
        metadata: { expiresInMinutes: 15 },
      }).catch((error) => {
        console.error('delivery webhook error', error)
        return { queued: false, deliveryStatus: 'failed', event: 'password_reset' }
      })

      if (webhookResult.queued) {
        return res.json({ message: genericMessage, deliveryStatus: webhookResult.deliveryStatus })
      }

      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ message: 'Password reset delivery is not configured. Please contact the barangay office.' })
      }

      return res.json({
        message: 'Development reset token generated.',
        resetToken: token,
        deliveryStatus: webhookResult.deliveryStatus,
      })
    } catch (error) {
      console.error('reset request error', error)
      return res.status(500).json({ message: 'Unable to start password reset.' })
    }
  })

  app.post('/api/reset-password', authRateLimit, async (req, res) => {
    const token = sanitizeText(req.body?.token || '')
    const newPassword = String(req.body?.newPassword || '').trim()
    if (!token || !isValidPassword(newPassword)) {
      return res.status(400).json({ message: `A valid reset token and password with ${passwordRequirements} are required.` })
    }

    try {
      const tokenHash = createHash('sha256').update(token).digest('hex')
      const reset = resetTokens.get(tokenHash)
      if (!reset || reset.expiresAt < Date.now()) {
        resetTokens.delete(tokenHash)
        return res.status(400).json({ message: 'This reset token is invalid or expired.' })
      }

      const updatedUser = await store.updateUser?.(reset.userId, { passwordHash: await hashPassword(newPassword) })
      resetTokens.delete(tokenHash)
      if (!updatedUser) return res.status(404).json({ message: 'User not found.' })

      await writeAudit(null, 'password.reset', 'user', reset.userId)
      return res.json({ message: 'Password reset successful. You can now log in.' })
    } catch (error) {
      console.error('reset password error', error)
      return res.status(500).json({ message: 'Unable to reset password.' })
    }
  })

  app.post('/api/change-password', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      const user = await store.findUserById(payload.sub)
      const currentPassword = String(req.body?.currentPassword || '')
      const newPassword = String(req.body?.newPassword || '').trim()

      if (!user || ['Suspended', 'Disabled'].includes(user.status)) {
        return res.status(403).json({ message: 'Account access is disabled.' })
      }
      if (!currentPassword || !isValidPassword(newPassword)) {
        return res.status(400).json({ message: `A current password and new password with ${passwordRequirements} are required.` })
      }
      if (currentPassword === newPassword) {
        return res.status(400).json({ message: 'The new password must be different from the current password.' })
      }
      if (!await comparePassword(currentPassword, user.passwordHash || user.password_hash)) {
        return res.status(401).json({ message: 'Current password is incorrect.' })
      }

      await store.updateUser?.(user.id, { passwordHash: await hashPassword(newPassword) })
      await writeAudit(user, 'password.changed', 'user', user.id)
      return res.json({ message: 'Password changed successfully.' })
    } catch (error) {
      console.error('change password error', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/profile', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      const user = await store.findUserById(payload.sub)

      if (!user) {
        return res.status(401).json({ message: 'User not found.' })
      }

      return res.json({ user: sanitizeUserRecord(user) })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.patch('/api/profile', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      const existingUser = await store.findUserById(payload.sub)
      if (!existingUser) {
        return res.status(404).json({ message: 'User not found.' })
      }

      const firstName = sanitizeText(req.body?.firstName || existingUser.firstName || existingUser.first_name || '')
      const lastName = sanitizeText(req.body?.lastName || existingUser.lastName || existingUser.last_name || '')
      const email = sanitizeText(req.body?.email || existingUser.email || '').toLowerCase()
      const mobile = sanitizeText(req.body?.mobile || existingUser.mobile || '')
      const address = sanitizeText(req.body?.address || existingUser.address || '')
      const householdId = sanitizeText(req.body?.householdId || existingUser.householdId || existingUser.household_id || '') || null
      const familyMembers = req.body?.familyMembers === undefined
        ? (existingUser.familyMembers ?? existingUser.family_members ?? 4)
        : Number(req.body.familyMembers)

      if (!firstName || !lastName) {
        return res.status(400).json({ message: 'First name and last name are required.' })
      }
      if (email && !isValidEmail(email)) {
        return res.status(400).json({ message: 'Please enter a valid email.' })
      }
      if (mobile && !isValidMobile(mobile)) {
        return res.status(400).json({ message: 'Please enter a valid mobile number.' })
      }

      const duplicateEmail = email && await store.findUserByIdentifier(email)
      if (duplicateEmail && duplicateEmail.id !== existingUser.id) {
        return res.status(409).json({ message: 'A user with this email already exists.' })
      }

      const duplicateMobile = mobile && await store.findUserByIdentifier(mobile)
      if (duplicateMobile && duplicateMobile.id !== existingUser.id) {
        return res.status(409).json({ message: 'A user with this mobile number already exists.' })
      }

      const updatedUser = await store.updateUser?.(existingUser.id, {
        firstName,
        lastName,
        email,
        mobile,
        address,
        householdId,
        familyMembers,
      })

      return res.json({ user: sanitizeUserRecord(updatedUser) })
    } catch (error) {
      console.error('profile update error', error)
      return res.status(500).json({ message: 'Unable to update profile.' })
    }
  })

  app.get('/api/dashboard', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor) return res.status(403).json({ message: 'Account access is disabled or authentication is incomplete.' })
      const { user } = actor

      const requests = user.role === 'resident'
        ? await store.listRequestsForUser(user.id)
        : await store.listAllRequests?.() || []
      const storedAnnouncements = await store.listAnnouncements?.() || []

      return res.json({
        services: serviceCatalog,
        announcements: storedAnnouncements,
        events: [],
        payments: [],
        summary: {
          totalRequests: requests.length,
          pending: requests.filter((item) => ['Pending', 'In Review', 'Needs Information'].includes(item.status)).length,
          activeCases: requests.filter((item) => ['Pending', 'In Review', 'Needs Information'].includes(item.status)).length,
          nextEvent: null,
        },
        user: sanitizeUserRecord(user),
      })
    } catch (error) {
      console.error('dashboard load error', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/services', (_req, res) => {
    return res.json({ services: serviceCatalog })
  })

  app.get('/api/announcements', async (_req, res) => {
    try {
      const storedAnnouncements = await store.listAnnouncements?.() || []
      return res.json({ announcements: storedAnnouncements })
    } catch (error) {
      console.error('failed to load announcements', error)
      return res.status(503).json({ message: 'Unable to load announcements.' })
    }
  })

  app.post('/api/announcements', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      if (!(await hasCurrentRole(token, ['admin']))) {
        return res.status(403).json({ message: 'Administrator access required.' })
      }

      const title = sanitizeText(req.body?.title)
      const content = sanitizeText(req.body?.content)
      const date = sanitizeText(req.body?.date) || new Date().toLocaleDateString()
      const tag = sanitizeText(req.body?.tag) || 'green'
      const socialChannels = Array.isArray(req.body?.socialChannels)
        ? req.body.socialChannels.map((channel) => sanitizeText(channel)).filter(Boolean)
        : []

      if (!title || !content) {
        return res.status(400).json({ message: 'Title and message are required.' })
      }

      const announcement = {
        id: randomUUID(),
        tag,
        title,
        content,
        date,
        socialChannels,
        createdAt: new Date().toISOString(),
      }

      const savedAnnouncement = await store.saveAnnouncement?.(announcement)

      return res.status(201).json({ announcement: savedAnnouncement || announcement })
    } catch (error) {
      console.error('failed to create announcement', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.delete('/api/announcements/:id', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      if (!(await hasCurrentRole(token, ['admin']))) {
        return res.status(403).json({ message: 'Administrator access required.' })
      }

      const targetId = req.params.id
      const deletedAnnouncement = await store.deleteAnnouncement?.(targetId)
      if (!deletedAnnouncement) {
        return res.status(404).json({ message: 'Announcement not found.' })
      }

      return res.json({ success: true, removedId: targetId })
    } catch (error) {
      console.error('failed to delete announcement', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/events', (_req, res) => {
    return res.json({ events: [] })
  })

  app.get('/api/payments', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Account access is disabled.' })
      }

      return res.json({ payments: [] })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.patch('/api/payments/:id/status', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin') {
        return res.status(403).json({ message: 'Administrator access required.' })
      }

      const paymentId = String(req.params.id || '').trim()
      const nextStatus = String(req.body?.status || '').trim()

      if (!paymentId || !nextStatus) {
        return res.status(400).json({ message: 'Payment ID and status are required.' })
      }

      return res.status(404).json({ message: 'Payment record not found.' })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/requests', async (req, res) => {
    try {
      const actor = await authorizeCurrentActor(req, res, ['resident', 'staff', 'admin'], 'request-processing')
      if (!actor) return
      const requests = actor.role === 'resident'
        ? await store.listRequestsForUser(actor.id)
        : await store.listAllRequests?.() || await store.listRequestsForUser(actor.id)
      return res.json({ requests })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/staff/requests', async (req, res) => {
    try {
      const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'request-processing')
      if (!actor) return
      const requests = await store.listAllRequests?.() || []
      return res.json({ requests })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/staff/dashboard-requests', async (req, res) => {
    try {
      const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'request-processing')
      if (!actor) return
    } catch (error) {
      console.error('staff dashboard authorization lookup error', error)
      return res.status(500).json({ message: 'Unable to verify staff access.' })
    }

    const { search = '', status = 'active', type = '', zone = '', from = '', to = '', sort = 'date', direction = 'desc' } = req.query
    const page = Number(req.query.page || 1)
    const pageSize = Number(req.query.pageSize || 10)
    const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

    if (String(search).length > 120 || String(type).length > 100) {
      return res.status(400).json({ message: 'Search text or document type is too long.' })
    }
    if (zone && !['1', '2', '3', '4', '5', '6', '7'].includes(String(zone))) {
      return res.status(400).json({ message: 'Invalid request zone filter.' })
    }
    if (!['active', 'all', 'Pending', 'In Review', 'Needs Information', 'Approved', 'Rejected'].includes(String(status))) {
      return res.status(400).json({ message: 'Invalid request status filter.' })
    }
    if (sort !== 'date' && sort !== 'status') {
      return res.status(400).json({ message: 'Invalid request sort field.' })
    }
    if (direction !== 'asc' && direction !== 'desc') {
      return res.status(400).json({ message: 'Invalid sort direction.' })
    }
    if ((from && !validDate(String(from))) || (to && !validDate(String(to))) || (from && to && from > to)) {
      return res.status(400).json({ message: 'Invalid request date range.' })
    }
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      return res.status(400).json({ message: 'Invalid pagination values.' })
    }

    let result
    try {
      result = await store.listStaffRequestDashboard({
        search: String(search).trim(),
        status: status === 'all' ? '' : String(status),
        type: String(type),
        zone: String(zone),
        from: String(from),
        to: String(to),
        sort,
        direction,
        page,
        pageSize,
      })
    } catch (error) {
      console.error('staff dashboard requests error', error)
      return res.status(500).json({ message: 'Unable to load staff request dashboard.' })
    }
    return res.json(result)
  })

  const getStaffReportFilters = (req, res) => {
    const from = String(req.query.from || '')
    const to = String(req.query.to || '')
    const type = String(req.query.type || '')
    const status = String(req.query.status || '')
    const allowedStatuses = ['Pending', 'In Review', 'Needs Information', 'Approved', 'Rejected']

    if ((from && !isValidReportDate(from)) || (to && !isValidReportDate(to)) || (from && to && from > to)) {
      res.status(400).json({ message: 'Invalid report date range.' })
      return null
    }
    if (type.length > 100 || (status && !allowedStatuses.includes(status))) {
      res.status(400).json({ message: 'Invalid report filter.' })
      return null
    }
    return { from, to, type, status }
  }

  const withStaffReportAccess = async (req, res, callback) => {
    const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'request-processing')
    if (!actor) return

    const filters = getStaffReportFilters(req, res)
    if (filters) await callback(filters)
  }

  app.get('/api/staff/reports', async (req, res) => {
    await withStaffReportAccess(req, res, async (filters) => {
      try {
        const requests = await store.listRequestsForStaffReports?.()
        if (!Array.isArray(requests)) throw new Error('Request storage is unavailable.')
        return res.json(getStaffRequestReport(requests, filters))
      } catch (error) {
        console.error('staff reports query failed', error)
        return res.status(500).json({ message: 'Unable to load service reports.' })
      }
    })
  })

  app.get('/api/staff/reports/export.csv', async (req, res) => {
    await withStaffReportAccess(req, res, async (filters) => {
      try {
        const requests = await store.listRequestsForStaffReports?.()
        if (!Array.isArray(requests)) throw new Error('Request storage is unavailable.')
        const csv = createRequestReportCsv(filterStaffReportRequests(requests, filters))
        const range = filters.from && filters.to
          ? `${filters.from}-to-${filters.to}`
          : filters.from || filters.to || 'all-time'
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="service-requests-${range}.csv"`)
        return res.send(`\uFEFF${csv}`)
      } catch (error) {
        console.error('staff reports CSV export failed', error)
        return res.status(500).json({ message: 'Unable to export service reports.' })
      }
    })
  })

  app.get('/api/staff/residents', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'resident-registry.read')
    if (!actor) return

    const search = String(req.query.search || '').trim()
    const birthDate = String(req.query.birthDate || '').trim()
    const ageRaw = req.query.age
    const age = ageRaw === undefined || ageRaw === '' ? null : Number(ageRaw)
    const zoneRaw = req.query.zone
    const zone = zoneRaw === undefined || zoneRaw === '' ? null : Number(zoneRaw)
    const purok = String(req.query.purok || '').trim()
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 25))
    const today = getManilaDateKey()

    if (search.length > 120 || purok.length > 100) return res.status(400).json({ message: 'Search filters are too long.' })
    if (birthDate && (!isValidDateKey(birthDate) || birthDate > today)) return res.status(400).json({ message: 'Enter a valid birthdate that is not in the future.' })
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130)) return res.status(400).json({ message: 'Age must be a whole number from 0 to 130.' })
    if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })

    let ageStart = null
    let ageEnd = null
    if (age !== null) {
      ageStart = shiftDateKeyByDays(shiftDateKeyByYears(today, -(age + 1)), 1)
      ageEnd = shiftDateKeyByYears(today, -age)
    }
    try {
      if (typeof store.listResidentRegistry !== 'function') throw new Error('Resident registry storage is unavailable.')
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
      await writeAudit(actor.user, 'resident_registry.read', 'resident_registry', null, {
        resultCount: result.total,
        page,
        pageSize,
        filters: {
          zone,
          hasPurokFilter: purok !== '',
          hasSearch: search !== '',
          hasBirthDate: birthDate !== '',
          hasAge: age !== null,
        },
      })
      return res.json({
        residents,
        total: result.total,
        page,
        pageSize,
        filters: { search, birthDate, age, zone, purok },
      })
    } catch (error) {
      console.error('staff resident registry query failed', error)
      return res.status(500).json({ message: 'Unable to load the resident registry.' })
    }
  })

  app.get('/api/staff/demographics', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'resident-registry.read')
    if (!actor) return
    const zoneRaw = req.query.zone
    const zone = zoneRaw === undefined || zoneRaw === '' ? null : Number(zoneRaw)
    const purok = String(req.query.purok || '').trim()
    if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })
    if (purok.length > 100) return res.status(400).json({ message: 'Purok filter is too long.' })
    try {
      if (typeof store.getResidentDemographics !== 'function') throw new Error('Resident demographic storage is unavailable.')
      const summary = await store.getResidentDemographics({ zone, purok })
      await writeAudit(actor.user, 'resident_registry.demographics_read', 'resident_registry', null, {
        resultCount: summary.overall?.total || 0,
        filters: { zone, hasPurokFilter: purok !== '' },
      })
      return res.json(summary)
    } catch (error) {
      console.error('staff resident demographics query failed', error)
      return res.status(500).json({ message: 'Unable to load demographic totals.' })
    }
  })

  app.get('/api/admin/demographics', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['admin'])
    if (!actor) return
    const zoneRaw = req.query.zone
    const zone = zoneRaw === undefined || zoneRaw === '' ? null : Number(zoneRaw)
    const purok = String(req.query.purok || '').trim()
    if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) return res.status(400).json({ message: 'Choose a valid zone from 1 to 7.' })
    if (purok.length > 100) return res.status(400).json({ message: 'Purok filter is too long.' })
    try {
      if (typeof store.getResidentDemographics !== 'function') throw new Error('Resident demographic storage is unavailable.')
      const summary = await store.getResidentDemographics({ zone, purok }, false)
      await writeAudit(actor.user, 'resident_registry.demographics_read', 'resident_registry', null, {
        resultCount: summary.overall?.total || 0,
        filters: { zone, hasPurokFilter: purok !== '' },
      })
      return res.json(summary)
    } catch (error) {
      console.error('admin resident demographic query failed', error)
      return res.status(500).json({ message: 'Unable to load demographic totals.' })
    }
  })

  app.post('/api/staff/residents', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'resident-registry.manage')
    if (!actor) return
    const firstName = sanitizeText(req.body?.firstName)
    const lastName = sanitizeText(req.body?.lastName)
    const birthDate = req.body?.birthDate || null
    const sex = req.body?.sex || null
    const householdId = sanitizeText(req.body?.householdId || '')
    const purok = sanitizeText(req.body?.purok || '')
    const address = sanitizeText(req.body?.address || '')
    const sourceReference = sanitizeText(req.body?.sourceReference || '')
    const sourceFilename = sanitizeText(req.body?.sourceFilename || '')
    const zoneValue = req.body?.zone
    const zone = zoneValue === null || zoneValue === undefined || zoneValue === '' ? null : Number(zoneValue)
    const today = getManilaDateKey()

    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      return res.status(400).json({ message: 'Enter the resident’s first and last names (up to 100 characters each).' })
    }
    if (birthDate && (typeof birthDate !== 'string' || !isValidDateKey(birthDate) || birthDate > today)) {
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
      const potentialMatches = await store.findPotentialRegistryMatches?.(firstName, lastName, birthDate)
      if (!Array.isArray(potentialMatches)) throw new Error('Duplicate-check storage is unavailable.')
      if (potentialMatches.length && req.body?.confirmPotentialMatch !== true) {
        return res.status(409).json({
          message: 'Review the possible matching records before confirming this registration.',
          potentialMatches,
          reviewRequired: true,
        })
      }

      const createdAt = new Date().toISOString()
      const resident = await store.insertRegistryResident?.({
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
      })
      if (!resident) throw new Error('Resident registry storage is unavailable.')
      await writeAudit(actor, 'resident_registry.created', 'resident_registry', resident.id, {
        verificationStatus: 'pending',
        hasSourceReference: Boolean(sourceReference),
      })
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
    const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'resident-registry.manage')
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

    const today = getManilaDateKey()
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
        return sanitizeText(value || '')
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
      if (birthDate && (!isValidDateKey(birthDate) || birthDate > today)) {
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
    if (validationErrors.length) {
      return res.status(400).json({ message: 'Correct the invalid rows before importing.', validationErrors })
    }

    try {
      if (typeof store.findPotentialRegistryMatches !== 'function' || typeof store.insertRegistryResidents !== 'function') {
        throw new Error('Bulk resident registry storage is unavailable.')
      }
      const potentialMatches = []
      const seenRows = new Map()
      for (const [index, resident] of normalized.entries()) {
        const identityKey = `${resident.firstName.toLowerCase()}\u0000${resident.lastName.toLowerCase()}\u0000${resident.birthDate || ''}`
        const earlierRow = seenRows.get(identityKey)
        if (earlierRow !== undefined) {
          potentialMatches.push({
            row: index + 2,
            records: [{ id: `upload-row-${earlierRow + 2}`, firstName: normalized[earlierRow].firstName, lastName: normalized[earlierRow].lastName, birthDate: normalized[earlierRow].birthDate, source: 'same import file' }],
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
      const auditEntry = {
        id: randomUUID(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'resident_registry.bulk_imported',
        targetType: 'resident_registry_batch',
        targetId: null,
        metadata: {
          count: records.length,
          hasSourceFilename: filename.trim() !== '',
          potentialMatchCount: potentialMatches.length,
        },
        createdAt,
      }
      await store.insertRegistryResidents(records, auditEntry)
      return res.status(201).json({ imported: records.length, verificationStatus: 'pending', potentialMatches })
    } catch (error) {
      console.error('staff resident registry import failed', error)
      return res.status(500).json({ message: 'Unable to import resident records.' })
    }
  })

  app.post('/api/staff/residents/print-audit', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'resident-registry.read')
    if (!actor) return
    const { count: recordCount, filters = {} } = req.body || {}
    if (!Number.isInteger(recordCount) || recordCount < 1 || recordCount > 100) {
      return res.status(400).json({ message: 'Print between 1 and 100 visible resident records.' })
    }
    const zone = filters.zone === '' || filters.zone === null || filters.zone === undefined ? null : Number(filters.zone)
    const purok = typeof filters.purok === 'string' ? filters.purok.trim() : ''
    const page = Number(filters.page)
    if ((zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 7))
      || purok.length > 100 || !Number.isInteger(page) || page < 1) {
      return res.status(400).json({ message: 'Print filter values are invalid.' })
    }
    try {
      await writeAudit(actor, 'resident_registry.print.blocked', 'resident_registry', null, {
        recordCount,
        filters: { zone, hasPurokFilter: purok !== '', page },
        dataFields: ['name', 'birthDate', 'age', 'sex', 'householdId', 'purok', 'zone', 'verificationStatus', 'recordStatus'],
      })
      return res.status(503).json({ message: 'Managed office printing is not configured. No print job was started.' })
    } catch (error) {
      console.error('resident registry print audit failed', error)
      return res.status(500).json({ message: 'Unable to record the print audit. Printing was not started.' })
    }
  })

  app.patch('/api/staff/residents/:id/verify', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'resident-registry.manage')
    if (!actor) return
    const verificationStatus = req.body?.verificationStatus
    if (!['verified', 'needs_review'].includes(verificationStatus)) return res.status(400).json({ message: 'Choose verified or needs_review.' })
    try {
      const verifiedAt = new Date().toISOString()
      const resident = await store.updateRegistryResident?.(req.params.id, {
        verificationStatus,
        verifiedBy: actor.id,
        verifiedAt,
      })
      if (!resident) return res.status(404).json({ message: 'Resident record not found.' })
      await writeAudit(actor, `resident_registry.${verificationStatus}`, 'resident_registry', resident.id)
      return res.json({ resident: { id: resident.id, firstName: resident.firstName, lastName: resident.lastName, verificationStatus, verifiedBy: actor.id, verifiedAt } })
    } catch (error) {
      console.error('resident verification update failed', error)
      return res.status(500).json({ message: 'Unable to update resident verification.' })
    }
  })

  app.patch('/api/staff/residents/:id/status', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'resident-registry.manage')
    if (!actor) return
    const status = req.body?.status
    if (!['active', 'inactive', 'deceased', 'archived'].includes(status)) return res.status(400).json({ message: 'Choose active, inactive, deceased, or archived.' })
    try {
      const resident = await store.updateRegistryResident?.(req.params.id, { status })
      if (!resident) return res.status(404).json({ message: 'Resident record not found.' })
      await writeAudit(actor, 'resident_registry.status_changed', 'resident_registry', resident.id, { status })
      return res.json({ resident: { id: resident.id, status } })
    } catch (error) {
      console.error('resident record status update failed', error)
      return res.status(500).json({ message: 'Unable to update resident record status.' })
    }
  })

  app.get('/api/admin/emergency-access', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['admin'])
    if (!actor) return
    try {
      const grant = await store.getActiveEmergencyAccessGrant?.()
      if (!grant) return res.json({ active: false, grant: null })
      return res.json({
        active: true,
        grant: {
          id: grant.id,
          isOwnGrant: grant.adminId === actor.id,
          reason: grant.reason,
          scopes: grant.scopes,
          activatedAt: grant.activatedAt,
          expiresAt: grant.expiresAt,
        },
      })
    } catch (error) {
      console.error('emergency access status query failed', error)
      return res.status(500).json({ message: 'Unable to load emergency access status.' })
    }
  })

  app.post('/api/admin/emergency-access', authRateLimit, async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['admin'])
    if (!actor) return
    const password = req.body?.currentPassword
    const reason = String(req.body?.reason || '').trim()
    if (typeof password !== 'string' || password.length > 200 || reason.length < 20 || reason.length > 500) {
      return res.status(400).json({ message: 'Enter your current password and an emergency reason of 20 to 500 characters.' })
    }
    try {
      if (!actor.passwordHash || !(await comparePassword(password, actor.passwordHash))) {
        return res.status(401).json({ message: 'Current password was not accepted.' })
      }
      let mfaStep = null
      const mfaEnabled = Boolean(actor.mfaEnabled ?? actor.mfa_enabled)
      if (mfaEnabled) {
        const code = String(req.body?.code || '').trim()
        if (!/^\d{6}$/.test(code) || !(actor.mfaSecret || actor.mfa_secret)) {
          return res.status(401).json({ message: 'Enter the current authenticator code to activate emergency access.' })
        }
        try {
          mfaStep = verifyTotp(decryptTotpSecret(actor.mfaSecret || actor.mfa_secret), code)
        } catch (error) {
          console.error('emergency access MFA verification is unavailable', error)
          return res.status(503).json({ message: 'Authenticator verification is unavailable. Contact the system operator.' })
        }
        if (mfaStep === null || mfaStep <= Number(actor.mfaLastStep ?? actor.mfa_last_step ?? 0)) {
          return res.status(401).json({ message: 'Authenticator code is invalid or has already been used.' })
        }
      }
      const now = new Date()
      const expiresAt = new Date(now.getTime() + 20 * 60 * 1000)
      const scopes = ['resident-registry.read', 'resident-registry.manage', 'request-processing']
      const grantInput = {
        id: randomUUID(),
        adminId: actor.id,
        reason,
        scopes,
        activeSlot: 'global',
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }
      const auditEntry = {
        id: randomUUID(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'emergency_access.activated',
        targetType: 'emergency_access_grant',
        targetId: grantInput.id,
        metadata: { reason, scopes, expiresAt: grantInput.expiresAt },
        createdAt: now.toISOString(),
      }
      const created = await store.createEmergencyAccessGrant?.(grantInput, mfaStep, auditEntry)
      if (!created) throw new Error('Emergency access storage is unavailable.')
      if (created.conflict) return res.status(409).json({ message: 'An emergency access grant is already active. Revoke it or wait for it to expire.' })
      if (created.replayedMfa) return res.status(409).json({ message: 'Authenticator code has already been used.' })
      return res.status(201).json({
        active: true,
        grant: {
          id: created.grant.id,
          isOwnGrant: true,
          reason,
          scopes,
          activatedAt: created.grant.activatedAt,
          expiresAt: created.grant.expiresAt,
        },
      })
    } catch (error) {
      console.error('emergency access activation failed', error)
      return res.status(500).json({ message: 'Unable to activate emergency access.' })
    }
  })

  app.post('/api/admin/emergency-access/revoke', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['admin'])
    if (!actor) return
    try {
      const grant = await store.getActiveEmergencyAccessGrant?.()
      if (!grant) return res.status(404).json({ message: 'There is no active emergency access grant to revoke.' })
      const revokedAt = new Date().toISOString()
      const auditEntry = {
        id: randomUUID(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'emergency_access.revoked',
        targetType: 'emergency_access_grant',
        targetId: grant.id,
        metadata: { activatedBy: grant.adminId, reason: grant.reason },
        createdAt: revokedAt,
      }
      const revoked = await store.revokeEmergencyAccessGrant?.(grant.id, actor.id, revokedAt, auditEntry)
      if (!revoked) return res.status(404).json({ message: 'There is no active emergency access grant to revoke.' })
      return res.json({ active: false, revoked: true })
    } catch (error) {
      console.error('emergency access revoke failed', error)
      return res.status(500).json({ message: 'Unable to revoke emergency access.' })
    }
  })

  app.get('/api/admin/users', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const users = filterVisibleUsers(await store.listAllUsers?.() || [])
      return res.json({ users: users.map((user) => sanitizeUserRecord(user)) })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/admin/audit-logs', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required.' })
      const logs = await store.listAuditLogs?.(req.query.limit) || []
      return res.json({ logs })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/admin/summary', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const [users, requests] = await Promise.all([
        await store.listAllUsers?.() || [],
        await store.listAllRequests?.() || [],
      ])
      const sanitizedUsers = users.map((user) => sanitizeUserRecord(user))

      return res.json({
        summary: {
          totalResidents: sanitizedUsers.filter((user) => user.role === 'resident').length,
          totalStaff: sanitizedUsers.filter((user) => user.role === 'staff').length,
          totalAdmins: sanitizedUsers.filter((user) => user.role === 'admin').length,
          totalRequests: requests.length,
          pendingRequests: requests.filter((item) => ['Pending', 'In Review', 'Needs Information'].includes(item.status)).length,
        },
      })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/staff/account-approvals', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['staff'])
    if (!actor) return

    try {
      const users = await store.listAllUsers?.() || []
      const approvals = users
        .filter((user) => user.role === 'resident' && user.status === 'Pending Verification')
        .map((user) => ({
          id: user.id,
          firstName: user.firstName || user.first_name || '',
          lastName: user.lastName || user.last_name || '',
          email: user.email || '',
          mobile: user.mobile || '',
          address: user.address || '',
          zone: user.zone ?? user.zoneNumber ?? null,
          createdAt: user.createdAt || user.created_at || null,
        }))
      return res.json({ approvals })
    } catch (error) {
      console.error('staff account approvals load failed', error)
      return res.status(500).json({ message: 'Unable to load pending resident accounts.' })
    }
  })

  app.patch('/api/staff/account-approvals/:id', async (req, res) => {
    const actor = await authorizeCurrentActor(req, res, ['staff'])
    if (!actor) return

    const status = req.body?.status
    if (!['Active Resident', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'Choose Active Resident or Rejected.' })
    }

    try {
      const existing = await store.findUserById?.(req.params.id)
      if (!existing || existing.role !== 'resident') {
        return res.status(404).json({ message: 'Pending resident account not found.' })
      }
      if (existing.status !== 'Pending Verification') {
        return res.status(409).json({ message: 'This resident account has already been reviewed.' })
      }

      const updated = await store.updateUser?.(req.params.id, { status })
      if (!updated) return res.status(404).json({ message: 'Pending resident account not found.' })
      await writeAudit(actor, status === 'Active Resident' ? 'resident_account.approved' : 'resident_account.rejected', 'resident_account', req.params.id, { status })
      return res.json({ user: { id: updated.id, status: updated.status } })
    } catch (error) {
      console.error('staff resident account decision failed', error)
      return res.status(500).json({ message: 'Unable to update the resident account review.' })
    }
  })

  app.get('/api/staff/members', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      const actor = await store.findUserById?.(payload.sub)
      if (!actor || !['staff', 'admin'].includes(actor.role) || ['Suspended', 'Disabled'].includes(actor.status)) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

      const users = await store.listAllUsers?.() || []
      const staffMembers = users.filter((user) => user.role === 'staff').map((user) => ({
        id: user.id,
        firstName: user.first_name || user.firstName,
        lastName: user.last_name || user.lastName,
        position: user.position || 'Staff',
        availability: user.availability || 'Available',
        email: user.email,
        mobile: user.mobile,
        status: user.status,
      }))

      return res.json({ staffMembers })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.post('/api/staff/members', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Administrator access required.' })
      }

      const firstName = sanitizeText(req.body?.firstName)
      const lastName = sanitizeText(req.body?.lastName)
      const position = sanitizeText(req.body?.position) || 'Staff'
      const availability = sanitizeText(req.body?.availability) || 'Available'
      const email = sanitizeText(req.body?.email).toLowerCase()
      const mobile = sanitizeText(req.body?.mobile)
      const password = String(req.body?.password || '').trim()

      if (!firstName || !lastName || !email || !mobile || !password) {
        return res.status(400).json({ message: 'Please complete all staff member fields.' })
      }

      if (!isValidEmail(email) || !isValidMobile(mobile) || !isValidPassword(password)) {
        return res.status(400).json({ message: `Please enter a valid email, mobile number, and password with ${passwordRequirements}.` })
      }

      const existingEmail = await store.findUserByIdentifier(email)
      const existingMobile = await store.findUserByIdentifier(mobile)
      if (existingEmail || existingMobile) {
        return res.status(409).json({ message: 'A staff member with this email or mobile already exists.' })
      }

      const staffMember = {
        id: randomUUID(),
        firstName,
        lastName,
        email,
        mobile,
        passwordHash: await hashPassword(password),
        role: 'staff',
        householdId: `2024-${String(Date.now()).slice(-4)}`,
        familyMembers: 1,
        status: sanitizeText(req.body?.status) || 'On Duty',
        address: 'Barangay Hall, Legaspi',
        zone: 0,
        position,
        availability,
        createdAt: new Date().toISOString(),
      }

      if (typeof store.createUser === 'function') {
        await store.createUser(staffMember)
      } else {
        const db = await store.readDb?.() || { users: [] }
        db.users = db.users || []
        db.users.push(staffMember)
        await store.writeDb?.(db)
      }

      const { passwordHash, ...safeMember } = staffMember
      await writeAudit(actor.user, 'staff.created', 'user', staffMember.id, { email: staffMember.email })
      return res.status(201).json({ staffMember: safeMember })
    } catch (error) {
      console.error('failed to create staff member', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.post('/api/admin/users', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const firstName = sanitizeText(req.body?.firstName)
      const lastName = sanitizeText(req.body?.lastName)
      const email = sanitizeText(req.body?.email).toLowerCase()
      const mobile = sanitizeText(req.body?.mobile)
      const password = String(req.body?.password || '').trim()
      if (!firstName || !lastName || !email || !mobile || !password) {
        return res.status(400).json({ message: 'First name, last name, email, mobile, and password are required.' })
      }
      if (!isValidEmail(email) || !isValidMobile(mobile) || !isValidPassword(password)) {
        return res.status(400).json({ message: `Please provide valid account details and a password with ${passwordRequirements}.` })
      }
      if (await store.findUserByIdentifier(email) || await store.findUserByIdentifier(mobile)) {
        return res.status(409).json({ message: 'A user with this email or mobile already exists.' })
      }

      const adminUser = {
        id: randomUUID(), firstName, lastName, email, mobile, passwordHash: await hashPassword(password),
        role: 'admin', householdId: `2024-${String(Date.now()).slice(-4)}`, familyMembers: 1,
        status: 'Administrator', address: 'Barangay Hall, Legaspi', zone: 0, createdAt: new Date().toISOString(),
      }
      await store.createUser?.(adminUser) || await store.saveUser(adminUser)
      const { passwordHash, ...safeUser } = adminUser
      await writeAudit(actor.user, 'admin.created', 'user', adminUser.id, { email })
      return res.status(201).json({ user: safeUser })
    } catch (error) {
      console.error('failed to create admin user', error)
      return res.status(500).json({ message: 'Unable to create administrator account.' })
    }
  })

  app.delete('/api/staff/members/:id', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Administrator access required.' })
      }

      if (req.params.id === actor.user.id) {
        return res.status(403).json({ message: 'You cannot delete your own account.' })
      }

      const targetUser = await store.findUserById?.(req.params.id)
      if (!targetUser) {
        return res.status(404).json({ message: 'Staff member not found.' })
      }

      if (targetUser.role !== 'staff') {
        return res.status(400).json({ message: 'Only staff members can be deleted from the staff directory.' })
      }

      const deletedUser = await store.deleteUser?.(req.params.id)
      if (!deletedUser) {
        return res.status(404).json({ message: 'Staff member not found.' })
      }

      await writeAudit(actor.user, 'staff.deleted', 'user', req.params.id)
      return res.json({ success: true, removedId: req.params.id })
    } catch (error) {
      console.error('failed to delete staff member', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.post('/api/staff/archive-requests', async (req, res) => {
    try {
      const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'request-processing')
      if (!actor) return

      const rawDays = req.body?.days
      const parsedDays = rawDays === undefined || rawDays === null || rawDays === '' ? 1 : Number(rawDays)
      const days = Number.isFinite(parsedDays) ? Math.max(0, parsedDays) : 1
      const result = await store.archiveProcessedRequestsOlderThan?.(days)
      return res.json({ archive: result || null })
    } catch (e) {
      console.error('archive-requests error', e)
      return res.status(500).json({ message: 'Failed to archive queue and approval records.' })
    }
  })

  app.get('/api/staff/archives', async (req, res) => {
    try {
      const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'request-processing')
      if (!actor) return
      const archives = await store.listArchives?.() || []
      const visibleArchives = actor.role === 'admin'
        ? archives
        : archives.filter((archive) => archive.name.startsWith('queue-approvals-'))
      return res.json({ archives: visibleArchives })
    } catch (e) {
      console.error('list staff archives error', e)
      return res.status(500).json({ message: 'Unable to load staff archives.' })
    }
  })

  app.get('/api/staff/archive-file', async (req, res) => {
    try {
      const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'request-processing')
      if (!actor) return

      const name = req.query.name
      if (!name || typeof name !== 'string' || name.includes('..') || !/^[\w\-.]+$/.test(name)) {
        return res.status(400).json({ message: 'Invalid file name.' })
      }
      if (actor.role !== 'admin' && !name.startsWith('queue-approvals-')) {
        return res.status(403).json({ message: 'This archive is not available to staff.' })
      }

      const archive = await store.getArchive?.(name)
      if (!archive) return res.status(404).json({ message: 'File not found.' })
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
      return res.send(JSON.stringify(archive, null, 2))
    } catch (e) {
      console.error('staff archive-file error', e)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.delete('/api/staff/archive-file', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) {
        return res.status(403).json({ message: 'Administrator access required.' })
      }

      const name = req.query.name
      if (!name || typeof name !== 'string' || name.includes('..') || !/^[\w\-.]+$/.test(name)) {
        return res.status(400).json({ message: 'Invalid file name.' })
      }

      const deleted = await store.deleteArchive?.(name)
      if (!deleted) return res.status(404).json({ message: 'File not found.' })
      return res.json({ ok: true, deleted: name })
    } catch (e) {
      console.error('delete staff archive error', e)
      return res.status(500).json({ message: 'Failed to delete archive file.' })
    }
  })

  app.patch('/api/admin/users/:id', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const existingUser = await store.findUserById?.(req.params.id)
      if (!existingUser) {
        return res.status(404).json({ message: 'User not found.' })
      }

      const nextRole = sanitizeText(req.body?.role || '').toLowerCase() || existingUser.role || 'resident'
      if (!['resident', 'staff', 'admin'].includes(nextRole)) {
        return res.status(400).json({ message: 'Invalid role.' })
      }

      const nextFirstName = sanitizeText(req.body?.firstName || existingUser.firstName || existingUser.first_name)
      const nextLastName = sanitizeText(req.body?.lastName || existingUser.lastName || existingUser.last_name)
      const nextEmail = sanitizeText(req.body?.email || existingUser.email || '').toLowerCase()
      const nextMobile = sanitizeText(req.body?.mobile || existingUser.mobile || '')
      const nextStatus = sanitizeText(req.body?.status || existingUser.status || 'Active Resident')
      const nextZone = req.body?.zone === undefined ? (existingUser.zone ?? null) : Number(req.body.zone)
      const nextPosition = req.body?.position === undefined ? (existingUser.position ?? null) : sanitizeText(req.body.position)
      const nextAvailability = req.body?.availability === undefined ? (existingUser.availability ?? 'Available') : sanitizeText(req.body.availability)
      const nextAddress = req.body?.address === undefined ? (existingUser.address || '') : sanitizeText(req.body.address)
      const nextHouseholdId = req.body?.householdId === undefined
        ? (existingUser.householdId || existingUser.household_id || null)
        : sanitizeText(req.body.householdId) || null
      const nextFamilyMembers = req.body?.familyMembers === undefined ? (existingUser.familyMembers ?? existingUser.family_members ?? 4) : Number(req.body.familyMembers)
      const storedHouseholdMembers = existingUser.householdMembers ?? existingUser.household_members
      const currentHouseholdMembers = Array.isArray(storedHouseholdMembers) ? storedHouseholdMembers : []
      const householdMembersInput = req.body?.householdMembers

      if (householdMembersInput !== undefined && (!Array.isArray(householdMembersInput) || householdMembersInput.length > 100)) {
        return res.status(400).json({ message: 'Household members must be a list of no more than 100 people.' })
      }

      const nextHouseholdMembers = householdMembersInput === undefined
        ? currentHouseholdMembers
        : householdMembersInput.map((member) => {
          if (!member || typeof member !== 'object' || Array.isArray(member)) return null
          const name = typeof member.name === 'string' ? sanitizeText(member.name) : ''
          const relationship = typeof member.relationship === 'string' ? sanitizeText(member.relationship) : ''
          if (!name || name.length > 100 || !relationship || relationship.length > 50) return null
          return { name, relationship }
        })

      if (nextHouseholdMembers.some((member) => !member)) {
        return res.status(400).json({ message: 'Each household member needs a name (up to 100 characters) and relationship (up to 50 characters).' })
      }

      if (!nextFirstName || !nextLastName) {
        return res.status(400).json({ message: 'First name and last name are required.' })
      }

      if (nextEmail && !isValidEmail(nextEmail)) {
        return res.status(400).json({ message: 'Please enter a valid email.' })
      }

      if (nextMobile && !isValidMobile(nextMobile)) {
        return res.status(400).json({ message: 'Please enter a valid mobile number.' })
      }

      if (nextRole === 'resident' && (!Number.isInteger(nextZone) || nextZone < 1 || nextZone > 7)) {
        return res.status(400).json({ message: 'Resident zone must be a number from 1 to 7.' })
      }

      if (!Number.isInteger(nextFamilyMembers) || nextFamilyMembers < 1 || nextFamilyMembers > 100) {
        return res.status(400).json({ message: 'Family members must be a whole number from 1 to 100.' })
      }

      if (nextHouseholdId && nextHouseholdId.length > 50) {
        return res.status(400).json({ message: 'Household ID must not exceed 50 characters.' })
      }

      const duplicateEmail = nextEmail && await store.findUserByIdentifier(nextEmail)
      if (duplicateEmail && duplicateEmail.id !== req.params.id) {
        return res.status(409).json({ message: 'A user with this email already exists.' })
      }

      const duplicateMobile = nextMobile && await store.findUserByIdentifier(nextMobile)
      if (duplicateMobile && duplicateMobile.id !== req.params.id) {
        return res.status(409).json({ message: 'A user with this mobile number already exists.' })
      }

      const updatedUser = await store.updateUser?.(req.params.id, {
        firstName: nextFirstName,
        lastName: nextLastName,
        email: nextEmail,
        mobile: nextMobile,
        role: nextRole,
        status: nextStatus,
        zone: nextZone,
        position: nextPosition,
        availability: nextAvailability,
        address: nextAddress,
        householdId: nextHouseholdId,
        familyMembers: nextFamilyMembers,
        householdMembers: nextHouseholdMembers,
      })

      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found.' })
      }

      await sendDeliveryWebhook({
        event: 'account_status_updated',
        recipient: updatedUser.email,
        token: null,
        expiresAt: null,
        user: updatedUser,
        title: 'Account status updated',
        message: `Your barangay account status changed to ${updatedUser.status}.`,
        metadata: { status: updatedUser.status, role: updatedUser.role },
      }).catch((error) => {
        console.error('status notification error', error)
      })

      await writeAudit(actor.user, 'user.updated', 'user', updatedUser.id, { status: updatedUser.status, role: updatedUser.role })
      return res.json({ user: sanitizeUserRecord(updatedUser) })
    } catch (error) {
      console.error('admin update user error', error)
      return res.status(500).json({ message: 'Unable to update user details.' })
    }
  })

  app.post('/api/admin/residents/:id/archive', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const resident = await store.findUserById?.(req.params.id)
      if (!resident) return res.status(404).json({ message: 'Resident not found.' })
      if (resident.role !== 'resident') {
        return res.status(400).json({ message: 'Only resident accounts can be archived here.' })
      }
      if (resident.status === 'Disabled') {
        return res.json({ success: true, alreadyArchived: true, user: sanitizeUserRecord(resident) })
      }

      const updatedUser = await store.updateUser?.(resident.id, { status: 'Disabled' })
      if (!updatedUser) return res.status(404).json({ message: 'Resident not found.' })

      await writeAudit(actor.user, 'resident.archived', 'user', resident.id, {
        previousStatus: resident.status || null,
      })
      return res.json({ success: true, user: sanitizeUserRecord(updatedUser) })
    } catch (error) {
      if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error?.name)) {
        return res.status(401).json({ message: 'Invalid or expired token.' })
      }
      console.error('failed to archive resident', error)
      return res.status(500).json({ message: 'Unable to archive resident account.' })
    }
  })

  app.post('/api/admin/archive-users-by-zone', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })

      const users = await store.listAllUsers?.() || []
      const zonedUsers = {}
      for (const user of users) {
        const zone = Number(user.zone ?? user.zone_number ?? 0)
        if (!Number.isFinite(zone) || zone < 1 || zone > 7) continue
        zonedUsers[zone] = zonedUsers[zone] || []
        zonedUsers[zone].push(sanitizeUserRecord(user))
      }

      const archiveList = []
      for (const [zoneKey, zoneUsers] of Object.entries(zonedUsers)) {
        const zone = Number(zoneKey)
        const filename = `zone-${zone}-users.json`
        await store.createArchive?.(filename, 'zone-users', {
          archivedAt: new Date().toISOString(),
          zone,
          total: zoneUsers.length,
          users: zoneUsers,
        })
        archiveList.push({ zone, filename, count: zoneUsers.length })
      }

      return res.json({
        ok: true,
        archives: archiveList.map((archive) => ({
          zone: archive.zone,
          filename: archive.filename,
          count: archive.count,
          archivedAt: new Date().toISOString(),
        })),
      })
    } catch (error) {
      console.error('archive-users-by-zone error', error)
      return res.status(500).json({ message: 'Failed to archive users by zone.' })
    }
  })

  app.get('/api/admin/residents-by-zone', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const users = filterVisibleUsers(await store.listAllUsers?.() || [])
      const residents = users.filter((user) => user.role === 'resident').map((user) => ({
        id: user.id,
        firstName: user.first_name || user.firstName,
        lastName: user.last_name || user.lastName,
        email: user.email,
        mobile: user.mobile,
        zone: user.zone || 1,
        householdId: user.householdId,
        familyMembers: user.familyMembers,
        status: user.status,
        address: user.address,
      }))

      return res.json({ residents })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/admin/reports', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const reports = await store.listReports?.() || []
      return res.json({ reports })
    } catch (error) {
      console.error('failed to load reports', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.post('/api/admin/reports', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const type = sanitizeText(req.body?.type)
      const title = sanitizeText(req.body?.title)
      const description = sanitizeText(req.body?.description)
      const severity = sanitizeText(req.body?.severity)
      const zone = Number(req.body?.zone) || 1

      if (!type || !title) {
        return res.status(400).json({ message: 'Type and title are required.' })
      }

      const report = {
        id: `RPT-${String(Date.now()).slice(-6)}`,
        type,
        title,
        description,
        severity,
        zone,
        status: 'Open',
        date: new Date().toISOString(),
      }

      await store.createReport?.(report)

      return res.status(201).json({ report })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  // Admin access endpoints for Access (names-only) and user detail
  app.get('/api/admin/access/users', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })

      const users = filterVisibleUsers(await store.listAllUsers?.() || [])
      const accessUsers = users
        .map((user) => toAccessUserSummary(user))
        .sort((a, b) => {
          const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase()
          const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase()
          return nameA.localeCompare(nameB)
        })
      return res.json({ users: accessUsers })
    } catch (error) {
      console.error('admin access users error', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/admin/access/user/:id', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })
      const user = await store.findUserById?.(req.params.id)
      if (!user) return res.status(404).json({ message: 'User not found.' })
      const safeUser = toAccessUserSummary(user)
      return res.json({ user: safeUser })
    } catch (error) {
      console.error('admin access user detail error', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  // Admin clear data endpoint - by default keep admin/staff accounts
  app.post('/api/admin/clear-data', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })
      const keepAdmins = req.body?.keepAdmins !== false
      await store.clearData?.({ keepAdmins })
      return res.json({ ok: true })
    } catch (e) {
      console.error('clear-data error', e)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  // Manual archive endpoint to force archiving approvals older than N days (admin-only)
  app.post('/api/admin/archive-approvals', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })
      const rawDays = req.body?.days
      const parsedDays = rawDays === undefined || rawDays === null || rawDays === '' ? 7 : Number(rawDays)
      const days = Number.isFinite(parsedDays) ? Math.max(0, parsedDays) : 7
      const result = await store.archiveApprovalsOlderThan?.(days)
      return res.json({ archive: result || null })
    } catch (e) {
      console.error('archive-approvals error', e.message, e.stack)
      return res.status(500).json({ message: 'Failed to archive approvals.', error: e.message })
    }
  })

  app.get('/api/admin/approvals', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })
      const approvals = await store.listApprovals?.() || []
      return res.json({ approvals })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  // List archive files (admin only)
  app.get('/api/admin/archives', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })

      const archives = await store.listArchives?.() || []
      return res.json({ archives })
    } catch (e) {
      console.error('list archives error', e)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  // Download an archive file (admin only)
  app.get('/api/admin/archive-file', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })

      const name = req.query.name
      if (!name || typeof name !== 'string' || name.includes('..') || !/^[\w\-.]+$/.test(name)) {
        return res.status(400).json({ message: 'Invalid file name.' })
      }

      const archive = await store.getArchive?.(name)
      if (!archive) return res.status(404).json({ message: 'File not found.' })
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
      return res.send(JSON.stringify(archive, null, 2))
    } catch (e) {
      console.error('archive-file error', e)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  // Delete an archive file (admin only)
  app.delete('/api/admin/archive-file', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })

      const name = req.query.name
      if (!name || typeof name !== 'string' || name.includes('..') || !/^[\w\-.]+$/.test(name)) {
        return res.status(400).json({ message: 'Invalid file name.' })
      }

      const deleted = await store.deleteArchive?.(name)
      if (!deleted) return res.status(404).json({ message: 'File not found.' })
      return res.json({ ok: true, deleted: name })
    } catch (e) {
      console.error('delete-archive-file error', e)
      return res.status(500).json({ message: 'Failed to delete archive file.' })
    }
  })

  app.patch('/api/requests/:id/status', async (req, res) => {
    try {
      const actor = await authorizeCurrentActor(req, res, ['staff', 'admin'], 'request-processing')
      if (!actor) return

      const status = sanitizeText(req.body?.status)
      if (!['Pending', 'In Review', 'Needs Information', 'Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status value.' })
      }
      const note = sanitizeText(req.body?.note || '')
      if (note.length > 1000) {
        return res.status(400).json({ message: 'Status note must be 1000 characters or fewer.' })
      }
      if (status === 'Needs Information' && !note) {
        return res.status(400).json({ message: 'Add a note explaining what information is needed.' })
      }
      if (status === 'Rejected' && !note) {
        return res.status(400).json({ message: 'Add a reason explaining why this request is rejected.' })
      }

      const existingRequest = (await store.listAllRequests?.() || []).find((request) => request.id === req.params.id)
      if (!existingRequest) {
        return res.status(404).json({ message: 'Request not found.' })
      }

      const allowedTransitions = {
        Pending: ['In Review', 'Needs Information', 'Approved', 'Rejected'],
        'In Review': ['Needs Information', 'Approved', 'Rejected'],
        'Needs Information': ['In Review', 'Approved', 'Rejected'],
        Approved: [],
        Rejected: [],
      }
      if (!(allowedTransitions[existingRequest.status] || []).includes(status)) {
        return res.status(409).json({ message: `Cannot change a ${existingRequest.status} request to ${status}.` })
      }

      if (status === 'Approved') {
        const existingApprovals = await store.listApprovals?.() || []
        if (existingApprovals.some((approval) => approval.requestId === req.params.id)) {
          return res.status(409).json({ message: 'This request has already been approved.' })
        }
      }

      const historyEntry = {
        id: randomUUID(),
        kind: 'status',
        status,
        note,
        createdAt: new Date().toISOString(),
        actorRole: actor.role,
        actorName: `${actor.firstName || ''} ${actor.lastName || ''}`.trim(),
      }
      const updated = await store.updateRequestStatus?.(req.params.id, status, historyEntry)
      if (!updated) {
        return res.status(404).json({ message: 'Request not found.' })
      }

      await writeAudit(actor, `request.${status.toLowerCase().replace(/\s+/g, '-')}`, 'request', req.params.id, { previousStatus: existingRequest.status })

      // if approved, create an approval record
      if (status === 'Approved') {
        const approval = {
          id: `APP-${String(Date.now()).slice(-8)}`,
          requestId: req.params.id,
          approvedBy: actor.id,
          approvedByRole: actor.role,
          dateApproved: new Date().toISOString(),
          requestSnapshot: updated,
        }
        try {
          await store.addApproval?.(approval)
          const archived = await store.archiveApprovalsOlderThan?.(7)
          // return archive info optionally
          return res.json({ request: updated, approval, archive: archived || null })
        } catch (err) {
          console.error('approval log error', err)
          return res.json({ request: updated, approval: null })
        }
      }

      return res.json({ request: updated })
    } catch (e) {
      console.error('status update error', e)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.post('/api/requests', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor) return res.status(403).json({ message: 'Account access is disabled or authentication is incomplete.' })
      const { user } = actor
      if (user.role === 'resident' && user.status !== 'Active Resident') {
        return res.status(403).json({ message: 'Your account is pending barangay verification. You can submit requests after Staff approves your account.' })
      }

      const type = sanitizeText(req.body?.type)
      const purpose = sanitizeText(req.body?.purpose)
      const notes = sanitizeText(req.body?.notes)
      const deliveryMethod = sanitizeText(req.body?.deliveryMethod || 'online').toLowerCase()
      const deliveryNote = sanitizeText(req.body?.deliveryNote || '')

      if (!type || !purpose) {
        return res.status(400).json({ message: 'Request type and purpose are required.' })
      }
      if (!['online', 'physical'].includes(deliveryMethod)) {
        return res.status(400).json({ message: 'Delivery method must be online or physical.' })
      }
      if (deliveryNote.length > 500) {
        return res.status(400).json({ message: 'Delivery note must be 500 characters or fewer.' })
      }

      const request = {
        id: randomUUID(),
        userId: user.id,
        type,
        purpose,
        notes,
        deliveryMethod,
        deliveryNote,
        followUps: [],
        status: 'Pending',
        date: new Date().toISOString(),
        statusHistory: [{
          id: randomUUID(),
          kind: 'status',
          status: 'Pending',
          note: '',
          createdAt: new Date().toISOString(),
          actorRole: user.role,
          actorName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        }],
      }

      await store.saveRequest(request)
      return res.status(201).json({ request })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.post('/api/requests/:id/reminders', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'resident' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Resident account access is required.' })
      }

      const requestId = req.params.id
      const residentRequests = await store.listRequestsForUser(actor.user.id)
      if (!residentRequests.some((request) => request.id === requestId)) {
        return res.status(404).json({ message: 'Request not found.' })
      }

      const scheduledAtRaw = sanitizeText(req.body?.scheduledAt || '')
      const scheduledAt = new Date(scheduledAtRaw).getTime()
      if (!scheduledAtRaw || !Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
        return res.status(400).json({ message: 'Choose a future date and time for the reminder.' })
      }

      const reminder = {
        id: randomUUID(),
        requestId,
        userId: actor.user.id,
        scheduledAt: new Date(scheduledAt).toISOString(),
        notified: false,
        createdAt: new Date().toISOString(),
      }

      reminderStore.set(reminder.id, reminder)
      return res.status(201).json({ reminder })
    } catch (error) {
      console.error('create reminder error', error)
      return res.status(500).json({ message: 'Unable to schedule reminder.' })
    }
  })

  app.get('/api/reminders', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor) return res.status(401).json({ message: 'Authentication required.' })

      const dueOnly = String(req.query.due || '').toLowerCase() === 'true'
      const reminders = [...reminderStore.values()]
        .filter((reminder) => reminder.userId === actor.user.id)
        .map((reminder) => ({ ...reminder, isDue: dueOnly ? new Date(reminder.scheduledAt).getTime() <= Date.now() : false }))
        .filter((reminder) => !dueOnly || reminder.isDue)

      return res.json({ reminders })
    } catch (error) {
      console.error('list reminders error', error)
      return res.status(500).json({ message: 'Unable to load reminders.' })
    }
  })

  app.post('/api/requests/:id/follow-ups', authRateLimit, async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'resident' || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Resident account access is required.' })
      }

      const message = sanitizeText(req.body?.message)
      if (!message || message.length > 1000) {
        return res.status(400).json({ message: 'Follow-up message must be between 1 and 1000 characters.' })
      }

      const residentRequests = await store.listRequestsForUser(actor.user.id)
      if (!residentRequests.some((request) => request.id === req.params.id)) {
        return res.status(404).json({ message: 'Request not found.' })
      }

      const followUp = {
        id: randomUUID(),
        message,
        createdAt: new Date().toISOString(),
        actorName: `${actor.user.firstName || ''} ${actor.user.lastName || ''}`.trim(),
      }
      const updatedRequest = await store.appendRequestFollowUp?.(req.params.id, followUp)
      if (!updatedRequest) return res.status(404).json({ message: 'Request not found.' })

      await writeAudit(actor.user, 'request.followed-up', 'request', req.params.id)
      return res.status(201).json({ request: updatedRequest })
    } catch (error) {
      console.error('request follow-up error', error)
      return res.status(500).json({ message: 'Unable to send request follow-up.' })
    }
  })

  app.use((req, res) => {
    res.status(404).json({ message: 'Route not found.' })
  })

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ message: 'Invalid JSON payload.' })
    }

    if (error?.message === 'Origin not allowed') {
      return res.status(403).json({ message: 'Origin not allowed.' })
    }

    console.error('Unhandled API error:', error)
    return res.status(500).json({ message: 'Internal server error.' })
  })

  return app
}

export async function startServer() {
  try {
    if (usePostgres) {
      await pgDb.initDatabase()
    } else if (!SHOULD_SKIP_SEED) {
      await seedDemoResident()
    }
  } catch (error) {
    console.error('Database initialization failed; refusing to start without the configured storage.', error)
    throw error
  }

  const app = createApp()
  const server = app.listen(PORT, () => {
    console.log(`Barangay API running on http://localhost:${PORT}`)
  })

  return server
}
