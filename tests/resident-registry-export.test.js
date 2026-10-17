import test from 'node:test'
import assert from 'node:assert/strict'
import { createResidentRegistryCsv } from '../src/resident-registry-export.js'

test('resident registry CSV is ordered by zone, household, then name with spreadsheet headers', () => {
  const csv = createResidentRegistryCsv([
    { firstName: 'Zoe', lastName: 'Zane', zone: 2, household: 'B' },
    { firstName: 'Ben', lastName: 'Able', zone: 1, household: 'B' },
    { firstName: 'Ada', lastName: 'Able', zone: 1, household: 'A' },
    { firstName: 'No zone', lastName: 'Resident', zone: null, household: 'A' },
  ])
  const rows = csv.slice(1).split('\r\n')
  assert.equal(rows[0], '"Zone","Household","Last name","First name","Birthdate","Age","Sex","Record status","Verification"')
  assert.deepEqual(rows.slice(1), [
    '"1","A","Able","Ada","","","","",""',
    '"1","B","Able","Ben","","","","",""',
    '"2","B","Zane","Zoe","","","","",""',
    '"","A","Resident","No zone","","","","",""',
  ])
})

test('resident registry CSV omits confidential fields and neutralizes spreadsheet formulas', () => {
  const csv = createResidentRegistryCsv([{
    firstName: '=HYPERLINK("https://bad.invalid")',
    lastName: 'Doe, "Example"',
    zone: 1,
    maritalStatus: 'Confidential value',
    occupation: '+1+1',
  }])
  assert.match(csv, /"Doe, ""Example"""/)
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad\.invalid""\)"/)
  assert.doesNotMatch(csv, /Confidential value|\+1\+1|Marital status|Occupation/)
})

test('resident registry CSV refuses exports larger than the supported batch size', () => {
  assert.throws(
    () => createResidentRegistryCsv(Array.from({ length: 10001 }, () => ({}))),
    /no more than 10000/,
  )
})
