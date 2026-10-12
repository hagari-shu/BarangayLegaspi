import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import barangaySeal from './assets/barangay-seal-new.png'
import {
  createEmptyQualityAssessment,
  getQualityAssessmentStorageKey,
  getQualityAssessmentSummary,
  MCCALL_QUALITY_GROUPS,
  parseQualityAssessment,
  parseQualityScores,
} from './mccall-quality-model'
import translations from './translations'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')

if (!API_BASE) {
  throw new Error('VITE_API_BASE must be configured to point to the deployed API base URL.')
}

export function AdminQualitySummary({ language }) {
  const t = translations[language] || translations.en
  const [state, setState] = useState({ status: 'loading', summary: null })

  useEffect(() => {
    let active = true
    const loadSummary = async () => {
      try {
        const response = await fetch(`${API_BASE}/admin/quality-assessments`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || 'Unable to load quality assessment results.')
        if (active) setState({ status: 'loaded', summary: data.summary })
      } catch (error) {
        console.error('load quality assessment summary failed', error)
        if (active) setState({ status: 'error', summary: null })
      }
    }
    loadSummary()
    window.addEventListener('quality-assessment-saved', loadSummary)

    return () => {
      active = false
      window.removeEventListener('quality-assessment-saved', loadSummary)
    }
  }, [])

  return (
    <article className="panel-card quality-aggregate-card">
      <div className="panel-header">
        <h2>{t.qualityAggregateTitle}</h2>
        {state.summary && <span className="soft-label">{state.summary.responseCount} {t.qualityResponses}</span>}
      </div>
      {state.status === 'loading' && <p className="quality-storage-status">{t.qualityLoading}</p>}
      {state.status === 'error' && <p className="quality-storage-status error" role="alert">{t.qualitySyncFailed}</p>}
      {state.summary && state.summary.responseCount === 0 && <p className="quality-storage-status">{t.qualityNoResponses}</p>}
      {state.summary && state.summary.responseCount > 0 && (
        <>
          <div className="quality-summary-grid">
            <article className="quality-summary-card quality-overall-card">
              <span>{t.qualityOverallScore}</span>
              <strong>{state.summary.average ?? '—'}<small>/5</small></strong>
              <span>{state.summary.totalRatings} {t.qualityRatingsSubmitted}</span>
            </article>
            {MCCALL_QUALITY_GROUPS.map((group) => (
              <article className="quality-summary-card" key={group.id}>
                <span>{group.title[language]}</span>
                <strong>{state.summary.groups[group.id]?.average ?? '—'}<small>/5</small></strong>
                <span>{state.summary.groups[group.id]?.ratedCount || 0} {t.qualityRatingsSubmitted}</span>
              </article>
            ))}
          </div>
          <div className="quality-aggregate-factors">
            {MCCALL_QUALITY_GROUPS.flatMap((group) => group.factors).map((factor) => (
              <div className="quality-aggregate-factor" key={factor.id}>
                <span>{factor.title[language]}</span>
                <strong>{state.summary.factors[factor.id]?.average ?? '—'} / 5</strong>
                <small>{state.summary.factors[factor.id]?.ratedCount || 0} {t.qualityRatingsSubmitted}</small>
              </div>
            ))}
          </div>
        </>
      )}
    </article>
  )
}

