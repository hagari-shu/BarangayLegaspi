import test from 'node:test'
import assert from 'node:assert/strict'
import translations from '../src/translations.js'

test('translation catalog includes Mau help and MFA labels', () => {
  const en = translations.en
  const fil = translations.fil

  assert.match(en.mauWelcome || '', /Mau/i)
  assert.ok(en.mauError)
  assert.ok(en.mauOptionsLabel)
  assert.ok(en.mauSuggestions)
  assert.ok(en.mfaTitle)
  assert.ok(en.mfaCodeLabel)
  assert.ok(en.mfaVerify)
  assert.ok(en.mfaResend)

  assert.ok(fil.mauError)
  assert.ok(fil.mfaTitle)
  assert.ok(fil.mfaVerify)
})
