import test from 'node:test'
import assert from 'node:assert/strict'
import { createCertificatePrintHtml, createRegistryPrintHtml, renderCertificateTemplate } from '../src/registry-printing.js'

const labels = {
  barangayName: 'Barangay Legaspi',
  generated: 'Generated',
  residents: 'residents',
  name: 'Resident',
  birthDate: 'Birthdate',
  zone: 'Zone',
  household: 'Household',
  sex: 'Sex',
  maritalStatus: 'Marital status',
  occupation: 'Occupation',
  address: 'Address',
  verification: 'Verification',
  recordStatus: 'Record status',
  unassigned: 'Unassigned',
  confidentialNotice: 'Confidential',
  location: 'Tayug, Pangasinan',
  dateIssued: 'Date issued',
  authorizedOfficial: 'Authorized official',
  reviewBeforeSigning: 'Review before signing.',
}

const resident = {
  id: 'resident-1',
  firstName: 'Maria',
  lastName: 'Dela Cruz',
  birthDate: '1990-02-03',
  zone: 2,
  householdId: 'HH-2',
  address: 'Purok 1',
  maritalStatus: 'Married',
  occupation: 'Teacher',
  status: 'active',
  verificationStatus: 'verified',
}

test('resident roster print escapes data and renders roster fields', () => {
  const html = createRegistryPrintHtml({
    title: 'Zone 2 roster',
    subtitle: 'Zone 2',
    records: [{ ...resident, firstName: '<script>alert(1)</script>' }],
    labels,
  })

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<td><script>alert/)
  assert.match(html, /HH-2/)
  assert.match(html, /Teacher/)
  assert.match(html, /Confidential/)
})

test('resident individual print creates one printable sheet per record', () => {
  const html = createRegistryPrintHtml({
    title: 'Family sheets',
    subtitle: 'HH-2',
    records: [resident, { ...resident, id: 'resident-2', firstName: 'Jose' }],
    mode: 'individuals',
    labels,
  })

  assert.equal((html.match(/class="individual"/g) || []).length, 2)
  assert.match(html, /Maria Dela Cruz/)
  assert.match(html, /Jose Dela Cruz/)
})

test('certificate placeholders fill resident details and custom content is escaped', () => {
  const template = 'I certify that {full_name} from {zone} lives at {address} for {purpose}. {unknown_field}'
  const rendered = renderCertificateTemplate(template, resident, { purpose: 'school admission' })
  assert.equal(rendered, 'I certify that Maria Dela Cruz from Zone 2 lives at Purok 1 for school admission. {unknown_field}')

  const html = createCertificatePrintHtml({
    title: '<script>title()</script>',
    body: 'Resident: {full_name}\n\n<script>run()</script>',
    residents: [{ ...resident, firstName: '<img src=x onerror=alert(1)>' }],
    values: { purpose: 'school admission', issueDate: '2026-10-20', signatory: 'Official', position: 'Secretary' },
    labels,
  })

  assert.match(html, /&lt;script&gt;title\(\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /&lt;script&gt;run\(\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<script>run/)
})

test('custom certificate signature uses the captain role without a signatory name', () => {
  const residentText = renderCertificateTemplate(
    'Prepared for {full_name}. Signature: {signatory}; role: {position}.',
    resident,
    { signatory: '', position: 'Barangay Captain' },
  )
  assert.equal(residentText, 'Prepared for Maria Dela Cruz. Signature: ; role: Barangay Captain.')

  const html = createCertificatePrintHtml({
    title: 'Custom certificate',
    body: residentText,
    residents: [resident],
    values: { purpose: 'school admission', issueDate: '2026-10-20', signatory: '', position: 'Barangay Captain' },
    labels,
  })
  assert.match(html, /<span>Barangay Captain<\/span>/)
  assert.doesNotMatch(html, /Captain Name/)
})

test('certificate preview uses the print layout without opening the print dialog', () => {
  const html = createCertificatePrintHtml({
    title: 'Residency certificate',
    body: 'Resident: {full_name}',
    residents: [resident],
    values: { issueDate: '2026-10-20' },
    labels,
    autoPrint: false,
  })

  assert.match(html, /class="certificate"/)
  assert.doesNotMatch(html, /window\.print\(\)/)
})
