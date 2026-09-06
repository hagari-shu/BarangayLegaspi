import express from 'express'
import cors from 'cors'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { comparePassword, hashPassword, signToken, verifyToken } from './auth.js'
import * as jsonDb from './db.js'
import * as pgDb from './db-postgres.js'
import { PORT } from './config.js'
import fs from 'node:fs'
import path from 'node:path'

const store = process.env.DATABASE_URL ? pgDb : jsonDb

const sanitizeText = (value = '') => String(value).replace(/[<>]/g, '').trim()
const sanitizeUserRecord = (user = {}) => {
  if (!user || typeof user !== 'object') return {}
  const { password, passwordHash, password_hash, ...safeUser } = user
  return { ...safeUser, role: safeUser.role || safeUser.userRole || 'resident' }
}

const isValidEmail = (value) => /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(String(value).trim())
const isValidMobile = (value) => /^09\d{9}$/.test(String(value).trim())
const isValidPassword = (value) => {
  const password = String(value).trim()
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9\s]/.test(password)
}
const passwordRequirements = 'at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character'
const serviceCatalog = [
  { icon: '📄', title: 'Barangay Certificate', subtitle: 'Request and claim', tone: 'green' },
  { icon: '🏥', title: 'Health Assistance', subtitle: 'Access public health support', tone: 'blue' },
  { icon: '🧾', title: 'Barangay Clearance', subtitle: 'Update and renew', tone: 'amber' },
  { icon: '🚨', title: 'Emergency Help', subtitle: 'Call for immediate support', tone: 'red' },
]

const announcements = [
  { tag: 'green', title: 'Free vaccination schedule', date: 'June 18 • 8:00 AM', content: 'Vaccination drive for all residents. Come to the barangay hall.' },
  { tag: 'amber', title: 'Senior citizen ID renewal', date: 'June 20 • 9:00 AM', content: 'Senior citizens are encouraged to renew their IDs.' },
  { tag: 'blue', title: 'Clean-up drive reminder', date: 'June 25 • 7:00 AM', content: 'Community clean-up drive scheduled for next Saturday.' },
  { tag: 'red', title: 'Emergency hotline now active', date: 'August 29 • 3:30 PM', content: 'Emergency hotline is available 24/7 for all barangay residents.' },
]

const residentEvents = [
  { title: 'Barangay health drive', date: '2026-09-05', location: 'Covered Court' },
  { title: 'Tree planting program', date: '2026-09-12', location: 'Barangay Park' },
  { title: 'Senior citizen support session', date: '2026-09-18', location: 'Barangay Hall' },
]

