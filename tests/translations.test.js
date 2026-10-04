import test from 'node:test'
import assert from 'node:assert/strict'
import translations from '../src/translations.js'

test('filipino translation includes resident and admin labels', () => {
  const fil = translations.fil

  assert.equal(fil.residentPortal, 'Portal ng Resident')
  assert.equal(fil.requestService, 'Humiling ng Serbisyo')
  assert.equal(fil.requestHistory, 'Kasaysayan ng request')
  assert.equal(fil.statusNeedsInformation, 'Kailangan ng impormasyon')
  assert.equal(fil.statusCompleted, 'Nakumpleto')
  assert.equal(fil.physicalCopy, 'Pisikal na kopya')
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
  assert.ok(en.mauWelcome.includes('Mau'))
  assert.ok(fil.mauWelcome.includes('Mau'))
  assert.equal(typeof en.mauHelper, 'string')
  assert.ok(fil.mauHelper.toLowerCase().includes('barangay legaspi'))
})

test('Facebook group and profile links have localized labels', () => {
  for (const locale of [translations.en, translations.fil]) {
    assert.ok(locale.socialMediaLinks)
    assert.ok(locale.facebookGroup)
    assert.ok(locale.facebookGroupHint)
    assert.ok(locale.facebookProfile)
    assert.ok(locale.facebookProfileHint)
  }
})

test('captain photo controls and profile details have localized labels', () => {
  for (const locale of [translations.en, translations.fil]) {
    assert.ok(locale.captainIdentification)
    assert.ok(locale.captainPhotoLabel)
    assert.ok(locale.captainPortraitAlt)
    assert.ok(locale.addCaptainPhoto)
    assert.ok(locale.captainRole)
    assert.ok(locale.captainLocation)
    assert.ok(locale.captainPhotoInvalid)
    assert.ok(locale.captainPhotoTooLarge)
  }
})
