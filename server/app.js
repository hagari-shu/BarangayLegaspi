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
  OFFICIAL_PHOTO_KEYS,
  OFFICIAL_PHOTO_ROLES,
  createCaptainPhotoUpload,
  createOfficialPhotoUpload,
  deleteCaptainPhoto,
  deleteOfficialPhoto,
  finalizeCaptainPhotoUpload,
  finalizeOfficialPhotoUpload,
  getCaptainPhotoUrl,
  getOfficialPhotoUrl,
  isCaptainPhotoStorageConfigured,
  isOfficialPhotoStorageConfigured,
} from './captain-photo-storage.js'
import {
  deleteFacebookPost,
  deliverMessengerAnnouncement,
  getMetaIntegrationStatus,
  processMessengerWebhook,
  publishFacebookPost,
  verifyMetaWebhookSignature,
} from './meta-social.js'
import { registerResidentRegistryRoutes } from './resident-registry.js'
import { ADMIN_SEED, CORS_ORIGINS, IS_PRODUCTION, IS_TEST_RUN, PORT, SHOULD_SKIP_SEED } from './config.js'
import {
  createStaffInvitationAcceptanceAudit,
  hashStaffInvitationToken,
  isValidStaffInvitationToken,
} from './staff-invitations.js'
import {
  createSuperAdminInvitationAcceptanceAudit,
  hashSuperAdminInvitationToken,
  isValidSuperAdminInvitationToken,
} from './super-admin-invitations.js'
import { isAdminRole, isStaffOrAdminRole, isSuperAdminRole } from './rbac.js'

let store = process.env.DATABASE_URL && !IS_TEST_RUN ? pgDb : jsonDb

