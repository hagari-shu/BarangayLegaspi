import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseRegistryCsv, registryCsvTemplate } from '../src/registry-csv.js'
import { inspectResidentRoster } from '../scripts/preflight-resident-roster.js'

test('registry CSV parser handles BOM, quoted commas, escaped quotes, and optional fields', () => {
  const csv = `\uFEFFfirstName,lastName,birthDate,sex,householdId,zone,purok,address,sourceReference\r\n"Ana, Marie","Rey ""Reyes""",2001-06-02,Female,HH-1,3,"Purok 3 Daya","Block 1, Lot 2",Page 1`
  assert.deepEqual(parseRegistryCsv(csv), [{
    firstName: 'Ana, Marie',
    lastName: 'Rey "Reyes"',
    birthDate: '2001-06-02',
    sex: 'Female',
    householdId: 'HH-1',
    zone: '3',
    purok: 'Purok 3 Daya',
    address: 'Block 1, Lot 2',
    sourceReference: 'Page 1',
  }])
})

test('registry CSV parser rejects missing, duplicate, unknown, and malformed columns', () => {
  assert.throws(() => parseRegistryCsv('firstName\nAna'), /lastName/)
  assert.throws(() => parseRegistryCsv('firstName,lastName,firstName\nAna,Reyes,Ana'), /Duplicate/)
  assert.throws(() => parseRegistryCsv('firstName,lastName,password\nAna,Reyes,secret'), /Unknown/)
  assert.throws(() => parseRegistryCsv('firstName,lastName\n"Ana,Reyes'), /unclosed/)
  assert.throws(() => parseRegistryCsv('firstName,lastName\nAn"a,Reyes'), /quote must wrap/)
})

test('registry CSV parser enforces data rows and the 500-row import limit', () => {
  assert.throws(() => parseRegistryCsv(registryCsvTemplate), /no resident records/)
  const tooManyRows = `firstName,lastName\n${Array.from({ length: 501 }, (_, index) => `Name${index},Resident`).join('\n')}`
  assert.throws(() => parseRegistryCsv(tooManyRows), /no more than 500/)
})

test('registry CSV parser supports a larger strict Male/Female preflight without changing import defaults', () => {
  const csv = 'firstName,lastName,birthDate,sex\nAna,Reyes,2001-06-02,female\nJose,Cruz,1998-04-10,MALE'
  assert.deepEqual(
    parseRegistryCsv(csv, { maxRows: 1000, requireBinarySex: true }).map(({ sex }) => sex),
    ['Female', 'Male']
  )
  assert.throws(() => parseRegistryCsv('firstName,lastName,sex\nAna,Reyes,', { requireBinarySex: true }), /row 2.*Male or Female/i)
  assert.throws(() => parseRegistryCsv('firstName,lastName,sex\nAna,Reyes,Unclassified', { requireBinarySex: true }), /row 2.*Male or Female/i)

  const rows501 = `firstName,lastName,sex\n${Array.from({ length: 501 }, (_, index) => `Name${index},Resident,${index % 2 ? 'Female' : 'Male'}`).join('\n')}`
  assert.throws(() => parseRegistryCsv(rows501), /no more than 500/)
  assert.equal(parseRegistryCsv(rows501, { maxRows: 1000, requireBinarySex: true }).length, 501)
})

test('resident roster preflight reports counts only and validates fictional source rows', () => {
  const csv = [
    'firstName,lastName,birthDate,sex,householdId,zone,purok,address,sourceReference',
    'SyntheticA,SampleA,2001-06-02,female,HH-1,1,Purok 1,Fictional address,Page 1',
    'SyntheticB,SampleB,1998-04-10,MALE,HH-1,1,Purok 1,Fictional address,Page 2',
    'SyntheticB,SampleB,1998-04-10,Male,HH-1,1,Purok 1,Fictional address,Page 3',
  ].join('\n')

  assert.deepEqual(inspectResidentRoster(csv), {
    records: 3,
    batchesOf500: 1,
    sexCounts: { Male: 2, Female: 1 },
    incompleteCounts: { birthDate: 0, householdId: 0, zone: 0, purok: 0, address: 0, sourceReference: 0 },
    exactDuplicateRows: 1,
  })
})

test('resident roster preflight rejects incomplete binary sex and invalid dates or zones', () => {
  assert.throws(
    () => inspectResidentRoster('firstName,lastName,sex\nSynthetic,Sample,'),
    /row 2.*Male or Female/i
  )
  assert.throws(
    () => inspectResidentRoster('firstName,lastName,birthDate,sex,zone\nSynthetic,Sample,2001-02-30,Female,8'),
    /Preflight failed.*birthDate.*zone/
  )
})

test('private roster preflight CLI reports aggregates without echoing resident values or contacting a database', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'registry-preflight-test-'))
  const sourcePath = path.join(temporaryDirectory, 'fictional.csv')
  const source = 'firstName,lastName,birthDate,sex\nSyntheticPrivateName,TestRecord,2001-06-02,Female'
  await writeFile(sourcePath, source, 'utf8')
  try {
    const output = execFileSync(process.execPath, ['scripts/preflight-resident-roster.js', sourcePath], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' },
    })
    assert.match(output, /Records: 1/)
    assert.match(output, /Sex values: Male 0, Female 1/)
    assert.doesNotMatch(output, /SyntheticPrivateName|TestRecord|fictional\.csv/)

    const refused = spawnSync(process.execPath, ['scripts/preflight-resident-roster.js', sourcePath], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: 'postgres://must-not-connect.invalid/db', NODE_ENV: 'test' },
    })
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /refuses to run while DATABASE_URL is set/)
    assert.doesNotMatch(refused.stderr, /SyntheticPrivateName|TestRecord/)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})
