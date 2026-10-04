const topics = {
  en: [
    { response: 'mauRegisterReply', keywords: ['register', 'create an account', 'create account', 'sign up', 'new account'] },
    { response: 'mauLoginReply', keywords: ['how do i log in', 'how do i login', 'sign in', 'log in', 'login'] },
    {
      response: 'mauStatusReply',
      keywords: [
        'request status',
        'status of my request',
        'track my request',
        'tracking request',
        'pending request',
        'approved request',
        'rejected request',
        'request progress',
      ],
    },
    {
      response: 'mauPasswordReply',
      keywords: ['password', 'forgot password', 'reset password', 'password recovery'],
    },
    {
      response: 'mauVerificationReply',
      keywords: ['verify account', 'account verification', 'verify my account', 'resident verification', 'verification', 'verified'],
    },
    {
      response: 'mauAnnouncementReply',
      keywords: ['announcement', 'announcements', 'barangay news', 'barangay update', 'barangay updates', 'alerts'],
    },
    {
      response: 'mauReply',
      keywords: [
        'service request',
        'submit request',
        'make a request',
        'request a service',
        'barangay service',
        'resident service',
        'barangay services',
        'certificate',
        'barangay clearance',
        'request',
        'requests',
      ],
    },
  ],
  fil: [
    { response: 'mauRegisterReply', keywords: ['magrehistro', 'magparehistro', 'mag register', 'gumawa ng account', 'gumawa ng resident account', 'mag sign up', 'mag signup'] },
    { response: 'mauLoginReply', keywords: ['paano mag sign in', 'paano mag log in', 'mag sign in', 'mag log in', 'mag login', 'mag-login'] },
    {
      response: 'mauStatusReply',
      keywords: [
        'status ng request',
        'katayuan ng request',
        'status ng kahilingan',
        'lagay ng kahilingan',
        'lagay ng request',
        'kalagayan ng kahilingan',
        'status ng mga kahilingan',
        'subaybayan ang request',
        'subaybayan ang kahilingan',
        'nakabinbing request',
        'aprubadong request',
        'tinanggihang request',
        'progreso ng request',
      ],
    },
    {
      response: 'mauPasswordReply',
      keywords: [
        'password',
        'nakalimutan ang password',
        'ire reset ang password',
        'i reset ang password',
        'pag reset ng password',
      ],
    },
    {
      response: 'mauVerificationReply',
      keywords: [
        'beripikasyon ng account',
        'beripikahin ang account',
        'mag verify ng account',
        'mag verify ng',
        'i verify ang account',
        'verify ang account',
        'verification',
        'beripikasyon',
        'beripikahin',
        'beripika',
        'na verify',
        'naaprubahan ang account',
      ],
    },
    {
      response: 'mauAnnouncementReply',
      keywords: ['anunsyo', 'anunsyo ng barangay', 'balita ng barangay', 'update ng barangay', 'mga update ng barangay', 'abiso'],
    },
    {
      response: 'mauReply',
      keywords: [
        'request sa serbisyo',
        'magsumite ng request',
        'mag submit ng request',
        'kahilingan sa serbisyo',
        'serbisyo ng barangay',
        'mga serbisyo ng barangay',
        'hihiling ng serbisyo',
        'humiling ng serbisyo',
        'kahilingan',
        'sertipiko',
        'barangay clearance',
        'request',
        'requests',
      ],
    },
  ],
}

const staffTopics = {
  en: [
    { response: 'mauStaffRequestsReply', keywords: ['request queue', 'pending requests', 'requests to review', 'review requests', 'review request', 'service request queue'] },
    { response: 'mauStaffUpdateReply', keywords: ['update request status', 'change request status', 'process request', 'approve request', 'reject request'] },
    { response: 'mauStaffAnnouncementsReply', keywords: ['publish announcement', 'post announcement', 'create announcement', 'staff announcement', 'announcement'] },
  ],
  fil: [
    { response: 'mauStaffRequestsReply', keywords: ['mga request na susuriin', 'pila ng request', 'request queue', 'mga nakabinbing request', 'suriin ang mga request', 'suriin ang request', 'susuriin ang mga kahilingan', 'suriin ang mga kahilingan'] },
    { response: 'mauStaffUpdateReply', keywords: ['i update ang status ng request', 'baguhin ang status ng request', 'i update ang lagay ng kahilingan', 'ia update ang lagay ng kahilingan', 'baguhin ang lagay ng kahilingan', 'baguhin ang kalagayan ng isang kahilingan', 'babaguhin ang kalagayan ng isang kahilingan', 'iproseso ang request', 'aprubahan ang request', 'tanggihan ang request'] },
    { response: 'mauStaffAnnouncementsReply', keywords: ['maglathala ng anunsyo', 'mag post ng anunsyo', 'gumawa ng anunsyo', 'anunsyo ng staff', 'anunsyo'] },
  ],
}

