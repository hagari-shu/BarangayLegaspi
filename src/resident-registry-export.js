const MAX_EXPORT_ROWS = 10000

const compareText = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, {
  sensitivity: 'base',
  numeric: true,
})

const compareZone = (left, right) => {
  const leftZone = left.zone === null || left.zone === undefined || left.zone === '' ? Number.POSITIVE_INFINITY : Number(left.zone)
  const rightZone = right.zone === null || right.zone === undefined || right.zone === '' ? Number.POSITIVE_INFINITY : Number(right.zone)
  return leftZone - rightZone
}

export function createResidentRegistryCsv(residents) {
  if (!Array.isArray(residents) || residents.length > MAX_EXPORT_ROWS) {
    throw new Error(`Export no more than ${MAX_EXPORT_ROWS} resident records at a time. Add filters and try again.`)
  }

  const headers = [
    'Zone',
    'Household',
    'Last name',
    'First name',
    'Birthdate',
    'Age',
    'Sex',
    'Marital status',
    'Occupation',
    'Record status',
    'Verification',
  ]
  const escapeCell = (value) => {
    let text = String(value ?? '')
    // Spreadsheet formula prefixes can be preceded by tabs, newlines, or other controls.
    // eslint-disable-next-line no-control-regex
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  const sortedResidents = [...residents].sort((left, right) => (
    compareZone(left, right)
    || compareText(left.household || left.householdId, right.household || right.householdId)
    || compareText(left.lastName, right.lastName)
    || compareText(left.firstName, right.firstName)
  ))
  const rows = sortedResidents.map((resident) => [
    resident.zone,
    resident.household || resident.householdId,
    resident.lastName,
    resident.firstName,
    resident.birthDate,
    resident.age,
    resident.sex,
    resident.maritalStatus,
    resident.occupation,
    resident.status,
    resident.verificationStatus,
  ])

  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')}`
}
