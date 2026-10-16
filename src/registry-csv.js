const MAX_IMPORT_ROWS = 500
const EXPECTED_HEADERS = [
  'firstName',
  'lastName',
  'birthDate',
  'sex',
  'householdId',
  'zone',
  'purok',
  'address',
  'sourceReference',
]

function parseRows(source) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let afterQuote = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        afterQuote = true
      } else {
        field += character
      }
      continue
    }

    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n' && character !== ' ' && character !== '\t') {
      throw new Error('Unexpected text after a quoted CSV field.')
    }
    if (character === '"' && field.length === 0) {
      quoted = true
      continue
    }
    if (character === '"') throw new Error('A quote must wrap a complete CSV field.')
    if (character === ',') {
      row.push(field.trim())
      field = ''
      afterQuote = false
      continue
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(field.trim())
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      field = ''
      afterQuote = false
      continue
    }
    field += character
  }

  if (quoted) throw new Error('The CSV contains an unclosed quoted field.')
  row.push(field.trim())
  if (row.some((value) => value !== '')) rows.push(row)
  return rows
}

export function parseRegistryCsv(source) {
  const rows = parseRows(String(source).replace(/^\uFEFF/, ''))
  if (rows.length === 0) throw new Error('The CSV file is empty.')

  const headers = rows[0].map((header) => header.trim())
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index)
  if (duplicateHeaders.length) throw new Error(`Duplicate CSV header: ${duplicateHeaders[0]}.`)
  const missingHeaders = ['firstName', 'lastName'].filter((header) => !headers.includes(header))
  if (missingHeaders.length) throw new Error(`Required CSV headers are missing: ${missingHeaders.join(', ')}.`)
  if (headers.some((header) => !EXPECTED_HEADERS.includes(header))) {
    const unknown = headers.find((header) => !EXPECTED_HEADERS.includes(header))
    throw new Error(`Unknown CSV header: ${unknown}.`)
  }

  const dataRows = rows.slice(1)
  if (dataRows.length === 0) throw new Error('The CSV has headers but no resident records.')
  if (dataRows.length > MAX_IMPORT_ROWS) throw new Error(`Import no more than ${MAX_IMPORT_ROWS} resident records at a time.`)

  const residents = dataRows.map((values, index) => {
    if (values.length > headers.length && values.slice(headers.length).some(Boolean)) {
      throw new Error(`CSV row ${index + 2} has more fields than its header.`)
    }
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column] || '']))
    return {
      firstName: record.firstName,
      lastName: record.lastName,
      birthDate: record.birthDate || null,
      sex: record.sex || null,
      householdId: record.householdId || null,
      zone: record.zone || null,
      purok: record.purok || null,
      address: record.address || null,
      sourceReference: record.sourceReference || null,
    }
  })

  return residents
}

export const registryCsvTemplate = `${EXPECTED_HEADERS.join(',')}\n`
