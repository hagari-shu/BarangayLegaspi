const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isCount = (value) => Number.isInteger(value) && value >= 0
const isNullableNumber = (value) => value === null || Number.isFinite(value)
const isNamedCountList = (value) => Array.isArray(value)
  && value.every((item) => isRecord(item) && typeof item.name === 'string' && isCount(item.count))

export function isStaffReportResponse(value) {
  if (!isRecord(value) || !isRecord(value.summary)) return false

  const summaryCounts = [
    'received',
    'pendingReview',
    'inProcessing',
    'needsInformation',
    'approved',
    'rejected',
    'active',
    'approvedDecisions',
    'rejectedDecisions',
    'decisionCount',
    'missingSubmissionDates',
  ]
  if (!summaryCounts.every((key) => isCount(value.summary[key]))) return false
  if (!['averageDecisionHours', 'approvalRate', 'pendingRate'].every((key) => isNullableNumber(value.summary[key]))) return false
  if (!Array.isArray(value.requestTypes) || !value.requestTypes.every((item) => typeof item === 'string')) return false
  if (!Array.isArray(value.statuses) || !value.statuses.every((item) => typeof item === 'string')) return false
  if (!isNamedCountList(value.statusDistribution) || !isNamedCountList(value.typeBreakdown)) return false
  if (!Array.isArray(value.activity) || !value.activity.every((item) => (
    isRecord(item)
    && typeof item.period === 'string'
    && ['day', 'week', 'month'].includes(item.unit)
    && isCount(item.received)
    && isCount(item.decisions)
  ))) return false
  if (!Array.isArray(value.recentDecisions) || !value.recentDecisions.every((item) => (
    isRecord(item)
    && typeof item.id === 'string'
    && typeof item.type === 'string'
    && ['Approved', 'Rejected'].includes(item.status)
    && Number.isFinite(Date.parse(item.date))
  ))) return false

  return typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt))
}
