import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRegistryCsv, registryCsvTemplate } from '../src/registry-csv.js'

test('registry CSV parser handles BOM, quoted commas, escaped quotes, and optional fields', () => {
  const csv = `\uFEFFfirstName,lastName,birthDate,sex,householdId,zone,maritalStatus,occupation,sourceReference\r\n"Ana, Marie","Rey ""Reyes""",2001-06-02,Female,HH-1,3,Married,"Store owner",Page 1`
  assert.deepEqual(parseRegistryCsv(csv), [{
    firstName: 'Ana, Marie',
    lastName: 'Rey "Reyes"',
    birthDate: '2001-06-02',
    sex: 'Female',
    householdId: 'HH-1',
    zone: '3',
    maritalStatus: 'Married',
    occupation: 'Store owner',
    sourceReference: 'Page 1',
  }])
})

test('registry CSV parser rejects missing, duplicate, unknown, and malformed columns', () => {
  assert.throws(() => parseRegistryCsv('firstName\nAna'), /lastName/)
  assert.throws(() => parseRegistryCsv('firstName,lastName,firstName\nAna,Reyes,Ana'), /Duplicate/)
  assert.throws(() => parseRegistryCsv('firstName,lastName,password\nAna,Reyes,secret'), /Unknown/)
  assert.throws(() => parseRegistryCsv('firstName,lastName,purok,address\nAna,Reyes,Zone 2,Old address'), /Unknown/)
  assert.throws(() => parseRegistryCsv('firstName,lastName\n"Ana,Reyes'), /unclosed/)
  assert.throws(() => parseRegistryCsv('firstName,lastName\nAn"a,Reyes'), /quote must wrap/)
})

test('registry CSV parser enforces data rows and the 500-row import limit', () => {
  assert.throws(() => parseRegistryCsv(registryCsvTemplate), /no resident records/)
  const tooManyRows = `firstName,lastName\n${Array.from({ length: 501 }, (_, index) => `Name${index},Resident`).join('\n')}`
  assert.throws(() => parseRegistryCsv(tooManyRows), /no more than 500/)
})
