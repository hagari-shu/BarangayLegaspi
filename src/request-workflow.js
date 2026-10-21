export const REQUEST_WORKFLOW_STAGES = [
  { status: 'Pending', labelKey: 'statusSubmitted', messageKey: 'requestStatusPendingMessage', active: true },
  { status: 'In Review', labelKey: 'statusUnderReview', messageKey: 'requestStatusInReviewMessage', active: true },
  { status: 'Needs Information', labelKey: 'statusNeedsInformation', messageKey: 'requestStatusNeedsInformationMessage', active: true },
  { status: 'Approved', labelKey: 'approved', messageKey: 'requestStatusApprovedMessage', active: false },
  { status: 'Rejected', labelKey: 'statusRejected', messageKey: 'requestStatusRejectedMessage', active: false },
]

const requestWorkflowStagesByStatus = new Map(REQUEST_WORKFLOW_STAGES.map((stage) => [stage.status, stage]))

export function getRequestStatusMessage(status, translations) {
  const stage = requestWorkflowStagesByStatus.get(status)
  return translations[stage?.messageKey || 'requestStatusPendingMessage']
}

export function getRequestStatusCounts(requests) {
  const counts = Object.fromEntries(REQUEST_WORKFLOW_STAGES.map(({ status }) => [status, 0]))
  for (const request of Array.isArray(requests) ? requests : []) {
    if (requestWorkflowStagesByStatus.has(request.status)) counts[request.status] += 1
  }
  return counts
}

export function getActiveRequestCount(counts) {
  return REQUEST_WORKFLOW_STAGES.reduce((total, { status, active }) => total + (active ? counts[status] : 0), 0)
}
