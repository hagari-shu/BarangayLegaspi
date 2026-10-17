import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseRegistryCsv } from '../src/registry-csv.js'

const MAX_SOURCE_ROWS = 10000
const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const BATCH_SIZE = 500

const manilaDateKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date)

export function inspectResidentRoster(source) {
  const residents = parseRegistryCsv(source, {
    maxRows: MAX_SOURCE_ROWS,
    requireBinarySex: true,
  })
  const today = manilaDateKey()
  const sexCounts = { Male: 0, Female: 0 }
  const incompleteCounts = { birthDate: 0, householdId: 0, zone: 0, purok: 0, address: 0, sourceReference: 0 }
  const validationErrors = []
  const seenRecords = new Set()
  let exactDuplicateRows = 0

  residents.forEach((resident, index) => {
    const row = index + 2
    const validName = (value) => value.trim().length > 0 && value.length <= 100
    if (!validName(resident.firstName) || !validName(resident.lastName)) {
      validationErrors.push({ row, field: 'name' })
    }

    if (resident.birthDate) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(resident.birthDate)
      const date = match ? new Date(`${resident.birthDate}T00:00:00.000Z`) : null
      if (!match || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== resident.birthDate || resident.birthDate > today) {
        validationErrors.push({ row, field: 'birthDate' })
      }
    } else {
      incompleteCounts.birthDate += 1
    }

    if (resident.zone && (!/^\d+$/.test(resident.zone) || Number(resident.zone) < 1 || Number(resident.zone) > 7)) {
      validationErrors.push({ row, field: 'zone' })
    } else if (!resident.zone) {
      incompleteCounts.zone += 1
    }

    if ((resident.householdId || '').length > 100
      || (resident.purok || '').length > 100
      || (resident.address || '').length > 255
      || (resident.sourceReference || '').length > 255) {
      validationErrors.push({ row, field: 'length' })
    }

    if (!resident.householdId) incompleteCounts.householdId += 1
    if (!resident.purok) incompleteCounts.purok += 1
    if (!resident.address) incompleteCounts.address += 1
    if (!resident.sourceReference) incompleteCounts.sourceReference += 1

    sexCounts[resident.sex] += 1
    const duplicateKey = [
      resident.firstName.trim().toLocaleLowerCase('en'),
      resident.lastName.trim().toLocaleLowerCase('en'),
      resident.birthDate || '',
    ].join('\u0000')
    if (seenRecords.has(duplicateKey)) exactDuplicateRows += 1
    else seenRecords.add(duplicateKey)
  })

  if (validationErrors.length) {
    const fields = [...new Set(validationErrors.map(({ field }) => field))]
    throw new Error(`Preflight failed for ${validationErrors.length} row(s). Correct fields: ${fields.join(', ')}. No resident data was imported.`)
  }

  return {
    records: residents.length,
    batchesOf500: Math.ceil(residents.length / BATCH_SIZE),
    sexCounts,
    incompleteCounts,
    exactDuplicateRows,
  }
}

const main = async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Roster preflight is disabled in production.')
  }
  if (process.env.DATABASE_URL?.trim()) {
    throw new Error('Roster preflight refuses to run while DATABASE_URL is set. No database was contacted.')
  }
  const args = process.argv.slice(2)
  if (args.length !== 1 || args[0] === '--help') {
    throw new Error('Usage: npm run registry:preflight -- <private-roster.csv>')
  }
  const sourcePath = path.resolve(args[0])
  const fileStats = await stat(sourcePath)
  if (!fileStats.isFile()) throw new Error('The source path must identify a regular CSV file.')
  if (fileStats.size > MAX_SOURCE_BYTES) throw new Error('The source CSV exceeds the 20 MB local preflight limit.')

  const bytes = await readFile(sourcePath)
  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('The source CSV must be valid UTF-8. No resident data was imported.')
  }
  const report = inspectResidentRoster(source)
  console.log('Roster preflight passed. No records were imported or sent over the network.')
  console.log(`Records: ${report.records}`)
  console.log(`500-row batches for review: ${report.batchesOf500}`)
  console.log(`Sex values: Male ${report.sexCounts.Male}, Female ${report.sexCounts.Female}`)
  console.log(`Exact name-and-birthdate duplicate rows to review in the Staff import workflow: ${report.exactDuplicateRows}`)
  console.log(`Rows with missing optional fields: ${JSON.stringify(report.incompleteCounts)}`)
  console.log('This is validation only. Import only to an authorized staging database after backup, restore, encryption, and access-control checks pass.')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`Unable to preflight resident roster: ${error.message}`)
    process.exitCode = 1
  })
}
