import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp, seedDemoResident } from '../server/app.js'
import { DB_PATH } from '../server/config.js'
import * as jsonDb from '../server/db.js'
import { hashStaffInvitationToken, issueStaffInvitation } from '../server/staff-invitations.js'

beforeEach(async () => {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true })
  await fs.writeFile(DB_PATH, JSON.stringify({ users: [], requests: [], announcements: [], reports: [], approvals: [], auditLogs: [] }), 'utf8')
  await seedDemoResident()
})

async function startTestServer() {
  const server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  }
}

async function createInvitation(email = 'staff.invitee@example.test', now = new Date(), position = 'Staff') {
  const result = await issueStaffInvitation({
    email,
    position,
    publicAppUrl: 'https://barangay-legaspi.vercel.app',
    store: jsonDb,
    now,
  })
  assert.equal(result.status, 'created')
  const inviteUrl = new URL(result.inviteUrl)
  return { ...result, token: new URLSearchParams(inviteUrl.hash.slice(1)).get('token') }
}

test('staff invitations preserve the assigned position and user-chosen password, audit redemption, and reject replay', async () => {
  const invitation = await createInvitation('staff.invitee@example.test', new Date(), 'Secretary')
  const storedBeforeAcceptance = await jsonDb.readDb()
  assert.equal(storedBeforeAcceptance.staffInvitations[0].tokenHash.length, 64)
  assert.equal(storedBeforeAcceptance.staffInvitations[0].tokenHash.includes(invitation.token), false)
  assert.equal(storedBeforeAcceptance.auditLogs[0].action, 'staff.invitation.issued')
  assert.equal(storedBeforeAcceptance.auditLogs[0].metadata.email, undefined)

  const { server, baseUrl } = await startTestServer()
  try {
    assert.equal(new URL(invitation.inviteUrl).search, '')
    const lookup = await fetch(`${baseUrl}/api/staff/invitations/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invitation.token }),
    })
    assert.equal(lookup.status, 200)
    assert.equal(lookup.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await lookup.json(), {
      email: 'staff.invitee@example.test',
      expiresAt: invitation.expiresAt,
    })

    const accepted = await fetch(`${baseUrl}/api/staff/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: invitation.token,
        firstName: 'Ana',
        lastName: 'Santos',
        mobile: '09170000001',
        password: 'Staff!Password2026',
      }),
    })
    assert.equal(accepted.status, 201)
    assert.deepEqual(await accepted.json(), { message: 'Staff account created. You can now sign in.' })

    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'staff.invitee@example.test',
        password: 'Staff!Password2026',
      }),
    })
    assert.equal(login.status, 200)
    assert.equal((await login.json()).user.role, 'staff')

    const replay = await fetch(`${baseUrl}/api/staff/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: invitation.token,
        firstName: 'Ana',
        lastName: 'Santos',
        mobile: '09170000002',
        password: 'Staff!Password2026',
      }),
    })
    assert.equal(replay.status, 410)

    const storedAfterAcceptance = await jsonDb.readDb()
    const staffUser = storedAfterAcceptance.users.find((user) => user.email === 'staff.invitee@example.test')
    assert.equal(staffUser.role, 'staff')
    assert.equal(staffUser.position, 'Secretary')
    assert.notEqual(staffUser.passwordHash, 'Staff!Password2026')
    assert.equal(staffUser.password, undefined)
    assert.equal(storedAfterAcceptance.staffInvitations[0].acceptedAt !== undefined, true)
    assert.equal(storedAfterAcceptance.auditLogs.at(-1).action, 'staff.invitation.accepted')
    assert.equal(storedAfterAcceptance.auditLogs.at(-1).targetId, staffUser.id)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('staff invitations expire after twelve hours and are replaced without exposing the token in storage', async () => {
  const issuedAt = new Date('2026-10-17T00:00:00.000Z')
  const expired = await createInvitation('expired.invitee@example.test', new Date(issuedAt.getTime() - 13 * 60 * 60 * 1000))
  assert.equal(expired.expiresAt, '2026-10-16T23:00:00.000Z')

  const { server, baseUrl } = await startTestServer()
  try {
    const response = await fetch(`${baseUrl}/api/staff/invitations/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expired.token }),
    })
    assert.equal(response.status, 410)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  const first = await createInvitation('replace.invitee@example.test')
  const second = await createInvitation('replace.invitee@example.test')
  assert.notEqual(first.token, second.token)
  const stored = await jsonDb.readDb()
  assert.ok(stored.staffInvitations.find((entry) => entry.tokenHash === hashStaffInvitationToken(first.token))?.revokedAt)
})

