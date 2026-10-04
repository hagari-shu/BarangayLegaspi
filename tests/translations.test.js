import test from 'node:test'
import assert from 'node:assert/strict'
import { getMauQuickOptions, getMauReply, getMauResidentAnswer, getMauWelcome } from '../src/mau-responses.js'
import translations from '../src/translations.js'

test('filipino translation includes resident and admin labels', () => {
  const fil = translations.fil

  assert.equal(fil.residentPortal, 'Portal ng Residente')
  assert.equal(fil.requestStatusTracker, 'Pagsubaybay sa kalagayan ng kahilingan')
  assert.equal(fil.requestHistory, 'Kasaysayan ng mga kahilingan')
  assert.equal(fil.requestStatusHistory, 'Kasaysayan ng kalagayan')
  assert.equal(fil.landingHeaderSignIn, 'Mag-sign in')
  assert.equal(fil.requestService, 'Humiling ng Serbisyo')
  assert.equal(fil.statusNeedsInformation, 'Kailangan ng karagdagang impormasyon')
  assert.equal(fil.statusCompleted, 'Natapos')
  assert.equal(fil.physicalCopy, 'Pisikal na kopya')
  assert.equal(fil.dashboard, 'Dashboard')
  assert.equal(fil.overview, 'Pangkalahatang-ideya')
  assert.equal(fil.staffPortal, 'Portal ng Staff')
  assert.equal(fil.adminConsole, 'Admin Console')
  assert.ok(fil.mauWelcome.includes('Mau'))
})

test('homepage header actions are localized', () => {
  assert.equal(translations.en.landingHeaderSignIn, 'Sign in')
  assert.equal(translations.fil.landingHeaderSignIn, 'Mag-sign in')
})

test('request status tracker label is localized', () => {
  assert.equal(translations.en.requestStatusTracker, 'Request Status Tracker')
  assert.equal(translations.fil.requestStatusTracker, 'Pagsubaybay sa kalagayan ng kahilingan')
})

test('mau assistant includes locale-aware labels and reply metadata', () => {
  const fil = translations.fil
  const en = translations.en

  assert.equal(typeof fil.mauPlaceholder, 'string')
  assert.equal(typeof fil.mauAsk, 'string')
  assert.equal(typeof fil.mauSend, 'string')
  assert.equal(typeof fil.mauHelper, 'string')
  assert.equal(typeof fil.mauCloseLabel, 'string')
  assert.equal(typeof fil.mauOutOfScope, 'string')
  assert.equal(typeof fil.mauEmpty, 'string')
  assert.equal(typeof fil.mauTooLong, 'string')
  assert.equal(fil.mauOptionsHide, 'Itago ang mga mungkahing tanong')
  assert.equal(fil.mauOptionsShow, 'Ipakita ang mga mungkahing tanong')
  assert.equal(fil.mobileOrEmail, 'Numero ng cellphone o email')
  assert.equal(fil.officialAccess, 'Para lamang sa mga awtorisadong gumagamit')
  assert.ok(en.mauWelcome.includes('Mau'))
  assert.ok(fil.mauWelcome.includes('Mau'))
  assert.ok(en.mauOutOfScope.includes('Sorry'))
  assert.ok(fil.mauOutOfScope.includes('Paumanhin'))
  assert.equal(typeof en.mauHelper, 'string')
  assert.ok(fil.mauHelper.toLowerCase().includes('barangay legaspi'))
})

test('Mau answers supported topics in the selected language and handles other questions politely', () => {
  const cases = [
    ['en', 'How do I submit a service request?', 'mauReply'],
    ['en', 'What is my request status?', 'mauStatusReply'],
    ['en', 'How do I verify my account?', 'mauVerificationReply'],
    ['en', 'Where can I read barangay announcements?', 'mauAnnouncementReply'],
    ['en', 'I forgot my password', 'mauPasswordReply'],
    ['en', 'Hello', 'mauGreetingReply'],
    ['fil', 'Paano mag-submit ng request?', 'mauReply'],
    ['fil', 'Ano ang status ng request ko?', 'mauStatusReply'],
    ['fil', 'Paano beripikahin ang account?', 'mauVerificationReply'],
    ['fil', 'Paano mag-verify ng account?', 'mauVerificationReply'],
    ['fil', 'Saan mababasa ang mga anunsyo ng barangay?', 'mauAnnouncementReply'],
    ['fil', 'Paano ko malalaman ang kalagayan ng kahilingan ko?', 'mauStatusReply'],
    ['fil', 'Nakalimutan ko ang password ko', 'mauPasswordReply'],
    ['fil', 'Kamusta', 'mauGreetingReply'],
  ]

  for (const [language, question, responseKey] of cases) {
    assert.equal(getMauReply(question, language, translations[language]), translations[language][responseKey], `${language}: ${question}`)
  }

  assert.equal(
    getMauReply('Can you help me plan a vacation?', 'en', translations.en),
    translations.en.mauOutOfScope,
  )
  assert.equal(
    getMauReply('Paano magluto ng adobo?', 'fil', translations.fil),
    translations.fil.mauOutOfScope,
  )
})

