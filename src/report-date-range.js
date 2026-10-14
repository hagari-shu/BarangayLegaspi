const formatDate = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

const shiftDate = (dateString, days) => {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getReportDateRange(period, now = new Date()) {
  const today = formatDate(now)
  const [year, month] = today.split('-').map(Number)
  const firstOfCurrentMonth = `${today.slice(0, 7)}-01`

  switch (period) {
    case 'today':
      return { from: today, to: today }
    case 'last7':
      return { from: shiftDate(today, -6), to: today }
    case 'last30':
      return { from: shiftDate(today, -29), to: today }
    case 'thisMonth':
      return { from: firstOfCurrentMonth, to: today }
    case 'previousMonth': {
      const previousMonth = new Date(Date.UTC(year, month - 2, 1))
      const from = previousMonth.toISOString().slice(0, 10)
      const to = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10)
      return { from, to }
    }
    case 'custom':
    case 'all':
      return { from: '', to: '' }
    default:
      throw new RangeError(`Unsupported report period: ${period}`)
  }
}