const paymentRecords = [
  { id: 'INV-1042', label: 'Barangay permit', status: 'Paid', amount: '₱250.00' },
  { id: 'INV-1049', label: 'Medical assistance', status: 'Pending', amount: '₱1,200.00' },
  { id: 'INV-1056', label: 'Community fee', status: 'Paid', amount: '₱180.00' },
]
export async function seedDemoResident() {
  if (process.env.DATABASE_URL) {
    await pgDb.initDatabase()
    return
  }

  const db = await jsonDb.readDb()

  const demoNonAdminIdentifiers = new Set([
    'maria.delacruz@email.com',
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
      } else if (user.email === 'admin@barangay.gov.ph' || user.mobile === '09999999999') {
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

  const requiredSeeds = [
    {
      firstName: 'Carmen',
      lastName: 'Santos',
      mobile: '09999999999',
      email: 'admin@barangay.gov.ph',
      password: 'AdminPass123',
      role: 'admin',
      householdId: '2024-ADMIN',
      familyMembers: 1,
      status: 'Administrator',
      address: 'Barangay Hall, Legaspi',
      zone: 0,
    },
  ]

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
  app.disable('x-powered-by')

  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean)
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || /^https?:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin)) {
        return callback(null, true)
      }
      return callback(new Error('Origin not allowed'))
    },
  }))
  app.use(express.json({ limit: '100kb' }))

  const getCurrentActor = async (token) => {
    const payload = verifyToken(token)
    const user = await store.findUserById?.(payload.sub)
    return user ? { payload, user } : null
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

  const authAttempts = new Map()
  const resetTokens = new Map()
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

  app.get('/api/health', async (_req, res) => {
    try {
      if (process.env.DATABASE_URL) {
        await pgDb.query('SELECT 1')
      }
      res.json({ ok: true, message: 'Barangay Legaspi API is running' })
    } catch (error) {
      console.error('health check failed', error)
      res.status(503).json({ ok: false, message: 'Database unavailable.' })
    }
  })

  app.post('/api/register', authRateLimit, async (req, res) => {
    try {
      const firstName = sanitizeText(req.body?.firstName)
      const lastName = sanitizeText(req.body?.lastName)
      const mobile = sanitizeText(req.body?.mobile)
      const email = sanitizeText(req.body?.email).toLowerCase()
      const password = sanitizeText(req.body?.password)

      if (!firstName || !lastName || !mobile || !email || !password) {
        return res.status(400).json({ message: 'Please complete all required fields.' })
      }

      if (!isValidMobile(mobile) || !isValidEmail(email) || !isValidPassword(password)) {
        return res.status(400).json({ message: `Please enter a valid mobile number, email, and password with ${passwordRequirements}.` })
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
        address: 'Barangay Legaspi, Tayug, Pangasinan',
        createdAt: new Date().toISOString(),
      }

      await store.saveUser(user)
      await writeAudit(null, 'user.registered', 'user', user.id, { status: user.status })

      const { passwordHash, ...safeUser } = user

      return res.status(201).json({
        message: 'Account created and is awaiting administrator approval.',
        requiresApproval: true,
        user: safeUser,
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

      const user = await store.findUserByIdentifier(identifier)
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials.' })
      }

      const isValid = await comparePassword(password, user.passwordHash || user.password_hash)
      if (!isValid) {
        return res.status(401).json({ message: 'Invalid credentials.' })
      }

      if (user.role === 'resident' && user.status !== 'Active Resident') {
        return res.status(403).json({ message: 'Your account is awaiting administrator approval before you can access the web app.' })
      }

      const normalizedRole = user.role || 'resident'
      const token = signToken({ sub: user.id, role: normalizedRole })
      const safeUser = sanitizeUserRecord({ ...user, role: normalizedRole })

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

      if (process.env.RESET_DELIVERY_URL) {
        const deliveryResponse = await fetch(process.env.RESET_DELIVERY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, token, expiresAt }),
        })
        if (!deliveryResponse.ok) throw new Error('Reset delivery failed')
        return res.json({ message: genericMessage })
      }

      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ message: 'Password reset delivery is not configured. Please contact the barangay office.' })
      }

      return res.json({ message: 'Development reset token generated.', resetToken: token })
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
      const payload = verifyToken(token)
      const user = await store.findUserById(payload.sub)
      if (!user) {
        return res.status(401).json({ message: 'User not found.' })
      }

      const requests = user.role === 'resident'
        ? await store.listRequestsForUser(payload.sub)
        : await store.listAllRequests?.() || []

      return res.json({
        services: serviceCatalog,
        announcements,
        events: residentEvents,
        payments: paymentRecords,
        summary: {
          totalRequests: requests.length,
          pending: requests.filter((item) => item.status !== 'Approved').length,
          activeCases: requests.filter((item) => item.status === 'Pending').length,
          nextEvent: residentEvents[0],
        },
        user: sanitizeUserRecord(user),
      })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/services', (_req, res) => {
    return res.json({ services: serviceCatalog })
  })

  app.get('/api/announcements', async (_req, res) => {
    try {
      const storedAnnouncements = await store.listAnnouncements?.() || []

      if (storedAnnouncements.length === 0) {
        for (const [index, item] of announcements.entries()) {
          await store.saveAnnouncement?.({ id: randomUUID(), ...item, createdAt: new Date(Date.now() - index * 1000).toISOString() })
        }
        return res.json({ announcements: await store.listAnnouncements?.() || announcements })
      }

      return res.json({ announcements: storedAnnouncements })
    } catch (error) {
      console.error('failed to load announcements', error)
      return res.json({ announcements })
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

      if (!title || !content) {
        return res.status(400).json({ message: 'Title and message are required.' })
      }

      const announcement = {
        id: randomUUID(),
        tag,
        title,
        content,
        date,
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
    return res.json({ events: residentEvents })
  })

  app.get('/api/payments', (_req, res) => {
    return res.json({ payments: paymentRecords })
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

      const users = await store.listAllUsers?.() || []
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
          pendingRequests: requests.filter((item) => item.status === 'Pending').length,
        },
      })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
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
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['staff', 'admin']))) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

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
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const payload = verifyToken(token)
      if (!(await hasCurrentRole(token, ['staff', 'admin']))) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

      const archivesDir = path.join(process.cwd(), 'server', 'data', 'archives')
      try {
        const files = await fs.promises.readdir(archivesDir)
        const actor = await getCurrentActor(token)
        const visibleFiles = actor?.user.role === 'admin' ? files : files.filter((file) => file.startsWith('queue-approvals-'))
        const list = await Promise.all(visibleFiles.map(async (file) => {
          const stat = await fs.promises.stat(path.join(archivesDir, file))
          return { name: file, size: stat.size, mtime: stat.mtime.toISOString() }
        }))
        list.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))
        return res.json({ archives: list })
      } catch (e) {
        return res.json({ archives: [] })
      }
    } catch (e) {
      console.error('list staff archives error', e)
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  app.get('/api/staff/archive-file', async (req, res) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    try {
      const actor = await getCurrentActor(token)
      if (!actor || !['staff', 'admin'].includes(actor.user.role) || ['Suspended', 'Disabled'].includes(actor.user.status)) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

      const name = req.query.name
      if (!name || typeof name !== 'string' || name.includes('..') || !/^[\w\-.]+$/.test(name)) {
        return res.status(400).json({ message: 'Invalid file name.' })
      }
      if (actor.user.role !== 'admin' && !name.startsWith('queue-approvals-')) {
        return res.status(403).json({ message: 'This archive is not available to staff.' })
      }

      const archivesDir = path.join(process.cwd(), 'server', 'data', 'archives')
      const filePath = path.join(archivesDir, name)
      try {
        const stat = await fs.promises.stat(filePath)
        if (!stat.isFile()) return res.status(404).json({ message: 'File not found.' })
      } catch (e) {
        return res.status(404).json({ message: 'File not found.' })
      }

      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
      const stream = fs.createReadStream(filePath)
      stream.pipe(res)
      stream.on('error', (err) => {
        console.error('staff archive-file stream error', err)
        try { res.status(500).end() } catch (err2) {}
      })
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

      const archivesDir = path.join(process.cwd(), 'server', 'data', 'archives')
      const filePath = path.join(archivesDir, name)
      try {
        await fs.promises.access(filePath)
      } catch (e) {
        return res.status(404).json({ message: 'File not found.' })
      }

      await fs.promises.rm(filePath, { force: true })
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
      const nextAddress = sanitizeText(req.body?.address || existingUser.address || '')
      const nextHouseholdId = sanitizeText(req.body?.householdId || existingUser.householdId || existingUser.household_id || '') || null
      const nextFamilyMembers = req.body?.familyMembers === undefined ? (existingUser.familyMembers ?? existingUser.family_members ?? 4) : Number(req.body.familyMembers)

      if (!nextFirstName || !nextLastName) {
        return res.status(400).json({ message: 'First name and last name are required.' })
      }

      if (nextEmail && !isValidEmail(nextEmail)) {
        return res.status(400).json({ message: 'Please enter a valid email.' })
      }

      if (nextMobile && !isValidMobile(nextMobile)) {
        return res.status(400).json({ message: 'Please enter a valid mobile number.' })
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
      })

      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found.' })
      }

      await writeAudit(actor.user, 'user.updated', 'user', updatedUser.id, { status: updatedUser.status, role: updatedUser.role })
      return res.json({ user: sanitizeUserRecord(updatedUser) })
    } catch (error) {
      console.error('admin update user error', error)
      return res.status(500).json({ message: 'Unable to update user details.' })
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
      const archivesDir = path.join(process.cwd(), 'server', 'data', 'archives')
      await fs.promises.mkdir(archivesDir, { recursive: true })

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
        const filePath = path.join(archivesDir, filename)
        await fs.promises.writeFile(filePath, JSON.stringify({ archivedAt: new Date().toISOString(), zone, total: zoneUsers.length, users: zoneUsers }, null, 2), 'utf8')
        archiveList.push({ zone, filename, count: zoneUsers.length, filePath })
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

      const users = await store.listAllUsers?.() || []
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

      const db = await store.readDb?.()
      const reports = db?.reports || [
        {
          id: 'RPT-001',
          type: 'Emergency',
          title: 'Fire Incident',
          description: 'Minor house fire reported in Zone 3',
          date: '2026-08-28 10:30 AM',
          severity: 'High',
          status: 'Resolved',
          zone: 3,
        },
        {
          id: 'RPT-002',
          type: 'Health',
          title: 'Medical Assistance Request',
          description: 'Senior citizen assisted with first aid',
          date: '2026-08-27 2:15 PM',
          severity: 'Medium',
          status: 'Completed',
          zone: 1,
        },
      ]

      return res.json({ reports })
    } catch {
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

      const db = await store.readDb?.()
      if (db) {
        db.reports = db.reports || []
        db.reports.push(report)
        await store.writeDb?.(db)
      }

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

      const users = await store.listAllUsers?.() || []
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

      const archivesDir = path.join(process.cwd(), 'server', 'data', 'archives')
      try {
        const files = await fs.promises.readdir(archivesDir)
        const list = await Promise.all(files.map(async (file) => {
          const stat = await fs.promises.stat(path.join(archivesDir, file))
          return { name: file, size: stat.size, mtime: stat.mtime.toISOString() }
        }))
        // newest first
        list.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))
        return res.json({ archives: list })
      } catch (e) {
        // if directory does not exist or no files, return empty list
        return res.json({ archives: [] })
      }
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

      const archivesDir = path.join(process.cwd(), 'server', 'data', 'archives')
      const filePath = path.join(archivesDir, name)
      try {
        const stat = await fs.promises.stat(filePath)
        if (!stat.isFile()) return res.status(404).json({ message: 'File not found.' })
      } catch (e) {
        return res.status(404).json({ message: 'File not found.' })
      }

      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
      const stream = fs.createReadStream(filePath)
      stream.pipe(res)
      stream.on('error', (err) => {
        console.error('archive-file stream error', err)
        try { res.status(500).end() } catch (e) {}
      })
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

      const archivesDir = path.join(process.cwd(), 'server', 'data', 'archives')
      const filePath = path.join(archivesDir, name)
      try {
        await fs.promises.access(filePath)
      } catch (e) {
        return res.status(404).json({ message: 'File not found.' })
      }

      await fs.promises.rm(filePath, { force: true })
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
      if (!actor || !['staff', 'admin'].includes(actor.role) || ['Suspended', 'Disabled'].includes(actor.status)) {
        return res.status(403).json({ message: 'Staff access required.' })
      }

      const status = sanitizeText(req.body?.status)
      if (!['Pending', 'Approved', 'Rejected', 'In Review'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status value.' })
      }

      const existingRequest = (await store.listAllRequests?.() || []).find((request) => request.id === req.params.id)
      if (!existingRequest) {
        return res.status(404).json({ message: 'Request not found.' })
      }

      const allowedTransitions = {
        Pending: ['In Review', 'Approved', 'Rejected'],
        'In Review': ['Approved', 'Rejected'],
        Approved: [],
        Rejected: [],
      }
      if (!allowedTransitions[existingRequest.status].includes(status)) {
        return res.status(409).json({ message: `Cannot change a ${existingRequest.status} request to ${status}.` })
      }

      if (status === 'Approved') {
        const existingApprovals = await store.listApprovals?.() || []
        if (existingApprovals.some((approval) => approval.requestId === req.params.id)) {
          return res.status(409).json({ message: 'This request has already been approved.' })
        }
      }

      const updated = await store.updateRequestStatus?.(req.params.id, status)
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
      const payload = verifyToken(token)
      const user = await store.findUserById(payload.sub)
      if (!user) {
        return res.status(401).json({ message: 'User not found.' })
      }
      if (user.role === 'resident' && user.status !== 'Active Resident') {
        return res.status(403).json({ message: 'Your account is pending barangay verification. You can submit requests after an administrator approves your account.' })
      }

      const type = sanitizeText(req.body?.type)
      const purpose = sanitizeText(req.body?.purpose)
      const notes = sanitizeText(req.body?.notes)

      if (!type || !purpose) {
        return res.status(400).json({ message: 'Request type and purpose are required.' })
      }

      const request = {
        id: randomUUID(),
        userId: payload.sub,
        type,
        purpose,
        notes,
        status: 'Pending',
        date: new Date().toISOString(),
      }

      await store.saveRequest(request)
      return res.status(201).json({ request })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }
  })

  return app
}

export async function startServer() {
  if (process.env.SKIP_SEED !== 'true') {
    await seedDemoResident()
  }
  const app = createApp()
  return app.listen(PORT, () => {
    console.log(`Barangay API running on http://localhost:${PORT}`)
  })
}
