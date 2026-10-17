import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { hashPassword } from '../server/auth.js'
import { DB_PATH, IS_QA_RUN } from '../server/config.js'
import * as jsonDb from '../server/db.js'

const fixturePath = process.argv[2]
const credentialPath = path.join(path.dirname(DB_PATH), 'qa-demo-credentials.csv')
const demoEmailPattern = /^demo\.resident\.\d{3}@example\.test$/
const demoMobilePattern = /^09000001\d{3}$/
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

if (!IS_QA_RUN || process.env.DATABASE_URL) {
  throw new Error('Demo accounts can only be seeded in the isolated local QA store.')
}
if (!fixturePath) {
  throw new Error('Provide the path to a synthetic resident JSON fixture.')
}

const parsedFixture = JSON.parse(await fs.readFile(path.resolve(fixturePath), 'utf8'))
const residents = Array.isArray(parsedFixture) ? parsedFixture : parsedFixture.residents
if (!Array.isArray(residents) || residents.length < 1 || residents.length > 100) {
  throw new Error('The demo fixture must contain between 1 and 100 synthetic residents.')
}

const fixtureEmails = new Set()
const fixtureMobiles = new Set()
for (const resident of residents) {
  if (
    !resident
    || typeof resident.firstName !== 'string'
    || !resident.firstName.trim()
    || typeof resident.lastName !== 'string'
    || !resident.lastName.trim()
    || !demoEmailPattern.test(resident.email)
    || !demoMobilePattern.test(resident.mobile)
    || !/^QA-DEMO-\d{3}$/.test(resident.demoId)
    || !/^\d{4}-\d{2}-\d{2}$/.test(resident.birthDate)
    || !['Female', 'Male'].includes(resident.sex)
    || typeof resident.householdId !== 'string'
    || !resident.householdId.startsWith('QA-HH-')
    || !Number.isInteger(resident.zone)
    || !Number.isInteger(resident.familyMembers)
    || resident.familyMembers < 1
    || resident.familyMembers > 12
    || resident.status !== 'Active Resident'
    || typeof resident.address !== 'string'
    || !resident.address.startsWith('QA Sample ')
  ) {
    throw new Error('The demo fixture contains an invalid or non-synthetic profile.')
  }
  if (fixtureEmails.has(resident.email) || fixtureMobiles.has(resident.mobile)) {
    throw new Error('The demo fixture contains duplicate email or mobile identifiers.')
  }
  fixtureEmails.add(resident.email)
  fixtureMobiles.add(resident.mobile)
}

const db = await jsonDb.readDb()
const existingDemoUsers = db.users.filter((user) => fixtureEmails.has(String(user.email || '').toLowerCase()))
if (existingDemoUsers.length > 0) {
  if (existingDemoUsers.length === residents.length && await fs.stat(credentialPath).then(() => true, () => false)) {
    console.log(`The ${residents.length} demo accounts already exist. Their credential file is ${credentialPath}.`)
    process.exit(0)
  }
  throw new Error('Some demo accounts already exist but their credential handoff is unavailable; refusing to reset passwords.')
}
if (await fs.stat(credentialPath).then(() => true, () => false)) {
  throw new Error(`Credential file already exists at ${credentialPath}; refusing to overwrite or reseed accounts.`)
}

const credentials = []
for (const resident of residents) {
  const password = `${randomBytes(24).toString('base64url')}Aa1!`
  db.users.push({
    id: randomUUID(),
    demoId: resident.demoId,
    firstName: resident.firstName.trim(),
    lastName: resident.lastName.trim(),
    mobile: resident.mobile,
    email: resident.email,
    birthDate: resident.birthDate,
    sex: resident.sex,
    passwordHash: await hashPassword(password),
    role: 'resident',
    householdId: resident.householdId,
    familyMembers: resident.familyMembers,
    householdMembers: [],
    status: resident.status,
    address: resident.address,
    zone: resident.zone,
    position: null,
    availability: 'Available',
    createdAt: new Date().toISOString(),
  })
  credentials.push({ ...resident, password })
}

const credentialCsv = [
  ['demoId', 'firstName', 'lastName', 'email', 'mobile', 'password', 'birthDate', 'sex', 'householdId', 'familyMembers', 'zone', 'address']
    .map(csvCell)
    .join(','),
  ...credentials.map((resident) => [
    resident.demoId,
    resident.firstName,
    resident.lastName,
    resident.email,
    resident.mobile,
    resident.password,
    resident.birthDate,
    resident.sex,
    resident.householdId,
    resident.familyMembers,
    resident.zone,
    resident.address,
  ].map(csvCell).join(',')),
].join('\r\n')

await jsonDb.writeDb(db)
await fs.writeFile(credentialPath, `${credentialCsv}\r\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
console.log(`Seeded ${residents.length} synthetic QA residents.`)
console.log(`Private credential handoff written to ${credentialPath}. Do not commit or publish it.`)
