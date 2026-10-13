export const MCCALL_QUALITY_GROUPS = [
  {
    id: 'productOperation',
    title: { en: 'Product Operation', fil: 'Pagpapatakbo ng Produkto' },
    factors: [
      {
        id: 'correctness',
        title: { en: 'Correctness', fil: 'Kawastuhan' },
        description: {
          en: 'Whether the portal gives accurate information and completes tasks as expected.',
          fil: 'Kung nagbibigay ng tamang impormasyon at natatapos ng portal ang mga gawain ayon sa inaasahan.',
        },
      },
      {
        id: 'reliability',
        title: { en: 'Reliability', fil: 'Pagiging Maaasahan' },
        description: {
          en: 'How consistently the portal works when you need it.',
          fil: 'Kung gaano palagi gumagana ang portal kapag kailangan mo ito.',
        },
      },
      {
        id: 'efficiency',
        title: { en: 'Efficiency', fil: 'Kahusayan' },
        description: {
          en: 'How quickly the portal responds and helps you finish tasks without extra steps.',
          fil: 'Kung gaano kabilis tumugon ang portal at tulungan kang makatapos ng mga gawain nang walang dagdag na hakbang.',
        },
      },
      {
        id: 'integrity',
        title: { en: 'Integrity', fil: 'Integridad' },
        description: {
          en: 'How confident you feel that the portal protects your information and account.',
          fil: 'Kung gaano ka nagtitiwalang pinoprotektahan ng portal ang iyong impormasyon at account.',
        },
      },
      {
        id: 'usability',
        title: { en: 'Usability', fil: 'Kadalian ng Paggamit' },
        description: {
          en: 'How easy the portal is to learn and use, including for people with disabilities.',
          fil: 'Kung gaano kadaling matutuhan at gamitin ang portal, kabilang ang paggamit ng mga taong may kapansanan.',
        },
      },
    ],
  },
  {
    id: 'productRevision',
    title: { en: 'Product Revision', fil: 'Pagbabago ng Produkto' },
    factors: [
      {
        id: 'maintainability',
        title: { en: 'Maintainability', fil: 'Kadalian ng Pagpapanatili' },
        description: {
          en: 'How well issues or errors you report are acknowledged and resolved.',
          fil: 'Kung gaano kahusay kinikilala at inaayos ang mga isyung o error na iniuulat mo.',
        },
      },
      {
        id: 'flexibility',
        title: { en: 'Flexibility', fil: 'Kakayahang Umangkop' },
        description: {
          en: 'How well the portal supports different needs as your circumstances change.',
          fil: 'Kung gaano kahusay sinusuportahan ng portal ang iba’t ibang pangangailangan habang nagbabago ang iyong sitwasyon.',
        },
      },
      {
        id: 'testability',
        title: { en: 'Testability', fil: 'Kakayahang Masubukan' },
        description: {
          en: 'How clearly the portal confirms that your tasks and changes were completed.',
          fil: 'Kung gaano kalinaw kinukumpirma ng portal na natapos ang iyong mga gawain at pagbabago.',
        },
      },
    ],
  },
  {
    id: 'productTransition',
    title: { en: 'Product Transition', fil: 'Paglipat ng Produkto' },
    factors: [
      {
        id: 'portability',
        title: { en: 'Portability', fil: 'Pagiging Naililipat' },
        description: {
          en: 'How well the portal works on the devices and browsers you use.',
          fil: 'Kung gaano kahusay gumagana ang portal sa mga device at browser na ginagamit mo.',
        },
      },
      {
        id: 'reusability',
        title: { en: 'Reusability', fil: 'Muling Paggamit' },
        description: {
          en: 'How well the portal lets you reuse saved information instead of entering it again.',
          fil: 'Kung gaano kahusay muling magamit ang naka-save na impormasyon sa halip na ilagay itong muli.',
        },
      },
      {
        id: 'interoperability',
        title: { en: 'Interoperability', fil: 'Interoperability' },
        description: {
          en: 'How well the portal works with other barangay services and information channels.',
          fil: 'Kung gaano kahusay gumagana ang portal kasama ng ibang serbisyo at daluyan ng impormasyon ng barangay.',
        },
      },
    ],
  },
]

export const MCCALL_QUALITY_FACTORS = MCCALL_QUALITY_GROUPS.flatMap((group) => group.factors)