test('duplicate email and mobile conflicts do not consume a valid staff invitation', async () => {
  const duplicateEmail = await issueStaffInvitation({
    email: 'admin@barangay.gov.ph',
    publicAppUrl: 'https://barangay-legaspi.vercel.app',
    store: jsonDb,
  })
  assert.equal(duplicateEmail.status, 'account_exists')

  const invitation = await createInvitation()
  const { server, baseUrl } = await startTestServer()
  try {
    const conflict = await fetch(`${baseUrl}/api/staff/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: invitation.token,
        firstName: 'Ana',
        lastName: 'Santos',
        mobile: '09123456789',
        password: 'Staff!Password2026',
      }),
    })
    assert.equal(conflict.status, 409)

    const retry = await fetch(`${baseUrl}/api/staff/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: invitation.token,
        firstName: 'Ana',
        lastName: 'Santos',
        mobile: '09170000003',
        password: 'Staff!Password2026',
      }),
    })
    assert.equal(retry.status, 201)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('resident registration cannot claim an email with a pending staff invitation', async () => {
  const invitation = await createInvitation('reserved.invitee@example.test')
  const { server, baseUrl } = await startTestServer()
  try {
    const response = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Ana',
        lastName: 'Santos',
        mobile: '09170000021',
        email: 'reserved.invitee@example.test',
        password: 'Resident!Password2026',
        address: 'Legaspi',
        zone: 1,
      }),
    })
    assert.equal(response.status, 409)

    const stored = await jsonDb.readDb()
    assert.equal(stored.users.some((user) => user.email === 'reserved.invitee@example.test'), false)
    assert.equal(stored.staffInvitations[0].tokenHash, hashStaffInvitationToken(invitation.token))
    assert.equal(stored.staffInvitations[0].revokedAt, undefined)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('resident registration and staff invitation issuance serialize on email', async () => {
  const now = new Date().toISOString()
  const resident = {
    id: '00000000-0000-4000-8000-000000000120',
    firstName: 'Ana',
    lastName: 'Santos',
    mobile: '09170000022',
    email: 'race.invitee@example.test',
    passwordHash: 'hashed',
    role: 'resident',
    householdId: '2026-TEST',
    familyMembers: 1,
    householdMembers: [],
    status: 'Pending Verification',
    address: 'Legaspi',
    zone: 1,
    createdAt: now,
  }
  const registration = jsonDb.registerResident(resident, {
    id: 'audit-registration-race',
    actorRole: null,
    action: 'user.registered',
    targetType: 'user',
    targetId: resident.id,
    metadata: { status: resident.status },
  })
  const invitation = issueStaffInvitation({
    email: resident.email,
    publicAppUrl: 'https://barangay-legaspi.vercel.app',
    store: jsonDb,
  })
  const [registrationResult, invitationResult] = await Promise.all([registration, invitation])

  assert.ok(
    (registrationResult.status === 'created' && invitationResult.status === 'account_exists')
    || (registrationResult.status === 'invitation_pending' && invitationResult.status === 'created'),
  )
})

