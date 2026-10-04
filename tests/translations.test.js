import test from 'node:test'
import assert from 'node:assert/strict'
import translations from '../src/translations.js'

test('filipino translation includes resident and admin labels', () => {
  const fil = translations.fil

  assert.equal(fil.residentPortal, 'Portal ng Resident')
  assert.equal(fil.requestService, 'Humiling ng Serbisyo')
  assert.equal(fil.dashboard, 'Dashboard')
  assert.equal(fil.overview, 'Pangkalahatang-ideya')
  assert.equal(fil.staffPortal, 'Portal ng Staff')
  assert.equal(fil.adminConsole, 'Admin Console')
  assert.ok(fil.mauWelcome.includes('Mau'))
})

test('mau assistant includes locale-aware labels and reply metadata', () => {
  const fil = translations.fil
  const en = translations.en

  assert.equal(typeof fil.mauPlaceholder, 'string')
  assert.equal(typeof fil.mauAsk, 'string')
  assert.equal(typeof fil.mauSend, 'string')
  assert.equal(typeof fil.mauHelper, 'string')
  assert.equal(typeof fil.mauCloseLabel, 'string')
  assert.equal(typeof en.mauHelper, 'string')
  assert.ok(fil.mauHelper.toLowerCase().includes('barangay'))
})
