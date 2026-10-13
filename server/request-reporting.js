const DAY_MS = 24 * 60 * 60 * 1000
const TIME_ZONE_OFFSET = '+08:00'

const parseTimestamp = (value) => {
  const timestamp = value ? new Date(value).getTime() : NaN
  return Number.isFinite(timestamp) ? timestamp : null
}

const getDateKey = (timestamp) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

const getMonthKey = (timestamp) => getDateKey(timestamp).slice(0, 7)

const shiftDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const getWeekStart = (timestamp) => {
  const dateKey = getDateKey(timestamp)
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay()
  return shiftDateKey(dateKey, -((weekday + 6) % 7))
}

const inRange = (timestamp, fromTime, toTime) => timestamp !== null
  && (fromTime === null || timestamp >= fromTime)
  && (toTime === null || timestamp < toTime)

const lastDecisionFor = (request) => {
  const history = Array.isArray(request.statusHistory)
    ? request.statusHistory
    : Array.isArray(request.status_history) ? request.status_history : []
  const decisions = history
    .filter((entry) => ['Approved', 'Rejected'].includes(entry.status))
    .map((entry) => ({ status: entry.status, timestamp: parseTimestamp(entry.createdAt || entry.created_at) }))
    .filter((entry) => entry.timestamp !== null)
    .sort((left, right) => left.timestamp - right.timestamp)
  return decisions.at(-1) || null
}

const getBucketUnit = (fromTime, toTime, timestamps) => {
  if (fromTime !== null && toTime !== null) {
    const days = Math.ceil((toTime - fromTime) / DAY_MS)
    if (days <= 31) return 'day'
    if (days <= 120) return 'week'
    return 'month'
  }
  if (timestamps.length < 2) return 'month'
  const days = (Math.max(...timestamps) - Math.min(...timestamps)) / DAY_MS
  if (days <= 31) return 'day'
  if (days <= 120) return 'week'
  return 'month'
}

const bucketKey = (timestamp, unit) => {
  if (unit === 'day') return getDateKey(timestamp)
  if (unit === 'week') return getWeekStart(timestamp)
  return getMonthKey(timestamp)
}

const buildActivity = (requests, decisions, fromTime, toTime) => {
  const submissionTimes = requests
    .map((request) => parseTimestamp(request.date || request.createdAt || request.created_at))
    .filter((timestamp) => timestamp !== null)
  const unit = getBucketUnit(fromTime, toTime, submissionTimes)
  const buckets = new Map()
  const add = (timestamp, key) => {
    const bucket = buckets.get(key) || { period: key, received: 0, decisions: 0 }
    bucket.received += timestamp.kind === 'received' ? 1 : 0
    bucket.decisions += timestamp.kind === 'decision' ? 1 : 0
    buckets.set(key, bucket)
  }
  for (const request of requests) {
    const timestamp = parseTimestamp(request.date || request.createdAt || request.created_at)
    if (timestamp !== null && inRange(timestamp, fromTime, toTime)) {
      add({ kind: 'received' }, bucketKey(timestamp, unit))
    }
  }
  for (const decision of decisions) {
    add({ kind: 'decision' }, bucketKey(decision.timestamp, unit))
  }
  return [...buckets.values()].sort((left, right) => left.period.localeCompare(right.period))
    .map((bucket) => ({ ...bucket, unit }))
}