export function QualityAssessmentPanel({ accountId, audience, language }) {
  const t = translations[language] || translations.en
  const storageKey = getQualityAssessmentStorageKey(audience, accountId)
  const legacyStorageKey = audience === 'admin' ? `brgy-legaspi-mccall-assessment:${accountId}` : null
  const [syncStatus, setSyncStatus] = useState('loading')
  const [saving, setSaving] = useState(false)
  const [assessmentState, setAssessmentState] = useState(() => {
    try {
      const storedAssessment = localStorage.getItem(storageKey)
      if (storedAssessment) {
        return {
          assessment: parseQualityAssessment(JSON.parse(storedAssessment)),
          storageError: false,
          migrationNeeded: false,
        }
      }

      const legacyAssessment = legacyStorageKey ? localStorage.getItem(legacyStorageKey) : null
      const assessment = legacyAssessment ? parseQualityAssessment(JSON.parse(legacyAssessment)) : createEmptyQualityAssessment()
      let storageError = false
      if (legacyAssessment) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(assessment))
        } catch (error) {
          console.error('migrate McCall quality assessment failed', error)
          storageError = true
        }
      }
      return {
        assessment,
        storageError,
      }
    } catch (error) {
      console.error('load McCall quality assessment failed', error)
      return { assessment: createEmptyQualityAssessment(), storageError: true }
    }
  })
  const summary = getQualityAssessmentSummary(assessmentState.assessment)
  const scoreLabels = [t.qualityWeak, t.qualityLimited, t.qualityAdequate, t.qualityStrong, t.qualityExcellent]
  const hasLocalScores = useRef(Object.values(assessmentState.assessment.scores).some((score) => score !== null))

  useEffect(() => {
    let active = true
    const loadAssessment = async () => {
      try {
        const response = await fetch(`${API_BASE}/quality-assessment`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || 'Unable to load your quality ratings.')
        const remoteScores = parseQualityScores(data.assessment?.scores)
        if (!active) return
        setAssessmentState((current) => {
          const assessment = {
            ...current.assessment,
            scores: data.assessment?.updatedAt ? remoteScores : current.assessment.scores,
            updatedAt: data.assessment?.updatedAt || current.assessment.updatedAt,
          }
          try {
            localStorage.setItem(storageKey, JSON.stringify(assessment))
            return { assessment, storageError: false }
          } catch (error) {
            console.error('save local quality feedback failed', error)
            return { assessment, storageError: true }
          }
        })
        setSyncStatus(data.assessment?.updatedAt ? 'ready' : hasLocalScores.current ? 'unsaved' : 'ready')
      } catch (error) {
        console.error('load quality assessment failed', error)
        if (active) setSyncStatus('error')
      }
    }
    loadAssessment()
    return () => {
      active = false
    }
  }, [storageKey])

  const updateAssessment = (factorId, field, value) => {
    const assessment = {
      ...assessmentState.assessment,
      [field]: { ...assessmentState.assessment[field], [factorId]: value },
    }
    if (field === 'scores') setSyncStatus('unsaved')
    setAssessmentState((current) => ({ assessment, storageError: current.storageError }))
    try {
      localStorage.setItem(storageKey, JSON.stringify(assessment))
    } catch (error) {
      console.error('save McCall quality assessment failed', error)
      setAssessmentState({ assessment, storageError: true })
    }
  }

  const saveAssessment = async () => {
    setSaving(true)
    setSyncStatus('saving')
    try {
      const response = await fetch(`${API_BASE}/quality-assessment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: assessmentState.assessment.scores }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to save your quality ratings.')
      const assessment = {
        ...assessmentState.assessment,
        scores: parseQualityScores(data.assessment?.scores),
        updatedAt: data.assessment?.updatedAt || new Date().toISOString(),
      }
      setAssessmentState((current) => ({ assessment, storageError: current.storageError }))
      try {
        localStorage.setItem(storageKey, JSON.stringify(assessment))
      } catch (error) {
        console.error('save local quality feedback failed', error)
        setAssessmentState({ assessment, storageError: true })
      }
      if (audience === 'admin') window.dispatchEvent(new Event('quality-assessment-saved'))
      setSyncStatus('saved')
    } catch (error) {
      console.error('save quality assessment failed', error)
      setSyncStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="quality-assessment" aria-labelledby="quality-assessment-title">
      <p className="quality-intro">{t.qualityModelDescription}</p>
      <div className="quality-summary-grid">
        <article className="quality-summary-card quality-overall-card">
          <span>{t.qualityOverallScore}</span>
          <strong>{summary.average ?? '—'}<small>/5</small></strong>
          <span>{summary.ratedCount} / {summary.factorCount} {t.qualityFactorsRated}</span>
        </article>
        {summary.groups.map((group) => (
          <article className="quality-summary-card" key={group.id}>
            <span>{group.title[language]}</span>
            <strong>{group.average ?? '—'}<small>/5</small></strong>
            <span>{group.ratedCount} / {group.factorCount} {t.qualityFactorsRated}</span>
          </article>
        ))}
      </div>

      <div className={`quality-sync-panel ${syncStatus === 'error' || assessmentState.storageError ? 'error' : ''}`}>
        <p className="quality-storage-status" role="status" aria-live="polite">
          {syncStatus === 'loading' ? t.qualityLoading
            : syncStatus === 'saving' ? t.qualitySaving
              : syncStatus === 'error' ? t.qualitySyncFailed
                : syncStatus === 'unsaved' ? t.qualityUnsaved
                : assessmentState.storageError ? t.qualityStorageUnavailable
                  : assessmentState.assessment.updatedAt
                    ? `${t.qualitySavedLocally} ${t.qualityLastUpdated}: ${new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(assessmentState.assessment.updatedAt))}`
                    : t.qualityStoragePrivacy}
        </p>
        <p className="quality-sync-privacy">{t.qualityAggregatePrivacy}</p>
        <button className="primary-btn small" type="button" onClick={saveAssessment} disabled={syncStatus === 'loading' || saving}>
          {syncStatus === 'error' ? t.qualityRetrySave : t.qualitySaveRatings}
        </button>
      </div>

      {MCCALL_QUALITY_GROUPS.map((group) => (
        <section className="quality-group" key={group.id} aria-labelledby={`quality-group-${audience}-${group.id}`}>
          <h2 id={`quality-group-${audience}-${group.id}`}>{group.title[language]}</h2>
          <div className="quality-factor-list">
            {group.factors.map((factor) => (
              <article className="quality-factor-card" key={factor.id}>
                <div className="quality-factor-copy">
                  <h3>{factor.title[language]}</h3>
                  <p>{factor.description[language]}</p>
                </div>
                <label className="quality-score-field" htmlFor={`quality-score-${audience}-${factor.id}`}>
                  <span>{t.qualityRating}</span>
                  <select
                    id={`quality-score-${audience}-${factor.id}`}
                    value={assessmentState.assessment.scores[factor.id] ?? ''}
                    disabled={syncStatus === 'loading' || saving}
                    onChange={(event) => updateAssessment(factor.id, 'scores', event.target.value === '' ? null : Number(event.target.value))}
                  >
                    <option value="">{t.qualityChooseScore} · {t.qualityNotRated}</option>
                    {scoreLabels.map((label, index) => (
                      <option key={label} value={index + 1}>{index + 1} — {label}</option>
                    ))}
                  </select>
                </label>
                <label className="quality-evidence-field" htmlFor={`quality-evidence-${audience}-${factor.id}`}>
                  <span>{t.qualityEvidence}</span>
                  <textarea
                    id={`quality-evidence-${audience}-${factor.id}`}
                    value={assessmentState.assessment.notes[factor.id]}
                    disabled={syncStatus === 'loading' || saving}
                    maxLength={500}
                    rows={2}
                    placeholder={t.qualityEvidencePlaceholder}
                    onChange={(event) => updateAssessment(factor.id, 'notes', event.target.value)}
                  />
                </label>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  )
}

export function QualityModelPage({ accountId, audience, language, setLanguage, onLogout }) {
  const t = translations[language] || translations.en
  const dashboardPath = audience === 'staff' ? '/staff' : audience === 'admin' ? '/admin' : '/dashboard'
  const returnLabel = audience === 'staff' ? t.staffPortal : audience === 'admin' ? t.adminPortal : t.residentPortal

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar admin-topbar">
        <div className="brand-wrap">
          <img className="seal-logo tiny" src={barangaySeal} alt="" />
          <div>
            <div className="brand-name">{t.barangayLegaspi}</div>
            <small>{audience === 'staff' ? t.staffPortal : audience === 'admin' ? t.adminPortal : t.residentPortal}</small>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="language-toggle" role="group" aria-label={t.languageSelectionLabel}>
            <button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
            <button type="button" className={language === 'fil' ? 'active' : ''} aria-pressed={language === 'fil'} onClick={() => setLanguage('fil')}>FIL</button>
          </div>
          <Link to={dashboardPath} className="secondary-btn small">{t.backToPortal.replace('{portal}', returnLabel)}</Link>
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>
      <main className="dashboard-main quality-page-main">
        <section className="content-panel">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{t.qualityModelNav}</p>
              <h1 id="quality-assessment-title">{t.qualityModelTitle}</h1>
            </div>
          </div>
          {audience === 'admin' && <AdminQualitySummary language={language} />}
          <QualityAssessmentPanel key={`${audience}:${accountId}`} accountId={accountId} audience={audience} language={language} />
        </section>
      </main>
    </div>
  )
}
