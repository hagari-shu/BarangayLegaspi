import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestReportCsv, filterStaffReportRequests, getStaffRequestReport, isValidReportDate } from '../server/request-reporting.js'
import { getReportDateRange } from '../src/report-date-range.js'

test('staff report date presets use Manila calendar days and handle month boundaries', () => {
  const now = new Date('2026-10-14T00:30:00.000Z')

  assert.deepEqual(getReportDateRange('today', now), { from: '2026-10-14', to: '2026-10-14' })
  assert.deepEqual(getReportDateRange('last7', now), { from: '2026-10-08', to: '2026-10-14' })
  assert.deepEqual(getReportDateRange('last30', now), { from: '2026-09-15', to: '2026-10-14' })
  assert.deepEqual(getReportDateRange('thisMonth', now), { from: '2026-10-01', to: '2026-10-14' })
  assert.deepEqual(getReportDateRange('previousMonth', now), { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(getReportDateRange('all', now), { from: '', to: '' })
  assert.deepEqual(getReportDateRange('custom', now), { from: '', to: '' })
  assert.throws(() => getReportDateRange('unsupported', now), RangeError)
})

const requests = [
  {
    id: 'approved-1',
    type: 'Barangay Certificate',
    date: '2026-10-09T00:00:00+08:00',
    status: 'Approved',
    statusHistory: [
      { status: 'Pending', createdAt: '2026-10-09T00:00:00+08:00' },
      { status: 'Approved', createdAt: '2026-10-10T00:00:00+08:00' },
    ],
  },
  {
    id: 'pending-1',
    type: 'Barangay Clearance',
    date: '2026-10-10T23:59:59+08:00',
    status: 'Pending',
    statusHistory: [{ status: 'Pending', createdAt: '2026-10-10T23:59:59+08:00' }],
  },
  {
    id: 'in-review-1',
    type: 'Barangay Certificate',
    date: '2026-10-11T00:00:00+08:00',
    status: 'In Review',
    statusHistory: [{ status: 'In Review', createdAt: '2026-10-11T00:00:00+08:00' }],
  },
]

test('staff report filters use inclusive Manila calendar date boundaries and actual status/type values', () => {
  const report = getStaffRequestReport(requests, {
    from: '2026-10-09',
    to: '2026-10-10',
    type: 'Barangay Certificate',
  })

  assert.equal(report.summary.received, 1)
  assert.equal(report.summary.approved, 1)
  assert.equal(report.summary.pendingReview, 0)
  assert.equal(report.summary.approvedDecisions, 1)
  assert.equal(report.summary.approvalRate, 100)
  assert.equal(report.summary.averageDecisionHours, 24)
  assert.deepEqual(report.requestTypes, ['Barangay Certificate', 'Barangay Clearance'])
  assert.equal(report.summary.releaseTracking, false)
  assert.equal(report.summary.deadlineTracking, false)
})

test('report percentages are unavailable without their denominator and status counts reconcile', () => {
  const report = getStaffRequestReport(requests, { from: '2026-10-11', to: '2026-10-11' })
  assert.equal(report.summary.received, 1)
  assert.equal(report.summary.inProcessing, 1)
  assert.equal(report.summary.approvalRate, null)
  assert.equal(report.summary.pendingRate, 100)
  assert.deepEqual(report.statusDistribution, [{ name: 'In Review', count: 1 }])
  assert.equal(report.activity[0].received, 1)
})

test('all-time reports exclude requests with invalid submission dates and count them explicitly', () => {
  const report = getStaffRequestReport([...requests, {
    id: 'missing-date',
    type: 'Barangay Certificate',
    status: 'Pending',
    statusHistory: [],
  }])
  assert.equal(report.summary.received, 3)
  assert.equal(report.summary.missingSubmissionDates, 1)
})

test('CSV export escapes cells and protects spreadsheet formulas', () => {
  const csv = createRequestReportCsv([{
    id: '=HYPERLINK("https://bad.invalid")',
    type: 'Certificate, "special"',
    date: '2026-10-10T00:00:00Z',
    status: '+1+1',
    statusHistory: [],
  }])
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad\.invalid""\)"/)
  assert.match(csv, /"Certificate, ""special"""/)
  assert.match(csv, /"'\+1\+1"/)
})

test('CSV rows and report rows use identical request filters; invalid date values are rejected', () => {
  const filters = { from: '2026-10-10', to: '2026-10-10', status: 'Pending' }
  assert.deepEqual(filterStaffReportRequests(requests, filters).map(({ id }) => id), ['pending-1'])
  assert.equal(isValidReportDate('2026-02-30'), false)
  assert.equal(isValidReportDate('2026-10-10'), true)
})
