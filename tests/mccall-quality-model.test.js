import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmptyQualityAssessment,
  getQualityAssessmentSummary,
  getQualityAssessmentStorageKey,
  MCCALL_QUALITY_FACTORS,
  MCCALL_QUALITY_GROUPS,
  parseQualityAssessment,
  parseQualityScores,
  summarizeQualityResponses,
} from '../src/mccall-quality-model.js'

test('McCall model contains all eleven factors in the three quality groups', () => {
  assert.equal(MCCALL_QUALITY_FACTORS.length, 11)
  assert.deepEqual(MCCALL_QUALITY_GROUPS.map((group) => group.factors.length), [5, 3, 3])
})

test('assessment storage is isolated by role and account', () => {
  const residentKey = getQualityAssessmentStorageKey('resident', 'account-1')
  assert.notEqual(residentKey, getQualityAssessmentStorageKey('staff', 'account-1'))
  assert.notEqual(residentKey, getQualityAssessmentStorageKey('resident', 'account-2'))
  assert.throws(() => getQualityAssessmentStorageKey('visitor', 'account-1'), /role/)
  assert.throws(() => getQualityAssessmentStorageKey('resident', ''), /account ID/)
})

test('empty assessment reports no scores instead of implying a measured zero', () => {
  const summary = getQualityAssessmentSummary(createEmptyQualityAssessment())
  assert.equal(summary.ratedCount, 0)
  assert.equal(summary.average, null)
  assert.equal(summary.factorCount, 11)
  assert.deepEqual(summary.groups.map((group) => group.average), [null, null, null])
})

test('assessment summary averages only rated factors and rounds to one decimal', () => {
  const assessment = createEmptyQualityAssessment()
  assessment.scores.correctness = 4
  assessment.scores.reliability = 5
  assessment.scores.maintainability = 2

  const summary = getQualityAssessmentSummary(assessment)
  assert.equal(summary.ratedCount, 3)
  assert.equal(summary.average, 3.7)
  assert.deepEqual(summary.groups.map((group) => group.average), [4.5, 2, null])
})

test('assessment parser rejects out-of-range scores and oversized notes', () => {
  const assessment = createEmptyQualityAssessment()
  assessment.scores.correctness = 6
  assert.throws(() => parseQualityAssessment(assessment), /Invalid score/)

  assessment.scores.correctness = 4
  assessment.notes.correctness = 'x'.repeat(501)
  assert.throws(() => parseQualityAssessment(assessment), /Invalid evidence note/)
  assert.throws(() => parseQualityAssessment({ scores: [], notes: {} }), /scores must be an object/)
  assert.throws(() => parseQualityScores({ correctness: 4, unsupported: 2 }), /unsupported factor/)
})

test('quality response aggregates include averages and counts without respondent data', () => {
  const makeScores = (correctness, usability) => ({
    correctness,
    reliability: null,
    efficiency: null,
    integrity: null,
    usability,
    maintainability: null,
    flexibility: null,
    testability: null,
    portability: null,
    reusability: null,
    interoperability: null,
  })
  const summary = summarizeQualityResponses([
    { scores: makeScores(5, 4), role: 'resident', userId: 'private-id' },
    { scores: JSON.stringify(makeScores(3, null)), role: 'staff', userId: 'other-private-id' },
  ])

  assert.equal(summary.responseCount, 2)
  assert.equal(summary.totalRatings, 3)
  assert.equal(summary.average, 4)
  assert.deepEqual(summary.factors.correctness, { average: 4, ratedCount: 2 })
  assert.deepEqual(summary.factors.usability, { average: 4, ratedCount: 1 })
  assert.deepEqual(summary.groups.productOperation, { average: 4, ratedCount: 3 })
  assert.equal(JSON.stringify(summary).includes('private-id'), false)
})