export function getQualityAssessmentStorageKey(role, accountId) {
  if (!['admin', 'staff', 'resident'].includes(role)) {
    throw new Error('Assessment role must be admin, staff, or resident.')
  }
  if (accountId === null || accountId === undefined || String(accountId).trim() === '') {
    throw new Error('Assessment account ID is required.')
  }

  return `brgy-legaspi-mccall-assessment:${role}:${encodeURIComponent(String(accountId))}`
}

export function createEmptyQualityAssessment() {
  return {
    scores: Object.fromEntries(MCCALL_QUALITY_FACTORS.map(({ id }) => [id, null])),
    notes: Object.fromEntries(MCCALL_QUALITY_FACTORS.map(({ id }) => [id, ''])),
    updatedAt: null,
  }
}

export function parseQualityAssessment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Assessment must be an object.')
  }
  if (!value.scores || typeof value.scores !== 'object' || Array.isArray(value.scores)) {
    throw new Error('Assessment scores must be an object.')
  }
  if (!value.notes || typeof value.notes !== 'object' || Array.isArray(value.notes)) {
    throw new Error('Assessment evidence must be an object.')
  }

  const emptyAssessment = createEmptyQualityAssessment()
  const scores = {}
  const notes = {}

  for (const { id } of MCCALL_QUALITY_FACTORS) {
    const score = value.scores[id] ?? null
    const note = value.notes[id] ?? ''
    if (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) {
      throw new Error(`Invalid score for ${id}.`)
    }
    if (typeof note !== 'string' || note.length > 500) {
      throw new Error(`Invalid evidence note for ${id}.`)
    }
    scores[id] = score
    notes[id] = note
  }

  const updatedAt = value.updatedAt ?? null
  if (updatedAt !== null && (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt)))) {
    throw new Error('Invalid assessment update date.')
  }

  return { ...emptyAssessment, scores, notes, updatedAt }
}

export function parseQualityScores(scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    throw new Error('Assessment scores must be an object.')
  }
  const knownFactors = new Set(MCCALL_QUALITY_FACTORS.map(({ id }) => id))
  if (Object.keys(scores).some((id) => !knownFactors.has(id))) {
    throw new Error('Assessment includes an unsupported factor.')
  }
  const notes = Object.fromEntries(MCCALL_QUALITY_FACTORS.map(({ id }) => [id, '']))
  return parseQualityAssessment({ scores, notes }).scores
}

export function summarizeQualityResponses(responses) {
  const factors = Object.fromEntries(MCCALL_QUALITY_FACTORS.map(({ id }) => [id, { total: 0, ratedCount: 0 }]))

  for (const response of responses) {
    const scores = typeof response.scores === 'string' ? JSON.parse(response.scores) : response.scores
    const parsedScores = parseQualityScores(scores)
    for (const { id } of MCCALL_QUALITY_FACTORS) {
      const score = parsedScores[id]
      if (score === null) continue
      factors[id].total += score
      factors[id].ratedCount += 1
    }
  }

  const toAverage = ({ total, ratedCount }) => ratedCount === 0 ? null : Number((total / ratedCount).toFixed(1))
  const summarizedFactors = Object.fromEntries(
    MCCALL_QUALITY_FACTORS.map(({ id }) => [id, { average: toAverage(factors[id]), ratedCount: factors[id].ratedCount }]),
  )
  const groups = Object.fromEntries(MCCALL_QUALITY_GROUPS.map((group) => {
    const groupTotal = group.factors.reduce((total, { id }) => total + factors[id].total, 0)
    const ratedCount = group.factors.reduce((total, { id }) => total + factors[id].ratedCount, 0)
    return [group.id, { average: toAverage({ total: groupTotal, ratedCount }), ratedCount }]
  }))
  const totalRatings = Object.values(factors).reduce((total, factor) => total + factor.ratedCount, 0)
  const totalScore = Object.values(factors).reduce((total, factor) => total + factor.total, 0)

  return {
    responseCount: responses.length,
    totalRatings,
    average: toAverage({ total: totalScore, ratedCount: totalRatings }),
    factors: summarizedFactors,
    groups,
  }
}

export function getQualityAssessmentSummary(assessment) {
  const summarize = (factors) => {
    const scores = factors
      .map(({ id }) => assessment.scores[id])
      .filter((score) => score !== null)

    return {
      ratedCount: scores.length,
      average: scores.length === 0
        ? null
        : Number((scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1)),
    }
  }

  return {
    ...summarize(MCCALL_QUALITY_FACTORS),
    factorCount: MCCALL_QUALITY_FACTORS.length,
    groups: MCCALL_QUALITY_GROUPS.map((group) => ({
      ...group,
      ...summarize(group.factors),
      factorCount: group.factors.length,
    })),
  }
}