export function getStaffRequestReport(requests, { from = '', to = '', type = '', status = '' } = {}) {
  const fromTime = from ? Date.parse(`${from}T00:00:00${TIME_ZONE_OFFSET}`) : null
  const toTime = to ? Date.parse(`${to}T00:00:00${TIME_ZONE_OFFSET}`) + DAY_MS : null
  const allRequests = Array.isArray(requests) ? requests : []
  const requestTypes = [...new Set(allRequests.map((request) => request.type).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
  const statuses = [...new Set(allRequests.map((request) => request.status).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
  const selected = allRequests.filter((request) => {
    const timestamp = parseTimestamp(request.date || request.createdAt || request.created_at)
    return inRange(timestamp, fromTime, toTime)
      && (!type || request.type === type)
      && (!status || request.status === status)
  })
  const decisionCandidates = allRequests.filter((request) =>
    (!type || request.type === type) && (!status || request.status === status))
  const decisions = decisionCandidates
    .map((request) => ({ request, decision: lastDecisionFor(request) }))
    .filter(({ decision }) => decision && inRange(decision.timestamp, fromTime, toTime))
    .map(({ request, decision }) => ({ request, id: request.id, type: request.type, ...decision }))
  const approvedDecisions = decisions.filter((decision) => decision.status === 'Approved').length
  const rejectedDecisions = decisions.filter((decision) => decision.status === 'Rejected').length
  const activeCount = selected.filter((request) => !['Approved', 'Rejected'].includes(request.status)).length
  const completedDecisionDurations = decisions
    .map(({ request, timestamp }) => {
      const createdAt = parseTimestamp(request.date || request.createdAt || request.created_at)
      return createdAt !== null && timestamp >= createdAt
        ? (timestamp - createdAt) / (60 * 60 * 1000)
        : null
    })
    .filter((duration) => duration !== null)
  const statusCounts = selected.reduce((counts, request) => {
    counts[request.status] = (counts[request.status] || 0) + 1
    return counts
  }, {})
  const typeCounts = selected.reduce((counts, request) => {
    counts[request.type] = (counts[request.type] || 0) + 1
    return counts
  }, {})

  return {
    summary: {
      received: selected.length,
      pendingReview: statusCounts.Pending || 0,
      inProcessing: statusCounts['In Review'] || 0,
      needsInformation: statusCounts['Needs Information'] || 0,
      approved: statusCounts.Approved || 0,
      rejected: statusCounts.Rejected || 0,
      active: activeCount,
      approvedDecisions,
      rejectedDecisions,
      decisionCount: approvedDecisions + rejectedDecisions,
      approvalRate: approvedDecisions + rejectedDecisions
        ? Math.round((approvedDecisions / (approvedDecisions + rejectedDecisions)) * 100)
        : null,
      pendingRate: selected.length ? Math.round((activeCount / selected.length) * 100) : null,
      averageDecisionHours: completedDecisionDurations.length
        ? Math.round(completedDecisionDurations.reduce((sum, value) => sum + value, 0) / completedDecisionDurations.length)
        : null,
      deadlineTracking: false,
      releaseTracking: false,
      missingSubmissionDates: allRequests.filter((request) => parseTimestamp(request.date || request.createdAt || request.created_at) === null).length,
    },
    requestTypes,
    statuses,
    statusDistribution: Object.entries(statusCounts).map(([name, count]) => ({ name, count })),
    typeBreakdown: Object.entries(typeCounts).map(([name, count]) => ({ name, count })),
    activity: buildActivity(selected, decisions, fromTime, toTime),
    recentDecisions: decisions
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 10)
      .map(({ id, type, status: decisionStatus, timestamp }) => ({
        id,
        type,
        status: decisionStatus,
        date: new Date(timestamp).toISOString(),
      })),
    generatedAt: new Date().toISOString(),
  }
}

export function filterStaffReportRequests(requests, { from = '', to = '', type = '', status = '' } = {}) {
  const fromTime = from ? Date.parse(`${from}T00:00:00${TIME_ZONE_OFFSET}`) : null
  const toTime = to ? Date.parse(`${to}T00:00:00${TIME_ZONE_OFFSET}`) + DAY_MS : null
  return (Array.isArray(requests) ? requests : []).filter((request) => {
    const timestamp = parseTimestamp(request.date || request.createdAt || request.created_at)
    return inRange(timestamp, fromTime, toTime)
      && (!type || request.type === type)
      && (!status || request.status === status)
  })
}

export function createRequestReportCsv(requests) {
  const headers = ['Request reference', 'Request type', 'Submitted at', 'Current status', 'Decision status', 'Decision date']
  const escapeCell = (value) => {
    let text = String(value ?? '')
    // Spreadsheet formula prefixes can be preceded by tabs, newlines, or other controls.
    // eslint-disable-next-line no-control-regex
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  const rows = requests.map((request) => {
    const decision = lastDecisionFor(request)
    return [
      request.id,
      request.type,
      request.date || request.createdAt || request.created_at,
      request.status,
      decision?.status,
      decision ? new Date(decision.timestamp).toISOString() : '',
    ]
  })
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')
}

export function isValidReportDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