test('reissuing an invitation while it is accepted leaves no unusable pending invitation', async () => {
  const invitation = await createInvitation('replace-race@example.test')
  const { server, baseUrl } = await startTestServer()
  const acceptance = fetch(`${baseUrl}/api/staff/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: invitation.token,
      firstName: 'Ana',
      lastName: 'Santos',
      mobile: '09170000024',
      password: 'Staff!Password2026',
    }),
  })
  const replacement = issueStaffInvitation({
    email: 'replace-race@example.test',
    publicAppUrl: 'https://barangay-legaspi.vercel.app',
    store: jsonDb,
  })

  try {
    const [acceptanceResponse, replacementResult] = await Promise.all([acceptance, replacement])
    const stored = await jsonDb.readDb()
    if (acceptanceResponse.status === 201) {
      assert.equal(replacementResult.status, 'account_exists')
      assert.equal(stored.staffInvitations[0].acceptedAt !== undefined, true)
      assert.equal(stored.staffInvitations.filter((entry) => !entry.acceptedAt && !entry.revokedAt).length, 0)
    } else {
      assert.equal(acceptanceResponse.status, 410)
      assert.equal(replacementResult.status, 'created')
      assert.ok(stored.staffInvitations[0].revokedAt)
      assert.equal(stored.staffInvitations.filter((entry) => !entry.acceptedAt && !entry.revokedAt).length, 1)
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('concurrent redemption creates exactly one staff account', async () => {
  const invitation = await createInvitation()
  const { server, baseUrl } = await startTestServer()
  const accept = (mobile) => fetch(`${baseUrl}/api/staff/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: invitation.token,
      firstName: 'Ana',
      lastName: 'Santos',
      mobile,
      password: 'Staff!Password2026',
    }),
  })

  try {
    const responses = await Promise.all([accept('09170000011'), accept('09170000012')])
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 410])
    const stored = await jsonDb.readDb()
    assert.equal(stored.users.filter((user) => user.email === 'staff.invitee@example.test').length, 1)
    assert.equal(stored.auditLogs.filter((entry) => entry.action === 'staff.invitation.accepted').length, 1)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('admin promotion requires both configured identifiers and records an audit without changing credentials', async () => {
  const account = {
    id: '00000000-0000-4000-8000-000000000101',
    email: 'verified.admin@example.test',
    mobile: '09170000010',
    role: 'resident',
    status: 'Active Resident',
    passwordHash: 'unchanged-hash',
    position: 'Resident Liaison',
  }
  await jsonDb.saveUser(account)
  const auditEntry = (userId, previousRole) => ({
    id: `audit-${userId}`,
    actorId: null,
    actorRole: 'deployment_operator',
    action: 'admin.promoted',
    targetType: 'user',
    targetId: userId,
    metadata: { previousRole, newRole: 'admin' },
  })

  const mismatch = await jsonDb.promoteExistingUserToAdmin({
    email: account.email,
    mobile: '09170000011',
    auditEntry,
  })
  assert.equal(mismatch.status, 'not_found')

  const promoted = await jsonDb.promoteExistingUserToAdmin({
    email: account.email.toUpperCase(),
    mobile: account.mobile,
    auditEntry,
  })
  assert.equal(promoted.status, 'promoted')

  const saved = await jsonDb.findUserById(account.id)
  assert.equal(saved.role, 'admin')
  assert.equal(saved.passwordHash, 'unchanged-hash')
  assert.equal(saved.position, 'Resident Liaison')
  const audit = (await jsonDb.listAuditLogs()).find((entry) => entry.action === 'admin.promoted')
  assert.equal(audit.actorRole, 'deployment_operator')
  assert.deepEqual(audit.metadata, { previousRole: 'resident', newRole: 'admin' })
})

test('admin promotion refuses residents who have not been verified', async () => {
  const account = {
    id: '00000000-0000-4000-8000-000000000121',
    email: 'unverified.admin@example.test',
    mobile: '09170000023',
    role: 'resident',
    status: 'Pending Verification',
    passwordHash: 'unchanged-hash',
  }
  await jsonDb.saveUser(account)

  const result = await jsonDb.promoteExistingUserToAdmin({
    email: account.email,
    mobile: account.mobile,
    auditEntry: () => ({ id: 'audit-unverified-promotion', action: 'admin.promoted' }),
  })

  assert.equal(result.status, 'account_unverified')
  assert.equal((await jsonDb.findUserById(account.id)).role, 'resident')
})