const adminTopics = {
  en: [
    { response: 'mauAdminApprovalsReply', keywords: ['pending resident', 'pending verification', 'approve resident', 'approve account', 'resident approval', 'account approval', 'verify account', 'verify resident'] },
    { response: 'mauAdminUsersReply', keywords: ['manage users', 'manage user', 'manage staff', 'user roles', 'change user role', 'create admin'] },
    { response: 'mauAdminAuditReply', keywords: ['audit log', 'audit logs', 'login alert', 'login alerts', 'login attempt', 'blocked login', 'security event'] },
  ],
  fil: [
    { response: 'mauAdminApprovalsReply', keywords: ['resident na naghihintay', 'pending verification', 'aprubahan ang resident', 'aprubahan ang mga resident', 'aaprubahan ang mga resident', 'aprubahan ang account', 'approval ng resident', 'beripikasyon ng account', 'beripikahin ang account', 'beripikahin ang resident'] },
    { response: 'mauAdminUsersReply', keywords: ['pamahalaan ang users', 'pamahalaan ang user', 'pamahalaan ang access', 'pamahalaan ang pahintulot', 'pamamahalaan ang pahintulot', 'pamahalaan ang staff', 'user roles', 'palitan ang role', 'gumawa ng admin'] },
    { response: 'mauAdminAuditReply', keywords: ['audit log', 'mga audit log', 'alerto sa login', 'alerto sa pag sign in', 'login attempt', 'na-block na login', 'security event'] },
  ],
}

const normalize = (value) => ` ${String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()} `

const greetings = new Set([
  'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'kamusta', 'kumusta', 'halo', 'magandang umaga', 'magandang hapon', 'magandang gabi',
])

const residentAnswer = (input) => {
  const answer = normalize(input).trim()
  if (/^(yes|oo|opo)\b/.test(answer) || /^(i am|i m) (a )?(resident|from (barangay )?legaspi)/.test(answer) || /^(taga (barangay )?legaspi|residente ako|nakatira sa (barangay )?legaspi|naninirahan sa (barangay )?legaspi)/.test(answer)) return 'yes'
  if (/^(no|hindi)\b/.test(answer) || /^(not a resident|not from legaspi|i am not from legaspi)/.test(answer)) return 'no'
  return null
}

export function getMauResidentAnswer(input) {
  return residentAnswer(input)
}

export function getMauWelcome(language, userRole, isAuthenticated, isHomepage, translations) {
  if (!isAuthenticated) {
    const label = isHomepage ? 'mauHomeWelcome' : 'mauVisitorWelcome'
    return translations[language]?.[label] || translations.en[label]
  }
  if (userRole === 'admin') return translations[language]?.mauAdminWelcome || translations.en.mauAdminWelcome
  if (userRole === 'staff') return translations[language]?.mauStaffWelcome || translations.en.mauStaffWelcome
  return translations[language]?.mauResidentWelcome || translations.en.mauResidentWelcome
}

export function getMauQuickOptions(language, userRole, isAuthenticated, isHomepage, residencyCheck, translations) {
  const t = translations[language] || translations.en
  if (!isAuthenticated) {
    if (isHomepage && residencyCheck === 'asked') return [t.mauHomeYesOption, t.mauHomeNoOption]
    return [t.mauVisitorRegisterOption, t.mauVisitorLoginOption]
  }
  if (userRole === 'admin') return [t.mauAdminApprovalsOption, t.mauAdminUsersOption, t.mauAdminAuditOption]
  if (userRole === 'staff') return [t.mauStaffRequestsOption, t.mauStaffUpdateOption, t.mauStaffAnnouncementsOption]
  return [t.mauResidentStatusOption, t.mauResidentRequestOption, t.mauResidentPasswordOption]
}

export function getMauReply(input, language, translations, userRole = 'resident', isAuthenticated = true, isHomepage = false, residencyCheck = 'confirmed') {
  const normalizedInput = normalize(input)
  const locale = topics[language] || topics.en

  if (!isAuthenticated && isHomepage && residencyCheck === 'asked') {
    const answer = residentAnswer(input)
    if (answer === 'yes') return translations.mauResidentYesReply
    if (answer === 'no') return translations.mauResidentNoReply
  }

  if (isAuthenticated && userRole === 'admin') {
    const match = (adminTopics[language] || adminTopics.en).find((topic) =>
      topic.keywords.some((keyword) => normalizedInput.includes(normalize(keyword))),
    )
    if (match) return translations[match.response]
  }

  if (!isAuthenticated) {
    const visitorTopic = locale.find((topic) =>
      ['mauRegisterReply', 'mauLoginReply'].includes(topic.response)
      && topic.keywords.some((keyword) => normalizedInput.includes(normalize(keyword))),
    )
    if (visitorTopic) return translations[visitorTopic.response]
  }

  if (isAuthenticated && userRole === 'staff') {
    const match = (staffTopics[language] || staffTopics.en).find((topic) =>
      topic.keywords.some((keyword) => normalizedInput.includes(normalize(keyword))),
    )
    if (match) return translations[match.response]
  }

  for (const topic of locale) {
    if (isAuthenticated && ['mauRegisterReply', 'mauLoginReply'].includes(topic.response)) continue
    if (topic.keywords.some((keyword) => normalizedInput.includes(normalize(keyword)))) {
      return translations[topic.response]
    }
  }

  const normalizedGreeting = normalizedInput.trim()
  if (greetings.has(normalizedGreeting)) {
    if (!isAuthenticated && isHomepage && residencyCheck === 'asked') return translations.mauResidentCheckPrompt
    if (!isAuthenticated) return translations.mauGreetingReply
    return translations[userRole === 'admin' ? 'mauAdminGreetingReply' : userRole === 'staff' ? 'mauStaffGreetingReply' : 'mauGreetingReply']
  }

  if (!isAuthenticated && isHomepage && residencyCheck === 'asked') return translations.mauResidentCheckPrompt
  if (!isAuthenticated) return translations.mauOutOfScope
  if (userRole === 'staff') return translations.mauStaffOutOfScope
  if (userRole === 'admin') return translations.mauAdminOutOfScope
  return translations.mauOutOfScope
}