const sanitizeText = (value = '') => String(value).replace(/[<>]/g, '').trim()
const sanitizeUserRecord = (user = {}) => {
  if (!user || typeof user !== 'object') return {}
  const { password, passwordHash, password_hash, mfaSecret, mfa_secret, mfaLastStep, mfa_last_step, ...safeUser } = user
  const mfaEnabled = Boolean(safeUser.mfaEnabled ?? safeUser.mfa_enabled)
  return {
    ...safeUser,
    mfaEnabled,
    mfaSetupPending: !mfaEnabled && Boolean(mfaSecret || mfa_secret),
    role: safeUser.role || safeUser.userRole || 'resident',
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
const generateInitialPassword = () => {
  let password = ''
  do {
    password = randomBytes(24).toString('base64url')
  } while (!isValidPassword(password))
  return password
}
const passwordRequirements = 'at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character'
const serviceCatalog = [
  { icon: '📄', title: 'Barangay Certificate', subtitle: 'Request and claim', tone: 'green' },
  { icon: '🏥', title: 'Health Assistance', subtitle: 'Access public health support', tone: 'blue' },
  { icon: '🧾', title: 'Barangay Clearance', subtitle: 'Update and renew', tone: 'amber' },
  { icon: '🚨', title: 'Emergency Help', subtitle: 'Call for immediate support', tone: 'red' },
]

const reminderStore = new Map()

export async function seedDemoResident() {
  if (process.env.DATABASE_URL && !IS_TEST_RUN) {
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

  app.get('/api/meta/webhook', (req, res) => {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
    if (
      verifyToken
      && req.query['hub.mode'] === 'subscribe'
      && req.query['hub.verify_token'] === verifyToken
      && typeof req.query['hub.challenge'] === 'string'
    ) {
      return res.type('text/plain').send(req.query['hub.challenge'])
    }
    return res.sendStatus(403)
  })

  app.post('/api/meta/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!getMetaIntegrationStatus().messenger) {
      return res.status(503).json({ message: 'Messenger integration is not configured.' })
    }
    if (!verifyMetaWebhookSignature(req.body, req.get('x-hub-signature-256'), process.env.META_APP_SECRET)) {
      return res.status(401).json({ message: 'Invalid webhook signature.' })
    }

    try {
      const payload = JSON.parse(req.body.toString('utf8'))
      const pagePayload = payload?.object === 'page'
        ? { ...payload, entry: (payload.entry || []).filter((entry) => String(entry.id) === String(process.env.META_PAGE_ID)) }
        : payload
      await processMessengerWebhook(pagePayload, store)
      return res.sendStatus(200)
    } catch (error) {
      console.error('Messenger webhook processing failed', error)
      return res.status(500).json({ message: 'Unable to process Messenger event.' })
    }
  })

  app.use(['/api/staff/residents', '/api/staff/demographics', '/api/staff/registry-source-reviews'], (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store')
    res.set('Vary', 'Authorization')
    next()
  })
  app.use('/api/staff/residents/import', express.json({ limit: '2mb' }))
  app.use(express.json({ limit: '100kb' }))
  app.use(express.urlencoded({ extended: true, limit: '100kb' }))

  app.use('/api', async (req, res, next) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return next()

    let payload
    try {
      payload = verifyToken(token)
    } catch {
      return next()
    }
    if (!payload.mustChangePassword) return next()

    try {
      const user = await store.findUserById?.(payload.sub)
      if (!(user?.mustChangePassword ?? user?.must_change_password)) return next()

      const path = req.originalUrl.split('?')[0]
      if ((path === '/api/change-password' && req.method === 'POST')
        || (path === '/api/profile' && req.method === 'GET')) {
        return next()
      }
      return res.status(403).json({
        code: 'password_change_required',
        message: 'Change your temporary password before using the portal.',
      })
    } catch (error) {
      console.error('temporary password access check failed', error)
      return res.status(503).json({ message: 'Unable to verify account access. Please try again.' })
    }
  })

  const getCurrentActor = async (token) => {
    const payload = verifyToken(token)
    if (payload.purpose === 'mfa_pending') return null
    const user = await store.findUserById?.(payload.sub)
    if (!user || ['Suspended', 'Disabled'].includes(user.status)) return null
    return { payload, user }
  }

  const hasCurrentRole = async (token, roles) => {
    const actor = await getCurrentActor(token)
    const roleAllowed = actor && (
      roles.includes(actor.user.role)
      || (roles.includes('admin') && isAdminRole(actor.user.role))
    )
    return Boolean(roleAllowed && !['Suspended', 'Disabled'].includes(actor.user.status))
  }

  const canManageOfficialProfiles = (actor) => Boolean(
    actor && ['staff', 'admin'].includes(actor.user.role)
      && !['Suspended', 'Disabled'].includes(actor.user.status),
  )

  const deliverAnnouncementChannels = async (announcement, channels, options = {}) => {
    const delivery = {}
    if (channels.includes('facebook')) {
      try {
        const postId = await publishFacebookPost(announcement)
        delivery.facebook = { status: 'published', postId }
      } catch (error) {
        console.error('Facebook announcement delivery failed', error.message)
        delivery.facebook = { status: 'failed', message: error.message }
      }
    }
    if (channels.includes('messenger')) {
      try {
        delivery.messenger = await deliverMessengerAnnouncement(announcement, store, options)
      } catch (error) {
        console.error('Messenger announcement delivery failed', error.message)
        delivery.messenger = { status: 'failed', eligible: 0, sent: 0, failed: 0, message: error.message }
      }
    }
    return delivery
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

  const createPortalAccount = async (actor, role, req, res) => {
    const firstName = sanitizeText(req.body?.firstName)
    const lastName = sanitizeText(req.body?.lastName)
    const email = sanitizeText(req.body?.email).toLowerCase()
    const mobile = sanitizeText(req.body?.mobile)
    const position = role === 'staff' ? sanitizeText(req.body?.position || 'Staff') : 'Administrator'

    if (!firstName || firstName.length > 100 || !lastName || lastName.length > 100) {
      return res.status(400).json({ message: 'First and last names are required and must be 100 characters or fewer.' })
    }
    if (!isValidEmail(email) || email.length > 255) {
      return res.status(400).json({ message: 'Provide a valid account email address.' })
    }
    if (!isValidMobile(mobile)) {
      return res.status(400).json({ message: 'Provide a valid 11-digit Philippine mobile number starting with 09.' })
    }
    if (role === 'staff' && (
      !position
      || position.length > 120
      || [...position].some((character) => {
        const codePoint = character.codePointAt(0)
        return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
      })
      || position.includes('<')
      || position.includes('>')
    )) {
      return res.status(400).json({ message: 'Provide a valid staff position with 1 to 120 printable characters.' })
    }

    res.set('Cache-Control', 'no-store')
    let temporaryPassword
    try {
      temporaryPassword = generateInitialPassword()
      const user = {
        id: randomUUID(),
        firstName,
        lastName,
        email,
        mobile,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        role,
        status: role === 'admin' ? 'Administrator' : 'On Duty',
        address: '',
        householdId: null,
        familyMembers: 1,
        householdMembers: [],
        position,
        availability: 'Available',
        createdAt: new Date().toISOString(),
      }
      const result = await store.createUser(user)
      if (result?.status === 'account_exists') {
        return res.status(409).json({ message: 'An account already uses this email or mobile number.' })
      }
      const createdUser = result?.user || result
      try {
        await writeAudit(actor.user, 'account.created', 'user', user.id, { role, email })
      } catch (error) {
        console.error('failed to record portal account creation audit entry', error)
      }
      return res.status(201).json({
        message: `${role === 'admin' ? 'Admin' : 'Staff'} account created. Share the temporary password securely; it will only be shown once.`,
        user: sanitizeUserRecord(createdUser),
        temporaryPassword,
      })
    } catch (error) {
      if (error?.code === '23505') {
        return res.status(409).json({ message: 'An account already uses this email or mobile number.' })
      }
      console.error('failed to create portal account', error)
      return res.status(500).json({ message: 'Unable to create the account.' })
    }
  }

  registerResidentRegistryRoutes(app, { store })

  const authAttempts = new Map()
  const resetTokens = new Map()
  const mfaChallenges = new Map()

  const ensureSeededAccounts = async () => {
    if (process.env.DATABASE_URL) return
    if (!SHOULD_SKIP_SEED) await seedDemoResident()
  }

  const sendDeliveryWebhook = async ({ event, recipient, token, expiresAt, user, title, message, metadata = {} }) => {
    const deliveryUrl = process.env.RESET_DELIVERY_URL || process.env.NOTIFICATION_WEBHOOK_URL
    if (!deliveryUrl) {
      return { queued: false, deliveryStatus: 'disabled', event }
    }
    if (process.env.NODE_ENV === 'production' && (!deliveryUrl.startsWith('https://') || !process.env.RESET_DELIVERY_TOKEN)) {
      throw new Error('Production reset delivery requires an HTTPS URL and RESET_DELIVERY_TOKEN.')
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
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.RESET_DELIVERY_TOKEN ? { Authorization: `Bearer ${process.env.RESET_DELIVERY_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
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
    const role = ['resident', 'staff', 'admin', 'super_admin'].includes(req.body?.role) ? req.body.role : 'unknown'
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
      if (!photoUrl) return res.status(204).end()
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
      if (!actor || !isAdminRole(actor.user.role) || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Admin access required.' })
      }
      if (!isCaptainPhotoStorageConfigured()) return res.status(503).json({ message: 'Image storage is not configured.' })
      if (typeof req.body?.key !== 'string' || !req.body.key.startsWith(`${CAPTAIN_PHOTO_KEY}/pending/`)) {
        return res.status(400).json({ message: 'Invalid image upload.' })
      }

      await finalizeCaptainPhotoUpload(req.body.key)
      await writeAudit(actor.user, 'captain-photo.updated', 'image', CAPTAIN_PHOTO_KEY)
      return res.json({ ok: true })
    } catch (error) {
      if (error.message?.startsWith('Invalid official photo upload')
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
      if (!actor || !isAdminRole(actor.user.role) || ['Suspended', 'Disabled'].includes(actor.user.status)) {
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

  app.get('/api/official-profiles', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const profiles = await store.getOfficialProfiles?.()
      if (!profiles) throw new Error('Official profile storage is unavailable.')
      const result = await Promise.all(profiles.map(async (profile) => ({
        ...profile,
        photoUrl: await getOfficialPhotoUrl(profile.role),
      })))
      return res.json({ profiles: result })
    } catch (error) {
      console.error('load official profiles failed', error)
      return res.status(500).json({ message: 'Unable to load official profiles.' })
    }
  })

  app.get('/api/official-profiles/:role/photo', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!OFFICIAL_PHOTO_ROLES.includes(req.params.role)) return res.sendStatus(404)
    try {
      const photoUrl = await getOfficialPhotoUrl(req.params.role)
      if (!photoUrl) return res.status(204).end()
      return res.redirect(302, photoUrl)
    } catch (error) {
      console.error('load official profile photo failed', error)
      return res.status(502).json({ message: 'Unable to load the official photo.' })
    }
  })

  app.put('/api/admin/official-profiles/:role', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    if (!OFFICIAL_PHOTO_ROLES.includes(req.params.role)) return res.status(404).json({ message: 'Official profile not found.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor) return res.status(401).json({ message: 'Authentication required.' })
    if (!canManageOfficialProfiles(actor)) return res.status(403).json({ message: 'Staff or Admin access required.' })

    try {
      const displayName = sanitizeText(req.body?.displayName || '')
      const profileUrl = String(req.body?.profileUrl || '').trim()
      const groupUrl = String(req.body?.groupUrl || '').trim()
      const isValidProfileUrl = (value) => {
        if (!value) return true
        if (value.length > 2048) return false
        try {
          const url = new URL(value)
          return url.protocol === 'https:' && !url.username && !url.password
        } catch {
          return false
        }
      }
      if (displayName.length > 120 || !isValidProfileUrl(profileUrl) || !isValidProfileUrl(groupUrl)) {
        return res.status(400).json({ message: 'Enter a name up to 120 characters and valid HTTPS profile and group links.' })
      }

      const profile = await store.updateOfficialProfile?.(
        req.params.role,
        { displayName, profileUrl, groupUrl },
        actor.user.id,
      )
      if (!profile) throw new Error('Official profile storage is unavailable.')
      await writeAudit(actor.user, 'official-profile.updated', 'official_profile', req.params.role)
      return res.json({ profile })
    } catch (error) {
      console.error('update official profile failed', error)
      return res.status(500).json({ message: 'Unable to update official profile.' })
    }
  })

  app.post('/api/admin/official-profiles/:role/photo/upload-url', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    if (!OFFICIAL_PHOTO_ROLES.includes(req.params.role)) return res.status(404).json({ message: 'Official profile not found.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor) return res.status(401).json({ message: 'Authentication required.' })
    if (!canManageOfficialProfiles(actor)) return res.status(403).json({ message: 'Staff or Admin access required.' })

    try {
      if (!CAPTAIN_PHOTO_CONTENT_TYPES.includes(req.body?.contentType)) {
        return res.status(400).json({ message: 'Choose a JPEG, PNG, or WebP image.' })
      }
      if (!isOfficialPhotoStorageConfigured()) return res.status(503).json({ message: 'Image storage is not configured.' })
      return res.json(await createOfficialPhotoUpload(req.params.role, req.body.contentType))
    } catch (error) {
      console.error('create official photo upload failed', error)
      return res.status(502).json({ message: 'Unable to prepare the image upload.' })
    }
  })

  app.post('/api/admin/official-profiles/:role/photo', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    if (!OFFICIAL_PHOTO_ROLES.includes(req.params.role)) return res.status(404).json({ message: 'Official profile not found.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor) return res.status(401).json({ message: 'Authentication required.' })
    if (!canManageOfficialProfiles(actor)) return res.status(403).json({ message: 'Staff or Admin access required.' })

    try {
      if (!isOfficialPhotoStorageConfigured()) return res.status(503).json({ message: 'Image storage is not configured.' })
      const expectedPendingPrefix = `${OFFICIAL_PHOTO_KEYS[req.params.role]}/pending/`
      if (typeof req.body?.key !== 'string' || !req.body.key.startsWith(expectedPendingPrefix)) {
        return res.status(400).json({ message: 'Invalid image upload.' })
      }
      await finalizeOfficialPhotoUpload(req.params.role, req.body.key)
      await writeAudit(actor.user, 'official-profile.photo_updated', 'official_profile', req.params.role)
      return res.json({ ok: true })
    } catch (error) {
      if (error.message?.startsWith('Invalid official photo upload')
        || error.message?.startsWith('Upload must be')
        || error.message?.startsWith('Uploaded file is not')) {
        return res.status(400).json({ message: error.message })
      }
      console.error('verify official photo upload failed', error)
      return res.status(502).json({ message: 'Unable to verify the uploaded image.' })
    }
  })

  app.delete('/api/admin/official-profiles/:role/photo', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    if (!OFFICIAL_PHOTO_ROLES.includes(req.params.role)) return res.status(404).json({ message: 'Official profile not found.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor) return res.status(401).json({ message: 'Authentication required.' })
    if (!canManageOfficialProfiles(actor)) return res.status(403).json({ message: 'Staff or Admin access required.' })

    try {
      if (!isOfficialPhotoStorageConfigured()) return res.status(503).json({ message: 'Image storage is not configured.' })
      await deleteOfficialPhoto(req.params.role)
      await writeAudit(actor.user, 'official-profile.photo_deleted', 'official_profile', req.params.role)
      return res.json({ ok: true })
    } catch (error) {
      console.error('delete official profile photo failed', error)
      return res.status(502).json({ message: 'Unable to remove the official photo.' })
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

      const registration = await store.registerResident(user, {
        id: randomUUID(),
        actorId: null,
        actorRole: null,
        action: 'user.registered',
        targetType: 'user',
        targetId: user.id,
        metadata: { status: user.status },
        createdAt: user.createdAt,
      })
      if (registration.status === 'account_exists') {
        return res.status(409).json({ message: 'A resident with this mobile number or email already exists.' })
      }
      if (registration.status === 'invitation_pending') {
        return res.status(409).json({ message: 'This email is reserved for an account invitation. Contact the barangay office.' })
      }

      const delivery = await sendDeliveryWebhook({
        event: 'resident_registered',
        recipient: user.email,
        token: null,
        expiresAt: null,
        user,
        title: 'Account registered',
        message: 'Your account has been created and is waiting administrator approval.',
        metadata: { status: user.status },
      }).catch((error) => {
        console.error('registration notification error', error)
        return { queued: false, deliveryStatus: 'failed', event: 'resident_registered' }
      })

      const { passwordHash, ...safeUser } = user

      return res.status(201).json({
        message: 'Account created and is awaiting administrator approval.',
        requiresApproval: true,
        user: safeUser,
        deliveryStatus: delivery.deliveryStatus || 'disabled',
      })
    } catch (error) {
      console.error('Register error:', error)
      return res.status(500).json({ message: 'Registration failed.' })
    }
  })

  app.post('/api/staff/invitations/validate', authRateLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const token = String(req.body?.token || '')
    if (!isValidStaffInvitationToken(token) || typeof store.getStaffInvitationByTokenHash !== 'function') {
      return res.status(410).json({ message: 'This staff invitation is invalid, expired, or already used.' })
    }

    try {
      const invitation = await store.getStaffInvitationByTokenHash(hashStaffInvitationToken(token))
      if (
        !invitation
        || invitation.acceptedAt
        || invitation.revokedAt
        || Date.parse(invitation.expiresAt) <= Date.now()
      ) {
        return res.status(410).json({ message: 'This staff invitation is invalid, expired, or already used.' })
      }

      return res.json({
        email: invitation.email,
        role: invitation.role === 'admin' ? 'admin' : 'staff',
        expiresAt: invitation.expiresAt,
      })
    } catch (error) {
      console.error('staff invitation lookup failed', error)
      return res.status(500).json({ message: 'Unable to verify this staff invitation.' })
    }
  })

  app.post('/api/staff/invitations', authRateLimit, async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor || !['admin', 'staff'].includes(actor.user.role)) {
      return res.status(403).json({ message: 'Only Admin and Staff accounts can create permitted accounts.' })
    }

    const role = String(req.body?.role || 'staff').trim().toLowerCase()
    if (!['admin', 'staff'].includes(role) || (role === 'admin' && actor.user.role !== 'admin')) {
      return res.status(403).json({ message: 'Staff can create Staff accounts only. Only an Admin can create Admin accounts.' })
    }
    return res.status(410).json({ message: 'Portal invitations are no longer issued. Create the account directly from the portal.' })
  })

  app.post('/api/staff/invitations/accept', authRateLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const token = String(req.body?.token || '')
    const firstName = sanitizeText(req.body?.firstName)
    const lastName = sanitizeText(req.body?.lastName)
    const mobile = sanitizeText(req.body?.mobile)
    const password = sanitizeText(req.body?.password)
    if (!isValidStaffInvitationToken(token)) {
      return res.status(410).json({ message: 'This staff invitation is invalid, expired, or already used.' })
    }
    if (
      !firstName || firstName.length > 100
      || !lastName || lastName.length > 100
      || !isValidMobile(mobile)
      || !isValidPassword(password)
    ) {
      return res.status(400).json({
        message: `Please provide a first and last name, a valid mobile number, and a password with ${passwordRequirements}.`,
      })
    }
    if (typeof store.acceptStaffInvitation !== 'function') {
      return res.status(503).json({ message: 'Staff invitation acceptance is unavailable.' })
    }

    try {
      const tokenHash = hashStaffInvitationToken(token)
      const invitation = await store.getStaffInvitationByTokenHash(tokenHash)
      if (
        !invitation
        || invitation.acceptedAt
        || invitation.revokedAt
        || Date.parse(invitation.expiresAt) <= Date.now()
      ) {
        return res.status(410).json({ message: 'This staff invitation is invalid, expired, or already used.' })
      }

      const acceptedAt = new Date().toISOString()
      const user = {
        id: randomUUID(),
        firstName,
        lastName,
        mobile,
        passwordHash: await hashPassword(password),
        householdId: `STAFF-${randomUUID().slice(0, 12)}`,
      }
      const result = await store.acceptStaffInvitation({
        tokenHash,
        user,
        acceptedAt,
        auditEntry: createStaffInvitationAcceptanceAudit(
          user.id,
          invitation.id,
          invitation.role === 'admin' ? 'admin' : 'staff',
        ),
      })
      if (result.status === 'invalid_invitation') {
        return res.status(410).json({ message: 'This staff invitation is invalid, expired, or already used.' })
      }
      if (result.status === 'account_exists') {
        return res.status(409).json({ message: 'An account already uses these details. Contact the barangay office.' })
      }

      return res.status(201).json({
        message: `${invitation.role === 'admin' ? 'Administrator' : 'Staff'} account created. You can now sign in.`,
        role: invitation.role === 'admin' ? 'admin' : 'staff',
      })
    } catch (error) {
      console.error('staff invitation acceptance failed', error)
      return res.status(500).json({ message: 'Unable to create the staff account.' })
    }
  })

  app.post('/api/super-admin/invitations/validate', authRateLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const token = String(req.body?.token || '')
    if (!isValidSuperAdminInvitationToken(token) || typeof store.getSuperAdminInvitationByTokenHash !== 'function') {
      return res.status(410).json({ message: 'This Super Admin invitation is invalid, expired, or already used.' })
    }

    try {
      const invitation = await store.getSuperAdminInvitationByTokenHash(hashSuperAdminInvitationToken(token))
      if (
        !invitation
        || invitation.acceptedAt
        || invitation.revokedAt
        || Date.parse(invitation.expiresAt) <= Date.now()
      ) {
        return res.status(410).json({ message: 'This Super Admin invitation is invalid, expired, or already used.' })
      }
      return res.json({ email: invitation.email, expiresAt: invitation.expiresAt })
    } catch (error) {
      console.error('Super Admin invitation lookup failed', error)
      return res.status(500).json({ message: 'Unable to verify this Super Admin invitation.' })
    }
  })

  app.post('/api/super-admin/invitations/accept', authRateLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const token = String(req.body?.token || '')
    const firstName = sanitizeText(req.body?.firstName)
    const lastName = sanitizeText(req.body?.lastName)
    const mobile = sanitizeText(req.body?.mobile)
    const password = String(req.body?.password || '')
    if (!isValidSuperAdminInvitationToken(token)) {
      return res.status(410).json({ message: 'This Super Admin invitation is invalid, expired, or already used.' })
    }
    if (
      !firstName || firstName.length > 100
      || !lastName || lastName.length > 100
      || !isValidMobile(mobile)
      || !isValidPassword(password)
    ) {
      return res.status(400).json({
        message: `Please provide a first and last name, a valid mobile number, and a password with ${passwordRequirements}.`,
      })
    }
    if (typeof store.acceptSuperAdminInvitation !== 'function') {
      return res.status(503).json({ message: 'Super Admin invitation acceptance is unavailable.' })
    }

    try {
      const tokenHash = hashSuperAdminInvitationToken(token)
      const invitation = await store.getSuperAdminInvitationByTokenHash(tokenHash)
      if (
        !invitation
        || invitation.acceptedAt
        || invitation.revokedAt
        || Date.parse(invitation.expiresAt) <= Date.now()
      ) {
        return res.status(410).json({ message: 'This Super Admin invitation is invalid, expired, or already used.' })
      }

      const acceptedAt = new Date().toISOString()
      const user = {
        id: randomUUID(),
        firstName,
        lastName,
        mobile,
        passwordHash: await hashPassword(password),
        householdId: `ADMIN-${randomUUID().slice(0, 12)}`,
      }
      const result = await store.acceptSuperAdminInvitation({
        tokenHash,
        user,
        acceptedAt,
        auditEntry: createSuperAdminInvitationAcceptanceAudit(user.id, invitation.id),
      })
      if (result.status === 'invalid_invitation') {
        return res.status(410).json({ message: 'This Super Admin invitation is invalid, expired, or already used.' })
      }
      if (result.status === 'account_exists') {
        return res.status(409).json({ message: 'An account already uses these details. Contact the barangay office.' })
      }

      return res.status(201).json({ message: 'Super Admin account created. You can now sign in.' })
    } catch (error) {
      console.error('Super Admin invitation acceptance failed', error)
      return res.status(500).json({ message: 'Unable to create the Super Admin account.' })
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
      const isApprovedUser = ['admin', 'super_admin', 'staff'].includes(normalizedRole) || ['Administrator', 'On Duty', 'Active Resident'].includes(normalizedStatus)

      if (normalizedRole === 'resident' && !isApprovedUser) {
        if (normalizedStatus.toLowerCase() === 'pending verification') {
          await writeAudit({ role: 'anonymous' }, 'auth.login.rejected_unapproved_resident', 'user', user.id, {
            status: normalizedStatus,
            residentName: `${user.firstName || user.first_name || ''} ${user.lastName || user.last_name || ''}`.trim(),
          })
          return res.status(403).json({
            code: 'resident_not_approved',
            message: 'Your account is awaiting administrator approval before you can access the web app.',
          })
        }
        return res.status(403).json({ message: 'Your account is not active. Please contact the barangay office for assistance.' })
      }

      const safeUser = sanitizeUserRecord({ ...user, role: normalizedRole })

      const mfaEnabled = Boolean(user.mfaEnabled ?? user.mfa_enabled)
      const mfaSecret = user.mfaSecret || user.mfa_secret
      if (mfaEnabled && !mfaSecret) {
        await writeAudit({ role: 'anonymous' }, 'auth.login.mfa_unavailable', 'user', user.id)
        console.error('MFA is enabled but the authenticator secret is missing for account', user.id)
        return res.status(503).json({
          code: 'mfa_unavailable',
          message: 'Authenticator verification is temporarily unavailable. Please contact the barangay office.',
        })
      }

      if (mfaEnabled) {
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

      const mustChangePassword = Boolean(user.mustChangePassword ?? user.must_change_password)
      const token = signToken({ sub: user.id, role: normalizedRole, mustChangePassword })

      return res.json({
        message: 'Login successful',
        token,
        user: safeUser,
        mustChangePassword,
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
      const mfaEnabled = Boolean(user?.mfaEnabled ?? user?.mfa_enabled)
      const mfaSecret = user?.mfaSecret || user?.mfa_secret
      if (!user || !mfaEnabled || !mfaSecret || ['Suspended', 'Disabled'].includes(user.status)
        || (challenge.temporaryAccess && user.role !== 'staff')) {
        return res.status(401).json({ message: 'MFA challenge is no longer valid.' })
      }

      const secret = decryptTotpSecret(mfaSecret)
      const matchedStep = verifyTotp(secret, code)
      const lastStep = Number(user.mfaLastStep || user.mfa_last_step || 0)
      if (matchedStep === null || matchedStep <= lastStep) {
        return res.status(401).json({ message: 'The authenticator code is invalid or has already been used.' })
      }

      mfaChallenges.delete(challengeKey)
      await store.updateUser?.(user.id, { mfaLastStep: matchedStep })
      const role = String(user.role || 'resident').toLowerCase()
      const mustChangePassword = Boolean(user.mustChangePassword ?? user.must_change_password)
      const tokenOptions = Number.isFinite(challenge.sessionExpiresAt)
        ? { expiresIn: Math.max(1, Math.ceil((challenge.sessionExpiresAt - Date.now()) / 1000)) }
        : {}
      const token = signToken({ sub: user.id, role, mustChangePassword }, tokenOptions)
      return res.json({ message: 'Login successful.', token, user: sanitizeUserRecord({ ...user, role }) })
    } catch (error) {
      console.error('MFA login error:', error)
      return res.status(500).json({ message: 'Unable to verify authenticator code.' })
    }
  })

  app.post('/api/staff/temporary-access/redeem', authRateLimit, async (req, res) => {
    const accessToken = String(req.body?.token || '')
    if (!/^[0-9a-f]{64}$/i.test(accessToken)) {
      return res.status(400).json({ message: 'A valid temporary access link is required.' })
    }

    try {
      const tokenHash = createHash('sha256').update(accessToken).digest('hex')
      const grant = await store.consumeStaffTemporaryAccessGrant?.(tokenHash)
      if (!grant) return res.status(401).json({ message: 'This temporary access link is invalid, expired, or already used.' })

      const user = grant.user
      const expiresAt = new Date(grant.expiresAt).getTime()
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return res.status(401).json({ message: 'This temporary access link has expired.' })
      }
      await writeAudit(user, 'staff.temporary_access.redeemed', 'user', user.id)

      const mfaEnabled = Boolean(user.mfaEnabled ?? user.mfa_enabled)
      const mfaSecret = user.mfaSecret || user.mfa_secret
      if (mfaEnabled && !mfaSecret) {
        await writeAudit(user, 'staff.temporary_access.mfa_unavailable', 'user', user.id)
        return res.status(503).json({ message: 'Authenticator verification is unavailable. Ask an administrator to issue a new link.' })
      }

      if (mfaEnabled) {
        const challengeToken = randomBytes(32).toString('hex')
        mfaChallenges.set(createHash('sha256').update(challengeToken).digest('hex'), {
          userId: user.id,
          expiresAt: Math.min(Date.now() + 5 * 60 * 1000, expiresAt),
          sessionExpiresAt: expiresAt,
          temporaryAccess: true,
        })
        return res.json({ requiresMfa: true, challengeToken })
      }

      const token = signToken(
        { sub: user.id, role: 'staff' },
        { expiresIn: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) },
      )
      return res.json({ token, user: sanitizeUserRecord({ ...user, role: 'staff' }) })
    } catch (error) {
      console.error('redeem staff temporary access failed', error)
      return res.status(500).json({ message: 'Unable to redeem temporary access.' })
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

      const mustChangePassword = Boolean(user.mustChangePassword ?? user.must_change_password)
      const updatedUser = await store.updateUser?.(user.id, {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      })
      await writeAudit(user, 'password.changed', 'user', user.id)
      if (mustChangePassword) {
        const role = String(user.role || 'resident').toLowerCase()
        return res.json({
          message: 'Temporary password changed successfully. You now have full portal access.',
          token: signToken({ sub: user.id, role }),
          user: sanitizeUserRecord({ ...updatedUser, mustChangePassword: false }),
        })
      }
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

  app.get('/api/social-integrations/status', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      verifyToken(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor || !isStaffOrAdminRole(actor.user.role)) {
        return res.status(403).json({ message: 'Staff access required.' })
      }
      return res.json({
        integrations: getMetaIntegrationStatus(),
        messengerLink: getMetaIntegrationStatus().messenger
          ? `https://m.me/${encodeURIComponent(process.env.META_PAGE_ID)}`
          : null,
      })
    } catch (error) {
      console.error('failed to load social integration status', error)
      return res.status(503).json({ message: 'Unable to load social integration status.' })
    }
  })

  app.post('/api/announcements', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor || !isStaffOrAdminRole(actor.user.role)) {
      return res.status(403).json({ message: 'Staff access required.' })
    }

    const title = sanitizeText(req.body?.title)
    const content = sanitizeText(req.body?.content)
    const date = sanitizeText(req.body?.date) || new Date().toLocaleDateString()
    const tag = sanitizeText(req.body?.tag) || 'green'
    const allowedChannels = new Set(['facebook', 'messenger'])
    const socialChannels = Array.isArray(req.body?.socialChannels)
      ? [...new Set(req.body.socialChannels.map((channel) => sanitizeText(channel).toLowerCase()))]
      : []

    if (socialChannels.some((channel) => !allowedChannels.has(channel))) {
      return res.status(400).json({ message: 'Only Facebook and Messenger announcement channels are supported.' })
    }
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and message are required.' })
    }
    const integrationStatus = getMetaIntegrationStatus()
    const unconfiguredChannel = socialChannels.find((channel) => !integrationStatus[channel])
    if (unconfiguredChannel) {
      return res.status(503).json({
        message: `${unconfiguredChannel === 'facebook' ? 'Facebook' : 'Messenger'} is not connected. Contact the system administrator.`,
      })
    }

    const announcement = {
      id: randomUUID(),
      tag,
      title,
      content,
      date,
      socialChannels,
      socialDelivery: {},
      createdAt: new Date().toISOString(),
    }

    try {
      const savedAnnouncement = await store.saveAnnouncement(announcement)
      const delivery = await deliverAnnouncementChannels(savedAnnouncement || announcement, socialChannels)
      const updatedAnnouncement = Object.keys(delivery).length
        ? await store.updateAnnouncement(announcement.id, { socialDelivery: delivery, facebookPostId: delivery.facebook?.postId })
        : savedAnnouncement || announcement
      return res.status(201).json({ announcement: updatedAnnouncement, socialDelivery: delivery })
    } catch (error) {
      console.error('failed to create announcement', error)
      return res.status(500).json({ message: 'Announcement could not be saved or its delivery status could not be recorded.' })
    }
  })

  app.delete('/api/announcements/:id', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor || !isStaffOrAdminRole(actor.user.role)) {
      return res.status(403).json({ message: 'Staff access required.' })
    }

    const targetId = req.params.id
    try {
      const announcement = await store.getAnnouncement(targetId)
      if (!announcement) return res.status(404).json({ message: 'Announcement not found.' })
      if (announcement.facebookPostId) {
        try {
          await deleteFacebookPost(announcement.facebookPostId)
        } catch (error) {
          console.error('Facebook announcement removal failed', error.message)
          return res.status(502).json({ message: `The Facebook post could not be deleted: ${error.message}` })
        }
      }
      const deletedAnnouncement = await store.deleteAnnouncement(targetId)
      if (!deletedAnnouncement) return res.status(404).json({ message: 'Announcement not found.' })
      return res.json({
        success: true,
        removedId: targetId,
        messengerMessagesCannotBeUnsent: Number(announcement.socialDelivery?.messenger?.sent) > 0,
      })
    } catch (error) {
      console.error('failed to delete announcement', error)
      return res.status(500).json({ message: 'Unable to delete announcement.' })
    }
  })

  app.post('/api/announcements/:id/retract', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor || !isStaffOrAdminRole(actor.user.role)) {
      return res.status(403).json({ message: 'Staff access required.' })
    }

    const content = sanitizeText(req.body?.content)
    if (!content) return res.status(400).json({ message: 'A correction message is required.' })

    try {
      const original = await store.getAnnouncement(req.params.id)
      if (!original) return res.status(404).json({ message: 'Announcement not found.' })
      if (original.retractionAnnouncementId) {
        return res.status(409).json({ message: 'A retraction has already been published for this announcement.' })
      }

      const channels = []
      if (original.facebookPostId) channels.push('facebook')
      if (Number(original.socialDelivery?.messenger?.sent) > 0) channels.push('messenger')
      const integrationStatus = getMetaIntegrationStatus()
      const unavailableChannel = channels.find((channel) => !integrationStatus[channel])
      if (unavailableChannel) {
        return res.status(503).json({
          message: `${unavailableChannel === 'facebook' ? 'Facebook' : 'Messenger'} is not connected. The retraction was not created.`,
        })
      }
      const retraction = {
        id: randomUUID(),
        tag: 'red',
        title: `Retraction: ${original.title}`.slice(0, 200),
        content,
        date: new Date().toLocaleDateString(),
        socialChannels: channels,
        socialDelivery: {},
        relatedAnnouncementId: original.id,
        createdAt: new Date().toISOString(),
      }
      const savedRetraction = await store.saveAnnouncement(retraction)
      const delivery = await deliverAnnouncementChannels(
        savedRetraction || retraction,
        channels,
        { recipientAnnouncementId: original.id },
      )
      const updatedRetraction = Object.keys(delivery).length
        ? await store.updateAnnouncement(retraction.id, { socialDelivery: delivery, facebookPostId: delivery.facebook?.postId })
        : savedRetraction || retraction
      await store.updateAnnouncement(original.id, { retractionAnnouncementId: retraction.id })
      return res.status(201).json({ announcement: updatedRetraction, socialDelivery: delivery })
    } catch (error) {
      console.error('failed to publish announcement retraction', error)
      return res.status(500).json({ message: 'Unable to publish the retraction.' })
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
      if (!actor || !isAdminRole(actor.user.role)) {
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
      const requests = actor.user.role === 'resident'
        ? await store.listRequestsForUser(actor.user.id)
        : await store.listAllRequests?.() || await store.listRequestsForUser(actor.user.id)
      return res.json({ requests })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/staff/requests', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['staff', 'admin']))) {
        return res.status(403).json({ message: 'Access denied for this role.' })
      }

      const requests = await store.listAllRequests?.() || []
      return res.json({ requests })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/staff/dashboard-requests', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    let payload
    try {
      payload = verifyToken(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (payload.purpose === 'mfa_pending') {
      return res.status(403).json({ message: 'Complete multi-factor authentication first.' })
    }

    let actor
    try {
      actor = await store.findUserById?.(payload.sub)
    } catch (error) {
      console.error('staff dashboard authorization lookup error', error)
      return res.status(500).json({ message: 'Unable to verify staff access.' })
    }
    if (!actor || !isStaffOrAdminRole(actor.role) || ['Suspended', 'Disabled'].includes(actor.status)) {
      return res.status(403).json({ message: 'Staff access required.' })
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

  app.get('/api/admin/users', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const actor = await getCurrentActor(token)
      if (!actor || !isAdminRole(actor.user.role) || ['Suspended', 'Disabled'].includes(actor.user.status)) {
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
      if (!actor || !isAdminRole(actor.user.role)) return res.status(403).json({ message: 'Admin access required.' })
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
          totalSuperAdmins: sanitizedUsers.filter((user) => user.role === 'super_admin').length,
          totalRequests: requests.length,
          pendingRequests: requests.filter((item) => ['Pending', 'In Review', 'Needs Information'].includes(item.status)).length,
        },
      })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/super-admin/monitoring', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor) return res.status(401).json({ message: 'Authentication required.' })
    if (!isSuperAdminRole(actor.user.role)) return res.status(403).json({ message: 'Super Admin access required.' })

    try {
      const [users, requests, auditLogs] = await Promise.all([
        store.listAllUsers?.() || [],
        store.listAllRequests?.() || [],
        store.listAuditLogs?.(10) || [],
      ])
      const visibleUsers = filterVisibleUsers(users)
      return res.json({
        summary: {
          totalResidents: visibleUsers.filter((user) => user.role === 'resident').length,
          totalStaff: visibleUsers.filter((user) => user.role === 'staff').length,
          totalAdmins: visibleUsers.filter((user) => user.role === 'admin').length,
          totalSuperAdmins: visibleUsers.filter((user) => user.role === 'super_admin').length,
          totalRequests: requests.length,
          pendingRequests: requests.filter((item) => ['Pending', 'In Review', 'Needs Information'].includes(item.status)).length,
        },
        recentActivity: auditLogs.map((entry) => ({
          action: entry.action,
          actorRole: entry.actorRole || entry.actor_role || 'unknown',
          createdAt: entry.createdAt || entry.created_at || null,
        })),
      })
    } catch (error) {
      console.error('super admin monitoring query failed', error)
      return res.status(500).json({ message: 'Unable to load Super Admin monitoring data.' })
    }
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
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      res.status(401).json({ message: 'Authentication required.' })
      return
    }

    let payload
    try {
      payload = verifyToken(token)
    } catch {
      res.status(401).json({ message: 'Invalid or expired token.' })
      return
    }
    if (payload.purpose === 'mfa_pending') {
      res.status(403).json({ message: 'Complete multi-factor authentication first.' })
      return
    }

    let actor
    try {
      actor = await store.findUserById?.(payload.sub)
    } catch (error) {
      console.error('staff report authorization lookup error', error)
      res.status(500).json({ message: 'Unable to verify staff access.' })
      return
    }
    if (!actor || !isStaffOrAdminRole(actor.role) || ['Suspended', 'Disabled'].includes(actor.status)) {
      res.status(403).json({ message: 'Staff access required.' })
      return
    }

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

  app.get('/api/staff/members', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      const actor = await store.findUserById?.(payload.sub)
      if (!actor || !isStaffOrAdminRole(actor.role) || ['Suspended', 'Disabled'].includes(actor.status)) {
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
      if (!actor || !['admin', 'staff'].includes(actor.user.role)) {
        return res.status(403).json({ message: 'Admin or Staff access required.' })
      }
      return await createPortalAccount(actor, 'staff', req, res)
    } catch (error) {
      console.error('failed to create staff member', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.post('/api/staff/presence', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor || actor.user.role !== 'staff') {
      return res.status(403).json({ message: 'Staff access required.' })
    }

    try {
      const lastSeen = new Date().toISOString()
      const updated = await store.updateUser?.(actor.user.id, { lastSeen })
      if (!updated) return res.status(404).json({ message: 'Staff account not found.' })
      return res.json({ ok: true, lastSeen })
    } catch (error) {
      console.error('failed to update staff presence', error)
      return res.status(500).json({ message: 'Unable to update staff presence.' })
    }
  })

  app.get('/api/admin/staff/presence', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor || !isAdminRole(actor.user.role)) {
      return res.status(403).json({ message: 'Administrator access required.' })
    }

    try {
      const staff = (await store.listAllUsers?.() || [])
        .filter((user) => user.role === 'staff')
        .map((user) => ({
          id: user.id,
          firstName: user.first_name || user.firstName,
          lastName: user.last_name || user.lastName,
          position: user.position || 'Staff',
          email: user.email,
          mobile: user.mobile,
          status: user.status,
          lastSeen: user.last_seen || user.lastSeen || null,
        }))
      return res.json({ staff })
    } catch (error) {
      console.error('failed to load staff presence', error)
      return res.status(500).json({ message: 'Unable to load staff presence.' })
    }
  })

  app.post('/api/admin/staff/:id/password', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }

    if (!actor || !isAdminRole(actor.user.role)) {
      return res.status(403).json({ message: 'Administrator access required.' })
    }

    const newPassword = String(req.body?.password || '').trim()
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ message: `Password must have ${passwordRequirements}.` })
    }

    try {
      const targetUser = await store.findUserById?.(req.params.id)
      if (!targetUser || targetUser.role !== 'staff') {
        return res.status(404).json({ message: 'Staff member not found.' })
      }

      const updatedUser = await store.updateUser?.(targetUser.id, { passwordHash: await hashPassword(newPassword) })
      if (!updatedUser) {
        return res.status(404).json({ message: 'Staff member not found.' })
      }

      await writeAudit(actor.user, 'staff.password_reset', 'user', targetUser.id, { email: targetUser.email })
      return res.json({ ok: true })
    } catch (error) {
      console.error('failed to reset staff password', error)
      return res.status(500).json({ message: 'Unable to reset staff password.' })
    }
  })

  app.post('/api/admin/staff/:id/temporary-access', authRateLimit, async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    let actor
    try {
      actor = await getCurrentActor(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    if (!actor) return res.status(401).json({ message: 'Authentication required.' })
    if (actor.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required.' })

    const deliveryUrl = process.env.RESET_DELIVERY_URL || process.env.NOTIFICATION_WEBHOOK_URL
    if (!deliveryUrl) {
      return res.status(503).json({ message: 'Temporary access email delivery is not configured.' })
    }

    let publicAppUrl
    try {
      const parsedUrl = new URL(process.env.PUBLIC_APP_URL || 'https://barangay-legaspi.vercel.app')
      if (
        parsedUrl.protocol !== 'https:'
        || parsedUrl.username
        || parsedUrl.password
        || parsedUrl.pathname !== '/'
        || parsedUrl.search
        || parsedUrl.hash
      ) {
        return res.status(503).json({ message: 'The official portal URL is not configured correctly.' })
      }
      publicAppUrl = parsedUrl.origin
    } catch {
      return res.status(503).json({ message: 'The official portal URL is not configured correctly.' })
    }

    let targetUser
    try {
      targetUser = await store.findUserById?.(req.params.id)
    } catch (error) {
      console.error('load staff temporary-access target failed', error)
      return res.status(500).json({ message: 'Unable to load the staff account.' })
    }
    if (!targetUser || targetUser.role !== 'staff' || ['Suspended', 'Disabled'].includes(targetUser.status)) {
      return res.status(404).json({ message: 'Active staff account not found.' })
    }
    if (!isValidEmail(targetUser.email)) {
      return res.status(409).json({ message: 'The staff account does not have a valid email address.' })
    }

    const accessToken = randomBytes(32).toString('hex')
    const now = Date.now()
    const expiresAt = new Date(now + 15 * 60 * 1000).toISOString()
    const grantId = randomUUID()
    let grantCreated = false
    try {
      const result = await store.createStaffTemporaryAccessGrant?.({
        id: grantId,
        userId: targetUser.id,
        tokenHash: createHash('sha256').update(accessToken).digest('hex'),
        issuedBy: actor.user.id,
        issuedAt: new Date(now).toISOString(),
        expiresAt,
      })
      if (result?.status !== 'created') {
        return res.status(409).json({ message: 'The staff account is no longer eligible for temporary access.' })
      }
      grantCreated = true

      const delivery = await sendDeliveryWebhook({
        event: 'staff_temporary_access',
        recipient: targetUser.email,
        token: accessToken,
        expiresAt,
        user: targetUser,
        title: 'Temporary staff portal access',
        message: 'Use the secure link to sign in to the staff portal. It can be used once and expires in 15 minutes.',
        metadata: {
          actionUrl: `${publicAppUrl}/staff-access#${accessToken}`,
          expiresInMinutes: 15,
        },
      })
      if (!delivery.queued) {
        await store.revokeStaffTemporaryAccessGrant?.(grantId)
        grantCreated = false
        return res.status(503).json({ message: 'Temporary access email delivery is unavailable.' })
      }

      await writeAudit(actor.user, 'staff.temporary_access.issued', 'user', targetUser.id, {
        recipient: targetUser.email,
        expiresAt,
        deliveryStatus: delivery.deliveryStatus,
      })
      return res.status(202).json({ message: 'Temporary access email queued.', expiresAt })
    } catch (error) {
      if (grantCreated) {
        try {
          await store.revokeStaffTemporaryAccessGrant?.(grantId)
        } catch (revokeError) {
          console.error('revoke undelivered staff temporary-access grant failed', revokeError)
        }
      }
      console.error('issue staff temporary access failed', error)
      return res.status(502).json({ message: 'Unable to deliver temporary access. No access link was activated.' })
    }
  })

  app.post('/api/admin/users', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || actor.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      return await createPortalAccount(actor, 'admin', req, res)
    } catch (error) {
      console.error('failed to create admin user', error)
      return res.status(401).json({ message: 'Invalid or expired token.' })
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
      if (!actor || !isAdminRole(actor.user.role) || ['Suspended', 'Disabled'].includes(actor.user.status)) {
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
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['staff', 'admin']))) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

      const rawDays = req.body?.days
      const missingRetention = rawDays === undefined
        || rawDays === null
        || (typeof rawDays === 'string' && rawDays.trim() === '')
      const days = missingRetention ? 30 : Number(rawDays)
      if ((!missingRetention && !['number', 'string'].includes(typeof rawDays)) || !Number.isInteger(days) || days < 0) {
        return res.status(400).json({ message: 'Retention days must be a non-negative whole number.' })
      }
      if (typeof store.archiveProcessedRequestsOlderThan !== 'function') {
        throw new Error('Processed request archiving is not available for the configured storage backend.')
      }
      const result = await store.archiveProcessedRequestsOlderThan(days)
      return res.json({ archive: result })
    } catch (e) {
      console.error('archive-requests error', e)
      return res.status(500).json({ message: 'Failed to archive queue and approval records.' })
    }
  })

  app.get('/api/staff/archives', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['staff', 'admin']))) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

      const actor = await getCurrentActor(token)
      const archives = await store.listArchives?.() || []
      const visibleArchives = actor && isAdminRole(actor.user.role)
        ? archives
        : archives.filter((archive) => archive.name.startsWith('queue-approvals-'))
      return res.json({ archives: visibleArchives })
    } catch (e) {
      console.error('list staff archives error', e)
      return res.status(500).json({ message: 'Unable to load staff archives.' })
    }
  })

  app.get('/api/staff/archive-file', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || !isStaffOrAdminRole(actor.user.role) || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

      const name = req.query.name
      if (!name || typeof name !== 'string' || name.includes('..') || !/^[\w\-.]+$/.test(name)) {
        return res.status(400).json({ message: 'Invalid file name.' })
      }
      if (!isAdminRole(actor.user.role) && !name.startsWith('queue-approvals-')) {
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
      if (!actor || !isAdminRole(actor.user.role) || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Admin access required.' })
      }

      const existingUser = await store.findUserById?.(req.params.id)
      if (!existingUser) {
        return res.status(404).json({ message: 'User not found.' })
      }
      if (existingUser.role === 'super_admin' && !isSuperAdminRole(actor.user.role)) {
        return res.status(403).json({ message: 'Only a Super Admin can update a Super Admin account.' })
      }

      const nextRole = sanitizeText(req.body?.role || '').toLowerCase() || existingUser.role || 'resident'
      if (!['resident', 'staff', 'admin', 'super_admin'].includes(nextRole)) {
        return res.status(400).json({ message: 'Invalid role.' })
      }
      if (nextRole !== existingUser.role) {
        return res.status(403).json({ message: 'Account roles can only be changed by an authorized deployment operator.' })
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
      if (!actor || !isAdminRole(actor.user.role)) {
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

      try {
        await writeAudit(actor.user, 'resident.archived', 'user', resident.id, {
          previousStatus: resident.status || null,
        })
      } catch (error) {
        console.error('resident archived but audit log failed', error)
        return res.status(500).json({
          message: 'Resident account was archived, but the audit log could not be recorded. Refresh and verify the account status before retrying.',
          archived: true,
          user: sanitizeUserRecord(updatedUser),
        })
      }
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
      const accessUsers = users.map((user) => ({
        id: user.id,
        firstName: user.firstName ?? user.first_name ?? '',
        lastName: user.lastName ?? user.last_name ?? '',
        zone: user.zone ?? user.zone_number ?? null,
        createdAt: user.createdAt ?? user.created_at ?? null,
      }))
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
      return res.json({ user: sanitizeUserRecord(user) })
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
      verifyToken(token)
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
    try {
      if (!(await hasCurrentRole(token, ['admin']))) return res.status(403).json({ message: 'Admin access required.' })
      const rawDays = req.body?.days
      const days = rawDays === undefined || rawDays === null || rawDays === '' ? 30 : Number(rawDays)
      if (!Number.isInteger(days) || days < 0) {
        return res.status(400).json({ message: 'Retention days must be a non-negative whole number.' })
      }
      if (typeof store.archiveApprovalsOlderThan !== 'function') {
        throw new Error('Approval archiving is not available for the configured storage backend.')
      }
      const result = await store.archiveApprovalsOlderThan(days)
      return res.json({ archive: result })
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
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    try {
      const payload = verifyToken(token)
      const actor = await store.findUserById?.(payload.sub)
      if (!actor || !isStaffOrAdminRole(actor.role) || ['Suspended', 'Disabled'].includes(actor.status)) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

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
          approvedBy: payload.sub,
          approvedByRole: payload.role,
          dateApproved: new Date().toISOString(),
          requestSnapshot: updated,
        }
        try {
          await store.addApproval?.(approval)
          const archived = await store.archiveApprovalsOlderThan?.(30)
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
        return res.status(403).json({ message: 'Your account is pending barangay verification. You can submit requests after an administrator approves your account.' })
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
    if (process.env.DATABASE_URL) {
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
