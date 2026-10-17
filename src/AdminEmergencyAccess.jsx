import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')

const labels = {
  en: {
    title: 'Emergency staff backup access',
    description: 'Use only when authorized staff are unavailable. Requires your current password and expires automatically after 20 minutes.',
    reason: 'Reason for emergency activation (20–500 characters)',
    password: 'Current password',
    code: 'Authenticator code (if MFA is enabled)',
    activate: 'Activate 20-minute access',
    revoke: 'Revoke access now',
    active: 'Emergency access is active',
    inactive: 'No emergency access is active.',
    scopes: 'Allowed: resident registry review and request processing. Account/security settings remain unavailable.',
    openStaff: 'Open Staff Portal',
    expires: 'Expires',
    reasonRequired: 'Enter a clear emergency reason (at least 20 characters) and confirm your current password.',
    activationFailed: 'Could not activate emergency access.',
    statusFailed: 'Could not load emergency access status.',
    revokeFailed: 'Could not revoke emergency access.',
    confirmActivate: 'Activate emergency staff access for 20 minutes? This action will be audited.',
    confirmRevoke: 'Revoke the active emergency staff access now?',
    anotherAdmin: 'Another administrator has an active grant. You cannot use that administrator’s grant.',
  },
  fil: {
    title: 'Pang-emergency na backup access ng kawani',
    description: 'Gamitin lamang kapag walang awtorisadong kawani. Kailangan ang kasalukuyang password at awtomatikong matatapos pagkalipas ng 20 minuto.',
    reason: 'Dahilan ng emergency activation (20–500 karakter)',
    password: 'Kasalukuyang password',
    code: 'Authenticator code (kung naka-enable ang MFA)',
    activate: 'I-activate sa loob ng 20 minuto',
    revoke: 'Bawiin agad ang access',
    active: 'Aktibo ang emergency access',
    inactive: 'Walang aktibong emergency access.',
    scopes: 'Pinapayagan: pagrepaso ng talaan at pagproseso ng kahilingan. Hindi kasama ang account/security settings.',
    openStaff: 'Buksan ang Staff Portal',
    expires: 'Magtatapos',
    reasonRequired: 'Maglagay ng malinaw na dahilan (hindi bababa sa 20 karakter) at kumpirmahin ang kasalukuyang password.',
    activationFailed: 'Hindi ma-activate ang emergency access.',
    statusFailed: 'Hindi makuha ang status ng emergency access.',
    revokeFailed: 'Hindi mabawi ang emergency access.',
    confirmActivate: 'I-activate ang emergency staff access nang 20 minuto? Itatala ang aksiyong ito.',
    confirmRevoke: 'Bawiin na ngayon ang aktibong emergency staff access?',
    anotherAdmin: 'May aktibong grant ang ibang administrator. Hindi mo magagamit ang grant na iyon.',
  },
}

function formatDate(value, language) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(date)
}

export default function AdminEmergencyAccess({ language = 'en' }) {
  const t = labels[language] || labels.en
  const [grant, setGrant] = useState(null)
  const [active, setActive] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadStatus = async (signal) => {
    const response = await fetch(`${API_BASE}/admin/emergency-access`, { signal })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || t.statusFailed)
    setActive(Boolean(data.active))
    setGrant(data.grant || null)
  }

  useEffect(() => {
    const controller = new AbortController()
    loadStatus(controller.signal).catch((loadError) => {
      if (loadError.name !== 'AbortError') {
        console.error('load emergency access status failed', loadError)
        setError(loadError.message || t.statusFailed)
      }
    })
    return () => controller.abort()
  }, [t.statusFailed])

  const activate = async (event) => {
    event.preventDefault()
    if (reason.trim().length < 20 || !password) {
      setError(t.reasonRequired)
      return
    }
    if (!window.confirm(t.confirmActivate)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${API_BASE}/admin/emergency-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), currentPassword: password, code }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.activationFailed)
      setGrant(data.grant)
      setActive(true)
      setReason('')
      setPassword('')
      setCode('')
      setMessage(t.active)
    } catch (activationError) {
      console.error('activate emergency access failed', activationError)
      setError(activationError.message || t.activationFailed)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    if (!window.confirm(t.confirmRevoke)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${API_BASE}/admin/emergency-access/revoke`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.revokeFailed)
      setActive(false)
      setGrant(null)
      setMessage(t.inactive)
    } catch (revokeError) {
      console.error('revoke emergency access failed', revokeError)
      setError(revokeError.message || t.revokeFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="panel-card emergency-access-card">
      <div className="panel-header">
        <h2>{t.title}</h2>
        <span className={`registry-status ${active ? 'is-verified' : 'is-pending'}`}>{active ? t.active : t.inactive}</span>
      </div>
      <p>{t.description}</p>
      <p className="emergency-scope-note">{t.scopes}</p>
      {grant && active && (
        <div className="emergency-grant-details">
          <p><strong>{t.expires}:</strong> <time dateTime={grant.expiresAt}>{formatDate(grant.expiresAt, language)}</time></p>
          {!grant.isOwnGrant && <p>{t.anotherAdmin}</p>}
          {grant.isOwnGrant && <Link className="primary-btn small" to="/staff">{t.openStaff}</Link>}
          <button type="button" className="secondary-btn small" disabled={busy} onClick={revoke}>{t.revoke}</button>
        </div>
      )}
      {!active && (
        <form className="emergency-access-form" onSubmit={activate}>
          <label>{t.reason}<textarea value={reason} maxLength={500} minLength={20} onChange={(event) => setReason(event.target.value)} required /></label>
          <label>{t.password}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label>{t.code}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
          <button type="submit" className="primary-btn small" disabled={busy || reason.trim().length < 20 || !password}>{busy ? '…' : t.activate}</button>
        </form>
      )}
      {message && <p className="registry-message" role="status">{message}</p>}
      {error && <p className="registry-message error" role="alert">{error}</p>}
    </article>
  )
}