test('Mau tailors homepage and authenticated guidance to residency and user role', () => {
  assert.match(getMauWelcome('en', 'resident', false, true, translations), /are you a resident/i)
  assert.match(getMauWelcome('fil', 'resident', false, true, translations), /residente po ba kayo/i)
  assert.equal(getMauResidentAnswer('Yes, I am a resident'), 'yes')
  assert.equal(getMauResidentAnswer('Taga Barangay Legaspi po ako'), 'yes')
  assert.equal(getMauResidentAnswer('No, I am not a resident'), 'no')
  assert.equal(getMauResidentAnswer('Hindi po ako taga Barangay Legaspi'), 'no')
  assert.equal(getMauResidentAnswer('Oo, residente ako'), 'yes')
  assert.equal(getMauResidentAnswer('Hindi, hindi ako residente'), 'no')

  assert.deepEqual(
    getMauQuickOptions('en', 'resident', false, true, 'asked', translations),
    [translations.en.mauHomeYesOption, translations.en.mauHomeNoOption],
  )
  assert.deepEqual(
    getMauQuickOptions('fil', 'resident', false, true, 'confirmed', translations),
    [translations.fil.mauVisitorRegisterOption, translations.fil.mauVisitorLoginOption],
  )
  assert.deepEqual(
    getMauQuickOptions('en', 'staff', true, false, 'confirmed', translations),
    [translations.en.mauStaffRequestsOption, translations.en.mauStaffUpdateOption, translations.en.mauStaffAnnouncementsOption],
  )
  const quickOptionCases = [
    ['resident', false, true, 'confirmed', 'mauVisitorRegisterOption', 'mauRegisterReply'],
    ['resident', false, true, 'confirmed', 'mauVisitorLoginOption', 'mauLoginReply'],
    ['resident', true, false, 'confirmed', 'mauResidentStatusOption', 'mauStatusReply'],
    ['resident', true, false, 'confirmed', 'mauResidentRequestOption', 'mauReply'],
    ['resident', true, false, 'confirmed', 'mauResidentPasswordOption', 'mauPasswordReply'],
    ['staff', true, false, 'confirmed', 'mauStaffRequestsOption', 'mauStaffRequestsReply'],
    ['staff', true, false, 'confirmed', 'mauStaffUpdateOption', 'mauStaffUpdateReply'],
    ['staff', true, false, 'confirmed', 'mauStaffAnnouncementsOption', 'mauStaffAnnouncementsReply'],
    ['admin', true, false, 'confirmed', 'mauAdminApprovalsOption', 'mauAdminApprovalsReply'],
    ['admin', true, false, 'confirmed', 'mauAdminUsersOption', 'mauAdminUsersReply'],
    ['admin', true, false, 'confirmed', 'mauAdminAuditOption', 'mauAdminAuditReply'],
  ]

  for (const [role, authenticated, homepage, residency, optionKey, replyKey] of quickOptionCases) {
    const question = translations.fil[optionKey]
    assert.equal(
      getMauReply(question, 'fil', translations.fil, role, authenticated, homepage, residency),
      translations.fil[replyKey],
      `Filipino quick option should trigger its reply: ${question}`,
    )
  }

  assert.equal(
    getMauReply('Paano ko babaguhin ang kalagayan ng isang kahilingan?', 'fil', translations.fil, 'staff', true),
    translations.fil.mauStaffUpdateReply,
  )

  assert.deepEqual(
    getMauQuickOptions('fil', 'admin', true, false, 'confirmed', translations),
    [translations.fil.mauAdminApprovalsOption, translations.fil.mauAdminUsersOption, translations.fil.mauAdminAuditOption],
  )

  assert.equal(
    getMauReply('Yes, I am a resident', 'en', translations.en, 'resident', false, true, 'asked'),
    translations.en.mauResidentYesReply,
  )
  assert.equal(
    getMauReply('Hindi, hindi ako residente', 'fil', translations.fil, 'resident', false, true, 'asked'),
    translations.fil.mauResidentNoReply,
  )
  assert.equal(
    getMauReply('How do I register?', 'en', translations.en, 'resident', false, true, 'confirmed'),
    translations.en.mauRegisterReply,
  )
  assert.equal(
    getMauReply('Paano magrehistro?', 'fil', translations.fil, 'resident', false, true, 'confirmed'),
    translations.fil.mauRegisterReply,
  )
  assert.equal(
    getMauReply('Paano mag-sign in?', 'fil', translations.fil, 'resident', false, true, 'confirmed'),
    translations.fil.mauLoginReply,
  )
  assert.equal(
    getMauReply('How do I review requests?', 'en', translations.en, 'staff', true),
    translations.en.mauStaffRequestsReply,
  )
  assert.equal(
    getMauReply('Where do I approve resident accounts?', 'en', translations.en, 'admin', true),
    translations.en.mauAdminApprovalsReply,
  )
  assert.equal(
    getMauReply('Where can I review login alerts?', 'en', translations.en, 'admin', true),
    translations.en.mauAdminAuditReply,
  )
  assert.equal(
    getMauReply('Paano pamahalaan ang access ng user?', 'fil', translations.fil, 'admin', true),
    translations.fil.mauAdminUsersReply,
  )
  assert.equal(
    getMauReply('Paano maglathala ng anunsyo?', 'fil', translations.fil, 'staff', true),
    translations.fil.mauStaffAnnouncementsReply,
  )
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
