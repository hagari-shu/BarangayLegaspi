import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { closeDatabase, createStaffInvitation } from '../server/db-postgres.js'

const inviteAppUrl = process.env.STAFF_INVITE_APP_URL
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error('Set DATABASE_URL to the PostgreSQL database used by the deployed Node API.')
}
if (!inviteAppUrl) {
  throw new Error('Set STAFF_INVITE_APP_URL to the HTTPS base URL of the deployed web app.')
}

const appUrl = new URL(inviteAppUrl)
if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password || appUrl.search || appUrl.hash) {
  throw new Error('STAFF_INVITE_APP_URL must be an HTTPS URL without credentials, query parameters, or a fragment.')
}
const baseUrl = inviteAppUrl.replace(/\/+$/, '')

const prompt = createInterface({ input: stdin, output: stdout })
try {
  const operatorId = (await prompt.question('Authorized operator identifier (recorded in the audit log): ')).trim()
  const email = (await prompt.question('Staff email: ')).trim().toLowerCase()
  const mobile = (await prompt.question('Staff mobile (09xxxxxxxxx): ')).trim()
  if (!operatorId || operatorId.length > 100 || !/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(email) || !/^09\d{9}$/.test(mobile)) {
    throw new Error('Enter an operator identifier, a valid email address, and a Philippine mobile number.')
  }

  console.log('This will create a single-use staff invitation, valid for 24 hours.')
  const confirmation = await prompt.question('Type ISSUE STAFF INVITATION to continue: ')
  if (confirmation !== 'ISSUE STAFF INVITATION') {
    throw new Error('Invitation creation cancelled.')
  }

  const token = randomBytes(32).toString('base64url')
  const createdAt = new Date().toISOString()
  const invitation = {
    id: randomUUID(),
    tokenHash: createHash('sha256').update(token).digest('hex'),
    email,
    mobile,
    operatorId,
    createdAt,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }

  try {
    await createStaffInvitation(invitation)
  } catch (error) {
    if (error.message === 'STAFF_INVITATION_ACCOUNT_EXISTS') {
      throw new Error('An account already uses this email or mobile number; no invitation was created.')
    }
    if (error.message === 'STAFF_INVITATION_ALREADY_PENDING') {
      throw new Error('A pending invitation already exists for this email or mobile number.')
    }
    if (error.message === 'STAFF_INVITATION_IDENTITY_CONFLICT') {
      throw new Error('An account or pending invitation already uses this email or mobile number.')
    }
    throw error
  }

  console.log('\nInvitation link (displayed once; deliver it securely out of band):')
  console.log(`${baseUrl}/staff-invite#${token}`)
  console.log(`Expires: ${invitation.expiresAt}`)
} finally {
  prompt.close()
  await closeDatabase()
}
