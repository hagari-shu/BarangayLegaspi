import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import barangaySeal from './assets/barangay-seal-new.png'
import legaspiHero from './assets/legaspi-community.png'
import { getMauQuickOptions, getMauReply, getMauResidentAnswer, getMauWelcome } from './mau-responses'
import { reportClientError } from './client-error-reporting'
import { getReportDateRange } from './report-date-range'
import { isStaffReportResponse } from './report-contract'
import { getActiveRequestCount, getRequestStatusCounts, getRequestStatusMessage, REQUEST_WORKFLOW_STAGES } from './request-workflow'
import StaffRegistryPanel from './StaffRegistryPanel'
import StaffPrintCenter from './StaffPrintCenter'
import StaffInvitationPage from './StaffInvitationPage'
import translations from './translations'
import './App.css'

const sessionKey = 'brgy-legaspi-session'
const readableTextStorageKey = 'brgy-legaspi-readable-text'
const getRequestReminderStorageKey = (userId) => `brgy-legaspi-request-reminders:${userId}`
const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')
const BrandingContext = createContext({ logoUrl: '', refreshLogo: () => {} })
const isAdminRole = (role) => role === 'admin' || role === 'super_admin'
const getDashboardPath = (role) => role === 'super_admin'
  ? '/super-admin'
  : role === 'admin'
    ? '/admin'
    : role === 'staff'
      ? '/staff'
      : '/dashboard'

if (!API_BASE) {
  throw new Error('VITE_API_BASE must be configured to point to the deployed API base URL, such as https://api.example.com/api.')
}

function SystemLogo({ alt = '', className }) {
  const { logoUrl } = useContext(BrandingContext)
  const [failedLogoUrl, setFailedLogoUrl] = useState('')
  const usingDefault = !logoUrl || failedLogoUrl === logoUrl

  return (
    <img
      className={className}
      src={usingDefault ? barangaySeal : logoUrl}
      alt={alt}
      onError={() => { if (logoUrl) setFailedLogoUrl(logoUrl) }}
    />
  )
}

// Simple fetch wrapper to automatically attach Authorization header for API calls when a session token exists
const _originalFetch = window.fetch.bind(window)
window.fetch = (input, init = {}) => {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(sessionKey) : null
    const token = saved ? JSON.parse(saved).token : null
    if (typeof input === 'string' && input.startsWith(API_BASE) && !input.startsWith(`${API_BASE}/client-errors`)) {
      init = init || {}
      init.headers = { ...(init.headers || {}), Authorization: token ? 'Bearer ' + token : '' }
    }
  } catch (e) {
    // ignore errors here to avoid breaking UI if localStorage inaccessible
  }
  return _originalFetch(input, init)
}

const sanitizeText = (value = '') => String(value).replace(/[<>]/g, '').trim()
const getRequestStatusLabel = (status, t) => {
  const stage = REQUEST_WORKFLOW_STAGES.find((item) => item.status === status)
  return stage ? t[stage.labelKey] : status === 'Available' ? t.availableLabel : status || t.statusSubmitted
}
const getStaffPositionLabel = (position, t) => ({
  Staff: t.staffRole,
  Secretary: t.secretaryRole,
  'Barangay Captain': t.barangayCaptainRole,
  Treasurer: t.treasurerRole,
  'Utility Worker': t.utilityWorkerRole,
}[position] || position)
const getStaffAvailabilityLabel = (availability, t) => ({
  Available: t.availableLabel,
  Busy: t.busyStatus,
  'On Duty': t.onDutyStatus,
}[availability] || availability)
const isValidIdentifier = (value) => /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$|^09\d{9}$/.test(String(value).trim())
const isValidPassword = (value) => {
  const password = String(value).trim()
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9\s]/.test(password)
}

const LanguageToggle = ({ language, setLanguage, className = '' }) => {
  const [largeText, setLargeText] = useState(() => {
    try {
      return localStorage.getItem(readableTextStorageKey) === 'true'
    } catch (error) {
      console.error('load readable text preference failed', error)
      return false
    }
  })
  const t = translations[language] || translations.en

  useEffect(() => {
    document.documentElement.classList.toggle('large-readable-text', largeText)
    try {
      localStorage.setItem(readableTextStorageKey, String(largeText))
    } catch (error) {
      console.error('save readable text preference failed', error)
    }
  }, [largeText])

  return (
    <>
      <div className={`language-toggle ${className}`} role="group" aria-label={t.languageSelectionLabel}>
        <button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
        <button type="button" className={language === 'fil' ? 'active' : ''} aria-pressed={language === 'fil'} onClick={() => setLanguage('fil')}>FIL</button>
      </div>
      <button
        type="button"
        className={`text-size-toggle${largeText ? ' active' : ''}${className ? ` ${className}-text-size` : ''}`}
        aria-label={largeText ? t.standardText : t.largerText}
        aria-pressed={largeText}
        title={largeText ? t.standardText : t.largerText}
        onClick={() => setLargeText((current) => !current)}
      >
        <span aria-hidden="true">Aa</span><span className="text-size-toggle-mark" aria-hidden="true">{largeText ? '−' : '+'}</span>
      </button>
    </>
  )
}

function PasswordField({ id, label, value, onChange, language = 'en', autoComplete = 'new-password', minLength = 8, placeholder, required = true, helpText }) {
  const [visible, setVisible] = useState(false)
  const t = translations[language] || translations.en

  return (
    <div className="password-field-block">
      {label && <label htmlFor={id}>{label}</label>}
      <div className="password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          minLength={minLength}
          placeholder={placeholder}
          required={required}
        />
        <button
          type="button"
          className="toggle-password"
          aria-label={visible ? t.hidePassword : t.showPassword}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5c5.4 0 9.8 4.3 11.4 6.5-1.6 2.2-6 6.5-11.4 6.5S2.2 13.7.6 11.5C2.2 9.3 6.6 5 12 5Zm0 2a8.2 8.2 0 0 0-7.8 4.5A8.2 8.2 0 0 0 12 16a8.2 8.2 0 0 0 7.8-4.5A8.2 8.2 0 0 0 12 7Zm0 2.5A2 2 0 1 1 12 14a2 2 0 0 1 0-4.5Z" />
          </svg>
        </button>
      </div>
      {helpText && <small>{helpText}</small>}
    </div>
  )
}

function RequestHistory({ history = [], t }) {
  if (!Array.isArray(history) || history.length === 0) {
    return <p className="empty-history">{t.noRequestHistory}</p>
  }

  return (
    <ol className="request-history-list">
      {history.map((event, index) => (
        <li key={event.id || `${event.createdAt}-${event.kind}-${index}`}>
          <strong>{event.kind === 'follow-up' ? t.followUpLabel : getRequestStatusLabel(event.status, t)}</strong>
          <time dateTime={event.createdAt}>{event.createdAt ? new Date(event.createdAt).toLocaleString() : ''}</time>
          {(event.note || event.message) && <p>{event.note === 'Resident provided a follow-up.' ? t.followUpResponseReceived : event.note || event.message}</p>}
          {event.actorName && <small>{event.actorName}</small>}
        </li>
      ))}
    </ol>
  )
}

const readStoredSession = () => {
  try {
    const saved = localStorage.getItem(sessionKey)
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

const writeStoredSession = (session) => {
  try {
    localStorage.setItem(sessionKey, JSON.stringify(session))
  } catch {
    // Ignore storage write issues in private browsing / restricted environments
  }
}

const clearStoredSession = () => {
  try {
    localStorage.removeItem(sessionKey)
  } catch {
    // Ignore removal failures
  }
}

const initialProfile = {
  firstName: '',
  lastName: '',
  mobile: '',
  email: '',
  address: '',
  householdId: '',
  familyMembers: 0,
  status: '',
}

const initialRequests = []
const defaultSocialAccounts = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'messenger', label: 'Messenger' },
]

const getDisplayName = (user = {}) => {
  const firstName = user.firstName ?? user.first_name ?? ''
  const lastName = user.lastName ?? user.last_name ?? ''
  return [firstName, lastName].filter(Boolean).join(' ') || user.name || 'Unknown user'
}

const getUserRole = (user = {}) => {
  if (user.role) return user.role
  if (user.position) return 'staff'
  return 'resident'
}

const formatDateValue = (value) => {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString()
}

function WorkflowModal({ title, onClose, children, wide = false, className = '', disableClose = false, closeLabel = 'Close dialog', closeButtonRef, trapFocus = false }) {
  const titleId = 'workflow-modal-title'
  const modalRef = useRef(null)
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !disableClose) onClose()
      if (event.key === 'Tab' && trapFocus) {
        const focusableElements = modalRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (!focusableElements?.length) return

        const firstElement = focusableElements[0]
        const lastElement = focusableElements[focusableElements.length - 1]
        if (event.shiftKey && (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement))) {
          event.preventDefault()
          lastElement.focus()
        } else if (!event.shiftKey && (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement))) {
          event.preventDefault()
          firstElement.focus()
        }
      }
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [disableClose, onClose, trapFocus])

  return (
    <div className="modal-overlay" onMouseDown={(event) => {
      if (!disableClose && event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={modalRef}
        className={`modal-content workflow-modal${wide ? ' workflow-modal-wide' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button type="button" ref={closeButtonRef} className="modal-close" aria-label={closeLabel} onClick={onClose} disabled={disableClose}>×</button>
        <div className="modal-header workflow-modal-header"><h2 id={titleId}>{title}</h2></div>
        <div className="workflow-modal-body">{children}</div>
      </section>
    </div>
  )
}

function AccountCreationModal({ allowedRoles, language, onClose, onCreated }) {
  const t = translations[language] || translations.en
  const [role, setRole] = useState(allowedRoles.includes('admin') ? 'staff' : allowedRoles[0])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [position, setPosition] = useState('Staff')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createdAccount, setCreatedAccount] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const endpoint = role === 'admin' ? '/admin/users' : '/staff/members'
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          mobile: mobile.trim(),
          position,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.accountCreationUnavailable)
      onCreated?.(data.user)
      setCreatedAccount(data)
    } catch (requestError) {
      setError(requestError.message || t.accountCreationUnavailable)
    } finally {
      setBusy(false)
    }
  }

  return (
    <WorkflowModal title={t.accountCreationTitle} onClose={onClose} wide disableClose={busy}>
      {createdAccount ? (
        <div className="editor-panel workflow-modal-form">
          <p role="status">{t.accountCreatedNotice}</p>
          <p><strong>{createdAccount.user?.email ? t.accountCreationEmail : t.mobileNumberLabel}:</strong> {createdAccount.user?.email || createdAccount.user?.mobile || mobile}</p>
          <p><strong>{t.temporaryPassword}:</strong></p>
          <input className="mfa-secret-input" value={createdAccount.temporaryPassword || ''} readOnly onFocus={(event) => event.target.select()} aria-label={t.temporaryPassword} />
          <p className="report-metric-note">{t.temporaryPasswordShareWarning}</p>
          <div className="editor-actions">
            <button type="button" className="primary-btn small" onClick={onClose}>{t.done}</button>
          </div>
        </div>
      ) : (
        <form className="editor-panel workflow-modal-form" onSubmit={submit}>
          <p>{t.accountCreationIntro}</p>
          <p className="report-metric-note">{t.accountCreationPermissionNote}</p>
          <div className="editor-grid">
            {allowedRoles.length > 1 && (
              <div className="input-block">
                <label htmlFor="account-creation-role">{t.accountCreationRole}</label>
                <select id="account-creation-role" value={role} onChange={(event) => setRole(event.target.value)}>
                  {allowedRoles.map((option) => (
                    <option key={option} value={option}>{option === 'admin' ? t.administrator : t.staffRole}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="input-block">
              <label htmlFor="account-creation-first-name">{t.firstName}</label>
              <input id="account-creation-first-name" autoComplete="given-name" maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
            </div>
            <div className="input-block">
              <label htmlFor="account-creation-last-name">{t.lastName}</label>
              <input id="account-creation-last-name" autoComplete="family-name" maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} required />
            </div>
            <div className="input-block">
              <label htmlFor="account-creation-email">{t.emailOptional}</label>
              <input id="account-creation-email" type="email" autoComplete="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby="account-creation-email-hint" />
              <small id="account-creation-email-hint">{t.accountCreationEmailHint}</small>
            </div>
            <div className="input-block">
              <label htmlFor="account-creation-mobile">{t.mobileNumberLabel}</label>
              <input id="account-creation-mobile" type="tel" autoComplete="tel" inputMode="numeric" pattern="09[0-9]{9}" maxLength={11} value={mobile} onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').slice(0, 11))} aria-describedby="account-creation-mobile-hint" required />
              <small id="account-creation-mobile-hint">{t.philippinesMobileFormatHint}</small>
            </div>
            {role === 'staff' && (
              <div className="input-block">
                <label htmlFor="account-creation-position">{t.accountCreationPosition}</label>
                <select id="account-creation-position" value={position} onChange={(event) => setPosition(event.target.value)}>
                  <option value="Staff">{t.staffRole}</option>
                  <option value="Secretary">{t.secretaryRole}</option>
                  <option value="Barangay Captain">{t.barangayCaptainRole}</option>
                  <option value="Treasurer">{t.treasurerRole}</option>
                  <option value="Utility Worker">{t.utilityWorkerRole}</option>
                </select>
              </div>
            )}
          </div>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="editor-actions">
            <button type="button" className="secondary-btn small" onClick={onClose} disabled={busy}>{t.cancel}</button>
            <button type="submit" className="primary-btn small" disabled={busy}>{busy ? t.working : t.createAccount}</button>
          </div>
        </form>
      )}
    </WorkflowModal>
  )
}

function ConfirmationModal({ title, message, onClose, onConfirm, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) {
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const confirm = async () => {
    setBusy(true)
    setErrorMessage('')
    try {
      await onConfirm()
      onClose()
    } catch (error) {
      setErrorMessage(error.message || 'Unable to complete this action.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <WorkflowModal title={title} onClose={onClose} disableClose={busy}>
      <p>{message}</p>
      {errorMessage && <p className="modal-error" role="alert">{errorMessage}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary-btn small" onClick={onClose} disabled={busy}>{cancelLabel}</button>
        <button type="button" className="small-action danger" onClick={confirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </WorkflowModal>
  )
}

function UserDetailModal({ user, onClose, onUserUpdated, onArchive, allowEdit = false }) {
  const [editableUser, setEditableUser] = useState(() => ({ ...(user || {}) }))
  const [householdMembersText, setHouseholdMembersText] = useState(() => (
    Array.isArray(user?.householdMembers)
      ? user.householdMembers.map((member) => `${member.name || ''} | ${member.relationship || ''}`).join('\n')
      : ''
  ))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditableUser({ ...(user || {}) })
    setHouseholdMembersText(Array.isArray(user?.householdMembers)
      ? user.householdMembers.map((member) => `${member.name || ''} | ${member.relationship || ''}`).join('\n')
      : '')
  }, [user])

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    const previousDocumentOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
    }
  }, [])

  if (!user) return null

  const fullName = getDisplayName(editableUser)
  const role = getUserRole(editableUser)
  const zone = editableUser.zone ?? editableUser.zoneNumber ?? 'N/A'
  const createdAt = formatDateValue(editableUser.createdAt || editableUser.created_at)
  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U'

  const handleFieldChange = (field, value) => {
    setEditableUser((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!allowEdit || !onUserUpdated) return

    setSaving(true)
    try {
      const payload = {
        firstName: editableUser.firstName ?? editableUser.first_name ?? '',
        lastName: editableUser.lastName ?? editableUser.last_name ?? '',
        email: editableUser.email ?? '',
        mobile: editableUser.mobile ?? '',
        role: editableUser.role ?? role,
        status: editableUser.status ?? 'Active Resident',
        zone: editableUser.zone ?? null,
        position: editableUser.position ?? null,
        availability: editableUser.availability ?? 'Available',
        address: editableUser.address ?? '',
        householdId: editableUser.householdId ?? editableUser.household_id ?? null,
        familyMembers: editableUser.familyMembers ?? editableUser.family_members ?? 4,
        householdMembers: householdMembersText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [name = '', ...relationshipParts] = line.split('|')
            return { name: name.trim(), relationship: relationshipParts.join('|').trim() }
          }),
      }

      const response = await fetch(`${API_BASE}/admin/users/${editableUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || 'Unable to update user.')
      }

      onUserUpdated?.(data.user || payload)
      setEditableUser({ ...editableUser, ...(data.user || payload) })
    } catch (error) {
      alert(error.message || 'Unable to update user.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content user-detail-modal" role="dialog" aria-modal="true" aria-labelledby="user-detail-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close user details">×</button>
        <div className="modal-header">
          <div className="modal-avatar">{initials}</div>
          <div>
            <h2 id="user-detail-title">{fullName}</h2>
            <p>{role.charAt(0).toUpperCase() + role.slice(1)} • {zone !== 'N/A' ? `Zone ${zone}` : 'No assigned zone'}</p>
          </div>
        </div>

        <div className="modal-body">
          <div className="info-box">
            <h3>Personal Information</h3>
            <dl>
              <div><dt>Full Name</dt><dd>{allowEdit ? (
                <div className="inline-edit-grid">
                  <input value={editableUser.firstName ?? editableUser.first_name ?? ''} onChange={(event) => handleFieldChange('firstName', event.target.value)} />
                  <input value={editableUser.lastName ?? editableUser.last_name ?? ''} onChange={(event) => handleFieldChange('lastName', event.target.value)} />
                </div>
              ) : fullName}</dd></div>
              {role !== 'resident' && <div><dt>Email</dt><dd>{allowEdit ? <input value={editableUser.email || ''} onChange={(event) => handleFieldChange('email', event.target.value)} /> : (editableUser.email || 'N/A')}</dd></div>}
              {role !== 'staff' && <div><dt>Mobile</dt><dd>{allowEdit ? <input value={editableUser.mobile || ''} onChange={(event) => handleFieldChange('mobile', event.target.value)} /> : (editableUser.mobile || 'N/A')}</dd></div>}
              <div><dt>Role</dt><dd>{role.charAt(0).toUpperCase() + role.slice(1)}</dd></div>
              {role !== 'staff' && <div><dt>Status</dt><dd>{allowEdit ? <input value={editableUser.status || ''} onChange={(event) => handleFieldChange('status', event.target.value)} /> : (editableUser.status || 'N/A')}</dd></div>}
              <div><dt>Zone</dt><dd>{allowEdit ? (
                <select value={editableUser.zone ?? ''} onChange={(event) => handleFieldChange('zone', event.target.value === '' ? null : Number(event.target.value))}>
                  <option value="">Select zone</option>
                  {[1, 2, 3, 4, 5, 6, 7].map((zoneNumber) => <option key={zoneNumber} value={zoneNumber}>Zone {zoneNumber}</option>)}
                </select>
              ) : (zone !== 'N/A' ? `Zone ${zone}` : 'N/A')}</dd></div>
              <div><dt>Created Account</dt><dd>{createdAt}</dd></div>
              {allowEdit ? (
                <>
                  <div><dt>Position</dt><dd><input value={editableUser.position || ''} onChange={(event) => handleFieldChange('position', event.target.value)} /></dd></div>
                  <div><dt>Availability</dt><dd><input value={editableUser.availability || ''} onChange={(event) => handleFieldChange('availability', event.target.value)} /></dd></div>
                </>
              ) : (
                <>
                  {editableUser.position && <div><dt>Position</dt><dd>{editableUser.position}</dd></div>}
                  {editableUser.availability && <div><dt>Availability</dt><dd>{editableUser.availability}</dd></div>}
                </>
              )}
            </dl>
          </div>

          {role === 'resident' && (
            <div className="info-box">
              <h3>Resident Details</h3>
              <dl>
                <div><dt>Email</dt><dd>{allowEdit ? <input value={editableUser.email || ''} onChange={(event) => handleFieldChange('email', event.target.value)} /> : (editableUser.email || 'N/A')}</dd></div>
                <div><dt>Household ID</dt><dd>{allowEdit ? <input value={editableUser.householdId || editableUser.household_id || ''} onChange={(event) => handleFieldChange('householdId', event.target.value)} /> : (editableUser.householdId || editableUser.household_id || 'N/A')}</dd></div>
                <div><dt>Family Members</dt><dd>{allowEdit ? <input type="number" min="1" value={editableUser.familyMembers ?? editableUser.family_members ?? 4} onChange={(event) => handleFieldChange('familyMembers', Number(event.target.value) || 0)} /> : (editableUser.familyMembers ?? editableUser.family_members ?? 'N/A')}</dd></div>
                <div><dt>Address</dt><dd>{allowEdit ? <input value={editableUser.address || ''} onChange={(event) => handleFieldChange('address', event.target.value)} /> : (editableUser.address || 'N/A')}</dd></div>
                <div><dt>Household Members</dt><dd>{allowEdit ? (
                  <textarea
                    aria-label="Household members"
                    rows="4"
                    placeholder="One member per line: Full name | Relationship"
                    value={householdMembersText}
                    onChange={(event) => setHouseholdMembersText(event.target.value)}
                  />
                ) : (Array.isArray(editableUser.householdMembers) && editableUser.householdMembers.length > 0 ? editableUser.householdMembers.map((member) => `${member.name} (${member.relationship})`).join(', ') : 'None listed')}</dd></div>
              </dl>
            </div>
          )}

          {role === 'staff' && (
            <div className="info-box">
              <h3>Staff Access Details</h3>
              <dl>
                <div><dt>Email</dt><dd>{allowEdit ? <input value={editableUser.email || ''} onChange={(event) => handleFieldChange('email', event.target.value)} /> : (editableUser.email || 'N/A')}</dd></div>
                <div><dt>Mobile Number</dt><dd>{allowEdit ? <input value={editableUser.mobile || ''} onChange={(event) => handleFieldChange('mobile', event.target.value)} /> : (editableUser.mobile || 'N/A')}</dd></div>
                <div><dt>Status</dt><dd>{allowEdit ? <input value={editableUser.status || ''} onChange={(event) => handleFieldChange('status', event.target.value)} /> : (editableUser.status || 'N/A')}</dd></div>
                <div><dt>Position</dt><dd>{allowEdit ? <input value={editableUser.position || ''} onChange={(event) => handleFieldChange('position', event.target.value)} /> : (editableUser.position || 'Staff')}</dd></div>
                <div><dt>Availability</dt><dd>{allowEdit ? <input value={editableUser.availability || ''} onChange={(event) => handleFieldChange('availability', event.target.value)} /> : (editableUser.availability || 'N/A')}</dd></div>
                <div><dt>Assigned Zone</dt><dd>{zone !== 'N/A' ? `Zone ${zone}` : 'N/A'}</dd></div>
              </dl>
            </div>
          )}

          {allowEdit && (
            <div className="modal-actions">
              {role === 'resident' && editableUser.status !== 'Disabled' && onArchive && (
                <button type="button" className="small-action danger" onClick={onArchive}>Archive resident</button>
              )}
              <button type="button" className="primary-btn small" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProtectedRoute({ isAuthenticated, allowedRoles, userRole, children }) {
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  if (allowedRoles && !allowedRoles.includes(userRole)) {
    const fallback = getDashboardPath(userRole)
    return <Navigate to={fallback} replace />
  }

  return children
}

async function optimizeCaptainPhoto(file) {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Unable to process the selected image.'))
      }, 'image/webp', 0.82)
    })
  } finally {
    bitmap.close()
  }
}

function OfficialProfileSettings({ language, canManageLogo = false }) {
  const t = translations[language] || translations.en
  const initialProfiles = [
    { role: 'captain', displayName: '', profileUrl: '', groupUrl: '', communityLinks: [] },
    { role: 'secretary', displayName: '', profileUrl: '', groupUrl: '', communityLinks: [] },
    { role: 'treasurer', displayName: '', profileUrl: '', groupUrl: '', communityLinks: [] },
  ]
  const { refreshLogo } = useContext(BrandingContext)
  const [profiles, setProfiles] = useState(initialProfiles)
  const [loading, setLoading] = useState(true)
  const [savingRole, setSavingRole] = useState('')
  const [photoBusyRole, setPhotoBusyRole] = useState('')
  const [logoBusy, setLogoBusy] = useState(false)
  const [photoVersions, setPhotoVersions] = useState({})
  const [error, setError] = useState('')
  const fileInputs = useRef({})
  const logoInput = useRef(null)

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/official-profiles`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(data.profiles)) {
          throw new Error(data.message || t.officialProfilesLoadFailed)
        }
        if (active) {
          setProfiles(data.profiles.map((profile) => ({
            ...profile,
            communityLinks: Array.isArray(profile.communityLinks)
              ? profile.communityLinks
              : profile.groupUrl ? [profile.groupUrl] : [],
          })))
          setError('')
        }
      })
      .catch((loadError) => {
        console.error('load official profiles failed', loadError)
        if (active) setError(t.officialProfilesLoadFailed)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [t.officialProfilesLoadFailed])

  const handleSaveProfile = async (event, role) => {
    event.preventDefault()
    const profile = profiles.find((item) => item.role === role)
    if (!profile) return

    setSavingRole(role)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/admin/official-profiles/${role}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profile.displayName,
          profileUrl: profile.profileUrl,
          communityLinks: profile.communityLinks || [],
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.officialProfileSaveFailed)
      setProfiles((current) => current.map((item) => item.role === role
        ? { ...item, ...data.profile }
        : item))
    } catch (saveError) {
      console.error('save official profile failed', saveError)
      setError(saveError.message || t.officialProfileSaveFailed)
    } finally {
      setSavingRole('')
    }
  }

  const handleUpload = async (event, role) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t.captainPhotoInvalid)
      return
    }
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      setError(t.captainPhotoTooLarge)
      return
    }

    setPhotoBusyRole(role)
    setError('')
    try {
      const optimizedPhoto = await optimizeCaptainPhoto(file)
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(optimizedPhoto.type)) {
        throw new Error(t.captainPhotoInvalid)
      }
      if (optimizedPhoto.size < 1 || optimizedPhoto.size > 5 * 1024 * 1024) {
        throw new Error(t.captainPhotoTooLarge)
      }
      const route = `${API_BASE}/admin/official-profiles/${role}/photo`
      const linkResponse = await fetch(`${route}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: optimizedPhoto.type }),
      })
      const upload = await linkResponse.json().catch(() => ({}))
      if (!linkResponse.ok) throw new Error(upload.message || t.captainPhotoUploadFailed)

      const form = new FormData()
      for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
      form.append('file', optimizedPhoto, `${role}-photo.webp`)
      const storageResponse = await fetch(upload.url, { method: 'POST', body: form })
      if (!storageResponse.ok) throw new Error(t.captainPhotoUploadFailed)

      const finalizeResponse = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: upload.key }),
      })
      const result = await finalizeResponse.json().catch(() => ({}))
      if (!finalizeResponse.ok) throw new Error(result.message || t.captainPhotoUploadFailed)
      setPhotoVersions((current) => ({ ...current, [role]: Date.now() }))
    } catch (uploadError) {
      console.error('upload official profile photo failed', uploadError)
      setError(uploadError.message || t.captainPhotoUploadFailed)
    } finally {
      setPhotoBusyRole('')
    }
  }

  const handleRemove = async (role) => {
    setPhotoBusyRole(role)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/admin/official-profiles/${role}/photo`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.captainPhotoUploadFailed)
      setPhotoVersions((current) => ({ ...current, [role]: Date.now() }))
    } catch (removeError) {
      console.error('remove official profile photo failed', removeError)
      setError(removeError.message || t.captainPhotoUploadFailed)
    } finally {
      setPhotoBusyRole('')
    }
  }

  const handleLogoUpload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t.systemLogoInvalid)
      return
    }
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      setError(t.systemLogoTooLarge)
      return
    }

    setLogoBusy(true)
    setError('')
    try {
      const route = `${API_BASE}/admin/system-logo`
      const linkResponse = await fetch(`${route}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type }),
      })
      const upload = await linkResponse.json().catch(() => ({}))
      if (!linkResponse.ok) throw new Error(upload.message || t.systemLogoUploadFailed)

      const form = new FormData()
      for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
      form.append('file', file, file.name)
      const storageResponse = await fetch(upload.url, { method: 'POST', body: form })
      if (!storageResponse.ok) throw new Error(t.systemLogoUploadFailed)

      const finalizeResponse = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: upload.key }),
      })
      const result = await finalizeResponse.json().catch(() => ({}))
      if (!finalizeResponse.ok) throw new Error(result.message || t.systemLogoUploadFailed)
      refreshLogo()
    } catch (uploadError) {
      console.error('upload system logo failed', uploadError)
      setError(uploadError.message || t.systemLogoUploadFailed)
    } finally {
      setLogoBusy(false)
    }
  }

  const handleLogoRemove = async () => {
    setLogoBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/admin/system-logo`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.systemLogoUploadFailed)
      refreshLogo()
    } catch (removeError) {
      console.error('remove system logo failed', removeError)
      setError(removeError.message || t.systemLogoUploadFailed)
    } finally {
      setLogoBusy(false)
    }
  }

  const labels = {
    captain: t.barangayCaptainRole,
    secretary: t.secretaryRole,
    treasurer: t.treasurerRole,
  }

  return (
    <article className="panel-card official-profile-settings">
      <div className="panel-header">
        <h2>{t.officialProfilesTitle}</h2>
        <span className="soft-label">{t.captainPhotoStorageHint}</span>
      </div>
      {loading && <p role="status">{t.loadingRequests}</p>}
      <div className="official-profile-settings-grid">
        {profiles.map((profile) => (
          <form key={profile.role} className="official-profile-editor" onSubmit={(event) => handleSaveProfile(event, profile.role)}>
            <h3>{labels[profile.role]}</h3>
            {profile.role === 'captain' && (
              <p className="current-officeholder">
                {t.currentCaptain}: <strong>{profile.displayName || t.currentCaptainNameMissing}</strong>
              </p>
            )}
            <label>
              {t.officialNameLabel}
              <input
                maxLength={120}
                value={profile.displayName || ''}
                onChange={(event) => setProfiles((current) => current.map((item) => item.role === profile.role
                  ? { ...item, displayName: event.target.value }
                  : item))}
              />
            </label>
            <label>
              {t.officialProfileLinkLabel}
              <input
                type="url"
                placeholder="https://"
                value={profile.profileUrl || ''}
                onChange={(event) => setProfiles((current) => current.map((item) => item.role === profile.role
                  ? { ...item, profileUrl: event.target.value }
                  : item))}
              />
            </label>
            <fieldset className="official-community-links">
              <legend>{t.officialGroupLinkLabel}</legend>
              {(profile.communityLinks || []).map((url, index) => (
                <div className="official-community-link-row" key={`${profile.role}-community-${index}`}>
                  <label>
                    {t.communityLinkNumber.replace('{number}', String(index + 1))}
                    <input
                      type="url"
                      placeholder="https://"
                      value={url}
                      onChange={(event) => setProfiles((current) => current.map((item) => item.role === profile.role
                        ? { ...item, communityLinks: item.communityLinks.map((link, linkIndex) => linkIndex === index ? event.target.value : link) }
                        : item))}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-btn small"
                    aria-label={t.removeCommunityLink.replace('{number}', String(index + 1))}
                    onClick={() => setProfiles((current) => current.map((item) => item.role === profile.role
                      ? { ...item, communityLinks: item.communityLinks.filter((_, linkIndex) => linkIndex !== index) }
                      : item))}
                  >
                    {t.remove}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="secondary-btn small"
                disabled={(profile.communityLinks || []).length >= 8}
                onClick={() => setProfiles((current) => current.map((item) => item.role === profile.role
                  ? { ...item, communityLinks: [...(item.communityLinks || []), ''] }
                  : item))}
              >
                {t.addAnotherCommunityLink}
              </button>
            </fieldset>
            <div className="official-profile-photo-row">
              <img
                key={photoVersions[profile.role] || 'initial'}
                src={`${API_BASE}/official-profiles/${profile.role}/photo?v=${photoVersions[profile.role] || 0}`}
                alt=""
                onError={(event) => { event.currentTarget.hidden = true }}
              />
              <input
                ref={(element) => { fileInputs.current[profile.role] = element }}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label={t.officialProfilePhotoLabel.replace('{role}', labels[profile.role])}
                disabled={photoBusyRole === profile.role}
                onChange={(event) => handleUpload(event, profile.role)}
              />
              <button
                className="secondary-btn small"
                type="button"
                disabled={photoBusyRole === profile.role}
                onClick={() => fileInputs.current[profile.role]?.click()}
              >
                {photoBusyRole === profile.role ? t.captainPhotoUploading : t.captainPhotoChoose}
              </button>
              <button
                className="secondary-btn small"
                type="button"
                disabled={photoBusyRole === profile.role}
                onClick={() => handleRemove(profile.role)}
              >
                {t.captainPhotoRemove}
              </button>
            </div>
            <button className="primary-btn small" type="submit" disabled={savingRole === profile.role || loading}>
              {savingRole === profile.role ? t.saving : t.saveChanges}
            </button>
          </form>
        ))}
      </div>
      {canManageLogo && (
        <section className="system-logo-settings" aria-labelledby="system-logo-title">
          <div>
            <h3 id="system-logo-title">{t.systemLogoTitle}</h3>
            <p className="field-note">{t.systemLogoHint}</p>
          </div>
          <SystemLogo className="system-logo-preview" alt={t.systemLogoTitle} />
          <input
            ref={logoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={t.systemLogoTitle}
            disabled={logoBusy}
            onChange={handleLogoUpload}
          />
          <div className="system-logo-actions">
            <button className="secondary-btn small" type="button" disabled={logoBusy} onClick={() => logoInput.current?.click()}>
              {logoBusy ? t.captainPhotoUploading : t.systemLogoChoose}
            </button>
            <button className="secondary-btn small" type="button" disabled={logoBusy} onClick={handleLogoRemove}>
              {t.systemLogoRemove}
            </button>
          </div>
        </section>
      )}
      {error && <p className="captain-photo-error" role="alert">{error}</p>}
    </article>
  )
}

function StaffTemporaryAccessPage({ onLogin, language, setLanguage }) {
  const navigate = useNavigate()
  const t = translations[language] || translations.en
  const [challengeToken, setChallengeToken] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const redemptionStarted = useRef(false)

  useEffect(() => {
    let active = true
    if (redemptionStarted.current) return () => { active = false }
    redemptionStarted.current = true
    const accessToken = window.location.hash.slice(1)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)

    if (!/^[0-9a-f]{64}$/i.test(accessToken)) {
      setError(t.staffAccessInvalid)
      setBusy(false)
      return () => { active = false }
    }

    fetch(`${API_BASE}/staff/temporary-access/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || t.staffAccessInvalid)
        if (data.requiresMfa) {
          if (active) setChallengeToken(data.challengeToken)
          return
        }
        if (!data.token || data.user?.role !== 'staff') throw new Error(t.staffAccessInvalid)
        if (active) {
          onLogin({ token: data.token, user: data.user, identifier: data.user.email, role: 'staff', isActive: true })
          navigate('/staff', { replace: true })
        }
      })
      .catch((redeemError) => {
        if (active) setError(redeemError.message || t.staffAccessInvalid)
      })
      .finally(() => {
        if (active) setBusy(false)
      })

    return () => { active = false }
  }, [navigate, onLogin, t.staffAccessInvalid])

  const handleMfaSubmit = async (event) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(mfaCode.trim())) {
      setError(t.mfaInvalid)
      return
    }

    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/login/mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, code: mfaCode.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.mfaInvalid)
      if (!data.token || data.user?.role !== 'staff') throw new Error(t.staffAccessInvalid)
      onLogin({ token: data.token, user: data.user, identifier: data.user.email, role: 'staff', isActive: true })
      navigate('/staff', { replace: true })
    } catch (submitError) {
      setError(submitError.message || t.mfaInvalid)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-screen staff-access-screen">
      <section className="login-card" aria-labelledby="staff-access-title">
        <LanguageToggle language={language} setLanguage={setLanguage} />
        <h1 id="staff-access-title">{t.staffTemporaryAccess}</h1>
        {busy && <p role="status">{t.loadingRequests}</p>}
        {challengeToken && !busy && (
          <form onSubmit={handleMfaSubmit}>
            <p>{t.mfaHelper}</p>
            <label htmlFor="staff-temporary-mfa-code">{t.mfaCodeLabel}</label>
            <input
              id="staff-temporary-mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))}
            />
            <button className="primary-btn" type="submit" disabled={busy}>{t.mfaVerify}</button>
          </form>
        )}
        {error && <p className="captain-photo-error" role="alert">{error}</p>}
        <Link to="/" className="secondary-btn small">{t.backToPortal.replace('{portal}', t.residentPortal)}</Link>
      </section>
    </main>
  )
}

function LoginPage({ onLogin, language, setLanguage }) {
  const navigate = useNavigate()
  const t = translations[language] || translations.en
  const [officialProfiles, setOfficialProfiles] = useState([
    { role: 'captain', displayName: '', profileUrl: '', groupUrl: '', communityLinks: [] },
    { role: 'secretary', displayName: '', profileUrl: '', groupUrl: '', communityLinks: [] },
    { role: 'treasurer', displayName: '', profileUrl: '', groupUrl: '', communityLinks: [] },
  ])
  const [form, setForm] = useState({
    identifier: '',
    password: '',
    rememberMe: false,
  })
  const [loginError, setLoginError] = useState('')
  const [mfaState, setMfaState] = useState({ required: false, challengeToken: '', identifier: '' })
  const [mfaCode, setMfaCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetForm, setResetForm] = useState({ identifier: '', token: '', newPassword: '' })
  const [resetRequested, setResetRequested] = useState(false)
  const [resetManualPasswordRequired, setResetManualPasswordRequired] = useState(false)
  const [resetTemporaryPassword, setResetTemporaryPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [captainPhotoAvailable, setCaptainPhotoAvailable] = useState(true)
  const captainProfile = officialProfiles.find((profile) => profile.role === 'captain')

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/official-profiles`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(data.profiles)) {
          throw new Error(data.message || t.officialProfilesLoadFailed)
        }
        if (active) setOfficialProfiles(data.profiles)
      })
      .catch((error) => console.error('load public official profiles failed', error))
    return () => { active = false }
  }, [t.officialProfilesLoadFailed])

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target
    setLoginError('')
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const cleanedIdentifier = sanitizeText(form.identifier)
    const password = String(form.password)

    if (!cleanedIdentifier || !password) {
      alert(t.loginRequired)
      return
    }

    if (!isValidIdentifier(cleanedIdentifier) || password.length < 8) {
      alert(t.loginFormatInvalid)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanedIdentifier, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.code === 'resident_not_approved') {
          setLoginError(t.loginAwaitingApproval)
          return
        }
        throw new Error(data.message || 'Login failed.')
      }

      if (data.requiresMfa) {
        setMfaState({ required: true, challengeToken: data.challengeToken, identifier: cleanedIdentifier })
        setMfaCode('')
        return
      }

      const nextRole = data.user?.role || 'resident'
      onLogin({
        token: data.token,
        user: data.user,
        identifier: cleanedIdentifier,
        role: nextRole,
        isActive: true,
        mustChangePassword: Boolean(data.mustChangePassword || data.user?.mustChangePassword),
      })
      navigate(data.mustChangePassword || data.user?.mustChangePassword ? '/settings' : getDashboardPath(nextRole))
    } catch (error) {
      setLoginError(error.message || 'Your login details are not recognized. Please try again.')
    }
  }

  const handleMfaSubmit = async (event) => {
    event.preventDefault()

    if (!mfaState.required) return

    if (!/^[0-9]{6}$/.test(String(mfaCode).trim())) {
      alert(t.mfaInvalid)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/login/mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: mfaState.challengeToken, code: String(mfaCode).trim() }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.message || 'Login failed.')
      }

      const nextRole = data.user?.role || 'resident'
      onLogin({
        token: data.token,
        user: data.user,
        identifier: mfaState.identifier,
        role: nextRole,
        isActive: true,
      })
      setMfaState({ required: false, challengeToken: '', identifier: '' })
      setMfaCode('')
      navigate(getDashboardPath(nextRole))
    } catch (error) {
      alert(error.message || 'Your login details are not recognized. Please try again or use the demo account.')
    }
  }

  const closeResetModal = () => {
    setShowReset(false)
    setResetRequested(false)
    setResetManualPasswordRequired(false)
    setResetTemporaryPassword('')
    setResetForm({ identifier: '', token: '', newPassword: '' })
  }

  const handleResetSubmit = async (event) => {
    event.preventDefault()
    if (resetRequested && resetManualPasswordRequired && !isValidPassword(resetForm.newPassword)) {
      alert(t.newPasswordRequirementsError.replace('{requirements}', t.passwordRequirements))
      return
    }
    setResetting(true)
    try {
      const endpoint = resetRequested ? `${API_BASE}/reset-password` : `${API_BASE}/reset-password/request`
      const body = resetRequested
        ? resetManualPasswordRequired
          ? { token: resetForm.token, newPassword: resetForm.newPassword }
          : { token: resetForm.token, generateTemporaryPassword: true }
        : { identifier: resetForm.identifier }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok && data.code === 'manual_password_required') {
        setResetManualPasswordRequired(true)
        alert(data.message || t.resetManualPasswordInstructions)
        return
      }
      if (!response.ok) throw new Error(data.message || 'Unable to reset password.')

      if (!resetRequested) {
        if (data.deliveryStatus === 'helpdesk') {
          alert(t.resetHelpdeskInstructions)
          return
        }
        if (!['queued', 'sent'].includes(data.deliveryStatus) && !data.resetToken) {
          alert(t.resetRequestGeneric)
          return
        }
        setResetRequested(true)
        if (data.resetToken) {
          setResetForm((current) => ({ ...current, token: data.resetToken }))
        }
        alert(data.message || t.resetRequestGeneric)
      } else if (data.temporaryPassword) {
        setResetTemporaryPassword(data.temporaryPassword)
        setResetForm((current) => ({ ...current, token: '', newPassword: '' }))
      } else {
        alert(data.message)
        closeResetModal()
        setForm((current) => ({ ...current, password: '' }))
      }
    } catch (error) {
      alert(error.message || 'Unable to reset password.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar landing-topbar" aria-label="Top bar">
        <div className="landing-header-inner">
          <a className="landing-brand" href="/" aria-label={`${t.barangayLegaspi} - ${t.residentPortal}`}>
            <SystemLogo />
            <span>
              <strong>{t.barangayLegaspi}</strong>
              <span>{t.residentPortal}</span>
            </span>
          </a>
          <div className="landing-header-actions">
            <a className="landing-header-signin" href="#login-card">{t.landingHeaderSignIn}</a>
            <LanguageToggle language={language} setLanguage={setLanguage} />
          </div>
        </div>
      </header>

      <main className="login-screen">
        <section className="landing-intro" aria-labelledby="landing-headline">
          <img className="landing-image" src={legaspiHero} alt="Barangay Legaspi community display lit up at night" />
          <div className="landing-copy">
            <p className="landing-eyebrow">{t.officialResident}</p>
            <h1 id="landing-headline">{t.landingHeadline}</h1>
            <p>{t.landingDescription}</p>
            <a className="landing-cta" href="#login-card">{t.landingCta}</a>
          </div>
          <ul className="landing-benefits">
            <li><span aria-hidden="true">✓</span>{t.landingServiceRequests}</li>
            <li><span aria-hidden="true">✓</span>{t.landingTrackRequests}</li>
            <li><span aria-hidden="true">✓</span>{t.landingOfficialUpdates}</li>
          </ul>
        </section>
        <div className="portal-entry">
          <div className="brand-block" aria-label="Barangay brand">
            <div className="brand-logo-frame">
              <SystemLogo className="seal-logo" alt="Barangay Legaspi official seal" />
            </div>
            <div className="brand-copy">
              <span className="brand-kicker">{t.officialResident}</span>
              <h1>{t.barangayLegaspi}</h1>
              <p>{t.residentPortal}</p>
              <span className="brand-location">Tayug, Pangasinan</span>
            </div>
            <section className="captain-card captain-profile-hero" aria-label={t.captainIdentification}>
              <div className="captain-photo-picker">
                {captainPhotoAvailable ? (
                  <img
                    src={`${API_BASE}/official-profiles/captain/photo`}
                    alt={t.captainPortraitAlt}
                    onError={() => setCaptainPhotoAvailable(false)}
                  />
                ) : (
                  <>
                    <svg viewBox="0 0 48 48" aria-hidden="true">
                      <path d="M24 24a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 4c-8.3 0-15 5-15 11v3h30v-3c0-6-6.7-11-15-11Z" />
                    </svg>
                  </>
                )}
              </div>
              <div className="captain-details">
                <span className="captain-role">{t.captainRole}</span>
                <strong>{captainProfile?.displayName || t.currentCaptainNameMissing}</strong>
                <span className="captain-location">{t.captainLocation}</span>
                <div className="official-profile-links">
                  {captainProfile?.profileUrl && <a href={captainProfile.profileUrl} target="_blank" rel="noopener noreferrer">{t.officialProfileLinkLabel}</a>}
                  {(captainProfile?.communityLinks?.length ? captainProfile.communityLinks : captainProfile?.groupUrl ? [captainProfile.groupUrl] : []).map((url, index) => (
                    url && <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer">
                      {t.officialGroupLinkLabel}{captainProfile.communityLinks?.length > 1 ? ` ${index + 1}` : ''}
                    </a>
                  ))}
                </div>
              </div>
            </section>
            <div className="official-profile-list" aria-label={t.officialProfilesTitle}>
              {officialProfiles.filter((profile) => profile.role !== 'captain').map((profile) => {
                const roleLabel = profile.role === 'secretary' ? t.secretaryRole : t.treasurerRole
                return (
                  <article className="official-profile-public-card" key={profile.role}>
                    <img
                      src={`${API_BASE}/official-profiles/${profile.role}/photo`}
                      alt=""
                      onError={(event) => { event.currentTarget.hidden = true }}
                    />
                    <div>
                      <span className="captain-role">{roleLabel}</span>
                      {profile.displayName && <strong>{profile.displayName}</strong>}
                      <div className="official-profile-links">
                        {profile.profileUrl && <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer">{t.officialProfileLinkLabel}</a>}
                        {(profile.communityLinks?.length ? profile.communityLinks : profile.groupUrl ? [profile.groupUrl] : []).map((url, index) => (
                          url && <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer">
                            {t.officialGroupLinkLabel}{profile.communityLinks?.length > 1 ? ` ${index + 1}` : ''}
                          </a>
                        ))}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
            <div className="brand-social-links" aria-label={t.socialMediaLinks}>
              <a
                className="social-reference-link"
                href="https://www.facebook.com/groups/1063394307576620"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="social-reference-icon" aria-hidden="true">f</span>
                <span>
                  <strong>{t.facebookGroup}</strong>
                  <small>{t.facebookGroupHint}</small>
                </span>
                <span className="social-reference-external" aria-hidden="true">↗</span>
              </a>
              <a
                className="social-reference-link"
                href="https://www.facebook.com/profile.php?id=61553834954054"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="social-reference-icon" aria-hidden="true">f</span>
                <span>
                  <strong>{t.facebookProfile}</strong>
                  <small>{t.facebookProfileHint}</small>
                </span>
                <span className="social-reference-external" aria-hidden="true">↗</span>
              </a>
            </div>
          </div>

        <section className="login-card" id="login-card" aria-label={t.loginFormLabel}>
          <h2>{t.signIn}</h2>
        <button
          type="button"
          className="login-mau-help"
          onClick={(event) => window.dispatchEvent(new CustomEvent('brgy-open-mau', { detail: { trigger: event.currentTarget } }))}
        >
          <span className="login-mau-help-icon" aria-hidden="true">?</span>
          <span>{t.mauSignInHelp}</span>
        </button>

        {!mfaState.required ? (
            <form onSubmit={handleSubmit} noValidate>
              {loginError && <p className="mau-error" role="alert">{loginError}</p>}
              <div className="field-group">
                <label htmlFor="identifier">{t.mobileOrEmail}</label>
                <input
                  id="identifier"
                  name="identifier"
                  type="text"
                  value={form.identifier}
                  onChange={handleChange}
                  placeholder={language === 'fil' ? '09XXXXXXXXX o email' : '09XXXXXXXXX or email address'}
                  autoComplete="username"
                />
              </div>

              <div className="field-group password-field">
                <div className="label-row">
                  <label htmlFor="password">{t.password}</label>
                  <button type="button" className="text-button" aria-label={t.forgotPassword} onClick={() => setShowReset(true)}>
                    {t.forgotPassword}
                  </button>
                </div>

                <div className="password-wrap">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={handleChange}
                    placeholder={language === 'fil' ? 'Ilagay ang iyong password' : 'Enter your password'}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5c5.4 0 9.8 4.3 11.4 6.5-1.6 2.2-6 6.5-11.4 6.5S2.2 13.7.6 11.5C2.2 9.3 6.6 5 12 5Zm0 2a8.2 8.2 0 0 0-7.8 4.5A8.2 8.2 0 0 0 12 16a8.2 8.2 0 0 0 7.8-4.5A8.2 8.2 0 0 0 12 7Zm0 2.5A2 2 0 1 1 12 14a2 2 0 0 1 0-4.5Z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="remember-row">
                <label className="checkbox-label" htmlFor="rememberMe">
                  <input
                    id="rememberMe"
                    name="rememberMe"
                    type="checkbox"
                    checked={form.rememberMe}
                    onChange={handleChange}
                  />
                  <span>{t.rememberMe}</span>
                </label>
              </div>

              <button type="submit" className="primary-btn" aria-label={t.logIn}>
                {t.logIn}
              </button>
            </form>
          ) : (
            <form className="mfa-card" onSubmit={handleMfaSubmit} noValidate>
              <div className="mfa-header">
                <h3>{t.mfaTitle}</h3>
                <p>{t.mfaPrompt}</p>
                <small>{t.mfaHelper}</small>
              </div>

              <div className="field-group">
                <label htmlFor="mfa-code">{t.mfaCodeLabel}</label>
                <input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                />
              </div>

              <div className="mfa-actions">
                <button type="submit" className="primary-btn small">{t.mfaVerify}</button>
                <button type="button" className="secondary-btn small" onClick={() => {
                  setMfaState({ required: false, challengeToken: '', identifier: '' })
                  setMfaCode('')
                }}>{t.mfaCancel}</button>
              </div>
            </form>
          )}

          <div className="login-helper" aria-label={t.officialAccessLabel}>
            <span className="helper-pill">{t.officialAccess}</span>
            <p>{t.officialAccessText}</p>
          </div>

          <p className="approval-notice">{t.accountApprovalNotice}</p>

          <p className="signup-line">
            {t.noAccount}
            <Link to="/register" aria-label={t.createResidentAccountLabel}>{t.createResidentAccount}</Link>
          </p>
        </section>
        </div>

        <footer className="page-footer">{t.barangayLegaspi} • Tayug, Pangasinan</footer>
      </main>

      {showReset && (
        <div className="modal-overlay" onClick={closeResetModal}>
          <form className="modal-content reset-password-modal" onSubmit={handleResetSubmit} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={closeResetModal} aria-label="Close password reset">×</button>
            <div className="modal-header">
              <div>
                <h2>{t.resetPassword}</h2>
                <p>{resetTemporaryPassword
                  ? t.adminTemporaryPasswordInstructions
                  : resetRequested
                    ? resetManualPasswordRequired ? t.resetManualPasswordInstructions : t.resetCodeInstructions
                    : 'We will send a short-lived reset token to your registered contact.'}</p>
              </div>
            </div>
            <div className="modal-body">
              {!resetRequested && <div className="input-block">
                <label htmlFor="reset-identifier">Mobile number or email</label>
                <input id="reset-identifier" type="text" value={resetForm.identifier} onChange={(event) => setResetForm((current) => ({ ...current, identifier: event.target.value }))} required />
              </div>}
              {resetRequested && !resetTemporaryPassword && <div className="input-block">
                <label htmlFor="reset-token">{t.oneTimeResetToken}</label>
                <input id="reset-token" type="text" value={resetForm.token} onChange={(event) => setResetForm((current) => ({ ...current, token: event.target.value }))} required />
              </div>}
              {resetRequested && resetManualPasswordRequired && !resetTemporaryPassword && <div className="input-block">
                <PasswordField id="reset-new-password" label={t.password} value={resetForm.newPassword} onChange={(event) => setResetForm((current) => ({ ...current, newPassword: event.target.value }))} language={language} helpText={`${t.passwordRequirements}.`} />
              </div>}
              {resetTemporaryPassword && <div className="input-block">
                <label htmlFor="admin-reset-temporary-password">{t.temporaryPassword}</label>
                <input id="admin-reset-temporary-password" type="text" value={resetTemporaryPassword} readOnly onFocus={(event) => event.target.select()} aria-describedby="admin-reset-password-help" />
                <p id="admin-reset-password-help" role="status">{t.temporaryPasswordChangeRequired}</p>
              </div>}
              <div className="modal-actions">
                {!resetTemporaryPassword && <button type="button" className="secondary-btn small" onClick={closeResetModal}>{t.cancel}</button>}
                {resetTemporaryPassword
                  ? <button type="button" className="primary-btn small" onClick={closeResetModal}>{t.done}</button>
                  : <button type="submit" className="primary-btn small" disabled={resetting}>{resetting ? t.working : resetRequested ? resetManualPasswordRequired ? t.resetPasswordAction : t.verifyResetToken : t.sendResetToken}</button>}
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function RegisterPage({ language, setLanguage }) {
  const navigate = useNavigate()
  const t = translations[language] || translations.en
  const relationshipOptions = [
    { value: 'Parent', label: t.relationshipParent },
    { value: 'Sibling', label: t.relationshipSibling },
    { value: 'Relative', label: t.relationshipRelative },
    { value: 'Spouse', label: t.relationshipSpouse },
    { value: 'Child', label: t.relationshipChild },
    { value: 'Other', label: t.relationshipOther },
  ]
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    mobile: '',
    email: '',
    address: '',
    zone: '',
    householdMembers: [],
    password: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const addHouseholdMember = () => {
    setForm((prev) => ({ ...prev, householdMembers: [...prev.householdMembers, { name: '', relationship: 'Parent' }] }))
  }

  const updateHouseholdMember = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      householdMembers: prev.householdMembers.map((member, memberIndex) => memberIndex === index ? { ...member, [field]: value } : member),
    }))
  }

  const removeHouseholdMember = (index) => {
    setForm((prev) => ({ ...prev, householdMembers: prev.householdMembers.filter((_, memberIndex) => memberIndex !== index) }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submittingRef.current) return

    const nextForm = {
      firstName: sanitizeText(form.firstName),
      lastName: sanitizeText(form.lastName),
      mobile: sanitizeText(form.mobile),
      email: sanitizeText(form.email),
      address: sanitizeText(form.address),
      zone: Number(form.zone),
      householdMembers: form.householdMembers
        .map((member) => ({ name: sanitizeText(member.name), relationship: relationshipOptions.some((option) => option.value === member.relationship) ? member.relationship : 'Other' }))
        .filter((member) => member.name),
      password: sanitizeText(form.password),
    }

    if (!nextForm.firstName || !nextForm.lastName || !nextForm.mobile || !nextForm.address || !nextForm.zone || !nextForm.password) {
      alert(t.registrationRequiredFieldsError)
      return
    }

    if (!/^09\d{9}$/.test(nextForm.mobile) || (nextForm.email && !/^[\w.+-]+@gmail\.com$/i.test(nextForm.email))) {
      alert(nextForm.email ? t.gmailAddressRequired : t.mobileNumberInvalid)
      return
    }

    if (!isValidPassword(nextForm.password)) {
      alert(t.passwordRequirementsError.replace('{requirements}', t.passwordRequirements))
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const response = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: nextForm.firstName,
          lastName: nextForm.lastName,
          mobile: nextForm.mobile,
          email: nextForm.email,
          address: nextForm.address,
          zone: nextForm.zone,
          householdMembers: nextForm.householdMembers,
          password: nextForm.password,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || t.registrationFailed)
      }

      alert(data.message || t.registrationPendingNotice)
      navigate('/')
    } catch (error) {
      alert(error.message || t.registrationFailed)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell page-alt">
      <header className="topbar" aria-label="Top bar">
        <div className="topbar-inner">
          <div className="topbar-title">{t.officialResident}</div>
          <div className="topbar-location">{t.barangayLegaspi}</div>
        </div>
        <LanguageToggle language={language} setLanguage={setLanguage} />
      </header>

      <main className="register-screen">
        <div className="register-box">
          <div className="register-header">
            <SystemLogo className="seal-logo small" alt="Barangay Legaspi official seal" />
            <div>
              <h1>{t.createResidentTitle}</h1>
              <p>{t.createResidentSubtitle}</p>
              <p className="register-subtext">{t.newResidentPrompt}</p>
            </div>
          </div>

          <form className="register-form" onSubmit={handleSubmit} aria-busy={submitting}>
            <div className="info-strip" aria-label={t.registrationInformationNoticeLabel}>
              <p className="info-strip-title">{t.whyWeAskForThis}</p>
              <p>{t.registrationDataUseNotice}</p>
            </div>

            <div className="form-sections">
              <section className="form-section">
                <div className="form-section-heading">
                  <h2>1. {t.accountDetails}</h2>
                  <p>{t.usedForLogin}</p>
                </div>

                <div className="form-grid">
                  <div className="input-block">
                    <label htmlFor="registration-first-name">{t.firstNameLabel}</label>
                    <input id="registration-first-name" type="text" name="firstName" value={form.firstName} onChange={handleChange} placeholder={t.registrationFirstNamePlaceholder} autoComplete="given-name" required />
                  </div>
                  <div className="input-block">
                    <label htmlFor="registration-last-name">{t.lastNameLabel}</label>
                    <input id="registration-last-name" type="text" name="lastName" value={form.lastName} onChange={handleChange} placeholder={t.registrationLastNamePlaceholder} autoComplete="family-name" required />
                  </div>
                  <div className="input-block">
                    <label htmlFor="registration-mobile">{t.mobileNumberLabel}</label>
                    <input id="registration-mobile" type="text" name="mobile" value={form.mobile} onChange={handleChange} placeholder="09XXXXXXXXX" autoComplete="tel" inputMode="numeric" maxLength={11} required />
                  </div>
                  <div className="input-block">
                    <label htmlFor="registration-email">{t.emailOptional}</label>
                    <input id="registration-email" type="email" name="email" value={form.email} onChange={handleChange} placeholder={t.registrationEmailPlaceholder} autoComplete="email" aria-describedby="registration-email-hint" />
                    <small id="registration-email-hint">{t.residentEmailOptionalHint}</small>
                  </div>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-heading">
                  <h2>2. {t.addressDetails}</h2>
                  <p>{t.usedForVerification}</p>
                </div>

                <div className="form-grid">
                  <div className="input-block full-width">
                    <label htmlFor="registration-address">{t.homeAddressLabel}</label>
                    <input id="registration-address" type="text" name="address" value={form.address} onChange={handleChange} placeholder={t.registrationAddressPlaceholder} autoComplete="street-address" required />
                  </div>
                  <div className="input-block full-width">
                    <label htmlFor="registration-zone">{t.zoneLabel}</label>
                    <select id="registration-zone" name="zone" value={form.zone} onChange={handleChange} required>
                      <option value="">{t.registrationSelectZone}</option>
                      {[1, 2, 3, 4, 5, 6, 7].map((zone) => <option key={zone} value={zone}>Zone {zone}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-heading">
                  <h2>3. {t.householdDetails}</h2>
                  <p>{t.optionalHousehold}</p>
                </div>

                <div className="input-block full-width household-members-block" role="group" aria-labelledby="registration-household-members-label">
                  <div className="household-members-header">
                    <div>
                      <strong id="registration-household-members-label" className="household-members-label">{t.householdMembersLabel}</strong>
                      <small>{t.registrationHouseholdOptionalHint}</small>
                    </div>
                    <button type="button" className="secondary-btn small" onClick={addHouseholdMember}>{t.addMember}</button>
                  </div>
                  {form.householdMembers.map((member, index) => (
                    <div className="household-member-row" key={`household-member-${index}`}>
                      <input type="text" value={member.name} onChange={(event) => updateHouseholdMember(index, 'name', event.target.value)} placeholder={t.registrationHouseholdMemberNamePlaceholder} aria-label={t.registrationHouseholdMemberName.replace('{number}', String(index + 1))} />
                      <select value={member.relationship} onChange={(event) => updateHouseholdMember(index, 'relationship', event.target.value)} aria-label={t.registrationHouseholdMemberRelationship.replace('{number}', String(index + 1))}>
                        {relationshipOptions.map((relationship) => <option key={relationship.value} value={relationship.value}>{relationship.label}</option>)}
                      </select>
                      <button type="button" className="small-action danger" onClick={() => removeHouseholdMember(index)} aria-label={t.registrationRemoveHouseholdMember.replace('{number}', String(index + 1))}>{t.remove}</button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-heading">
                  <h2>4. {t.accountSecurity}</h2>
                  <p>{t.usedToProtect}</p>
                </div>

                <div className="form-grid registration-password-grid">
                  <PasswordField id="registration-password" label={t.passwordLabel} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} language={language} placeholder={t.registrationPasswordPlaceholder} helpText={`${t.passwordRequirements}.`} />
                </div>
              </section>
            </div>

            <p className="approval-notice">{t.registrationApprovalNotice}</p>

            <div className="register-actions">
              <button type="submit" className="primary-btn wide" disabled={submitting}>{submitting ? t.working : t.registerAsResident}</button>
              <Link to="/" className="secondary-btn" aria-disabled={submitting} onClick={(event) => { if (submitting) event.preventDefault() }}>{t.backToLogin}</Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}

function DashboardPage({ profile, requests, services, announcements, events, payments, onLogout, onProfileUpdated, language, setLanguage }) {
  const t = translations[language] || translations.en
  const residentStorageKey = profile.email || profile.id || profile.mobile || 'resident'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null)
  const announcementTriggerRef = useRef(null)
  const announcementDetailsCloseRef = useRef(null)
  const closeAnnouncementDetails = useCallback(() => setSelectedAnnouncement(null), [])
  const [editingProfile, setEditingProfile] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return localStorage.getItem(`brgy-legaspi-onboarding:${residentStorageKey}`) !== 'complete'
    } catch {
      return true
    }
  })
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const stored = localStorage.getItem(`brgy-legaspi-notifications:${residentStorageKey}`)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [profileForm, setProfileForm] = useState(profile)
  const [savingProfile, setSavingProfile] = useState(false)
  const navigate = useNavigate()
  const pendingRequests = (requests || []).filter((item) => ['Pending', 'In Review', 'Needs Information'].includes(item.status)).length

  useEffect(() => {
    setProfileForm(profile)
  }, [profile])

  useEffect(() => {
    if (selectedAnnouncement) {
      announcementDetailsCloseRef.current?.focus()
    } else {
      announcementTriggerRef.current?.focus()
    }
  }, [selectedAnnouncement])

  const handleProfileFieldChange = (field, value) => {
    setProfileForm((current) => ({ ...current, [field]: value }))
  }

  const handleProfileSave = async (event) => {
    event.preventDefault()
    setSavingProfile(true)

    try {
      const response = await fetch(`${API_BASE}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: profileForm.firstName,
          lastName: profileForm.lastName,
          email: profileForm.email,
          mobile: profileForm.mobile,
          address: profileForm.address,
          householdId: profileForm.householdId,
          familyMembers: Number(profileForm.familyMembers) || 0,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to update profile.')

      setProfileForm(data.user)
      setEditingProfile(false)
      onProfileUpdated?.(data.user)
    } catch (error) {
      alert(error.message || 'Unable to update profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const filteredServices = (services || []).filter((service) => {
    const searchText = `${service.title || ''} ${service.subtitle || ''}`.toLowerCase()
    return !normalizedSearch || searchText.includes(normalizedSearch)
  })
  const filteredAnnouncements = (announcements || []).filter((announcement) => {
    const searchText = `${announcement.title || ''} ${announcement.content || ''}`.toLowerCase()
    return !normalizedSearch || searchText.includes(normalizedSearch)
  })
  const filteredEvents = (events || []).filter((event) => {
    const searchText = `${event.title || ''} ${event.location || ''} ${event.date || ''}`.toLowerCase()
    return !normalizedSearch || searchText.includes(normalizedSearch)
  })
  const filteredPayments = (payments || []).filter((payment) => {
    const searchText = `${payment.label || ''} ${payment.id || ''} ${payment.status || ''}`.toLowerCase()
    return !normalizedSearch || searchText.includes(normalizedSearch)
  })

  const residentChecklist = [
    {
      label: t.profileComplete,
      complete: Boolean(profile.firstName && profile.lastName && profile.mobile && profile.address),
      detail: t.residentDetailsComplete,
    },
    {
      label: t.approvalStatusReady,
      complete: profile.status === 'Active Resident',
      detail: profile.status === 'Active Resident' ? t.accountActive : t.waitingForAdminVerification,
    },
    {
      label: t.recentRequestTracked,
      complete: (requests || []).length > 0,
      detail: (requests || []).length > 0
        ? ((requests || []).length === 1 ? t.activeRequestOne : t.activeRequestsMany).replace('{count}', String((requests || []).length))
        : t.noRequestSubmitted,
    },
  ]
  const onboardingProgress = Math.round((residentChecklist.filter((item) => item.complete).length / residentChecklist.length) * 100)
  const residentNotifications = [
    ...(profile.status !== 'Active Resident' ? [{ id: 'verification-pending', title: t.verificationPendingTitle, detail: t.waitForBarangayVerification }] : []),
    ...((requests || []).slice(0, 3).map((request) => ({
      id: `request-${request.id}`,
      title: `${request.type}: ${getRequestStatusLabel(request.status, t)}`,
      detail: request.purpose || t.submittedAwaitingReview,
    }))),
    ...((announcements || []).slice(0, 2).map((announcement) => ({
      id: `announcement-${announcement.id || announcement.title}`,
      title: announcement.title,
      detail: announcement.date || 'Latest barangay update',
    }))),
  ].slice(0, 4)
  const unreadNotificationCount = residentNotifications.filter((notification) => !readNotificationIds.includes(notification.id)).length

  const completeOnboarding = () => {
    setShowOnboarding(false)
    try {
      localStorage.setItem(`brgy-legaspi-onboarding:${residentStorageKey}`, 'complete')
    } catch {
      // Ignore storage write issues in restricted browsing environments.
    }
  }

  const markNotificationsRead = () => {
    const nextReadIds = residentNotifications.map((notification) => notification.id)
    setReadNotificationIds(nextReadIds)
    try {
      localStorage.setItem(`brgy-legaspi-notifications:${residentStorageKey}`, JSON.stringify(nextReadIds))
    } catch {
      // Ignore storage write issues in restricted browsing environments.
    }
  }

  const markNotificationRead = (notificationId) => {
    setReadNotificationIds((current) => {
      if (current.includes(notificationId)) return current
      const nextReadIds = [...current, notificationId]
      try {
        localStorage.setItem(`brgy-legaspi-notifications:${residentStorageKey}`, JSON.stringify(nextReadIds))
      } catch {
        // Ignore storage write issues in restricted browsing environments.
      }
      return nextReadIds
    })
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar resident-topbar">
        <div className="brand-wrap">
          <SystemLogo className="seal-logo tiny" alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>Resident Portal</small>
          </div>
        </div>

        <div className="topbar-actions">
          <label className="search-box" aria-label="Search content">
            <span aria-hidden="true">🔎</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label="Search resident dashboard"
            />
          </label>
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <button className="notification-button" type="button" aria-label={`${unreadNotificationCount} unread notifications`} onClick={() => setNotificationsOpen((current) => !current)}>
            <span aria-hidden="true">🔔</span>
            {unreadNotificationCount > 0 && <span className="notification-count">{unreadNotificationCount}</span>}
          </button>
          <button className="profile-pill" type="button" aria-label={t.manageProfile} onClick={() => setEditingProfile(true)}>
            <span className="avatar">{(profile.firstName || '').charAt(0)}</span>
            <span>{profile.firstName}</span>
          </button>
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="dashboard-main resident-dashboard-main">
        <section className="content-panel resident-dashboard-panel">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{t.goodMorning}</p>
              <h1>{t.welcomeBack}, {profile.firstName}</h1>
            </div>
            <p>{t.pendingRequests}: {pendingRequests}</p>
          </div>

          <nav className="mobile-quick-nav" aria-label={t.quickAccessLabel}>
            <button type="button" onClick={() => navigate('/requests')}><span aria-hidden="true">📄</span> {t.requests}</button>
            <button type="button" onClick={() => document.getElementById('announcements-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span aria-hidden="true">📢</span> {t.updates}</button>
            <button type="button" onClick={() => navigate('/events')}><span aria-hidden="true">📅</span> {t.events}</button>
            <button type="button" onClick={() => navigate('/payments')}><span aria-hidden="true">💳</span> {t.payments}</button>
            <button type="button" onClick={() => window.dispatchEvent(new Event('brgy-open-mau'))}><span aria-hidden="true">💬</span> {t.mauQuickAccess}</button>
          </nav>

          {profile.status && profile.status !== 'Active Resident' && (
            <div className="verification-banner">
              <strong>{t.accountVerificationPending}</strong>
              <span>{t.accountVerificationMessage}</span>
            </div>
          )}

          {showOnboarding && (
            <div className="onboarding-welcome" role="dialog" aria-labelledby="onboarding-title">
              <div>
                <p className="eyebrow">{t.newResidentGuide}</p>
                <h2 id="onboarding-title">{t.everythingYouNeed}</h2>
                <p>{t.residentOnboardingDescription}</p>
              </div>
              <div className="onboarding-actions">
                <button type="button" className="secondary-btn small" onClick={completeOnboarding}>{t.gotIt}</button>
                <button type="button" className="primary-btn small" onClick={() => { completeOnboarding(); setEditingProfile(true) }}>{t.completeProfile}</button>
              </div>
            </div>
          )}

          <div className="onboarding-card">
            <div className="onboarding-header">
              <div>
                <p className="eyebrow">{t.residentProgress}</p>
                <h2>{t.gettingStartedChecklist}</h2>
              </div>
              <span className="progress-pill">{onboardingProgress}% {t.progressCompleteSuffix}</span>
            </div>
            <div className="progress-bar" aria-hidden="true">
              <span style={{ width: `${onboardingProgress}%` }} />
            </div>
            <ul className="checklist-list">
              {residentChecklist.map((item) => (
                <li key={item.label} className={item.complete ? 'complete' : ''}>
                  <span className="checkmark" aria-hidden="true">{item.complete ? '✓' : '•'}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="stats-grid" aria-label={t.residentSummaryLabel}>
            <article className="stat-card accent">
              <div className="stat-header">
                <span className="label">{t.requests}</span>
                <span className="badge success">{t.live}</span>
              </div>
              <div className="stat-number">{requests.length}</div>
              <p>{t.totalSubmitted}</p>
            </article>
            <article className="stat-card">
              <div className="stat-header">
                <span className="label">{t.pending}</span>
                <span className="badge warning">{t.review}</span>
              </div>
              <div className="stat-number">{pendingRequests}</div>
              <p>{t.awaitingAction}</p>
            </article>
            <article className="stat-card">
              <div className="stat-header">
                <span className="label">{t.services}</span>
                <span className="badge info">{t.now}</span>
              </div>
              <div className="stat-number">{filteredServices.length}</div>
              <p>{t.availableServices}</p>
            </article>
            <article className="stat-card">
              <div className="stat-header">
                <span className="label">{t.announcements}</span>
                <span className="badge danger">{t.updated}</span>
              </div>
              <div className="stat-number">{filteredAnnouncements.length}</div>
              <p>{t.latestUpdates}</p>
            </article>
          </div>

          <div className="dashboard-body">
            <div className="main-column">
              <article className="panel-card" id="announcements-section">
                <div className="panel-header">
                  <h2>{t.currentSituation}</h2>
                  <span className="soft-label">{t.recentAnnouncements}</span>
                </div>
                <ul className="notice-list">
                  {filteredAnnouncements.length > 0 ? filteredAnnouncements.map((announcement) => (
                    <li
                      key={announcement.id || `${announcement.title}-${announcement.date}`}
                      className={selectedAnnouncement === announcement ? 'announcement-current' : ''}
                    >
                      <span className={`dot ${announcement.tag || 'green'}`} aria-hidden="true" />
                      <button
                        type="button"
                        className="resident-announcement-trigger"
                        aria-label={t.openAnnouncementDetails.replace('{title}', announcement.title || t.announcements)}
                        aria-pressed={selectedAnnouncement === announcement}
                        onClick={(event) => {
                          announcementTriggerRef.current = event.currentTarget
                          setSelectedAnnouncement(announcement)
                        }}
                      >
                        <strong>{announcement.title}</strong>
                        <small>{announcement.date}</small>
                        <p>{announcement.content}</p>
                        {selectedAnnouncement === announcement && (
                          <span className="announcement-current-label">{t.currentAnnouncement}</span>
                        )}
                      </button>
                    </li>
                  )) : <li><div className="empty-state">{t.noCurrentAnnouncements}</div></li>}
                </ul>
              </article>

              <article className="panel-card">
                <div className="panel-header">
                  <h2>{t.availableServices}</h2>
                  <span className="soft-label">{t.residentSupport}</span>
                </div>
                <div className="service-list">
                  {filteredServices.length > 0 ? filteredServices.map((service) => (
                    <button
                      key={service.title}
                      type="button"
                      className="service-item"
                      aria-label={t.requestServiceAction.replace('{service}', service.title)}
                      onClick={() => navigate(`/requests?service=${encodeURIComponent(service.title)}`)}
                    >
                      <span className={`service-icon ${service.tone || 'green'}`}>{service.icon || '📄'}</span>
                      <span>
                        <strong>{service.title}</strong>
                        <small>{service.subtitle}</small>
                      </span>
                      <span className={`service-status ${(requests || []).find((request) => request.type === service.title && request.status !== 'Rejected')?.status?.toLowerCase() || 'available'}`}>
                        {getRequestStatusLabel((requests || []).find((request) => request.type === service.title && request.status !== 'Rejected')?.status || 'Available', t)}
                      </span>
                    </button>
                  )) : <div className="empty-state">{t.noServicesMatchSearch}</div>}
                </div>
              </article>
            </div>

            <aside className="side-column">
              <article className="profile-card">
                <div className="profile-head">
                  <div className="profile-avatar">{(profile.firstName || 'R').charAt(0).toUpperCase()}</div>
                  <div>
                    <h3>{profile.firstName} {profile.lastName}</h3>
                    <span>{t.residentAccount}</span>
                  </div>
                  <button type="button" className="secondary-btn tiny" onClick={() => setEditingProfile(true)}>{t.edit}</button>
                </div>
                <dl className="profile-list">
                  <div><dt>{t.householdId}</dt><dd>{profile.householdId || 'N/A'}</dd></div>
                  <div><dt>{t.homeAddressLabel}</dt><dd>{profile.address || 'N/A'}</dd></div>
                  <div><dt>{t.emailAddressLabel}</dt><dd>{profile.email || 'N/A'}</dd></div>
                  <div><dt>{t.mobileNumberLabel}</dt><dd>{profile.mobile || 'N/A'}</dd></div>
                </dl>
              </article>

              <article className="panel-card compact-panel">
                <div className="panel-header notification-panel-header">
                  <h2>{t.updates} &amp; {t.announcements}</h2>
                  <button type="button" className="text-button" onClick={markNotificationsRead} disabled={unreadNotificationCount === 0}>{t.markAllRead}</button>
                </div>
                <ul className="notification-feed">
                  {residentNotifications.length > 0 ? residentNotifications.map((notification) => (
                    <li key={notification.id} className={readNotificationIds.includes(notification.id) ? 'read' : 'unread'}>
                      <strong>{notification.title}</strong>
                      <small>{notification.detail}</small>
                    </li>
                  )) : <li><div className="empty-state">{t.noNewAlerts}</div></li>}
                </ul>
              </article>

              <article className="panel-card">
                <div className="panel-header left-align">
                  <h2>{t.upcomingEvents}</h2>
                </div>
                <div className="service-list">
                  {filteredEvents.length > 0 ? filteredEvents.map((event) => (
                    <div key={`${event.title}-${event.date}`} className="service-item">
                      <span className="service-icon green">✨</span>
                      <span>
                        <strong>{event.title}</strong>
                        <small>{event.date} • {event.location}</small>
                      </span>
                    </div>
                  )) : <div className="empty-state">{t.noEventsMatchSearch}</div>}
                </div>
              </article>

              <article className="panel-card">
                <div className="panel-header left-align">
                  <h2>{t.payments}</h2>
                </div>
                <div className="service-list">
                  {filteredPayments.length > 0 ? filteredPayments.map((payment) => (
                    <div key={payment.id} className="service-item">
                      <span className="service-icon blue">💳</span>
                      <span>
                        <strong>{payment.label}</strong>
                        <small>{payment.id} • {payment.status} • {payment.amount}</small>
                      </span>
                    </div>
                  )) : <div className="empty-state">{t.noPaymentsMatchSearch}</div>}
                </div>
              </article>
            </aside>
          </div>
        </section>
      </main>
      {selectedAnnouncement && (
        <WorkflowModal
          title={selectedAnnouncement.title || t.announcements}
          closeLabel={t.closeAnnouncementDetails}
          closeButtonRef={announcementDetailsCloseRef}
          trapFocus
          onClose={closeAnnouncementDetails}
        >
          <div className="announcement-details">
            <span className="announcement-current-label">{t.currentAnnouncement}</span>
            <p className="announcement-details-date">
              <strong>{t.announcementDate}:</strong> {selectedAnnouncement.date || t.announcementDateUnavailable}
            </p>
            <p className="announcement-details-content">
              {selectedAnnouncement.content || t.announcementDetailsUnavailable}
            </p>
          </div>
        </WorkflowModal>
      )}
      {notificationsOpen && (
        <div className="notification-popover" role="dialog" aria-label="Notification center">
          <div className="notification-popover-header">
            <div>
              <strong>{t.notificationCenter}</strong>
              <small>{unreadNotificationCount ? `${unreadNotificationCount} ${t.unread}` : t.allCaughtUp}</small>
            </div>
            <button type="button" className="modal-close" aria-label="Close notification center" onClick={() => setNotificationsOpen(false)}>×</button>
          </div>
          <div className="notification-popover-list">
            {residentNotifications.length > 0 ? residentNotifications.map((notification) => (
              <button type="button" key={notification.id} className={`notification-popover-item ${readNotificationIds.includes(notification.id) ? 'read' : 'unread'}`} onClick={() => markNotificationRead(notification.id)}>
                <strong>{notification.title}</strong>
                <small>{notification.detail}</small>
              </button>
            )) : <span className="empty-state">{t.noNotificationsYet}</span>}
          </div>
        </div>
      )}
      {editingProfile && (
        <div className="modal-overlay" onClick={() => setEditingProfile(false)}>
          <form className="modal-content profile-edit-modal" onSubmit={handleProfileSave} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setEditingProfile(false)} aria-label="Close profile editor">×</button>
            <div className="modal-header">
              <div>
                <h2>{t.manageProfile}</h2>
                <p>{t.accountVerificationMessage || 'Update your resident account information.'}</p>
              </div>
            </div>
            <div className="modal-body">
              <div className="editor-grid">
                {[
                  ['firstName', 'First Name'],
                  ['lastName', 'Last Name'],
                  ['email', 'Email'],
                  ['mobile', 'Mobile'],
                  ['householdId', 'Household ID'],
                  ['familyMembers', 'Family Members'],
                  ['address', 'Address'],
                ].map(([field, label]) => (
                  <label key={field} className={`input-block ${field === 'address' ? 'full-width' : ''}`}>
                    <span>{label}</span>
                    <input
                      type={field === 'familyMembers' ? 'number' : field === 'email' ? 'email' : 'text'}
                      min={field === 'familyMembers' ? '1' : undefined}
                      value={profileForm[field] ?? ''}
                      onChange={(event) => handleProfileFieldChange(field, event.target.value)}
                      required={['firstName', 'lastName', 'mobile'].includes(field)}
                      readOnly={field === 'email'}
                      aria-describedby={field === 'email' ? 'resident-profile-email-hint' : undefined}
                    />
                    {field === 'email' && <small id="resident-profile-email-hint">{t.emailVerificationHint}</small>}
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-btn small" onClick={() => setEditingProfile(false)}>{t.cancel}</button>
                <button type="submit" className="primary-btn small" disabled={savingProfile}>{savingProfile ? t.saving : t.saveChanges}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function RequestsPage({ requests, onSubmit, onRequestUpdated, onLogout, language, setLanguage, userId }) {
  const t = translations[language] || translations.en
  const requestTypes = ['Barangay Certificate', 'Barangay Clearance', 'Medical Assistance', 'Emergency Help']
  const requestedService = new URLSearchParams(window.location.search).get('service')
  const [form, setForm] = useState({
    type: requestTypes.includes(requestedService) ? requestedService : 'Barangay Certificate',
    purpose: '',
    notes: '',
    deliveryMethod: 'online',
    deliveryNote: '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [requestModalOpen, setRequestModalOpen] = useState(Boolean(requestedService))
  const [followUpDrafts, setFollowUpDrafts] = useState({})
  const [followUpBusy, setFollowUpBusy] = useState({})
  const [followUpNotice, setFollowUpNotice] = useState('')
  const [reminderDates, setReminderDates] = useState(() => {
    try {
      const reminders = JSON.parse(localStorage.getItem(getRequestReminderStorageKey(userId)) || '{}')
      return Object.fromEntries(Object.entries(reminders).map(([id, reminder]) => [id, reminder.scheduledAt]))
    } catch {
      return {}
    }
  })
  const [reminderNotice, setReminderNotice] = useState('')

  const recentRequests = [...(requests || [])].slice(0, 3)

  const formatRequestDate = (date) => {
    if (!date) return ''
    const parsedDate = new Date(date)
    return Number.isNaN(parsedDate.getTime())
      ? date
      : parsedDate.toLocaleDateString(language === 'fil' ? 'fil-PH' : 'en-PH')
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const cleanedPurpose = sanitizeText(form.purpose)
    const cleanedNotes = sanitizeText(form.notes)

    if (!cleanedPurpose) {
      alert(t.requestPurposeRequired)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          purpose: cleanedPurpose,
          notes: cleanedNotes,
          deliveryMethod: form.deliveryMethod,
          deliveryNote: sanitizeText(form.deliveryNote),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Request failed.')
      }

      onSubmit({
        id: data.request.id,
        type: data.request.type,
        purpose: data.request.purpose,
        status: data.request.status,
        date: new Date(data.request.date).toLocaleDateString(),
        notes: data.request.notes,
        deliveryMethod: data.request.deliveryMethod || form.deliveryMethod,
        deliveryNote: data.request.deliveryNote || sanitizeText(form.deliveryNote),
        followUps: data.request.followUps || [],
        statusHistory: data.request.statusHistory || [],
      })

      setSubmitted(true)
      setRequestModalOpen(false)
      setForm({
        type: 'Barangay Certificate',
        purpose: '',
        notes: '',
        deliveryMethod: 'online',
        deliveryNote: '',
      })
    } catch (error) {
      alert(error.message || 'Request submission failed.')
    }
  }

  const handleFollowUpSubmit = async (event, requestId) => {
    event.preventDefault()
    const message = sanitizeText(followUpDrafts[requestId] || '')
    if (!message) return

    setFollowUpBusy((current) => ({ ...current, [requestId]: true }))
    setFollowUpNotice('')
    try {
      const response = await fetch(`${API_BASE}/requests/${requestId}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to send follow-up.')
      onRequestUpdated?.(data.request)
      setFollowUpDrafts((current) => ({ ...current, [requestId]: '' }))
      setFollowUpNotice(requestId)
    } catch (error) {
      alert(error.message || 'Unable to send follow-up.')
    } finally {
      setFollowUpBusy((current) => ({ ...current, [requestId]: false }))
    }
  }

  const handleSetReminder = async (event, request) => {
    event.preventDefault()
    const scheduledAt = new Date(reminderDates[request.id] || '').getTime()
    if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
      alert(t.reminderFutureRequired)
      return
    }

    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission()
      }

      const response = await fetch(`${API_BASE}/requests/${request.id}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: new Date(scheduledAt).toISOString() }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || 'Unable to schedule reminder.')
      }

      const reminderStorageKey = getRequestReminderStorageKey(userId)
      const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '{}')
      reminders[request.id] = {
        requestId: request.id,
        requestType: request.type,
        scheduledAt: new Date(scheduledAt).toISOString(),
        notified: false,
      }
      localStorage.setItem(reminderStorageKey, JSON.stringify(reminders))
      setReminderNotice(request.id)
    } catch (error) {
      alert(error.message || 'Unable to save this reminder.')
    }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="brand-wrap">
          <SystemLogo className="seal-logo tiny" alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>Resident Portal</small>
          </div>
        </div>

        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card">
          <div className="panel-header big-gap">
            <h2>{t.requestService}</h2>
            <button type="button" className="primary-btn small" onClick={() => setRequestModalOpen(true)}>{t.requestService}</button>
            <Link to="/dashboard" className="secondary-btn small">{t.backToDashboard}</Link>
          </div>

          {submitted && <div className="success-banner" role="status">{t.requestSubmittedSuccess}</div>}
          {requestModalOpen && (
            <WorkflowModal title={t.requestService} onClose={() => setRequestModalOpen(false)} wide>
              <form className="request-form workflow-modal-form" onSubmit={handleSubmit}>
                <div className="form-grid two-col">
                  <div className="input-block">
                    <label htmlFor="request-type">{t.requestType}</label>
                    <select id="request-type" name="type" value={form.type} onChange={handleChange}>
                      {requestTypes.map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </div>
                  <div className="input-block">
                    <label htmlFor="delivery-method">{t.deliveryMethodLabel}</label>
                    <select id="delivery-method" name="deliveryMethod" value={form.deliveryMethod} onChange={handleChange}>
                      <option value="online">{t.onlineCopy}</option>
                      <option value="physical">{t.physicalCopy}</option>
                    </select>
                  </div>
                  <div className="input-block">
                    <label htmlFor="request-purpose">{t.purpose}</label>
                    <input id="request-purpose" type="text" name="purpose" value={form.purpose} onChange={handleChange} placeholder={t.requestPurposePlaceholder} />
                  </div>
                  <div className="input-block full-width">
                    <label htmlFor="delivery-note">{t.deliveryNoteLabel}</label>
                    <input id="delivery-note" type="text" name="deliveryNote" value={form.deliveryNote} onChange={handleChange} maxLength={500} placeholder={t.deliveryNoteLabel} />
                  </div>
                  <div className="input-block full-width">
                    <label htmlFor="request-notes">{t.notes}</label>
                    <textarea id="request-notes" name="notes" rows="5" value={form.notes} onChange={handleChange} placeholder={t.requestNotesPlaceholder}></textarea>
                  </div>
                </div>
                <div className="modal-actions">
                  <button type="button" className="secondary-btn small" onClick={() => setRequestModalOpen(false)}>{t.cancel}</button>
                  <button type="submit" className="primary-btn small">{t.submitRequest}</button>
                </div>
              </form>
            </WorkflowModal>
          )}

          <div className="status-tracker-panel">
            <div className="panel-header big-gap">
              <h3>{t.requestStatusTracker}</h3>
            </div>
            {recentRequests.length > 0 ? recentRequests.map((item) => {
              return (
                <div key={item.id} className="request-status-card">
                  <div className="request-status-title-row">
                    <strong>{item.type}</strong>
                    <span className={'status-badge ' + (item.status || '').toLowerCase().replace(/\s+/g, '-')}>{getRequestStatusLabel(item.status, t)}</span>
                  </div>
                  <p className="request-status-guidance">{getRequestStatusMessage(item.status, t)}</p>
                  <div className="request-delivery-summary">
                    <strong>{t.deliveryMethodLabel}:</strong> {item.deliveryMethod === 'physical' ? t.physicalCopy : t.onlineCopy}
                    {item.deliveryNote && <p>{item.deliveryNote}</p>}
                  </div>
                  <details className="request-history-details">
                    <summary>{t.requestStatusHistory}</summary>
                    <RequestHistory history={item.statusHistory} t={t} />
                  </details>
                  <form className="request-reminder-form" onSubmit={(event) => handleSetReminder(event, item)}>
                    <label htmlFor={`reminder-${item.id}`}>{t.remindMeLabel}</label>
                    <input
                      id={`reminder-${item.id}`}
                      type="datetime-local"
                      required
                      value={reminderDates[item.id] || ''}
                      onChange={(event) => setReminderDates((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                    <button type="submit" className="secondary-btn small">{t.setReminder}</button>
                    {reminderNotice === item.id && <small role="status">{t.reminderScheduled} {new Date(reminderDates[item.id]).toLocaleString()}</small>}
                  </form>
                  {(item.followUps || []).map((followUp) => (
                    <div className="request-follow-up-entry" key={followUp.id}>
                      <small>{new Date(followUp.createdAt).toLocaleString()}</small>
                      <p>{followUp.message}</p>
                    </div>
                  ))}
                  <form className="request-follow-up-form" onSubmit={(event) => handleFollowUpSubmit(event, item.id)}>
                    <label htmlFor={`follow-up-${item.id}`}>{t.followUpLabel}</label>
                    <textarea
                      id={`follow-up-${item.id}`}
                      rows={2}
                      maxLength={1000}
                      value={followUpDrafts[item.id] || ''}
                      onChange={(event) => setFollowUpDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder={t.followUpPlaceholder}
                    />
                    <button type="submit" className="secondary-btn small" disabled={followUpBusy[item.id] || !String(followUpDrafts[item.id] || '').trim()}>
                      {followUpBusy[item.id] ? t.working : t.sendFollowUp}
                    </button>
                    {followUpNotice === item.id && <small role="status">{t.followUpSent}</small>}
                  </form>
                </div>
              )
            }) : <div className="empty-state">{t.noRecentRequests}</div>}
          </div>

          <div className="request-table-wrap">
            <h3>{t.requestHistory}</h3>
            <table className="request-table">
              <thead>
                <tr>
                  <th>{t.requestType}</th>
                  <th>{t.purpose}</th>
                  <th>{t.status}</th>
                  <th>{t.deliveryMethodLabel}</th>
                  <th>{t.when}</th>
                  <th>{t.requestStatusHistory}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item) => (
                  <tr key={item.id}>
                    <td>{item.type}</td>
                    <td>{item.purpose}</td>
                    <td><span className={'status-badge ' + (item.status || '').toLowerCase().replace(/\s+/g, '-')}>{getRequestStatusLabel(item.status, t)}</span></td>
                    <td>{item.deliveryMethod === 'physical' ? t.physicalCopy : t.onlineCopy}{item.deliveryNote && <small className="request-staff-note">{item.deliveryNote}</small>}</td>
                    <td>{formatRequestDate(item.date)}</td>
                    <td><details className="request-history-details"><summary>{t.requestStatusHistory}</summary><RequestHistory history={item.statusHistory} t={t} /></details></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}

function ProfilePage({ profile, onLogout, language, setLanguage }) {
  const t = translations[language] || translations.en
  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar resident-topbar">
        <div className="brand-wrap">
          <SystemLogo className="seal-logo tiny" alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>Resident Portal</small>
          </div>
        </div>

        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card profile-page">
          <div className="profile-banner">
            <div className="profile-avatar large">{profile.firstName.charAt(0)}</div>
            <div>
              <h2>{profile.firstName} {profile.lastName}</h2>
              <p>{t.resident} • {t.householdId}: {profile.householdId}</p>
            </div>
          </div>

          <div className="profile-grid">
            <div className="info-box">
              <h3>{t.contact || 'Contact Information'}</h3>
              <dl>
                <div><dt>{t.mobileNumberLabel}</dt><dd>{profile.mobile}</dd></div>
                <div><dt>{t.emailAddressLabel}</dt><dd>{profile.email}</dd></div>
                <div><dt>{t.homeAddressLabel}</dt><dd>{profile.address}</dd></div>
              </dl>
            </div>

            <div className="info-box">
              <h3>{t.householdDetails}</h3>
              <dl>
                <div><dt>{t.familyMembers}</dt><dd>{profile.familyMembers}</dd></div>
                <div><dt>{t.status}</dt><dd>{profile.status}</dd></div>
                <div><dt>{t.when}</dt><dd>June 24, 2026</dd></div>
              </dl>
            </div>
          </div>

          <div className="profile-footer">
            <Link to="/dashboard" className="secondary-btn small">Back to Dashboard</Link>
          </div>
        </div>
      </main>
    </div>
  )
}

function PaymentsPage({ payments, onLogout, language, setLanguage }) {
  const t = translations[language] || translations.en
  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="brand-wrap">
          <SystemLogo className="seal-logo tiny" alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>Resident Portal</small>
          </div>
        </div>
        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card">
          <div className="panel-header big-gap">
            <h2>{t.payments}</h2>
            <Link to="/dashboard" className="secondary-btn small">{t.backToDashboard}</Link>
          </div>

          <div className="request-table-wrap">
            <table className="request-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(payments || []).length > 0 ? (payments || []).map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.id}</td>
                    <td>{payment.label}</td>
                    <td><span className={'status-badge ' + String(payment.status).toLowerCase()}>{payment.status}</span></td>
                    <td>{payment.amount}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="empty-state">{t.noPaymentsMatchSearch}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}

function EventsPage({ events, onLogout, language, setLanguage }) {
  const t = translations[language] || translations.en
  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="brand-wrap">
          <SystemLogo className="seal-logo tiny" alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>Resident Portal</small>
          </div>
        </div>
        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card">
          <div className="panel-header big-gap">
            <h2>{t.upcomingEvents}</h2>
            <Link to="/dashboard" className="secondary-btn small">{t.backToDashboard}</Link>
          </div>

          <div className="service-list">
            {(events || []).map((event) => (
              <div key={event.title} className="service-item event-item">
                <span className="service-icon green">✨</span>
                <span>
                  <strong>{event.title}</strong>
                  <small>{event.date} • {event.location}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

function SettingsPage({ profile, onLogout, onPasswordChanged, onProfileUpdated, language, setLanguage }) {
  const navigate = useNavigate()
  const t = translations[language] || translations.en
  const [settingsProfile, setSettingsProfile] = useState(profile)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [savingPassword, setSavingPassword] = useState(false)
  const [mfaEnabled, setMfaEnabled] = useState(Boolean(profile.mfaEnabled))
  const [mfaSetup, setMfaSetup] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaCurrentPassword, setMfaCurrentPassword] = useState('')
  const [mfaBusy, setMfaBusy] = useState(false)
  const [mfaMessage, setMfaMessage] = useState('')
  const [accountForm, setAccountForm] = useState({
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    email: profile.email || '',
    mobile: profile.mobile || '',
  })
  const [savingAccount, setSavingAccount] = useState(false)
  const [emailCode, setEmailCode] = useState('')
  const [emailVerificationRequested, setEmailVerificationRequested] = useState(false)
  const [accountMessage, setAccountMessage] = useState('')
  const [accountError, setAccountError] = useState('')

  useEffect(() => {
    let isMounted = true
    const loadSecuritySettings = async () => {
      try {
        const response = await fetch(`${API_BASE}/profile`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || 'Unable to load security settings.')
        if (isMounted) {
          setSettingsProfile(data.user || profile)
          setMfaEnabled(Boolean(data.user?.mfaEnabled))
          setAccountForm({
            firstName: data.user?.firstName || '',
            lastName: data.user?.lastName || '',
            email: data.user?.email || '',
            mobile: data.user?.mobile || '',
          })
        }
        if (data.user?.mfaSetupPending) {
          const setupResponse = await fetch(`${API_BASE}/mfa/setup`, { method: 'POST' })
          const setupData = await setupResponse.json().catch(() => ({}))
          if (!setupResponse.ok) throw new Error(setupData.message || 'Unable to restore authenticator setup.')
          if (isMounted) setMfaSetup(setupData)
        }
      } catch (error) {
        if (isMounted) setMfaMessage(error.message || 'Unable to load security settings.')
      }
    }
    loadSecuritySettings()
    return () => { isMounted = false }
  }, [profile])

  const saveAccountDetails = async (event) => {
    event.preventDefault()
    if (!accountForm.firstName.trim() || !accountForm.lastName.trim()) {
      setAccountError(t.profileNameRequired)
      return
    }
    if (!/^09\d{9}$/.test(accountForm.mobile.trim())) {
      setAccountError(t.mobileNumberInvalid)
      return
    }

    setSavingAccount(true)
    setAccountError('')
    setAccountMessage('')
    try {
      const response = await fetch(`${API_BASE}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: accountForm.firstName.trim(),
          lastName: accountForm.lastName.trim(),
          mobile: accountForm.mobile.trim(),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.profileSaveFailed)
      setSettingsProfile(data.user)
      setAccountForm((current) => ({
        ...current,
        firstName: data.user.firstName,
        lastName: data.user.lastName,
        email: data.user.email || '',
        mobile: data.user.mobile,
      }))
      onProfileUpdated?.(data.user)
      setAccountMessage(t.profileSaved)
    } catch (error) {
      setAccountError(error.message || t.profileSaveFailed)
    } finally {
      setSavingAccount(false)
    }
  }

  const requestEmailVerification = async () => {
    const email = accountForm.email.trim().toLowerCase()
    if (!/^[\w.+-]+@gmail\.com$/i.test(email)) {
      setAccountError(t.gmailAddressRequired)
      return
    }
    if (email === String(settingsProfile.email || '').toLowerCase()) {
      setAccountError(t.emailAlreadyCurrent)
      return
    }

    setSavingAccount(true)
    setAccountError('')
    setAccountMessage('')
    try {
      const response = await fetch(`${API_BASE}/profile/email/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.emailVerificationFailed)
      setEmailVerificationRequested(true)
      setEmailCode('')
      setAccountMessage(data.message || t.emailVerificationSent)
    } catch (error) {
      setAccountError(error.message || t.emailVerificationFailed)
    } finally {
      setSavingAccount(false)
    }
  }

  const verifyProfileEmail = async (event) => {
    event.preventDefault()
    setSavingAccount(true)
    setAccountError('')
    setAccountMessage('')
    try {
      const response = await fetch(`${API_BASE}/profile/email/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: accountForm.email.trim().toLowerCase(), code: emailCode }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.emailVerificationFailed)
      setSettingsProfile(data.user)
      setAccountForm((current) => ({ ...current, email: data.user.email || '' }))
      setEmailVerificationRequested(false)
      setEmailCode('')
      onProfileUpdated?.(data.user)
      setAccountMessage(data.message || t.emailVerified)
    } catch (error) {
      setAccountError(error.message || t.emailVerificationFailed)
    } finally {
      setSavingAccount(false)
    }
  }

  const removeProfileEmail = async () => {
    setSavingAccount(true)
    setAccountError('')
    setAccountMessage('')
    try {
      const response = await fetch(`${API_BASE}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.profileSaveFailed)
      setSettingsProfile(data.user)
      setAccountForm((current) => ({ ...current, email: '' }))
      setEmailVerificationRequested(false)
      setEmailCode('')
      onProfileUpdated?.(data.user)
      setAccountMessage(t.emailRemovedHelpdesk)
    } catch (error) {
      setAccountError(error.message || t.profileSaveFailed)
    } finally {
      setSavingAccount(false)
    }
  }

  const startMfaSetup = async (rotate = false) => {
    setMfaBusy(true)
    setMfaMessage('')
    try {
      const response = await fetch(`${API_BASE}/mfa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotate }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to start MFA setup.')
      setMfaSetup(data)
      setMfaCode('')
    } catch (error) {
      setMfaMessage(error.message || 'Unable to start MFA setup.')
    } finally {
      setMfaBusy(false)
    }
  }

  const enableMfa = async (event) => {
    event.preventDefault()
    setMfaBusy(true)
    setMfaMessage('')
    try {
      const response = await fetch(`${API_BASE}/mfa/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaCode }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to enable MFA.')
      setMfaEnabled(true)
      setMfaSetup(null)
      setMfaCode('')
      setMfaMessage(data.message || t.mfaEnabled)
    } catch (error) {
      setMfaMessage(error.message || 'Unable to enable MFA.')
    } finally {
      setMfaBusy(false)
    }
  }

  const disableMfa = async (event) => {
    event.preventDefault()
    setMfaBusy(true)
    setMfaMessage('')
    try {
      const response = await fetch(`${API_BASE}/mfa/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaCode, currentPassword: mfaCurrentPassword }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to disable MFA.')
      setMfaEnabled(false)
      setMfaCode('')
      setMfaCurrentPassword('')
      setMfaMessage(data.message || t.mfaDisabled)
    } catch (error) {
      setMfaMessage(error.message || 'Unable to disable MFA.')
    } finally {
      setMfaBusy(false)
    }
  }

  const dashboardPath = getDashboardPath(settingsProfile.role)

  const handlePasswordSubmit = async (event) => {
    event.preventDefault()
    if (!isValidPassword(passwordForm.newPassword)) {
      alert(t.newPasswordRequirementsError.replace('{requirements}', t.passwordRequirements))
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert('New password and confirmation do not match.')
      return
    }

    setSavingPassword(true)
    try {
      const response = await fetch(`${API_BASE}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to change password.')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      if (data.token && data.user) {
        onPasswordChanged({ token: data.token, user: data.user })
        navigate(getDashboardPath(data.user.role), { replace: true })
      }
      alert(data.message || 'Password changed successfully.')
    } catch (error) {
      alert(error.message || 'Unable to change password.')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="brand-wrap">
          <SystemLogo className="seal-logo tiny" alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>{settingsProfile.role === 'super_admin' ? t.superAdminPortal : settingsProfile.role === 'admin' ? t.adminPortal : settingsProfile.role === 'staff' ? t.staffPortal : t.residentPortal}</small>
          </div>
        </div>
        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card profile-page">
          <div className="profile-banner">
            <div className="profile-avatar large">{(settingsProfile.firstName || '?').charAt(0)}</div>
            <div>
              <h2>{t.settings}</h2>
              <p>{t.manageProfile}</p>
            </div>
          </div>

          <div className="profile-grid">
            <div className="info-box">
              <h3>{t.account}</h3>
              <form className="password-change-form" onSubmit={saveAccountDetails}>
                <label className="input-block">
                  <span>{t.firstName}</span>
                  <input autoComplete="given-name" maxLength={100} value={accountForm.firstName} onChange={(event) => setAccountForm((current) => ({ ...current, firstName: event.target.value }))} required />
                </label>
                <label className="input-block">
                  <span>{t.lastName}</span>
                  <input autoComplete="family-name" maxLength={100} value={accountForm.lastName} onChange={(event) => setAccountForm((current) => ({ ...current, lastName: event.target.value }))} required />
                </label>
                <label className="input-block">
                  <span>{t.mobileNumberLabel}</span>
                  <input type="tel" autoComplete="tel" inputMode="numeric" maxLength={11} value={accountForm.mobile} onChange={(event) => setAccountForm((current) => ({ ...current, mobile: event.target.value.replace(/\D/g, '').slice(0, 11) }))} required aria-describedby="profile-mobile-hint" />
                  <small id="profile-mobile-hint">{t.philippinesMobileFormatHint}</small>
                </label>
                <button type="submit" className="primary-btn small" disabled={savingAccount}>{savingAccount ? t.working : t.saveChanges}</button>
              </form>
              <div className="profile-email-settings">
                <label className="input-block" htmlFor="profile-email">
                  <span>{t.emailOptional}</span>
                  <input id="profile-email" type="email" autoComplete="email" maxLength={255} value={accountForm.email} disabled={savingAccount} onChange={(event) => {
                    setAccountForm((current) => ({ ...current, email: event.target.value }))
                    setEmailVerificationRequested(false)
                    setEmailCode('')
                    setAccountError('')
                    setAccountMessage('')
                  }} aria-describedby="profile-email-hint" />
                </label>
                <small id="profile-email-hint">{t.emailVerificationHint}</small>
                {emailVerificationRequested ? (
                  <form className="password-change-form" onSubmit={verifyProfileEmail}>
                    <label className="input-block">
                      <span>{t.emailVerificationCode}</span>
                      <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
                    </label>
                    <button type="submit" className="primary-btn small" disabled={savingAccount || emailCode.length !== 6}>{savingAccount ? t.working : t.verifyEmail}</button>
                    <button type="button" className="secondary-btn small" onClick={requestEmailVerification} disabled={savingAccount}>{t.resendEmailCode}</button>
                  </form>
                ) : accountForm.email.trim().toLowerCase() !== String(settingsProfile.email || '').toLowerCase() ? (
                  accountForm.email.trim()
                    ? <button type="button" className="secondary-btn small" onClick={requestEmailVerification} disabled={savingAccount}>{savingAccount ? t.working : t.sendEmailCode}</button>
                    : settingsProfile.email && <button type="button" className="secondary-btn small" onClick={removeProfileEmail} disabled={savingAccount}>{savingAccount ? t.working : t.removeEmail}</button>
                ) : settingsProfile.email ? (
                  <p className="mfa-status enabled">{t.emailOnAccount}</p>
                ) : (
                  <p className="report-metric-note">{t.mobileOnlyRecoveryHint}</p>
                )}
              </div>
              {accountError && <p className="inline-error" role="alert">{accountError}</p>}
              {accountMessage && <p className="mfa-message" role="status">{accountMessage}</p>}
            </div>

            <div className="info-box">
              <h3>{t.security}</h3>
              <form className="password-change-form" onSubmit={handlePasswordSubmit}>
                <PasswordField id="current-password" label={t.currentPassword} language={language} autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} />
                <PasswordField id="new-password" label={t.newPassword} language={language} value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} />
                <PasswordField id="confirm-password" label={t.confirmNewPassword} language={language} value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} helpText={`${t.passwordRequirements}.`} />
                <button type="submit" className="primary-btn small" disabled={savingPassword}>{savingPassword ? t.saving : t.changePassword}</button>
              </form>
            </div>

            <div className="info-box mfa-settings">
              {settingsProfile.mustChangePassword ? (
                <p>{t.temporaryPasswordChangeRequired}</p>
              ) : (
                <>
                  <h3>{t.mfaSetupTitle}</h3>
                  <p>{t.mfaSetupHint}</p>
                  {mfaEnabled ? (
                    <form className="password-change-form" onSubmit={disableMfa}>
                      <p className="mfa-status enabled">{t.mfaEnabled}</p>
                      <label className="input-block">
                        <span>{t.mfaCurrentPassword}</span>
                        <input type="password" autoComplete="current-password" value={mfaCurrentPassword} onChange={(event) => setMfaCurrentPassword(event.target.value)} required />
                      </label>
                      <label className="input-block">
                        <span>{t.mfaCodeLabel}</span>
                        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
                      </label>
                      <button type="submit" className="secondary-btn small" disabled={mfaBusy}>{mfaBusy ? t.working : t.mfaDisableAction}</button>
                    </form>
                  ) : mfaSetup ? (
                    <form className="password-change-form" onSubmit={enableMfa}>
                      <p>{t.mfaSetupInstructions}</p>
                      <label className="input-block">
                        <span>{t.mfaSecretLabel}</span>
                        <input className="mfa-secret-input" value={mfaSetup.secret} readOnly onFocus={(event) => event.target.select()} aria-label={t.mfaSecretLabel} />
                      </label>
                      <button type="button" className="secondary-btn small" onClick={() => startMfaSetup(true)} disabled={mfaBusy}>{mfaBusy ? t.working : t.mfaRotateKey}</button>
                      <label className="input-block">
                        <span>{t.mfaCodeLabel}</span>
                        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
                      </label>
                      <button type="submit" className="primary-btn small" disabled={mfaBusy}>{mfaBusy ? t.working : t.mfaEnableAction}</button>
                    </form>
                  ) : (
                    <button type="button" className="primary-btn small" onClick={() => startMfaSetup()} disabled={mfaBusy}>{mfaBusy ? t.working : t.mfaSetupAction}</button>
                  )}
                  {mfaMessage && <p className="mfa-message" role="status">{mfaMessage}</p>}
                </>
              )}
            </div>
          </div>

          {!settingsProfile.mustChangePassword && (
            <div className="profile-footer">
              <Link to={dashboardPath} className="secondary-btn small">{t.backToDashboard}</Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function StaffDirectoryOverview({ staffMembers, language, onManage }) {
  const t = translations[language] || translations.en
  const [officialProfiles, setOfficialProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/official-profiles`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(data.profiles)) {
          throw new Error(data.message || t.officialProfilesLoadFailed)
        }
        if (active) setOfficialProfiles(data.profiles)
      })
      .catch((loadError) => {
        console.error('load dashboard officer profiles failed', loadError)
        if (active) setError(t.officialProfilesLoadFailed)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [t.officialProfilesLoadFailed])

  const officialRoleLabels = {
    captain: t.barangayCaptainRole,
    secretary: t.secretaryRole,
    treasurer: t.treasurerRole,
  }

  return (
    <article className="panel-card staff-directory-overview">
      <div className="panel-header">
        <h2>{t.staffDirectoryAndOfficials}</h2>
        <button type="button" className="secondary-btn small" onClick={onManage}>{t.manageDirectoryAndOfficials}</button>
      </div>
      <div className="staff-directory-overview-grid">
        <section aria-labelledby="staff-directory-overview-title">
          <h3 id="staff-directory-overview-title">{t.staffDirectory}</h3>
          <ul>
            {staffMembers.slice(0, 4).map((member) => (
              <li key={member.id}>
                <span>{getDisplayName(member)}</span>
                <strong>{getStaffPositionLabel(member.position, t)}</strong>
              </li>
            ))}
          </ul>
          {staffMembers.length === 0 && <p className="soft-label">{t.noStaffAccounts}</p>}
          {staffMembers.length > 4 && <p className="soft-label">+{staffMembers.length - 4}</p>}
        </section>
        <section aria-labelledby="officials-overview-title">
          <h3 id="officials-overview-title">{t.officialProfilesTitle}</h3>
          {loading && <p className="soft-label" role="status">{t.loadingRequests}</p>}
          {error && <p className="status-error" role="alert">{error}</p>}
          {!loading && !error && (
            <ul>
              {officialProfiles.map((profile) => (
                <li key={profile.role}>
                  <span>{officialRoleLabels[profile.role] || profile.role}</span>
                  <strong>{profile.displayName || t.notAvailable}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  )
}

function StaffPage({ staffMembers = [], announcements = [], currentUser, userRole = 'staff', onProcessRequest, onLogout, onStaffMemberUpdated, onPortalAccountCreated, onAddAnnouncement, onDeleteAnnouncement, onRetractAnnouncement, onDeleteStaffMember, language, setLanguage }) {
  const t = translations[language] || translations.en
  const [activeTab, setActiveTab] = useState('queue')
  const [showAccountCreation, setShowAccountCreation] = useState(false)
  const [openRequestPanel, setOpenRequestPanel] = useState('queue')
  const [queueSearch, setQueueSearch] = useState('')
  const [debouncedQueueSearch, setDebouncedQueueSearch] = useState('')
  const [queueStatus, setQueueStatus] = useState('active')
  const [queueZone, setQueueZone] = useState('all')
  const [queueType, setQueueType] = useState('all')
  const [queueFrom, setQueueFrom] = useState('')
  const [queueTo, setQueueTo] = useState('')
  const [queueSort, setQueueSort] = useState('date')
  const [queueDirection, setQueueDirection] = useState('desc')
  const [queuePage, setQueuePage] = useState(1)
  const [queuePageSize, setQueuePageSize] = useState(10)
  const [dashboardRequests, setDashboardRequests] = useState([])
  const [dashboardSummary, setDashboardSummary] = useState({ total: 0, pending: 0, inReview: 0, needsInformation: 0, approved: 0, rejected: 0 })
  const [dashboardDocumentTypes, setDashboardDocumentTypes] = useState([])
  const [dashboardTotal, setDashboardTotal] = useState(0)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState(null)
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0)
  const [staffArchives, setStaffArchives] = useState([])
  const [staffArchivesLoading, setStaffArchivesLoading] = useState(false)
  const [staffArchivesError, setStaffArchivesError] = useState('')
  const [staffArchiveMessage, setStaffArchiveMessage] = useState('')
  const [staffArchiveBusy, setStaffArchiveBusy] = useState(false)
  const [staffArchiveRefreshKey, setStaffArchiveRefreshKey] = useState(0)
  const [reportRefreshKey, setReportRefreshKey] = useState(0)
  const [reportPeriod, setReportPeriod] = useState('last30')
  const [reportRange, setReportRange] = useState(() => getReportDateRange('last30'))
  const [reportType, setReportType] = useState('')
  const [reportStatus, setReportStatus] = useState('')
  const [reportData, setReportData] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportExporting, setReportExporting] = useState(false)
  const [reportExportError, setReportExportError] = useState('')
  const [reportValidationError, setReportValidationError] = useState('')
  const [socialIntegrationStatus, setSocialIntegrationStatus] = useState(null)
  const [socialIntegrationStatusError, setSocialIntegrationStatusError] = useState('')
  const [messengerLink, setMessengerLink] = useState('')
  const [retractionTarget, setRetractionTarget] = useState(null)
  const [retractionContent, setRetractionContent] = useState('')
  const [retractionSubmitting, setRetractionSubmitting] = useState(false)
  const [todayDate] = useState(() => new Date())
  const [requestStatusDrafts, setRequestStatusDrafts] = useState({})
  const [requestStatusNotes, setRequestStatusNotes] = useState({})
  const [selectedUser, setSelectedUser] = useState(null)
  const connectedSocialAccounts = defaultSocialAccounts.map((account) => ({
    ...account,
    connected: Boolean(socialIntegrationStatus?.[account.key]),
  }))

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/social-integrations/status`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || 'Unable to load social connection status.')
        if (active) {
          setSocialIntegrationStatus(data.integrations || {})
          setMessengerLink(data.messengerLink || '')
        }
      })
      .catch((error) => {
        console.error('load social integration status error', error)
        if (active) {
          setSocialIntegrationStatus({})
          setSocialIntegrationStatusError(error.message || 'Unable to load social connection status.')
        }
      })
    return () => {
      active = false
    }
  }, [])
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    content: '',
    tag: 'green',
    date: new Date().toLocaleDateString(),
    socialChannels: [],
  })
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [confirmation, setConfirmation] = useState(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQueueSearch(queueSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [queueSearch])

  const effectiveQueueStatus = queueStatus
  useEffect(() => {
    let active = true
    const loadingTimer = window.setTimeout(() => {
      if (active) {
        setDashboardLoading(true)
        setDashboardError('')
      }
    }, 0)
    const loadRequestDashboard = async () => {
      const params = new URLSearchParams({
        search: debouncedQueueSearch,
        status: effectiveQueueStatus,
        zone: queueZone === 'all' ? '' : queueZone,
        type: queueType === 'all' ? '' : queueType,
        from: queueFrom,
        to: queueTo,
        sort: queueSort,
        direction: queueDirection,
        page: String(queuePage),
        pageSize: String(queuePageSize),
      })
      try {
        const response = await fetch(`${API_BASE}/staff/dashboard-requests?${params}`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || t.requestDashboardUnavailable)
        if (active) {
          setDashboardRequests(Array.isArray(data.requests) ? data.requests : [])
          setDashboardSummary(data.summary || { total: 0, pending: 0, inReview: 0, needsInformation: 0, approved: 0, rejected: 0 })
          setDashboardDocumentTypes(Array.isArray(data.documentTypes) ? data.documentTypes : [])
          setDashboardTotal(Number(data.total) || 0)
          setDashboardUpdatedAt(new Date())
          setDashboardError('')
        }
      } catch (error) {
        console.error('load staff request dashboard error', error)
        if (active) setDashboardError(error.message || t.requestDashboardUnavailable)
      } finally {
        window.clearTimeout(loadingTimer)
        if (active) setDashboardLoading(false)
      }
    }
    loadRequestDashboard()
    return () => {
      active = false
      window.clearTimeout(loadingTimer)
    }
  }, [debouncedQueueSearch, effectiveQueueStatus, queueZone, queueType, queueFrom, queueTo, queueSort, queueDirection, queuePage, queuePageSize, dashboardRefreshKey, t.requestDashboardUnavailable])

  useEffect(() => {
    if (activeTab !== 'approvals') return undefined
    let active = true
    const controller = new AbortController()
    const loadStaffArchives = async () => {
      setStaffArchivesLoading(true)
      setStaffArchivesError('')
      try {
        const response = await fetch(`${API_BASE}/staff/archives`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(data.archives)) throw new Error(data.message || t.staffArchivesLoadFailed)
        if (active) setStaffArchives(data.archives.filter((archive) => archive.name?.startsWith('queue-approvals-')))
      } catch (loadError) {
        if (loadError.name !== 'AbortError' && active) {
          console.error('load staff processed-request archives failed', loadError)
          setStaffArchivesError(loadError.message || t.staffArchivesLoadFailed)
        }
      } finally {
        if (active) setStaffArchivesLoading(false)
      }
    }
    loadStaffArchives()
    return () => {
      active = false
      controller.abort()
    }
  }, [activeTab, staffArchiveRefreshKey, t.staffArchivesLoadFailed])

  useEffect(() => {
    if (activeTab !== 'reports' || reportValidationError) return undefined

    let active = true
    const controller = new AbortController()
    const loadReport = async () => {
      setReportLoading(true)
      setReportError('')
      const params = new URLSearchParams({
        from: reportRange.from,
        to: reportRange.to,
        type: reportType,
        status: reportStatus,
      })
      try {
        const response = await fetch(`${API_BASE}/staff/reports?${params}`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || t.reportError)
        if (!isStaffReportResponse(data)) throw new Error(t.reportError)
        if (active) setReportData(data)
      } catch (error) {
        if (error.name === 'AbortError') return
        console.error('load staff reports error', error)
        if (active) {
          setReportData(null)
          setReportError(error.message || t.reportError)
        }
      } finally {
        if (active) setReportLoading(false)
      }
    }
    loadReport()
    return () => {
      active = false
      controller.abort()
    }
  }, [activeTab, reportRange, reportType, reportStatus, reportValidationError, reportRefreshKey, t.reportError])

  const pendingCount = Number(dashboardSummary.pending) || 0
  const inReviewCount = Number(dashboardSummary.inReview) || 0
  const approvedCount = Number(dashboardSummary.approved) || 0
  const totalRequests = Number(dashboardSummary.total) || 0
  const filteredQueueRequests = dashboardRequests
  const requestPages = Math.max(1, Math.ceil(dashboardTotal / queuePageSize))
  const quickQueueFilters = [
    { value: 'active', label: t.activeQueue, count: pendingCount + inReviewCount + (Number(dashboardSummary.needsInformation) || 0) },
    { value: 'Pending', label: t.pendingReview, count: pendingCount },
    { value: 'In Review', label: t.statusUnderReview, count: inReviewCount },
    { value: 'Needs Information', label: t.statusNeedsInformation, count: Number(dashboardSummary.needsInformation) || 0 },
  ]

  const setQueueFilter = (status) => {
    setActiveTab('queue')
    setQueueStatus(status)
    setQueuePage(1)
    setOpenRequestPanel('queue')
  }

  const handleReportPeriodChange = (period) => {
    setReportPeriod(period)
    setReportValidationError('')
    if (period !== 'custom') setReportRange(getReportDateRange(period))
  }

  const handleReportDateChange = (field, value) => {
    const nextRange = { ...reportRange, [field]: value }
    setReportPeriod('custom')
    setReportRange(nextRange)
    setReportValidationError(nextRange.from && nextRange.to && nextRange.from > nextRange.to
      ? t.reportCustomDateError
      : '')
  }

  const clearReportFilters = () => {
    setReportPeriod('all')
    setReportRange({ from: '', to: '' })
    setReportType('')
    setReportStatus('')
    setReportValidationError('')
    setReportExportError('')
  }

  const setQueueFilterFromReport = (status) => {
    setQueueStatus(status)
    setQueueType(reportType || 'all')
    setQueueFrom(reportRange.from)
    setQueueTo(reportRange.to)
    setQueuePage(1)
    setOpenRequestPanel('queue')
    setActiveTab('queue')
  }

  const exportReportCsv = async () => {
    setReportExporting(true)
    setReportExportError('')
    const params = new URLSearchParams({
      from: reportRange.from,
      to: reportRange.to,
      type: reportType,
      status: reportStatus,
    })
    try {
      const response = await fetch(`${API_BASE}/staff/reports/export.csv?${params}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.message || t.reportError)
      }
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `service-requests-${reportRange.from && reportRange.to ? `${reportRange.from}-to-${reportRange.to}` : reportRange.from || reportRange.to || 'all-time'}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.error('export staff reports CSV error', error)
      setReportExportError(error.message || t.reportError)
    } finally {
      setReportExporting(false)
    }
  }

  const formatReportPeriod = () => {
    if (!reportRange.from && !reportRange.to) return t.reportAllTime
    const locale = language === 'fil' ? 'fil-PH' : 'en-PH'
    const format = (value) => new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeZone: 'Asia/Manila',
    }).format(new Date(`${value}T12:00:00+08:00`))
    if (reportRange.from && reportRange.to) return `${format(reportRange.from)} – ${format(reportRange.to)}`
    return reportRange.from ? `${t.reportStartDate}: ${format(reportRange.from)}` : `${t.reportEndDate}: ${format(reportRange.to)}`
  }

  const formatDecisionTurnaround = (hours) => {
    if (hours === null || hours === undefined) return t.systemUnknown
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`
  }

  const formatRequestDate = (value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(date)
  }

  const handleRequestStatusSubmit = async (event, item) => {
    event.preventDefault()
    const status = requestStatusDrafts[item.id]
    if (!status) return
    try {
      await onProcessRequest(item.id, status, requestStatusNotes[item.id] || '')
      setRequestStatusDrafts((current) => ({ ...current, [item.id]: '' }))
      setRequestStatusNotes((current) => ({ ...current, [item.id]: '' }))
      setDashboardRefreshKey((current) => current + 1)
      setSelectedRequest(null)
    } catch (error) {
      alert(error.message || 'Unable to update request status.')
    }
  }

  const archiveProcessedRequests = async () => {
    if (!window.confirm(t.processedArchiveOlderMessage)) return
    setStaffArchiveBusy(true)
    setStaffArchivesError('')
    setStaffArchiveMessage('')
    try {
      const response = await fetch(`${API_BASE}/staff/archive-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 30 }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.archive) throw new Error(data.message || t.staffArchiveFailed)
      const archive = data.archive
      setStaffArchiveMessage(archive.count
        ? t.archiveSummary.replace('{count}', String(archive.count)).replace('{date}', formatRequestDate(archive.archivedAt || new Date().toISOString()))
        : t.noEligibleProcessedRequests)
      setDashboardRefreshKey((current) => current + 1)
      setStaffArchiveRefreshKey((current) => current + 1)
    } catch (archiveError) {
      console.error('archive processed resident requests failed', archiveError)
      setStaffArchivesError(archiveError.message || t.staffArchiveFailed)
    } finally {
      setStaffArchiveBusy(false)
    }
  }

  const downloadStaffArchive = async (archive) => {
    try {
      const response = await fetch(`${API_BASE}/staff/archive-file?name=${encodeURIComponent(archive.name)}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.message || t.staffArchivesLoadFailed)
      }
      const downloadUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = archive.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)
    } catch (downloadError) {
      console.error('download staff request archive failed', downloadError)
      setStaffArchivesError(downloadError.message || t.staffArchivesLoadFailed)
    }
  }

  const toggleAnnouncementChannel = (channelKey) => {
    setAnnouncementForm((prev) => {
      const nextChannels = new Set(prev.socialChannels || [])
      if (nextChannels.has(channelKey)) {
        nextChannels.delete(channelKey)
      } else {
        nextChannels.add(channelKey)
      }

      return { ...prev, socialChannels: Array.from(nextChannels) }
    })
  }

  const handleRetractionSubmit = async (event) => {
    event.preventDefault()
    const content = sanitizeText(retractionContent)
    if (!retractionTarget || !content) {
      alert(t.retractionMessageRequired)
      return
    }
    setRetractionSubmitting(true)
    try {
      await onRetractAnnouncement?.(retractionTarget.id, content)
      setRetractionTarget(null)
      setRetractionContent('')
    } catch (error) {
      alert(error.message || t.retractionFailed)
    } finally {
      setRetractionSubmitting(false)
    }
  }

  const handleAnnouncementSubmit = async (event) => {
    event.preventDefault()
    const title = sanitizeText(announcementForm.title)
    const content = sanitizeText(announcementForm.content)

    if (!title || !content) {
      alert('Please add a title and message for the announcement.')
      return
    }

    try {
      await onAddAnnouncement?.({
        tag: announcementForm.tag,
        title,
        content,
        date: announcementForm.date || new Date().toLocaleDateString(),
        socialChannels: announcementForm.socialChannels || [],
      })

      setAnnouncementForm({
        title: '',
        content: '',
        tag: 'green',
        date: new Date().toLocaleDateString(),
        socialChannels: [],
      })
      setShowAnnouncementForm(false)
    } catch (error) {
      alert(error.message || 'Unable to publish announcement.')
    }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar staff-topbar">
        <div className="brand-wrap">
          <SystemLogo className="seal-logo tiny" alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>{t.staffPortal}</small>
          </div>
        </div>

        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <Link to="/settings" className="secondary-btn small">{t.settings}</Link>
          <span className="role-chip">{getDisplayName(currentUser)} • {getStaffPositionLabel(currentUser?.position || (isAdminRole(userRole) ? t.administrator : 'Staff'), t)}</span>
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="dashboard-main staff-dashboard-main">
        <aside className="sidebar" aria-label={t.staffNavigationLabel}>
          <nav className="sidebar-nav" aria-label={t.staffNavigationLabel}>
            <button
              type="button"
              className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
              aria-current={activeTab === 'queue' ? 'page' : undefined}
              onClick={() => setActiveTab('queue')}
            >
              <span className="nav-icon">📄</span><span>{t.staffDashboardTitle}</span>
            </button>
            {userRole === 'staff' && (
              <button
                type="button"
                className={`nav-item ${activeTab === 'residents' ? 'active' : ''}`}
                aria-current={activeTab === 'residents' ? 'page' : undefined}
                onClick={() => setActiveTab('residents')}
              >
                <span className="nav-icon">🏘️</span><span>{language === 'fil' ? 'Talaan ng residente' : 'Resident registry'}</span>
              </button>
            )}
            <button
              type="button"
              className={`nav-item ${activeTab === 'printing' ? 'active' : ''}`}
              aria-current={activeTab === 'printing' ? 'page' : undefined}
              onClick={() => setActiveTab('printing')}
            >
              <span className="nav-icon">🖨️</span><span>{t.printCenterNav}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'approvals' ? 'active' : ''}`}
              aria-current={activeTab === 'approvals' ? 'page' : undefined}
              onClick={() => { setActiveTab('approvals'); setOpenRequestPanel('approvals'); setQueuePage(1) }}
            >
              <span className="nav-icon">🗄️</span><span>{t.processedArchiveNav}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`}
              aria-current={activeTab === 'reports' ? 'page' : undefined}
              onClick={() => setActiveTab('reports')}
            >
              <span className="nav-icon">📊</span><span>{t.reports}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'announcements' ? 'active' : ''}`}
              aria-current={activeTab === 'announcements' ? 'page' : undefined}
              onClick={() => setActiveTab('announcements')}
            >
              <span className="nav-icon">📣</span><span>{t.announcements}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'staff' ? 'active' : ''}`}
              aria-current={activeTab === 'staff' ? 'page' : undefined}
              onClick={() => setActiveTab('staff')}
            >
              <span className="nav-icon">👥</span><span>{t.staffDirectoryAndOfficials}</span>
            </button>
          </nav>
        </aside>

        <section className={`content-panel staff-content-panel staff-module-${activeTab}`} aria-label={t.staffOverviewLabel}>
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{t.operations}</p>
              <h1>{activeTab === 'queue' ? t.staffDashboardTitle : activeTab === 'printing' ? t.printCenterTitle : activeTab === 'reports' ? t.serviceReports : activeTab === 'announcements' ? t.announcements : activeTab === 'staff' ? t.staffDirectoryAndOfficials : activeTab === 'residents' ? (language === 'fil' ? 'Talaan ng residente' : 'Resident registry') : t.approvalsManagement}</h1>
              {activeTab === 'queue' && <p className="staff-dashboard-subtitle">{t.staffDashboardSubtitle}</p>}
            </div>
            {activeTab === 'queue' ? (
              <div className="staff-dashboard-meta">
                <span>{new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'full', timeZone: 'Asia/Manila' }).format(todayDate)}</span>
                <span>{t.lastUpdated}: {dashboardUpdatedAt ? new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(dashboardUpdatedAt) : '—'}</span>
                <button className="secondary-btn small" type="button" disabled={dashboardLoading} onClick={() => setDashboardRefreshKey((current) => current + 1)}>
                  {dashboardLoading ? t.loadingRequests : t.refreshRequests}
                </button>
              </div>
            ) : !['residents', 'staff', 'printing', 'approvals'].includes(activeTab) && <span className="counter-pill">{totalRequests} {t.requests}</span>}
          </div>

          {!['residents', 'staff', 'printing', 'approvals'].includes(activeTab) && <div className="stats-grid staff-dashboard-metrics" aria-label={t.staffSummaryLabel}>
            <button className="stat-card staff-metric-card accent" type="button" onClick={() => setQueueFilter('Pending')}>
              <span className="label">{t.pendingReviewMetric}</span>
              <span className="stat-number">{pendingCount}</span>
              <span className="staff-metric-description">{t.pendingReviewDescription}</span>
            </button>
            <button className="stat-card staff-metric-card" type="button" onClick={() => setQueueFilter('In Review')}>
              <span className="label">{t.inProcessingMetric}</span>
              <span className="stat-number">{inReviewCount}</span>
              <span className="staff-metric-description">{t.inProcessingDescription}</span>
            </button>
            <article className="stat-card staff-metric-card unavailable">
              <span className="label">{t.readyForReleaseMetric}</span>
              <span className="stat-number" aria-label={t.systemUnknown}>—</span>
              <span className="staff-metric-description">{t.releaseStageNotTracked}</span>
            </article>
            <article className="stat-card staff-metric-card unavailable">
              <span className="label">{t.overdueRequestsMetric}</span>
              <span className="stat-number" aria-label={t.systemUnknown}>—</span>
              <span className="staff-metric-description">{t.deadlinesNotTracked}</span>
            </article>
          </div>}

          <div className="dashboard-body">
            <div className="main-column">
              {activeTab === 'residents' && <StaffRegistryPanel language={language} />}
              {activeTab === 'printing' && <StaffPrintCenter language={language} />}
              {activeTab === 'queue' && (
                <>
                <section className="panel-card needs-attention" aria-labelledby="needs-attention-title">
                  <div className="panel-header left-align">
                    <h2 id="needs-attention-title">{t.printCenterTitle}</h2>
                  </div>
                  <div className="staff-print-launcher">
                    <p>{t.printCenterSummary}</p>
                    <button type="button" className="primary-btn small" onClick={() => setActiveTab('printing')}>{t.openPrintCenter}</button>
                  </div>
                </section>

                <article className="panel-card" id="staff-request-queue">
                  <button
                    type="button"
                    className="collapsible-panel-header"
                    aria-expanded={openRequestPanel === 'queue'}
                    onClick={() => setOpenRequestPanel((current) => current === 'queue' ? null : 'queue')}
                  >
                    <span>
                      <h2>{t.residentRequestsQueue || 'Resident Requests Queue'}</h2>
                      <span className="soft-label">{t.updatedToday}</span>
                    </span>
                    <span className={`collapse-chevron ${openRequestPanel === 'queue' ? 'open' : ''}`}>▾</span>
                  </button>

                  {openRequestPanel === 'queue' && <>
                  <div className="staff-queue-controls">
                    <div className="staff-queue-toolbar">
                      <input type="search" value={queueSearch} onChange={(event) => { setQueueSearch(event.target.value); setQueuePage(1) }} placeholder={t.requestQueueSearch} aria-label={t.requestQueueSearch} />
                      <button type="button" className="secondary-btn small" disabled={dashboardLoading} onClick={() => setDashboardRefreshKey((current) => current + 1)}>{dashboardLoading ? t.loadingRequests : t.refreshRequests}</button>
                    </div>
                    <nav className="staff-queue-workflow-filters" aria-label={t.requestStatusFilter}>
                      {quickQueueFilters.map((filter) => (
                        <button
                          type="button"
                          key={filter.value}
                          className={`staff-queue-workflow-filter${queueStatus === filter.value ? ' active' : ''}`}
                          aria-pressed={queueStatus === filter.value}
                          onClick={() => { setQueueStatus(filter.value); setQueuePage(1) }}
                        >
                          <span>{filter.label}</span><strong>{filter.count}</strong>
                        </button>
                      ))}
                    </nav>
                    <details className="staff-queue-advanced">
                      <summary>{t.advancedFilters}</summary>
                      <div className="staff-queue-filters">
                        <label>{t.requestStatusFilter}
                          <select value={queueStatus} onChange={(event) => { setQueueStatus(event.target.value); setQueuePage(1) }}>
                            <option value="active">{t.activeQueue}</option>
                            <option value="all">{t.allStatuses}</option>
                            <option value="Pending">{t.pending}</option>
                            <option value="In Review">{t.statusUnderReview}</option>
                            <option value="Needs Information">{t.statusNeedsInformation}</option>
                            <option value="Approved">{t.approved}</option>
                            <option value="Rejected">{t.statusRejected}</option>
                          </select>
                        </label>
                        <label>{t.documentTypeFilter}
                          <select value={queueType} onChange={(event) => { setQueueType(event.target.value); setQueuePage(1) }}>
                            <option value="all">{t.allDocumentTypes}</option>
                            {dashboardDocumentTypes.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </label>
                        <label>{t.requestZoneFilter}
                          <select value={queueZone} onChange={(event) => { setQueueZone(event.target.value); setQueuePage(1) }}>
                            <option value="all">{t.allZonesLabel}</option>
                            {[1, 2, 3, 4, 5, 6, 7].map((zone) => <option key={zone} value={String(zone)}>Zone {zone}</option>)}
                          </select>
                        </label>
                        <label>{t.fromDate}<input type="date" max={queueTo || undefined} value={queueFrom} onChange={(event) => { setQueueFrom(event.target.value); setQueuePage(1) }} /></label>
                        <label>{t.toDate}<input type="date" min={queueFrom || undefined} value={queueTo} onChange={(event) => { setQueueTo(event.target.value); setQueuePage(1) }} /></label>
                        <label>{t.sortRequestsBy}
                          <select value={queueSort} onChange={(event) => { setQueueSort(event.target.value); setQueuePage(1) }}>
                            <option value="date">{t.sortSubmissionDate}</option>
                            <option value="status">{t.sortStatus}</option>
                          </select>
                        </label>
                        <label>{t.sortDirection}
                          <select value={queueDirection} onChange={(event) => { setQueueDirection(event.target.value); setQueuePage(1) }}>
                            <option value="desc">{t.descending}</option>
                            <option value="asc">{t.ascending}</option>
                          </select>
                        </label>
                        <label>{t.requestPageSize}
                          <select value={queuePageSize} onChange={(event) => { setQueuePageSize(Number(event.target.value)); setQueuePage(1) }}>
                            {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                          </select>
                        </label>
                      </div>
                    </details>
                  </div>
                  {dashboardLoading && <p className="request-dashboard-loading" role="status">{t.loadingRequests}</p>}
                  {dashboardError && <div className="request-dashboard-error" role="alert">
                    <span>{dashboardError}</span>
                    <button type="button" className="secondary-btn small" onClick={() => setDashboardRefreshKey((current) => current + 1)}>{t.retry}</button>
                  </div>}
                  <div className="request-table-wrap" aria-busy={dashboardLoading}>
                    <table className="request-table">
                      <thead>
                        <tr>
                          <th>{t.requestId}</th>
                          <th>{t.resident}</th>
                          <th>{t.requestType}</th>
                          <th>{t.submissionDate}</th>
                          <th>{t.status}</th>
                          <th>{t.actionsLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredQueueRequests.map((item) => (
                          <tr key={item.id}>
                            <td><button type="button" className="request-id-button" aria-label={t.viewRequestDetails.replace('{id}', String(item.id))} onClick={() => setSelectedRequest(item)}>{item.id}</button></td>
                            <td>{item.first_name || item.firstName || t.resident} {item.last_name || item.lastName || ''}</td>
                            <td>{item.type}{item.type === 'Emergency Help' && <span className="priority-badge urgent">{t.urgentLabel}</span>}</td>
                            <td>{formatRequestDate(item.date || item.createdAt || item.created_at)}</td>
                            <td><span className={`status-badge ${(item.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{getRequestStatusLabel(item.status, t)}</span></td>
                            <td>
                              {['Approved', 'Rejected'].includes(item.status)
                                ? <button type="button" className="secondary-btn small" onClick={() => setSelectedRequest(item)}>{t.openRequestDetails}</button>
                                : <button type="button" className="small-action success" onClick={() => setSelectedRequest(item)}>{t.openRequestDetails}</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!dashboardLoading && !dashboardError && filteredQueueRequests.length === 0 && <div className="empty-state">{t.noRequestsMatchFilters}</div>}
                  </div>
                  <div className="request-pagination">
                    <span>{t.pageOfPages.replace('{page}', String(queuePage)).replace('{pages}', String(requestPages))} · {dashboardTotal}</span>
                    <div>
                      <button type="button" className="secondary-btn small" disabled={dashboardLoading || queuePage <= 1} onClick={() => setQueuePage((page) => Math.max(1, page - 1))}>{t.previousPage}</button>
                      <button type="button" className="secondary-btn small" disabled={dashboardLoading || queuePage >= requestPages} onClick={() => setQueuePage((page) => Math.min(requestPages, page + 1))}>{t.nextPage}</button>
                    </div>
                  </div>
                  </>}

                </article>
                </>
              )}

              {activeTab === 'approvals' && (
                <section className="staff-archive-page" aria-labelledby="staff-archive-title">
                  <article className="panel-card staff-archive-intro">
                    <div>
                      <h2 id="staff-archive-title">{t.approvalsManagement}</h2>
                      <p>{t.processedArchiveHelp}</p>
                    </div>
                    <div className="staff-archive-summary">
                      <strong>{approvedCount + (Number(dashboardSummary.rejected) || 0)}</strong>
                      <span>{t.processedArchiveCount}</span>
                    </div>
                    <div className="staff-archive-actions">
                      <button type="button" className="primary-btn small" onClick={archiveProcessedRequests} disabled={staffArchiveBusy || dashboardLoading}>
                        {staffArchiveBusy ? t.working : t.archiveOlderThan30Days}
                      </button>
                      <button type="button" className="secondary-btn small" onClick={() => setStaffArchiveRefreshKey((current) => current + 1)} disabled={staffArchivesLoading}>
                        {staffArchivesLoading ? t.loadingRequests : t.refreshRequests}
                      </button>
                    </div>
                  </article>
                  {staffArchiveMessage && <p className="staff-archive-message" role="status">{staffArchiveMessage}</p>}
                  {staffArchivesError && <div className="request-dashboard-error" role="alert">
                    <span>{staffArchivesError}</span>
                    <button type="button" className="secondary-btn small" onClick={() => setStaffArchiveRefreshKey((current) => current + 1)}>{t.retry}</button>
                  </div>}
                  <article className="panel-card staff-archive-files">
                    <div className="panel-header">
                      <h2>{t.processedArchiveFiles}</h2>
                      <span className="soft-label">{staffArchives.length}</span>
                    </div>
                    {staffArchivesLoading && <p className="request-dashboard-loading" role="status">{t.loadingRequests}</p>}
                    {!staffArchivesLoading && staffArchives.length > 0 ? (
                      <ul>
                        {staffArchives.map((archive) => (
                          <li key={archive.name}>
                            <div>
                              <strong>{archive.name}</strong>
                              <small>{t.processedArchiveDate}: {formatRequestDate(archive.mtime || archive.created_at)} · {t.processedArchiveSize}: {Math.max(1, Math.round(Number(archive.size || 0) / 1024))} KB</small>
                            </div>
                            <button type="button" className="secondary-btn small" onClick={() => downloadStaffArchive(archive)}>{t.processedArchiveDownload}</button>
                          </li>
                        ))}
                      </ul>
                    ) : !staffArchivesLoading && !staffArchivesError && <div className="empty-state">{t.processedArchiveNoFiles}</div>}
                  </article>
                </section>
              )}

              {activeTab === 'reports' && (
                <section className="staff-reports-page" aria-labelledby="staff-reports-title">
                  <article className="panel-card report-toolbar">
                    <div className="panel-header">
                      <div>
                        <h2 id="staff-reports-title">{t.serviceReports}</h2>
                        <p className="soft-label">{t.reportPeriod}: {formatReportPeriod()}</p>
                      </div>
                      <div className="report-toolbar-actions">
                        <button type="button" className="secondary-btn small" onClick={clearReportFilters}>{t.reportClearFilters}</button>
                        <button type="button" className="secondary-btn small" onClick={exportReportCsv} disabled={reportLoading || reportExporting || Boolean(reportValidationError)}>
                          {reportExporting ? t.working : t.reportExportCsv}
                        </button>
                        <button type="button" className="secondary-btn small" onClick={() => window.print()} disabled={!reportData || Boolean(reportError) || Boolean(reportValidationError)}>{t.reportPrint}</button>
                      </div>
                    </div>
                    <details className="report-filter-details">
                    <summary>{t.reportFilterOptions}</summary>
                    <div className="report-filters">
                      <label>{t.reportPeriod}
                        <select value={reportPeriod} onChange={(event) => handleReportPeriodChange(event.target.value)}>
                          <option value="today">{t.reportToday}</option>
                          <option value="last7">{t.reportLast7Days}</option>
                          <option value="last30">{t.reportLast30Days}</option>
                          <option value="thisMonth">{t.reportThisMonth}</option>
                          <option value="previousMonth">{t.reportPreviousMonth}</option>
                          <option value="custom">{t.reportCustomRange}</option>
                          <option value="all">{t.reportAllTime}</option>
                        </select>
                      </label>
                      {reportPeriod === 'custom' && (
                        <>
                          <label>{t.reportStartDate}
                            <input type="date" value={reportRange.from} max={reportRange.to || undefined} onChange={(event) => handleReportDateChange('from', event.target.value)} />
                          </label>
                          <label>{t.reportEndDate}
                            <input type="date" value={reportRange.to} min={reportRange.from || undefined} onChange={(event) => handleReportDateChange('to', event.target.value)} />
                          </label>
                        </>
                      )}
                      <label>{t.reportRequestType}
                        <select value={reportType} onChange={(event) => setReportType(event.target.value)}>
                          <option value="">{t.reportAllTypes}</option>
                          {(reportData?.requestTypes || []).map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </label>
                      <label>{t.reportCurrentStatus}
                        <select value={reportStatus} onChange={(event) => setReportStatus(event.target.value)}>
                          <option value="">{t.reportAllStatuses}</option>
                          {(reportData?.statuses || []).map((status) => <option key={status} value={status}>{getRequestStatusLabel(status, t)}</option>)}
                        </select>
                      </label>
                    </div>
                    <p className="report-filter-basis">{t.reportFilterBasis}</p>
                    </details>
                    {reportValidationError && <p className="report-error" role="alert">{reportValidationError}</p>}
                    {reportError && <div className="report-error" role="alert">
                      <span>{reportError}</span>
                      <button type="button" className="secondary-btn small" onClick={() => setReportRefreshKey((current) => current + 1)}>{t.reportRetry}</button>
                    </div>}
                    {reportExportError && <p className="report-error" role="alert">{reportExportError}</p>}
                  </article>

                  {reportLoading && <p className="request-dashboard-loading" role="status">{t.reportLoading}</p>}
                  {!reportLoading && !reportError && !reportValidationError && reportData && (
                    <>
                      <p className="report-summary-hint">{t.reportSummaryHint}</p>
                      <div className="stats-grid report-summary-grid" aria-label={t.serviceReports}>
                        <article className="stat-card report-summary-card accent">
                          <span className="label">{t.reportReceived}</span>
                          <span className="stat-number">{Number(reportData.summary.received).toLocaleString()}</span>
                          <span className="staff-metric-description">{formatReportPeriod()}</span>
                        </article>
                        <button type="button" className="stat-card report-summary-card" onClick={() => setQueueFilterFromReport('Pending')}>
                          <span className="label">{t.reportPendingReview}</span>
                          <span className="stat-number">{Number(reportData.summary.pendingReview).toLocaleString()}</span>
                          <span className="staff-metric-description">{t.pendingReviewDescription}</span>
                        </button>
                        <button type="button" className="stat-card report-summary-card" onClick={() => setQueueFilterFromReport('In Review')}>
                          <span className="label">{t.reportInProcessing}</span>
                          <span className="stat-number">{Number(reportData.summary.inProcessing).toLocaleString()}</span>
                          <span className="staff-metric-description">{t.inProcessingDescription}</span>
                        </button>
                      </div>

                      <details className="report-details">
                        <summary>{t.reportMoreDetails}</summary>
                        <div className="report-details-content">
                      {reportData.summary.missingSubmissionDates > 0 && (
                        <p className="report-data-notice" role="status">
                          {t.reportMissingDates.replace('{count}', String(reportData.summary.missingSubmissionDates))}
                        </p>
                      )}

                      <div className="report-analytics-grid">
                        <article className="panel-card report-analytics-panel">
                          <div className="panel-header">
                            <h2>{t.reportActivity}</h2>
                            <span className="soft-label">{t.reportPeriod}: {formatReportPeriod()}</span>
                          </div>
                          <div className="report-chart-legend" aria-hidden="true">
                            <span><i className="received" />{t.reportReceivedSeries}</span>
                            <span><i className="decisions" />{t.reportDecisionSeries}</span>
                          </div>
                          {reportData.activity.length > 0 ? (
                            <div className="report-activity-chart" role="img" aria-label={`${t.reportActivity}: ${t.reportReceivedSeries} and ${t.reportDecisionSeries}`}>
                              {reportData.activity.map((item) => {
                                const maximum = Math.max(1, ...reportData.activity.map((point) => Math.max(point.received, point.decisions)))
                                const date = item.unit === 'month' ? `${item.period}-01T12:00:00+08:00` : `${item.period}T12:00:00+08:00`
                                const label = new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', item.unit === 'month'
                                  ? { month: 'short', year: 'numeric', timeZone: 'Asia/Manila' }
                                  : { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(date))
                                return (
                                  <div className="report-activity-row" key={item.period}>
                                    <span className="report-activity-label">{label}</span>
                                    <div className="report-activity-bars">
                                      <div className="report-bar-track" title={`${t.reportReceivedSeries}: ${item.received}`}><span className="received" style={{ width: `${(item.received / maximum) * 100}%` }} /><b>{item.received}</b></div>
                                      <div className="report-bar-track" title={`${t.reportDecisionSeries}: ${item.decisions}`}><span className="decisions" style={{ width: `${(item.decisions / maximum) * 100}%` }} /><b>{item.decisions}</b></div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : <p className="empty-state">{t.reportNoData}</p>}
                        </article>

                        <article className="panel-card report-analytics-panel">
                          <div className="panel-header"><h2>{t.reportStatusBreakdown}</h2></div>
                          <div className="report-breakdown-list">
                            {reportData.statusDistribution.map(({ name, count }) => (
                              <div className="report-breakdown-item" key={name}>
                                <span>{getRequestStatusLabel(name, t)}</span>
                                <span className="report-breakdown-track"><i style={{ width: `${reportData.summary.received ? (count / reportData.summary.received) * 100 : 0}%` }} /></span>
                                <strong>{count.toLocaleString()}</strong>
                              </div>
                            ))}
                            {!reportData.statusDistribution.length && <p className="empty-state">{t.reportNoData}</p>}
                          </div>
                        </article>

                        <article className="panel-card report-analytics-panel">
                          <div className="panel-header"><h2>{t.reportTypeBreakdown}</h2></div>
                          <div className="report-breakdown-list">
                            {reportData.typeBreakdown.map(({ name, count }) => (
                              <button type="button" className="report-breakdown-item report-type-filter" key={name} onClick={() => setReportType((current) => current === name ? '' : name)} aria-pressed={reportType === name}>
                                <span>{name}</span>
                                <span className="report-breakdown-track"><i style={{ width: `${reportData.summary.received ? (count / reportData.summary.received) * 100 : 0}%` }} /></span>
                                <strong>{count.toLocaleString()}</strong>
                              </button>
                            ))}
                            {!reportData.typeBreakdown.length && <p className="empty-state">{t.reportNoData}</p>}
                          </div>
                        </article>

                        <article className="panel-card report-analytics-panel">
                          <div className="panel-header"><h2>{t.reportEfficiency}</h2></div>
                          <dl className="report-efficiency-list">
                            <div><dt>{t.reportApprovedDecisions}</dt><dd>{reportData.summary.approvedDecisions.toLocaleString()}</dd></div>
                            <div><dt>{t.statusRejected}</dt><dd>{reportData.summary.rejectedDecisions.toLocaleString()}</dd></div>
                            <div><dt>{t.reportApprovalRate}</dt><dd>{reportData.summary.approvalRate === null ? t.systemUnknown : `${reportData.summary.approvalRate}%`}</dd></div>
                            <div><dt>{t.reportPendingRate}</dt><dd>{reportData.summary.pendingRate === null ? t.systemUnknown : `${reportData.summary.pendingRate}%`}</dd></div>
                            <div><dt>{t.reportDecisionTurnaround}</dt><dd>{formatDecisionTurnaround(reportData.summary.averageDecisionHours)}</dd></div>
                          </dl>
                          <p className="report-metric-note">{t.reportDecisionBasis} {t.reportActiveBasis}</p>
                        </article>

                        <article className="panel-card report-analytics-panel">
                          <div className="panel-header"><h2>{t.reportNeedsAttention}</h2></div>
                          <div className="report-attention-list">
                            <button type="button" onClick={() => setQueueFilterFromReport('Pending')}>
                              <strong>{reportData.summary.pendingReview.toLocaleString()}</strong><span>{t.reportPendingReview}</span>
                            </button>
                            <button type="button" onClick={() => setQueueFilterFromReport('In Review')}>
                              <strong>{reportData.summary.inProcessing.toLocaleString()}</strong><span>{t.reportInProcessing}</span>
                            </button>
                            <button type="button" onClick={() => setQueueFilterFromReport('Needs Information')}>
                              <strong>{reportData.summary.needsInformation.toLocaleString()}</strong><span>{t.reportNeedsInformation}</span>
                            </button>
                            <p>{t.noReleaseOrDeadlineTracking}</p>
                          </div>
                        </article>

                        <article className="panel-card report-analytics-panel report-decisions-panel">
                          <div className="panel-header"><h2>{t.reportRecentDecisions}</h2></div>
                          {reportData.recentDecisions.length > 0 ? (
                            <ul className="report-decision-list">
                              {reportData.recentDecisions.map((decision) => (
                                <li key={`${decision.id}-${decision.date}`}>
                                  <span><strong>{getRequestStatusLabel(decision.status, t)}</strong><small>{decision.type}</small></span>
                                  <span className="report-decision-reference">{t.reportReference}: {decision.id}</span>
                                  <time dateTime={decision.date}>{new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(decision.date))}</time>
                                </li>
                              ))}
                            </ul>
                          ) : <p className="empty-state">{t.reportNoDecisions}</p>}
                        </article>
                      </div>
                      <footer className="report-footer">
                        <span>{t.reportGeneratedAt}: {new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(reportData.generatedAt))}</span>
                        <span>{t.reportDecisionBasis}</span>
                      </footer>
                        </div>
                      </details>
                    </>
                  )}
                </section>
              )}

              {activeTab === 'announcements' && (
                <article className="panel-card">
                  <div className="panel-header">
                    <h2>{t.announcements}</h2>
                    <span className="soft-label">{announcements.length} active</span>
                    <button type="button" className="primary-btn small" onClick={() => setShowAnnouncementForm(true)}>{t.publishAnnouncement}</button>
                  </div>

                  {showAnnouncementForm && (
                    <WorkflowModal title={t.publishAnnouncement} onClose={() => setShowAnnouncementForm(false)} wide className="announcement-modal">
                    <form className="editor-panel workflow-modal-form announcement-composer" onSubmit={handleAnnouncementSubmit}>
                    <div className="editor-grid announcement-composer-fields">
                      <div className="input-block full-width">
                        <label htmlFor="announcement-title">Title</label>
                        <input id="announcement-title" type="text" value={announcementForm.title} onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="e.g. Barangay Day celebration" />
                      </div>
                      <div className="input-block">
                        <label htmlFor="announcement-date">Date</label>
                        <input id="announcement-date" type="text" value={announcementForm.date} onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, date: event.target.value }))} placeholder="June 25 • 8:00 AM" />
                      </div>
                      <div className="input-block">
                        <label htmlFor="announcement-priority">Priority</label>
                        <select id="announcement-priority" value={announcementForm.tag} onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, tag: event.target.value }))}>
                          <option value="green">General</option>
                          <option value="blue">Information</option>
                          <option value="amber">Important</option>
                          <option value="red">Emergency</option>
                        </select>
                      </div>
                      <div className="input-block full-width">
                        <label htmlFor="announcement-message">Message</label>
                        <textarea id="announcement-message" rows="4" value={announcementForm.content} onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, content: event.target.value }))} placeholder="Write the key message for residents and staff." />
                      </div>
                      <div className="input-block full-width announcement-social-field">
                        <label>{t.socialMediaIntegration}</label>
                        <div className="social-account-picker announcement-social-picker" role="group" aria-label={t.socialMediaIntegration}>
                          {connectedSocialAccounts.map((account) => {
                            const isSelected = (announcementForm.socialChannels || []).includes(account.key)
                            return (
                              <label
                                key={account.key}
                                className={`announcement-social-option${isSelected ? ' selected' : ''}${account.connected ? '' : ' unavailable'}`}
                              >
                                <input
                                  className="announcement-social-checkbox"
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={!account.connected}
                                  onChange={() => toggleAnnouncementChannel(account.key)}
                                />
                                <span className="announcement-social-copy">
                                  <span>{account.label}</span>
                                  <small>{account.connected ? t.connected : t.socialNotConfigured}</small>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                        <small className="announcement-social-guidance">{t.socialIntegrationPending}</small>
                        {messengerLink && <small className="announcement-social-guidance"><a href={messengerLink} target="_blank" rel="noreferrer">{t.messengerOptInLink}</a></small>}
                        {socialIntegrationStatusError && <small className="announcement-social-guidance status-error" role="status">{t.socialIntegrationStatusUnavailable}</small>}
                      </div>
                    </div>
                    <div className="editor-actions">
                      <button type="button" className="secondary-btn small" onClick={() => setShowAnnouncementForm(false)}>{t.cancel}</button>
                      <button type="submit" className="primary-btn small">{t.publishAnnouncement}</button>
                    </div>
                    </form>
                    </WorkflowModal>
                  )}

                  <div className="announcement-list">
                    {announcements.map((item) => (
                      <div key={item.id || item.title} className="announcement-item">
                        <div className={'ann-badge ' + item.tag}></div>
                        <div className="ann-content">
                          <strong>{item.title}</strong>
                          <p>{item.content || t.noAdditionalContent}</p>
                          <small>{item.date}</small>
                          <small>{(item.socialChannels || []).length > 0 ? `${t.socialChannelsSelectedLabel}: ${item.socialChannels.join(', ')}` : t.internalNoticeOnly}</small>
                          {item.socialDelivery && Object.entries(item.socialDelivery).map(([channel, result]) => (
                            <small key={channel}>{t.socialDeliveryStatus} · {channel}: {result.status}{result.sent > 0 ? ` (${result.sent})` : ''}{result.failed > 0 ? ` — ${result.failed} failed` : ''}{result.message ? ` — ${result.message}` : ''}</small>
                          ))}
                          {item.relatedAnnouncementId && <small>{t.retractAnnouncementTitle}</small>}
                          {item.retractionAnnouncementId && <small>{t.retractionPublished}</small>}
                        </div>
                        <div className="announcement-actions">
                          <button
                            type="button"
                            className="small-action secondary"
                            disabled={Boolean(item.retractionAnnouncementId)}
                            onClick={() => {
                              setRetractionTarget(item)
                              setRetractionContent('')
                            }}
                          >
                            {t.retractAnnouncement}
                          </button>
                        <button
                          type="button"
                          className="small-action danger"
                          onClick={() => setConfirmation({
                            title: t.delete,
                            message: t.deleteAnnouncementWarning,
                            confirmLabel: t.delete,
                            onConfirm: () => onDeleteAnnouncement?.(item.id || item.title),
                          })}
                        >
                          {t.delete}
                        </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {retractionTarget && (
                    <WorkflowModal title={t.retractAnnouncementTitle} onClose={() => {
                      if (!retractionSubmitting) setRetractionTarget(null)
                    }} wide>
                      <form className="workflow-modal-form" onSubmit={handleRetractionSubmit}>
                        <p>{retractionTarget.title}</p>
                        <div className="input-block full-width">
                          <label htmlFor="announcement-retraction-message">{t.retractionMessageLabel}</label>
                          <textarea
                            id="announcement-retraction-message"
                            rows="5"
                            value={retractionContent}
                            onChange={(event) => setRetractionContent(event.target.value)}
                            required
                          />
                        </div>
                        <p className="request-staff-note">{t.socialIntegrationPending}</p>
                        <div className="editor-actions">
                          <button type="button" className="secondary-btn small" onClick={() => setRetractionTarget(null)} disabled={retractionSubmitting}>{t.cancel}</button>
                          <button type="submit" className="primary-btn small" disabled={retractionSubmitting}>{retractionSubmitting ? t.working : t.retractAnnouncement}</button>
                        </div>
                      </form>
                    </WorkflowModal>
                  )}
                </article>
              )}

              {activeTab === 'staff' && (
                <>
                  <article className="panel-card">
                    <div className="panel-header">
                      <h2>{t.staffDirectory}</h2>
                      <span className="soft-label">{staffMembers.length} {t.staffMembersAvailable}</span>
                    </div>
                    {userRole === 'staff' && (
                      <div className="editor-actions">
                        <p className="field-note">{t.accountCreationPermissionNote}</p>
                        <button type="button" className="primary-btn small" onClick={() => setShowAccountCreation(true)}>{t.createStaffAccount}</button>
                      </div>
                    )}
                    {showAccountCreation && userRole === 'staff' && (
                      <AccountCreationModal
                        allowedRoles={['staff']}
                        language={language}
                        onCreated={onPortalAccountCreated}
                        onClose={() => setShowAccountCreation(false)}
                      />
                    )}

                    <div className="staff-grid">
                      {staffMembers.map((member) => (
                        <div key={member.id} className="staff-card" onClick={() => setSelectedUser(member)} style={{ cursor: 'pointer' }}>
                          <div className="staff-avatar">{(member.firstName || 'S').charAt(0)}</div>
                          <div className="staff-info">
                            <h4>{member.firstName} {member.lastName}</h4>
                            <p className="position">{getStaffPositionLabel(member.position, t)}</p>
                            <p className="availability">
                              <span className={'availability-badge ' + (member.availability === 'Available' ? 'available' : 'unavailable')}>
                                {getStaffAvailabilityLabel(member.availability, t)}
                              </span>
                            </p>
                            <p className="contact">{t.status}: {member.status || 'N/A'}</p>
                            <p className="contact">{member.mobile}</p>
                            <p className="contact">{member.email}</p>
                          </div>
                          {isAdminRole(userRole) && (
                            <button
                              type="button"
                              className="small-action danger"
                              onClick={(event) => {
                                event.stopPropagation()
                                setConfirmation({
                                  title: t.delete,
                                  message: t.deleteStaffConfirm.replace('{name}', `${member.firstName} ${member.lastName}`),
                                  confirmLabel: t.delete,
                                  onConfirm: () => onDeleteStaffMember?.(member.id),
                                })
                              }}
                            >
                              {t.delete}
                            </button>
                          )}
                        </div>
                      ))}
                      {staffMembers.length === 0 && <p className="empty-state">{t.noStaffAccounts}</p>}
                    </div>
                  </article>
                  <OfficialProfileSettings language={language} canManageLogo={isAdminRole(userRole)} />
                </>
              )}
            </div>

            <aside className="side-column">
              {activeTab === 'queue' && (
                <StaffDirectoryOverview
                  staffMembers={staffMembers}
                  language={language}
                  onManage={() => setActiveTab('staff')}
                />
              )}
              <article className="profile-card">
                <div className="profile-head">
                  <div className="profile-avatar">{(currentUser?.firstName || currentUser?.first_name || 'S').charAt(0)}</div>
                  <div>
                    <h3>{t.staffProfile}</h3>
                    <span>{getDisplayName(currentUser)}</span>
                  </div>
                </div>
                <dl className="profile-list">
                  <div><dt>{t.positionLabel}</dt><dd>{getStaffPositionLabel(currentUser?.position || t.staffRole, t)}</dd></div>
                  <div><dt>{t.status}</dt><dd>{currentUser?.status || t.notAvailable}</dd></div>
                </dl>
                <p className="workflow-limit-notice">{t.staffScheduleNotTracked}</p>
              </article>
            </aside>
          </div>
        </section>
      </main>
      {selectedRequest && (
        <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRequest(null) }}>
          <section className="modal-content staff-request-details" role="dialog" aria-modal="true" aria-labelledby="staff-request-details-title">
            <button type="button" className="modal-close" aria-label={t.closeRequestDetails} onClick={() => setSelectedRequest(null)}>×</button>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{t.requestId}</p>
                <h2 id="staff-request-details-title">{selectedRequest.id}</h2>
              </div>
            </div>
            <dl className="profile-list">
              <div><dt>{t.resident}</dt><dd>{selectedRequest.first_name || selectedRequest.firstName || t.resident} {selectedRequest.last_name || selectedRequest.lastName || ''}</dd></div>
              <div><dt>{t.requestType}</dt><dd>{selectedRequest.type}</dd></div>
              <div><dt>{t.submissionDate}</dt><dd>{formatRequestDate(selectedRequest.date || selectedRequest.createdAt || selectedRequest.created_at)}</dd></div>
              <div>
                <dt>{t.status}</dt>
                <dd>
                  <span className={'status-badge ' + (selectedRequest.status || '').toLowerCase().replace(/\s+/g, '-')}>{getRequestStatusLabel(selectedRequest.status, t)}</span>
                  <p className="request-status-guidance">{getRequestStatusMessage(selectedRequest.status, t)}</p>
                </dd>
              </div>
              <div><dt>{t.purpose}</dt><dd>{selectedRequest.purpose || '—'}</dd></div>
              <div><dt>{t.deliveryMethodLabel}</dt><dd>{selectedRequest.deliveryMethod === 'physical' || selectedRequest.delivery_method === 'physical' ? t.physicalCopy : t.onlineCopy}</dd></div>
              {(selectedRequest.deliveryNote || selectedRequest.delivery_note) && <div><dt>{t.deliveryNoteLabel}</dt><dd>{selectedRequest.deliveryNote || selectedRequest.delivery_note}</dd></div>}
              {selectedRequest.notes && <div><dt>{t.notesLabel}</dt><dd>{selectedRequest.notes}</dd></div>}
              {((selectedRequest.followUps || selectedRequest.follow_ups || []).length > 0) && (
                <div>
                  <dt>{t.latestFollowUp}</dt>
                  <dd>{(selectedRequest.followUps || selectedRequest.follow_ups).slice(-1)[0].message}</dd>
                </div>
              )}
            </dl>
            <details className="request-history-details" open>
              <summary>{t.requestStatusHistory}</summary>
              <RequestHistory history={selectedRequest.statusHistory || selectedRequest.status_history} t={t} />
            </details>
            {!['Approved', 'Rejected'].includes(selectedRequest.status) && (
              <form className="request-status-action-form workflow-status-form" onSubmit={(event) => handleRequestStatusSubmit(event, selectedRequest)}>
                <label htmlFor="staff-request-next-status">{t.newStatusFor.replace('{service}', selectedRequest.type)}</label>
                <select
                  id="staff-request-next-status"
                  value={requestStatusDrafts[selectedRequest.id] || ''}
                  onChange={(event) => setRequestStatusDrafts((current) => ({ ...current, [selectedRequest.id]: event.target.value }))}
                  required
                >
                  <option value="">{t.selectStatus}</option>
                  <option value="In Review">{t.statusUnderReview}</option>
                  <option value="Needs Information">{t.statusNeedsInformation}</option>
                  <option value="Approved">{t.approved}</option>
                  <option value="Rejected">{t.statusRejected}</option>
                </select>
                <textarea
                  aria-label={t.staffNoteFor.replace('{service}', selectedRequest.type)}
                  value={requestStatusNotes[selectedRequest.id] || ''}
                  onChange={(event) => setRequestStatusNotes((current) => ({ ...current, [selectedRequest.id]: event.target.value }))}
                  placeholder={requestStatusDrafts[selectedRequest.id] === 'Rejected' ? t.rejectionReasonPrompt : t.statusNoteLabel}
                  maxLength={1000}
                  required={['Needs Information', 'Rejected'].includes(requestStatusDrafts[selectedRequest.id])}
                />
                <button type="submit" className="primary-btn small">{t.requestStatusAction}</button>
              </form>
            )}
          </section>
        </div>
      )}
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} allowEdit={isAdminRole(userRole)} onUserUpdated={(updated) => {
        setSelectedUser((prev) => ({ ...(prev || {}), ...updated }))
        onStaffMemberUpdated?.(updated)
      }} />}
      {confirmation && (
        <ConfirmationModal
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          cancelLabel={t.cancel}
          onClose={() => setConfirmation(null)}
          onConfirm={confirmation.onConfirm}
        />
      )}
    </div>
  )
}

function SuperAdminMonitoringPanel({ language }) {
  const t = translations[language] || translations.en
  const [monitoring, setMonitoring] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/super-admin/monitoring`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || t.superAdminMonitoringUnavailable)
        if (active) setMonitoring(data)
      })
      .catch((loadError) => {
        console.error('load Super Admin monitoring failed', loadError)
        if (active) setError(loadError.message || t.superAdminMonitoringUnavailable)
      })

    return () => { active = false }
  }, [t.superAdminMonitoringUnavailable])

  return (
    <article className="panel-card compact-panel" aria-labelledby="super-admin-monitoring-title">
      <div className="panel-header">
        <h2 id="super-admin-monitoring-title">{t.superAdminMonitoring}</h2>
        <span className="soft-label">{t.superAdminMonitoringHint}</span>
      </div>
      {error && <p role="alert">{error}</p>}
      {!monitoring && !error && <p role="status">{t.loading}</p>}
      {monitoring && (
        <>
          <div className="overview-grid">
            <div className="overview-item"><h4>{t.residents}</h4><p className="overview-value">{monitoring.summary.totalResidents}</p></div>
            <div className="overview-item"><h4>{t.staffRole}</h4><p className="overview-value">{monitoring.summary.totalStaff}</p></div>
            <div className="overview-item"><h4>{t.administrator}</h4><p className="overview-value">{monitoring.summary.totalAdmins}</p></div>
            <div className="overview-item"><h4>{t.superAdminAccounts}</h4><p className="overview-value">{monitoring.summary.totalSuperAdmins}</p></div>
            <div className="overview-item"><h4>{t.serviceRequests}</h4><p className="overview-value">{monitoring.summary.totalRequests}</p></div>
            <div className="overview-item"><h4>{t.pending}</h4><p className="overview-value">{monitoring.summary.pendingRequests}</p></div>
          </div>
          <h3>{t.recentAuditActivity}</h3>
          {monitoring.recentActivity.length
            ? <ul>{monitoring.recentActivity.map((entry, index) => <li key={`${entry.createdAt || 'activity'}-${entry.action}-${index}`}>{entry.action} · {entry.actorRole}</li>)}</ul>
            : <p>{t.noRecentAuditActivity}</p>}
        </>
      )}
    </article>
  )
}

function AdminPage({ users, residents = [], requests, reports = [], currentUser, onLogout, onPortalAccountCreated, language, setLanguage }) {
  const t = translations[language] || translations.en
  const zoneNumbers = [1, 2, 3, 4, 5, 6, 7]
  const [managedUsers, setManagedUsers] = useState(users)
  const [activeTab, setActiveTab] = useState('overview')
  const adminTabRefs = useRef({})
  const adminTabs = [
    { id: 'overview', label: t.overview, icon: '🧭' },
    { id: 'residents', label: t.residents, icon: '👥' },
    { id: 'access', label: t.access, icon: '🔐' },
    { id: 'emergencies', label: t.emergencies, icon: '🚨' },
  ]
  const [showAccountCreation, setShowAccountCreation] = useState(false)
  const [healthRefreshKey, setHealthRefreshKey] = useState(0)
  const [apiHealth, setApiHealth] = useState({ status: 'checking', storage: null, checkedAt: null })
  const [searchQuery, setSearchQuery] = useState('')
  const [accessSearch, setAccessSearch] = useState('')
  const [staffPasswordResetTarget, setStaffPasswordResetTarget] = useState(null)
  const [staffPasswordResetForm, setStaffPasswordResetForm] = useState({ password: '', confirmPassword: '' })
  const [resettingStaffPassword, setResettingStaffPassword] = useState(false)
  const [issuingTemporaryAccessId, setIssuingTemporaryAccessId] = useState('')
  const [staffPresence, setStaffPresence] = useState([])
  const [staffPresenceError, setStaffPresenceError] = useState('')
  const [selectedZone, setSelectedZone] = useState('all')
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedReport, setSelectedReport] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [archives, setArchives] = useState([])
  const [archiving, setArchiving] = useState(false)
  const [archiveResult, setArchiveResult] = useState(null)
  const [archiveError, setArchiveError] = useState('')
  const [retentionDays, setRetentionDays] = useState('30')
  const [confirmation, setConfirmation] = useState(null)
  const [expandedZone, setExpandedZone] = useState(null)
  const [residentZoneSort, setResidentZoneSort] = useState(() => {
    return Object.fromEntries(zoneNumbers.map((zone) => [zone, 'alphabetical']))
  })
  const [accessZoneSort, setAccessZoneSort] = useState(() => {
    return Object.fromEntries(zoneNumbers.map((zone) => [zone, 'alphabetical']))
  })

  const handleAdminTabKeyDown = (event) => {
    const currentIndex = adminTabs.findIndex((tab) => tab.id === activeTab)
    let nextIndex

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % adminTabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + adminTabs.length) % adminTabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = adminTabs.length - 1
    else return

    event.preventDefault()
    const nextTab = adminTabs[nextIndex]
    setActiveTab(nextTab.id)
    adminTabRefs.current[nextTab.id]?.focus()
  }

  useEffect(() => {
    setManagedUsers(users)
  }, [users])

  useEffect(() => {
    let active = true
    const checkApiHealth = async () => {
      if (active) setApiHealth((current) => ({ ...current, status: 'checking' }))
      try {
        const response = await fetch(`${API_BASE}/health`)
        if (response.status === 429) {
          if (active) setApiHealth({ status: 'limited', storage: null, checkedAt: new Date() })
          return
        }
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.ok !== true) {
          throw new Error(data.message || 'API health check failed.')
        }
        if (active) setApiHealth({ status: 'ok', storage: data.storage || null, checkedAt: new Date() })
      } catch (error) {
        console.error('admin API health check failed', error)
        if (active) setApiHealth({ status: 'error', storage: null, checkedAt: new Date() })
      }
    }

    checkApiHealth()
    const interval = window.setInterval(checkApiHealth, 60_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [healthRefreshKey])
  
  const residentCount = managedUsers.filter((user) => user.role === 'resident').length
  const staffCount = managedUsers.filter((user) => user.role === 'staff').length
  const admins = managedUsers.filter((user) => user.role === 'admin').length
  const superAdmins = managedUsers.filter((user) => user.role === 'super_admin').length
  const requestStatusCounts = getRequestStatusCounts(requests)
  const activeRequestCount = getActiveRequestCount(requestStatusCounts)
  const pendingVerificationUsers = managedUsers.filter((user) => user.role === 'resident' && user.status === 'Pending Verification')
  const approvedUsers = managedUsers.filter((user) => user.role === 'resident' && user.status === 'Active Resident').length
  const unapprovedLoginCutoff = Date.now() - 24 * 60 * 60 * 1000
  const unapprovedLoginAttempts = auditLogs.filter((entry) => (
    entry.action === 'auth.login.rejected_unapproved_resident'
    && new Date(entry.createdAt || entry.created_at || 0).getTime() >= unapprovedLoginCutoff
  ))
  const requestCountsByType = requests.reduce((counts, request) => {
    counts[request.type] = (counts[request.type] || 0) + 1
    return counts
  }, {})
  const notifications = [
    pendingVerificationUsers.length > 0 && `${pendingVerificationUsers.length} resident account${pendingVerificationUsers.length === 1 ? '' : 's'} awaiting verification`,
    activeRequestCount > 0 && t.activeServiceRequestsAlert.replace('{count}', String(activeRequestCount)),
    unapprovedLoginAttempts.length > 0 && t.adminUnapprovedLoginAlert.replace('{count}', String(unapprovedLoginAttempts.length)),
  ].filter(Boolean)
  const derivedActivityEntries = [
    ...pendingVerificationUsers.map((user) => ({
      id: `user-${user.id}`,
      label: `${user.firstName || user.first_name} ${user.lastName || user.last_name} registered`,
      detail: 'Pending resident verification',
      date: user.createdAt || user.created_at,
    })),
    ...approvals.slice(0, 8).map((approval) => ({
      id: approval.id,
      label: `Request ${approval.requestId} approved`,
      detail: `By ${approval.approvedByRole || 'staff'}`,
      date: approval.dateApproved,
    })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 8)
  const activityEntries = auditLogs.length > 0 ? auditLogs.slice(0, 8).map((entry) => {
    const isUnapprovedLogin = entry.action === 'auth.login.rejected_unapproved_resident'
    const residentName = entry.metadata?.residentName
    return {
      id: entry.id,
      label: isUnapprovedLogin ? t.activityUnapprovedLogin : entry.action,
      detail: isUnapprovedLogin && residentName
        ? `${residentName} • ${entry.metadata.status}`
        : `${entry.actorRole || 'system'} • ${entry.targetType || 'record'} ${entry.targetId || ''}`,
      date: entry.createdAt || entry.created_at,
    }
  }) : derivedActivityEntries

  const updateManagedUser = async (userId, updates) => {
    try {
      const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to update user.')
      setManagedUsers((current) => current.map((user) => user.id === userId ? { ...user, ...data.user } : user))
      setSelectedUser((current) => current?.id === userId ? data.user : current)
    } catch (error) {
      alert(error.message || 'Unable to update user.')
    }
  }

  const handleResetStaffPassword = async (event) => {
    event.preventDefault()
    if (!isValidPassword(staffPasswordResetForm.password)) {
      alert(t.newPasswordRequirementsError.replace('{requirements}', t.passwordRequirements))
      return
    }
    if (staffPasswordResetForm.password !== staffPasswordResetForm.confirmPassword) {
      alert(t.passwordsDoNotMatch)
      return
    }
    if (!staffPasswordResetTarget) return

    setResettingStaffPassword(true)
    try {
      const response = await fetch(`${API_BASE}/admin/staff/${staffPasswordResetTarget.id}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: staffPasswordResetForm.password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.staffPasswordResetFailed)
      setStaffPasswordResetTarget(null)
      setStaffPasswordResetForm({ password: '', confirmPassword: '' })
      alert(t.staffPasswordResetNotice)
    } catch (error) {
      alert(error.message || t.staffPasswordResetFailed)
    } finally {
      setResettingStaffPassword(false)
    }
  }

  const handleIssueStaffTemporaryAccess = async (user) => {
    if (!window.confirm(t.staffTemporaryAccessConfirm.replace('{name}', getDisplayName(user)))) return
    setIssuingTemporaryAccessId(user.id)
    try {
      const response = await fetch(`${API_BASE}/admin/staff/${user.id}/temporary-access`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.staffTemporaryAccessFailed)
      alert(`${t.staffTemporaryAccessQueued} ${new Date(data.expiresAt).toLocaleString()}`)
    } catch (error) {
      alert(error.message || t.staffTemporaryAccessFailed)
    } finally {
      setIssuingTemporaryAccessId('')
    }
  }

  const handleVerification = (user, status) => {
    const approved = status === 'Active Resident'
    setConfirmation({
      title: approved ? t.approve : t.reject,
      message: `${approved ? 'Approve' : 'Reject'} ${getDisplayName(user)}'s resident account?`,
      confirmLabel: approved ? t.approve : t.reject,
      onConfirm: () => updateManagedUser(user.id, { status }),
    })
  }

  const handleArchiveResident = (resident) => {
    setConfirmation({
      title: 'Archive resident account?',
      message: `Archive ${getDisplayName(resident)}? This disables sign-in but preserves the account and its request history. An administrator can restore access later by changing the account status.`,
      confirmLabel: 'Archive resident',
      onConfirm: async () => {
        let response
        try {
          response = await fetch(`${API_BASE}/admin/residents/${resident.id}/archive`, { method: 'POST' })
        } catch {
          throw new Error('Unable to reach the server. Check your connection and try again.')
        }

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          if (data.archived && data.user) {
            setManagedUsers((current) => current.map((user) => user.id === resident.id ? { ...user, ...data.user } : user))
            setSelectedUser((current) => current?.id === resident.id ? data.user : current)
          }
          throw new Error(data.message || 'Unable to archive resident account.')
        }

        if (!data.user) throw new Error('The server did not return the archived resident account.')
        setManagedUsers((current) => current.map((user) => user.id === resident.id ? { ...user, ...data.user } : user))
        setSelectedUser(null)
      },
    })
  }

  const getSortName = (person = {}) => {
    const firstName = person.firstName ?? person.first_name ?? ''
    const lastName = person.lastName ?? person.last_name ?? ''
    return `${lastName} ${firstName}`.trim().toLowerCase()
  }

  const normalizedResidentSearch = searchQuery.trim().toLowerCase()
  const filteredResidents = residents.filter((resident) => {
    const searchableText = [
      resident.firstName ?? resident.first_name,
      resident.lastName ?? resident.last_name,
      resident.email,
      resident.householdId ?? resident.household_id,
    ].filter(Boolean).join(' ').toLowerCase()
    const matchesSearch = normalizedResidentSearch === '' || searchableText.includes(normalizedResidentSearch)
    
    const matchesZone = selectedZone === 'all' || Number(resident.zone) === Number(selectedZone)
    
    return matchesSearch && matchesZone
  }).sort((a, b) => getSortName(a).localeCompare(getSortName(b)))

  const residentsByZone = {}
  for (let i = 1; i <= 7; i++) {
    residentsByZone[i] = residents.filter((r) => r.zone === i).length
  }

  const groupedResidentsByZone = zoneNumbers.map((zone) => ({
    zone,
    residents: filteredResidents.filter((resident) => resident.zone === zone),
  })).filter((group) => group.residents.length > 0 || (selectedZone === 'all' && !normalizedResidentSearch))

  const sortByMode = (items, mode) => {
    const sorted = [...items]

    if (mode === 'newest') {
      return sorted.sort((a, b) => {
        const left = new Date(a.createdAt || a.created_at || 0).getTime()
        const right = new Date(b.createdAt || b.created_at || 0).getTime()
        return right - left
      })
    }

    return sorted.sort((a, b) => {
      const left = getSortName(a)
      const right = getSortName(b)
      return left.localeCompare(right)
    })
  }

  const getResidentZoneUsers = (group) => {
    const mode = residentZoneSort[group.zone] || 'alphabetical'
    return sortByMode(group.residents, mode)
  }

  const getAccessZoneUsers = (group) => {
    const zoneUsers = sortedUsers.filter((user) => {
      const fullName = `${user.first_name || user.firstName || ''} ${user.last_name || user.lastName || ''}`.trim()
      const matchesSearch = accessSearch === '' || fullName.toLowerCase().includes(accessSearch.toLowerCase())
      const zoneMatch = Number(user.zone ?? user.zoneNumber ?? 0) === group.zone
      return matchesSearch && zoneMatch
    })

    return sortByMode(zoneUsers, accessZoneSort[group.zone] || 'alphabetical')
  }

  const sortedUsers = [...managedUsers].sort((a, b) => {
    const left = `${a.first_name || a.firstName || ''} ${a.last_name || a.lastName || ''}`.trim().toLowerCase()
    const right = `${b.first_name || b.firstName || ''} ${b.last_name || b.lastName || ''}`.trim().toLowerCase()
    return left.localeCompare(right)
  })

  const normalizedAccessSearch = accessSearch.trim().toLowerCase()
  const accessSearchResults = normalizedAccessSearch
    ? sortedUsers.filter((user) => {
      const searchableText = [
        getDisplayName(user),
        user.name,
        user.email,
        user.mobile,
        user.householdId || user.household_id,
        user.role,
        user.zone ?? user.zoneNumber,
      ].filter(Boolean).join(' ').toLowerCase()
      return searchableText.includes(normalizedAccessSearch)
    })
    : []

  const handleOpenAccessUser = async (user) => {
    try {
      const response = await fetch(`${API_BASE}/admin/access/user/${user.id}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.userDetailsLoadFailed)
      setSelectedUser(data.user)
    } catch (error) {
      console.error('fetch user detail error', error)
      alert(error.message || t.userDetailsLoadFailed)
    }
  }

  const accessUsersByZone = zoneNumbers.map((zone) => {
    const matchingUsers = sortedUsers.filter((user) => {
      const fullName = `${user.first_name || user.firstName || ''} ${user.last_name || user.lastName || ''}`.trim()
      const matchesSearch = accessSearch === '' || fullName.toLowerCase().includes(accessSearch.toLowerCase())
      const zoneMatch = Number(user.zone ?? user.zoneNumber ?? 0) === zone
      return matchesSearch && zoneMatch
    })

    return { zone, users: matchingUsers }
  }).filter((group) => group.users.length > 0)
  
  useEffect(() => {
    // load approvals and archives when admin opens Access tab
    const fetchApprovals = async () => {
      try {
        const resp = await fetch(`${API_BASE}/admin/approvals`)
        if (!resp.ok) throw new Error(t.archiveRefreshFailed)
        const data = await resp.json()
        setApprovals(Array.isArray(data.approvals) ? data.approvals : [])
      } catch (err) {
        console.error('fetch approvals error', err)
        setArchiveError(t.archiveRefreshFailed)
      }
    }

    const fetchArchives = async () => {
      try {
        const r = await fetch(`${API_BASE}/admin/archives`)
        if (!r.ok) throw new Error(t.archiveRefreshFailed)
        const d = await r.json()
        setArchives(Array.isArray(d.archives) ? d.archives : [])
      } catch (err) {
        console.error('fetch archives error', err)
        setArchiveError(t.archiveRefreshFailed)
      }
    }

    if (activeTab === 'access') {
      fetchApprovals()
      fetchArchives()
    }

    let auditRefreshTimer
    let staffPresenceRefreshTimer
    if (activeTab === 'overview' || activeTab === 'access') {
      const refreshAuditLogs = () => {
        fetch(`${API_BASE}/admin/audit-logs?limit=500`)
          .then((response) => {
            if (!response.ok) throw new Error('Unable to refresh administrator activity.')
            return response.json()
          })
          .then((data) => {
            if (!Array.isArray(data.logs)) throw new Error('Administrator activity response is invalid.')
            setAuditLogs(data.logs)
          })
          .catch((error) => console.error('fetch audit logs error', error))
      }
      refreshAuditLogs()
      if (activeTab === 'overview') auditRefreshTimer = window.setInterval(refreshAuditLogs, 30000)
    }

    if (activeTab === 'access') {
      const refreshStaffPresence = async () => {
        try {
          const response = await fetch(`${API_BASE}/admin/staff/presence`)
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.message || t.staffPresenceLoadFailed)
          if (!Array.isArray(data.staff)) throw new Error(t.staffPresenceLoadFailed)
          setStaffPresence(data.staff)
          setStaffPresenceError('')
        } catch (error) {
          console.error('fetch staff presence error', error)
          setStaffPresenceError(error.message || t.staffPresenceLoadFailed)
        }
      }
      refreshStaffPresence()
      staffPresenceRefreshTimer = window.setInterval(refreshStaffPresence, 15000)
    }

    return () => {
      if (auditRefreshTimer) window.clearInterval(auditRefreshTimer)
      if (staffPresenceRefreshTimer) window.clearInterval(staffPresenceRefreshTimer)
    }
  }, [activeTab, t.staffPresenceLoadFailed])

  const handleArchiveNow = async () => {
    const daysToArchive = retentionDays === '' ? 30 : Number(retentionDays)
    if (!Number.isInteger(daysToArchive) || daysToArchive < 0) {
      throw new Error(t.archiveInvalidRetention)
    }

    setArchiving(true)
    setArchiveResult(null)
    setArchiveError('')
    try {
      const resp = await fetch(`${API_BASE}/admin/archive-approvals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: daysToArchive }) })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.message || t.archiveFailed)
      setArchiveResult(data.archive || null)

      try {
        const [approvalsResponse, archivesResponse] = await Promise.all([
          fetch(`${API_BASE}/admin/approvals`),
          fetch(`${API_BASE}/admin/archives`),
        ])
        if (!approvalsResponse.ok || !archivesResponse.ok) throw new Error(t.archiveRefreshFailed)
        const [approvalsData, archivesData] = await Promise.all([
          approvalsResponse.json(),
          archivesResponse.json(),
        ])
        setApprovals(approvalsData.approvals || [])
        setArchives(archivesData.archives || [])
      } catch (error) {
        console.error('refresh after approval archive failed', error)
        setArchiveError(t.archiveRefreshFailed)
      }
    } finally {
      setArchiving(false)
    }
  }

  const handleDeleteArchive = async (fileName) => {
    if (!fileName) return

    try {
      const resp = await fetch(`${API_BASE}/admin/archive-file?name=${encodeURIComponent(fileName)}`, { method: 'DELETE' })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.message || 'Delete failed')
      }
      setArchives((prev) => prev.filter((item) => item.name !== fileName))
      alert('Archive deleted.')
    } catch (err) {
      console.error('delete archive error', err)
      alert(err.message || 'Delete failed')
    }
  }

  return (
    <div className="dashboard-shell admin-dashboard">
      <header className="dashboard-topbar admin-topbar">
        <div className="brand-wrap">
          <SystemLogo className="seal-logo tiny" alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>{currentUser?.role === 'super_admin' ? t.superAdminPortal : t.adminPortal}</small>
          </div>
        </div>

        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} className="admin-language-control" />
          <Link to="/settings" className="secondary-btn small admin-settings-link">{t.settings}</Link>
          <div className="admin-identity" aria-label={`${t.signedInAs} ${getDisplayName(currentUser)}`}>
            <small>{t.signedInAs}</small>
            <strong>{getDisplayName(currentUser)}</strong>
            <span>{currentUser?.email || currentUser?.mobile || t.administrator}</span>
          </div>
          <span className="role-chip">{currentUser?.role === 'super_admin' ? t.superAdminConsole : t.adminConsole}</span>
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="dashboard-main">
        <aside className="sidebar">
          <nav className="sidebar-nav admin-sidebar-nav" aria-label={t.adminNavigationLabel} role="tablist" aria-orientation="horizontal">
            {adminTabs.map((tab) => (
              <button
                key={tab.id}
                ref={(element) => { adminTabRefs.current[tab.id] = element }}
                id={`admin-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-controls="admin-tabpanel"
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={handleAdminTabKeyDown}
              >
                <span className="nav-icon" aria-hidden="true">{tab.icon}</span><span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section
          id="admin-tabpanel"
          className="content-panel"
          role="tabpanel"
          aria-labelledby={`admin-tab-${activeTab}`}
          tabIndex="-1"
        >
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{t.governance}</p>
              <h1 id="admin-panel-title">{activeTab === 'overview' ? t.adminConsoleTitle : activeTab === 'residents' ? t.residentsByZone : activeTab === 'access' ? t.userAccessManagement : t.emergencyReportsTitle}</h1>
            </div>
            <span className="counter-pill">{activeRequestCount} {t.activeRequests}</span>
          </div>

          <div className="stats-grid" role="group" aria-label={t.adminSummaryLabel}>
            <article className="stat-card accent">
              <div className="stat-header">
                <span className="label">{t.residents}</span>
              </div>
              <div className="stat-number">{residentCount}</div>
              <p>{t.activeHouseholds}</p>
            </article>

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">{t.staffRole}</span>
              </div>
              <div className="stat-number">{staffCount}</div>
              <p>{t.assignedPersonnel}</p>
            </article>

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">{t.administrator}</span>
              </div>
              <div className="stat-number">{admins}</div>
              <p>{t.systemOperators}</p>
            </article>

            {currentUser?.role === 'super_admin' && (
              <article className="stat-card">
                <div className="stat-header"><span className="label">{t.superAdminAccounts}</span></div>
                <div className="stat-number">{superAdmins}</div>
                <p>{t.superAdminMonitoring}</p>
              </article>
            )}

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">{t.activeRequests}</span>
              </div>
              <div className="stat-number">{activeRequestCount}</div>
              <p>{t.serviceRequests}</p>
            </article>
          </div>

          <div className="dashboard-body">
            <div className="main-column">
              {activeTab === 'overview' && currentUser?.role === 'super_admin' && <SuperAdminMonitoringPanel language={language} />}
              {activeTab === 'overview' && <OfficialProfileSettings language={language} canManageLogo={isAdminRole(currentUser?.role)} />}
              {activeTab === 'overview' && (
                <article className="panel-card compact-panel">
                  <div className="panel-header">
                    <h2>{t.systemOverview}</h2>
                    <span className="soft-label">{t.liveStatistics}</span>
                  </div>

                  <div className="overview-grid">
                    <div className="overview-item">
                      <h4>{t.totalActiveUsers}</h4>
                      <p className="overview-value">{managedUsers.length}</p>
                      <small>{t.residentsStaffAdmins}</small>
                    </div>
                    <div className="overview-item">
                      <h4>{t.serviceRequests}</h4>
                      <p className="overview-value">{requests.length}</p>
                      <small>{activeRequestCount} {t.activeRequests}</small>
                    </div>
                    <div className="overview-item">
                      <h4>{t.zonesCovered}</h4>
                      <p className="overview-value">7</p>
                      <small>{t.distributedPopulation}</small>
                    </div>
                    <div className="overview-item">
                      <h4>{t.emergencyReports}</h4>
                      <p className="overview-value">{reports.length}</p>
                      <small>{t.totalIncidentsTracked}</small>
                    </div>
                  </div>

                  <div className="info-box">
                    <h3>{t.residentsByZone}</h3>
                    <div className="zone-stats">
                      {[1, 2, 3, 4, 5, 6, 7].map((zone) => (
                        <div key={zone} className="zone-stat">
                          <span>Zone {zone}: </span>
                          <strong>{residentsByZone[zone]}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              )}

              {activeTab === 'overview' && (
                <>
                  <article className="panel-card compact-panel">
                    <div className="panel-header">
                      <h2>{t.pendingApprovals}</h2>
                      <span className="soft-label">{pendingVerificationUsers.length} {t.waiting}</span>
                    </div>
                    {pendingVerificationUsers.length > 0 ? (
                      <div className="admin-approval-list">
                        {pendingVerificationUsers.map((user) => (
                          <div key={user.id} className="admin-approval-row">
                            <div>
                              <strong>{user.firstName || user.first_name} {user.lastName || user.last_name}</strong>
                              <small>{user.mobile} • {t.registered} {formatDateValue(user.createdAt || user.created_at)}</small>
                              <small>{user.address || t.noAddressProvided} • Zone {user.zone || user.zoneNumber || 'N/A'}</small>
                            </div>
                            <div className="action-row">
                              <button type="button" className="small-action success" onClick={() => handleVerification(user, 'Active Resident')}>{t.approve}</button>
                              <button type="button" className="small-action danger" onClick={() => handleVerification(user, 'Rejected')}>{t.reject}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="empty-state">{t.noAccountsWaiting}</div>}
                  </article>

                  <article className="panel-card compact-panel">
                    <div className="panel-header">
                      <h2>{t.requestMonitoring}</h2>
                      <span className="soft-label">{activeRequestCount} {t.activeRequests}</span>
                    </div>
                    <div className="overview-grid admin-metric-grid request-workflow-metrics">
                      {REQUEST_WORKFLOW_STAGES.map((stage) => (
                        <div className="overview-item" key={stage.status}>
                          <h4>{t[stage.labelKey]}</h4>
                          <p className="overview-value">{requestStatusCounts[stage.status]}</p>
                          <small>{t[stage.messageKey]}</small>
                        </div>
                      ))}
                      <div className="overview-item">
                        <h4>{t.approvedResidents || 'Approved residents'}</h4>
                        <p className="overview-value">{approvedUsers}</p>
                        <small>{t.verifiedAccounts}</small>
                      </div>
                    </div>
                    <div className="service-count-list">
                      {Object.entries(requestCountsByType).map(([type, count]) => <div key={type}><span>{type}</span><strong>{count}</strong></div>)}
                      {Object.keys(requestCountsByType).length === 0 && <div className="empty-state">{t.noServiceRequestsRecorded}</div>}
                    </div>
                  </article>

                  <article className="panel-card compact-panel">
                    <div className="panel-header">
                      <h2>{t.notificationsActivity}</h2>
                      <span className="soft-label">{t.adminAlerts}</span>
                    </div>
                    <div className="notification-list">
                      {notifications.map((notification) => <div key={notification} className="notification-item">{notification}</div>)}
                      {notifications.length === 0 && <div className="empty-state">{t.noNewAdminNotifications}</div>}
                    </div>
                    <div className="activity-list">
                      {activityEntries.map((entry) => <div key={entry.id} className="activity-item"><div><strong>{entry.label}</strong><small>{entry.detail}</small></div><time>{formatDateValue(entry.date)}</time></div>)}
                      {activityEntries.length === 0 && <div className="empty-state">{t.noRecentActivity}</div>}
                    </div>
                  </article>
                </>
              )}

              {activeTab === 'residents' && (
                <article className="panel-card compact-panel">
                  <div className="panel-header">
                    <h2>{t.residentManagement}</h2>
                    <span className="soft-label">{filteredResidents.length} {t.residentsFound}</span>
                  </div>

                  <div className="search-and-filter">
                    <input
                      type="search"
                      placeholder={`🔎 ${t.searchByName}`}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="search-input"
                      aria-label={t.searchByName}
                    />
                    <select 
                      aria-label={t.zoneLabel}
                      value={selectedZone}
                      onChange={(e) => setSelectedZone(e.target.value)}
                      className="zone-filter"
                    >
                      <option value="all">{t.allZones}</option>
                      <option value="1">Zone 1</option>
                      <option value="2">Zone 2</option>
                      <option value="3">Zone 3</option>
                      <option value="4">Zone 4</option>
                      <option value="5">Zone 5</option>
                      <option value="6">Zone 6</option>
                      <option value="7">Zone 7</option>
                    </select>
                    {normalizedResidentSearch && (
                      <p className="resident-search-feedback" aria-live="polite">
                        {t.residentSearchMatches} “{searchQuery.trim()}”
                      </p>
                    )}
                  </div>

                  {filteredResidents.length === 0 ? (
                    <div className="empty-state">{t.noResidentSearchResults}</div>
                  ) : selectedZone === 'all' ? (
                    <div className="zone-group-stack">
                      {groupedResidentsByZone.map((group) => {
                        const isExpanded = expandedZone === group.zone
                        const zoneResidents = getResidentZoneUsers(group)

                        return (
                          <div key={group.zone} className="zone-group-card">
                            <button
                              type="button"
                              className="zone-toggle"
                              onClick={() => setExpandedZone((current) => current === group.zone ? null : group.zone)}
                            >
                              <div className="zone-toggle-left">
                                <span className="zone-toggle-number">Zone {group.zone}</span>
                                <span className="zone-toggle-meta">{group.residents.length} residents</span>
                              </div>
                              <span className={`zone-toggle-chevron ${isExpanded ? 'open' : ''}`}>▾</span>
                            </button>

                            {isExpanded && (
                              <div className="zone-group-body">
                                <div className="zone-sort-row">
                                  <label className="zone-sort-label" htmlFor={`resident-zone-sort-${group.zone}`}>{t.sortBy}</label>
                                  <select
                                    id={`resident-zone-sort-${group.zone}`}
                                    className="zone-sort-select"
                                    value={residentZoneSort[group.zone] || 'alphabetical'}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => {
                                      event.stopPropagation()
                                      setResidentZoneSort((prev) => ({ ...prev, [group.zone]: event.target.value }))
                                    }}
                                  >
                                    <option value="alphabetical">Alphabetical</option>
                                    <option value="newest">Recently created</option>
                                  </select>
                                </div>

                                <div className="request-table-wrap">
                                  <table className="request-table">
                                    <thead>
                                      <tr>
                                        <th>Resident</th>
                                        <th>Household ID</th>
                                        <th>Zone</th>
                                        <th>Family Members</th>
                                        <th>Email</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {zoneResidents.map((resident) => (
                                        <tr key={resident.id}>
                                          <td><button type="button" className="link-button" onClick={() => setSelectedUser(managedUsers.find((user) => user.id === resident.id) || resident)}>{getDisplayName(resident)}</button></td>
                                          <td>{resident.householdId || 'N/A'}</td>
                                          <td><span className="zone-badge">Zone {resident.zone}</span></td>
                                          <td>{resident.familyMembers}</td>
                                          <td>{resident.email}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="request-table-wrap">
                      <table className="request-table">
                        <thead>
                          <tr>
                            <th>Resident</th>
                            <th>Household ID</th>
                            <th>Zone</th>
                            <th>Family Members</th>
                            <th>Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredResidents.map((resident) => (
                            <tr key={resident.id}>
                              <td><button type="button" className="link-button" onClick={() => setSelectedUser(managedUsers.find((user) => user.id === resident.id) || resident)}>{getDisplayName(resident)}</button></td>
                              <td>{resident.householdId || 'N/A'}</td>
                              <td><span className="zone-badge">Zone {resident.zone}</span></td>
                              <td>{resident.familyMembers}</td>
                              <td>{resident.email}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                </article>
              )}

              {activeTab === 'access' && (
                <article className="panel-card">
                  <div className="panel-header">
                    <h2>User Access Management</h2>
                    <div className="editor-actions">
                      <span className="soft-label">{managedUsers.length} total users</span>
                      {currentUser?.role === 'admin' && (
                        <button type="button" className="primary-btn small" onClick={() => setShowAccountCreation(true)}>{t.accountCreationTitle}</button>
                      )}
                    </div>
                  </div>
                  {currentUser?.role === 'admin' && <p className="field-note">{t.accountCreationPermissionNote}</p>}
                  {currentUser?.role === 'super_admin' && <p className="field-note">{t.superAdminInvitationOperatorOnly}</p>}
                  {showAccountCreation && currentUser?.role === 'admin' && (
                    <AccountCreationModal
                      allowedRoles={['staff', 'admin']}
                      language={language}
                      onCreated={(createdUser) => {
                        onPortalAccountCreated?.(createdUser)
                        setManagedUsers((current) => [createdUser, ...current])
                      }}
                      onClose={() => setShowAccountCreation(false)}
                    />
                  )}

                  {staffPasswordResetTarget && (
                    <WorkflowModal
                      title={t.resetStaffPassword}
                      onClose={() => {
                        if (resettingStaffPassword) return
                        setStaffPasswordResetTarget(null)
                        setStaffPasswordResetForm({ password: '', confirmPassword: '' })
                      }}
                      wide
                      disableClose={resettingStaffPassword}
                    >
                      <form className="editor-panel workflow-modal-form" onSubmit={handleResetStaffPassword}>
                        <p>{t.staffPasswordResetIntro.replace('{name}', getDisplayName(staffPasswordResetTarget))}</p>
                        <div className="editor-grid">
                          <PasswordField
                            id="admin-staff-reset-password"
                            label={t.newPassword}
                            language={language}
                            value={staffPasswordResetForm.password}
                            onChange={(event) => setStaffPasswordResetForm((current) => ({ ...current, password: event.target.value }))}
                            helpText={`${t.passwordRequirements}.`}
                          />
                          <PasswordField
                            id="admin-staff-reset-password-confirm"
                            label={t.confirmNewPassword}
                            language={language}
                            value={staffPasswordResetForm.confirmPassword}
                            onChange={(event) => setStaffPasswordResetForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                            helpText={null}
                          />
                        </div>
                        <div className="editor-actions">
                          <button
                            type="button"
                            className="secondary-btn small"
                            onClick={() => {
                              setStaffPasswordResetTarget(null)
                              setStaffPasswordResetForm({ password: '', confirmPassword: '' })
                            }}
                            disabled={resettingStaffPassword}
                          >
                            {t.cancel}
                          </button>
                          <button type="submit" className="primary-btn small" disabled={resettingStaffPassword}>
                            {resettingStaffPassword ? t.working : t.resetStaffPassword}
                          </button>
                        </div>
                      </form>
                    </WorkflowModal>
                  )}

                  <section className="panel-card staff-access-roster" aria-labelledby="staff-access-heading">
                    <div className="panel-header">
                      <h3 id="staff-access-heading">{t.staffAccounts}</h3>
                      <span className="soft-label">{staffCount} {t.staffMembersAvailable}</span>
                    </div>
                    <p className="report-metric-note">{t.staffCredentialsNote}</p>
                    <p className="report-metric-note">{t.staffPresenceExplanation}</p>
                    {staffPresenceError && <p className="inline-error" role="alert">{staffPresenceError}</p>}
                    {staffCount > 0 ? (
                      <div className="request-table-wrap">
                        <table className="request-table">
                          <thead>
                            <tr>
                              <th>{t.name}</th>
                              <th>{t.positionLabel}</th>
                              <th>{t.email}</th>
                              <th>{t.mobileNumberLabel}</th>
                              <th>{t.status}</th>
                              <th>{t.staffPresence}</th>
                              <th>{t.actionsLabel}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedUsers.filter((user) => user.role === 'staff').map((user) => {
                              const presence = staffPresence.find((member) => member.id === user.id)
                              const lastSeenDate = presence?.lastSeen ? new Date(presence.lastSeen) : null
                              const isOnline = lastSeenDate && !Number.isNaN(lastSeenDate.getTime())
                                && Date.now() - lastSeenDate.getTime() <= 120000

                              return (
                                <tr key={user.id}>
                                  <td>{getDisplayName(user)}</td>
                                  <td>{getStaffPositionLabel(user.position || t.staffRole, t)}</td>
                                  <td>{user.email}</td>
                                  <td>{user.mobile}</td>
                                  <td>{user.status || t.onDutyStatus}</td>
                                  <td>
                                    <span className={`staff-presence-badge ${isOnline ? 'online' : 'offline'}`}>
                                      <span aria-hidden="true" />
                                      {isOnline ? t.onlineNow : t.offline}
                                    </span>
                                    {lastSeenDate && !Number.isNaN(lastSeenDate.getTime()) && (
                                      <small className="staff-last-seen">
                                        {t.lastSeen}: {new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', {
                                          dateStyle: 'short',
                                          timeStyle: 'short',
                                          timeZone: 'Asia/Manila',
                                        }).format(lastSeenDate)}
                                      </small>
                                    )}
                                  </td>
                                  <td>
                                    <div className="staff-access-actions">
                                      <button
                                        type="button"
                                        className="secondary-btn small"
                                        onClick={() => {
                                          setStaffPasswordResetForm({ password: '', confirmPassword: '' })
                                          setStaffPasswordResetTarget(user)
                                        }}
                                      >
                                        {t.resetStaffPassword}
                                      </button>
                                      <button
                                        type="button"
                                        className="secondary-btn small"
                                        disabled={issuingTemporaryAccessId === user.id || !user.email}
                                        onClick={() => handleIssueStaffTemporaryAccess(user)}
                                      >
                                        {issuingTemporaryAccessId === user.id ? t.captainPhotoUploading : t.staffTemporaryAccess}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="empty-state">{t.noStaffAccounts}</p>
                    )}
                  </section>

                  <div className="search-and-filter">
                    <input
                      id="admin-user-search"
                      type="search"
                      placeholder={t.searchUsersPlaceholder}
                      value={accessSearch}
                      onChange={(event) => setAccessSearch(event.target.value)}
                      className="search-input"
                      aria-label={t.searchUsersLabel}
                      aria-controls="admin-user-search-results"
                    />
                  </div>

                  {normalizedAccessSearch ? (
                    <section id="admin-user-search-results" className="panel-card user-search-results" aria-live="polite">
                      <div className="panel-header">
                        <h3>{t.userSearchResults}</h3>
                        <span className="soft-label">{accessSearchResults.length} {t.usersFound}</span>
                      </div>
                      {accessSearchResults.length > 0 ? (
                        <div className="request-table-wrap">
                          <table className="request-table">
                            <thead>
                              <tr>
                                <th>{t.name}</th>
                                <th>{t.role}</th>
                                <th>{t.zone}</th>
                                <th>{t.status}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {accessSearchResults.map((user) => {
                                const zone = user.zone ?? user.zoneNumber
                                return (
                                  <tr key={user.id}>
                                    <td><button type="button" className="link-button" onClick={() => handleOpenAccessUser(user)}>{getDisplayName(user)}</button></td>
                                    <td><span className="zone-badge">{user.role || t.residentRole}</span></td>
                                    <td>{Number(zone) > 0 ? `${t.zone} ${zone}` : t.notAvailable}</td>
                                    <td>{user.status || t.notAvailable}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="empty-state">{t.noUserSearchResults}</p>
                      )}
                    </section>
                  ) : (
                  <div className="zone-group-stack">
                    {accessUsersByZone.map((group) => {
                      const isExpanded = expandedZone === group.zone
                      const zoneUsers = getAccessZoneUsers(group)

                      return (
                        <div key={group.zone} className="zone-group-card">
                          <button
                            type="button"
                            className="zone-toggle"
                            onClick={() => setExpandedZone((current) => current === group.zone ? null : group.zone)}
                          >
                            <div className="zone-toggle-left">
                              <span className="zone-toggle-number">Zone {group.zone}</span>
                              <span className="zone-toggle-meta">{group.users.length} users</span>
                            </div>
                            <span className={`zone-toggle-chevron ${isExpanded ? 'open' : ''}`}>▾</span>
                          </button>

                          {isExpanded && (
                            <div className="zone-group-body">
                              <div className="zone-sort-row">
                                <label className="zone-sort-label" htmlFor={`access-zone-sort-${group.zone}`}>{t.sortBy}</label>
                                <select
                                  id={`access-zone-sort-${group.zone}`}
                                  className="zone-sort-select"
                                  value={accessZoneSort[group.zone] || 'alphabetical'}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    event.stopPropagation()
                                    setAccessZoneSort((prev) => ({ ...prev, [group.zone]: event.target.value }))
                                  }}
                                >
                                  <option value="alphabetical">Alphabetical</option>
                                  <option value="newest">Recently created</option>
                                </select>
                              </div>

                              <div className="request-table-wrap">
                                <table className="request-table">
                                  <thead>
                                    <tr>
                                      <th>Name</th>
                                      <th>Role</th>
                                      <th style={{textAlign: 'right'}}>Created</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {zoneUsers.map((user) => (
                                      <tr key={user.id}>
                                        <td>
                                          <button type="button" className="link-button" onClick={() => handleOpenAccessUser(user)}>{getDisplayName(user)}</button>
                                        </td>
                                        <td><span className="zone-badge">{user.role || 'resident'}</span></td>
                                        <td style={{textAlign: 'right'}}>{user.createdAt || user.created_at ? new Date(user.createdAt || user.created_at).toLocaleString() : 'N/A'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  )}

                  <div className="approvals-history">
                    <div className="history-header">
                      <div>
                        <h3>{t.approvalsHistory}</h3>
                        <p>{t.recentApprovalsAndRecords}</p>
                      </div>
                      <div className="history-actions">
                        <label className="retention-control" htmlFor="approval-retention-days">
                          <span>{t.retention}</span>
                          <div className="inline-field">
                            <input
                              id="approval-retention-days"
                              type="number"
                              min="0"
                              step="1"
                              value={retentionDays}
                              onChange={(event) => setRetentionDays(event.target.value)}
                              aria-describedby="approval-retention-hint"
                            />
                            <small>{t.days}</small>
                          </div>
                        </label>
                        <button className="primary-btn small" type="button" onClick={() => {
                          const days = retentionDays === '' ? 30 : Number(retentionDays)
                          if (!Number.isInteger(days) || days < 0) {
                            setArchiveError(t.archiveInvalidRetention)
                            return
                          }
                          setArchiveError('')
                          setConfirmation({
                            title: t.archiveConfirmTitle,
                            message: days === 0 ? t.archiveAllConfirmMessage : t.archiveConfirmMessage.replace('{days}', String(days)),
                            confirmLabel: t.archiveNow,
                            onConfirm: handleArchiveNow,
                          })
                        }} disabled={archiving}>
                          {archiving ? t.archiving : t.archiveNow}
                        </button>
                        <button className="secondary-btn small" type="button" onClick={async () => {
                          try {
                            const response = await fetch(`${API_BASE}/admin/approvals`)
                            if (!response.ok) throw new Error(t.archiveRefreshFailed)
                            const data = await response.json()
                            setApprovals(Array.isArray(data.approvals) ? data.approvals : [])
                            setArchiveError('')
                          } catch (error) {
                            console.error('refresh approvals error', error)
                            setArchiveError(t.archiveRefreshFailed)
                          }
                        }}>
                          Refresh
                        </button>
                      </div>
                    </div>

                    <p id="approval-retention-hint" className="resident-search-feedback">{t.archiveRetentionHint}</p>
                    {archiveError && <p className="modal-error" role="alert">{archiveError}</p>}
                    {archiveResult && (
                      <div className="status-banner">
                        {t.archiveCompleted.replace('{count}', String(archiveResult.count || 0)).replace('{file}', archiveResult.filename ? archiveResult.filename.split(/[\\/]/).pop() : t.noArchiveFileCreated)}
                      </div>
                    )}

                    <div className="history-panel">
                      <div className="panel-subhead">
                        <h4>Recent Approvals</h4>
                        <span>{approvals.length} records</span>
                      </div>

                      {approvals && approvals.length > 0 ? (
                        <div className="approval-list">
                          {approvals.map((a) => (
                            <div key={a.id} className="approval-item">
                              <div className="approval-status success">{t.approved}</div>
                              <div className="approval-main">
                                <div className="approval-row-top">
                                  <strong>{a.id}</strong>
                                  <span>{a.dateApproved ? new Date(a.dateApproved).toLocaleString() : a.dateApproved}</span>
                                </div>
                                <div className="approval-meta">{t.approvedBy} {a.approvedByRole}</div>
                                <div className="approval-meta accent">{a.requestSnapshot?.type} — {a.requestSnapshot?.purpose}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state">{t.noApprovals}</div>
                      )}
                    </div>
                  </div>

                </article>
              )}

              {activeTab === 'emergencies' && (
                <article className="panel-card">
                  <div className="panel-header">
                    <h2>{t.emergencyReportsTitle}</h2>
                    <span className="soft-label">{reports.length} {t.incidentsLogged}</span>
                  </div>

                  <div className="reports-grid">
                    {reports && reports.map((report) => (
                      <div key={report.id} className="emergency-card" onClick={() => setSelectedReport(report)} style={{cursor: 'pointer'}}>
                        <div className={`emergency-severity ${report.severity?.toLowerCase()}`}>
                          {report.severity}
                        </div>
                        <h4>{report.title}</h4>
                        <p>{report.description}</p>
                        <div className="report-meta">
                          <span className="report-type">📍 Zone {report.zone}</span>
                          <span className="report-date">{report.date}</span>
                          <span className={`report-status ${report.status?.toLowerCase()}`}>
                            {report.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {(!reports || reports.length === 0) && (
                    <div className="empty-state">
                      <p>{t.noEmergencyReports}</p>
                    </div>
                  )}
                </article>
              )}
            </div>

            <aside className="side-column">
              <article className="profile-card system-status-card">
                <div className="profile-head">
                  <div className="system-status-heading">
                    <h3>{t.systemStatus}</h3>
                    <span>{t.systemChecksSubtitle}</span>
                  </div>
                  <button className="secondary-btn tiny" type="button" onClick={() => setHealthRefreshKey((current) => current + 1)} disabled={apiHealth.status === 'checking'}>
                    {t.refreshStatus}
                  </button>
                </div>
                <div className={`system-health-badge ${apiHealth.status}`} role="status" aria-live="polite">
                  <span className="system-health-dot" aria-hidden="true" />
                  {apiHealth.status === 'checking' ? t.systemChecking : apiHealth.status === 'ok' ? t.systemOperational : apiHealth.status === 'limited' ? t.systemRateLimited : t.systemUnavailable}
                </div>
                <dl className="profile-list system-status-list">
                  <div><dt>{t.portal}</dt><dd>{apiHealth.status === 'error' ? t.systemUnavailable : apiHealth.status === 'checking' ? t.systemChecking : apiHealth.status === 'limited' ? t.systemRateLimited : t.systemOperational}</dd></div>
                  <div><dt>{t.dataStorage}</dt><dd>{apiHealth.storage === 'postgres' ? t.postgresConnected : apiHealth.storage === 'json-fallback' ? t.localJsonStorage : t.systemUnknown}</dd></div>
                  <div><dt>{t.security}</dt><dd>{t.rbacEnabled}</dd></div>
                  <div><dt>{t.servicesLabel}</dt><dd>{requests.length} {t.trackedRequests}</dd></div>
                  <div><dt>{t.alerts}</dt><dd>{pending} {t.pendingRequests}</dd></div>
                </dl>
                {apiHealth.checkedAt && (
                  <p className="system-health-checked">
                    {t.lastChecked}: {new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { hour: 'numeric', minute: '2-digit' }).format(apiHealth.checkedAt)}
                  </p>
                )}
                <div className="system-improvements">
                  <h4>{t.recommendedImprovements}</h4>
                  <ul>
                    {staffCount === 0 && <li>{t.systemNoStaffRecommendation}</li>}
                    {apiHealth.status === 'error' && <li>{t.systemCheckApiRecommendation}</li>}
                    {apiHealth.status === 'limited' && <li>{t.systemRateLimitRecommendation}</li>}
                    {apiHealth.storage === 'json-fallback' && <li>{t.systemStorageRecommendation}</li>}
                    {pending > 0 && <li>{t.systemRequestsRecommendation.replace('{count}', String(pending))}</li>}
                    {apiHealth.status === 'ok' && apiHealth.storage === 'postgres' && pending === 0 && (
                      <li>{t.systemMonitoringRecommendation}</li>
                    )}
                    {apiHealth.status === 'checking' && <li>{t.systemRecommendationsLoading}</li>}
                  </ul>
                </div>
              </article>

              <article className="panel-card archive-card">
                <div className="panel-subhead">
                  <h4>{t.archivedFiles}</h4>
                  <button className="secondary-btn tiny" type="button" onClick={async () => {
                    try {
                      const response = await fetch(`${API_BASE}/admin/archives`)
                      if (!response.ok) throw new Error(t.archiveRefreshFailed)
                      const data = await response.json()
                      setArchives(Array.isArray(data.archives) ? data.archives : [])
                      setArchiveError('')
                    } catch (error) {
                      console.error('refresh archives error', error)
                      setArchiveError(t.archiveRefreshFailed)
                    }
                  }}>{t.refresh}</button>
                </div>

                {archives && archives.length > 0 ? (
                  <div className="archive-list">
                    {archives.map((f) => (
                      <div key={f.name} className="archive-item-side">
                        <div className="archive-main">
                          <strong>{f.name}</strong>
                          <div className="archive-meta">{f.mtime} • {Math.round((f.size || 0) / 1024)} KB</div>
                        </div>
                        <div className="archive-actions-side">
                          <button type="button" className="small-action success" onClick={async () => {
                            try {
                              const resp = await fetch(`${API_BASE}/admin/archive-file?name=${encodeURIComponent(f.name)}`)
                              if (!resp.ok) { throw new Error('Download failed') }
                              const blob = await resp.blob()
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = f.name
                              document.body.appendChild(a)
                              a.click()
                              a.remove()
                              URL.revokeObjectURL(url)
                            } catch (err) {
                              console.error('download archive error', err)
                              alert('Download failed')
                            }
                          }}>{t.download}</button>
                          <button
                            type="button"
                            className="small-action danger"
                            onClick={() => setConfirmation({
                              title: t.delete,
                              message: `Delete archive ${f.name}?`,
                              confirmLabel: t.delete,
                              onConfirm: () => handleDeleteArchive(f.name),
                            })}
                          >{t.delete}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">{t.noArchivedFiles}</div>
                )}
              </article>
            </aside>
          </div>
        </section>
      </main>
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} allowEdit onArchive={() => handleArchiveResident(selectedUser)} onUserUpdated={(updated) => {
        setManagedUsers((current) => current.map((user) => user.id === updated.id ? { ...user, ...updated } : user))
        setSelectedUser((current) => ({ ...(current || {}), ...updated }))
      }} />}
      {selectedReport && (
        <div className="modal-overlay" onClick={() => setSelectedReport(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedReport(null)}>×</button>
            <div className="modal-header">
              <h2>{selectedReport.title}</h2>
              <small>Zone {selectedReport.zone} • {selectedReport.date} • {selectedReport.severity}</small>
            </div>
            <div className="modal-body">
              <p>{selectedReport.description}</p>
              <dl>
                <div><dt>Status</dt><dd>{selectedReport.status}</dd></div>
                <div><dt>Reported by</dt><dd>{selectedReport.reportedBy || 'Anonymous'}</dd></div>
                <div><dt>Contact</dt><dd>{selectedReport.contact || 'N/A'}</dd></div>
                <div><dt>Actions Taken</dt><dd>{selectedReport.actions || 'None recorded'}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      )}
      {confirmation && (
        <ConfirmationModal
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          cancelLabel={t.cancel}
          onClose={() => setConfirmation(null)}
          onConfirm={confirmation.onConfirm}
        />
      )}
    </div>
  )
}

function MauAssistant({ language, userRole, isAuthenticated, pathname, mobileDashboard }) {
  const t = translations[language] || translations.en
  const isHomepage = !isAuthenticated && pathname === '/'
  const residentRegistration = !isAuthenticated && pathname === '/register'
  const hasBottomNavigation = ['staff', 'admin', 'super_admin'].includes(userRole)
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [quickOptionsMinimized, setQuickOptionsMinimized] = useState(() => (
    window.matchMedia('(max-width: 760px) and (max-height: 480px)').matches
    || (window.innerWidth <= 760 && window.visualViewport?.height <= 480)
  ))
  const [residencyCheck, setResidencyCheck] = useState(isHomepage ? 'asked' : 'confirmed')
  const triggerRef = useRef(null)
  const questionInputRef = useRef(null)
  const assistantRef = useRef(null)
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'mau',
      text: t.mauWelcome,
    },
  ])

  useEffect(() => {
    const openAssistant = (event) => {
      triggerRef.current = event.detail?.trigger || document.activeElement
      setOpen(true)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && open) setOpen(false)
    }

    window.addEventListener('brgy-open-mau', openAssistant)
    document.addEventListener('keydown', closeOnEscape)
    if (open && !window.matchMedia('(pointer: coarse), (max-width: 640px)').matches) {
      questionInputRef.current?.focus()
    } else {
      triggerRef.current?.focus()
    }

    return () => {
      window.removeEventListener('brgy-open-mau', openAssistant)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    const compactViewport = window.matchMedia('(max-width: 760px) and (max-height: 480px)')
    const syncQuickOptions = () => {
      setQuickOptionsMinimized(compactViewport.matches || (
        window.innerWidth <= 760 && window.visualViewport?.height <= 480
      ))
    }

    compactViewport.addEventListener('change', syncQuickOptions)
    window.addEventListener('resize', syncQuickOptions)
    window.visualViewport?.addEventListener('resize', syncQuickOptions)
    syncQuickOptions()

    return () => {
      compactViewport.removeEventListener('change', syncQuickOptions)
      window.removeEventListener('resize', syncQuickOptions)
      window.visualViewport?.removeEventListener('resize', syncQuickOptions)
    }
  }, [])

  useEffect(() => {
    if (!open || !window.visualViewport) return undefined

    const viewport = window.visualViewport
    const updateViewport = () => {
      const keyboardInset = Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)
      assistantRef.current?.style.setProperty('--mau-visual-height', `${viewport.height}px`)
      assistantRef.current?.style.setProperty('--mau-keyboard-inset', `${keyboardInset}px`)
    }

    updateViewport()
    viewport.addEventListener('resize', updateViewport)
    viewport.addEventListener('scroll', updateViewport)
    return () => {
      viewport.removeEventListener('resize', updateViewport)
      viewport.removeEventListener('scroll', updateViewport)
      assistantRef.current?.style.removeProperty('--mau-visual-height')
      assistantRef.current?.style.removeProperty('--mau-keyboard-inset')
    }
  }, [open])

  const quickOptions = getMauQuickOptions(language, userRole, isAuthenticated, isHomepage, residencyCheck, translations)
  const welcomeMessage = getMauWelcome(language, userRole, isAuthenticated, isHomepage, translations)

  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    setResidencyCheck(isHomepage ? 'asked' : 'confirmed')
  }, [isAuthenticated, isHomepage, userRole])

  const sendQuestion = (input) => {
    const trimmed = String(input || '').trim()
    if (!trimmed) {
      setErrorMessage(t.mauEmpty)
      return
    }

    if (trimmed.length > 240) {
      setErrorMessage(t.mauTooLong)
      return
    }

    const userMessage = { id: `user-${Date.now()}`, sender: 'user', text: trimmed }
    const residentAnswer = isHomepage && residencyCheck === 'asked' ? getMauResidentAnswer(trimmed) : null
    const mauMessage = {
      id: `mau-${Date.now() + 1}`,
      sender: 'mau',
      text: getMauReply(trimmed, language, t, userRole, isAuthenticated, isHomepage, residencyCheck),
    }

    setMessages((current) => [...current, userMessage, mauMessage])
    if (residentAnswer) setResidencyCheck(residentAnswer === 'yes' ? 'confirmed' : 'not-resident')
    setErrorMessage('')
    setQuestion('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    sendQuestion(question)
  }

  return (
    <>
      <button
        type="button"
        className={`mau-launcher ${hasBottomNavigation ? 'with-bottom-nav' : ''} ${mobileDashboard ? 'resident-mobile-dashboard' : ''} ${residentRegistration ? 'resident-registration-launcher' : ''}`}
        onClick={(event) => {
          if (!open) triggerRef.current = event.currentTarget
          setOpen((current) => !current)
        }}
        aria-label={t.mauOpenLabel}
        aria-expanded={open}
        aria-controls="mau-assistant-dialog"
      >
        <span className="mau-launcher-badge" aria-hidden="true">
          <SystemLogo />
        </span>
        <span>Mau</span>
      </button>

      {open && (
        <div
          id="mau-assistant-dialog"
          ref={assistantRef}
          className={`mau-assistant ${hasBottomNavigation ? 'with-bottom-nav' : ''}`}
          role="dialog"
          aria-labelledby="mau-dialog-title"
        >
          <div className="mau-header">
            <div className="mau-avatar" aria-hidden="true">
              <SystemLogo />
            </div>
            <div>
              <strong id="mau-dialog-title">Mau</strong>
              <small>{t.mauHelper}</small>
            </div>
            <button type="button" className="mau-close" onClick={() => setOpen(false)} aria-label={t.mauCloseLabel}>×</button>
          </div>

          <div className="mau-body" role="log" aria-label={t.mauHelper} aria-live="polite" aria-relevant="additions">
            {messages.map((message) => (
              <div key={message.id} className={`mau-message ${message.sender === 'user' ? 'user' : 'mau'}`}>
                {message.id === 'welcome' ? welcomeMessage : message.text}
              </div>
            ))}
          </div>

          {errorMessage && <div className="mau-error" role="alert">{errorMessage}</div>}

          <div className="mau-options">
            <div className="mau-options-heading">
              <span>{t.mauOptionsLabel}</span>
              <button
                type="button"
                className="mau-options-toggle"
                aria-expanded={!quickOptionsMinimized}
                aria-controls="mau-quick-options"
                onClick={() => setQuickOptionsMinimized((current) => !current)}
              >
                {quickOptionsMinimized ? t.mauOptionsShow : t.mauOptionsHide}
              </button>
            </div>
            <div id="mau-quick-options" className="mau-option-row" hidden={quickOptionsMinimized}>
              {quickOptions.map((option) => (
                <button key={option} type="button" className="mau-option" onClick={() => sendQuestion(option)}>
                  {option}
                </button>
              ))}
            </div>
          </div>

          <form className="mau-form" onSubmit={handleSubmit}>
            <input
              ref={questionInputRef}
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t.mauPlaceholder}
              aria-label={t.mauAsk}
            />
            <button type="submit" className="primary-btn small mau-send">{t.mauSend}</button>
          </form>
        </div>
      )}
    </>
  )
}

function App() {
  const location = useLocation()
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem('brgy-legaspi-language') === 'fil' ? 'fil' : 'en'
    } catch {
      return 'en'
    }
  })
  const switchLanguage = (nextLanguage) => {
    if (nextLanguage === language) return

    if (document.startViewTransition) {
      document.startViewTransition(() => {
        flushSync(() => setLanguage(nextLanguage))
      })
      return
    }

    setLanguage(nextLanguage)
  }
  const [profile, setProfile] = useState(initialProfile)
  const [requests, setRequests] = useState(initialRequests)
  const [users, setUsers] = useState([])
  const [residents, setResidents] = useState([])
  const [staffMembers, setStaffMembers] = useState([])
  const [services, setServices] = useState([])
  const [announcementsData, setAnnouncementsData] = useState([])
  const [events, setEvents] = useState([])
  const [payments, setPayments] = useState([])
  const [reports, setReports] = useState([])
  const [logoVersion, setLogoVersion] = useState(0)
  const [logoUrl, setLogoUrl] = useState('')
  const [session, setSession] = useState(() => readStoredSession())
  const [reminderAlerts, setReminderAlerts] = useState([])

  const isAuthenticated = Boolean(session?.isActive)
  const userRole = session?.user?.role || session?.role || 'resident'
  const t = translations[language] || translations.en

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/system-logo`)
      .then(async (response) => {
        if (response.status === 204 || response.status === 404) return ''
        const data = await response.json().catch(() => ({}))
        if (!response.ok || typeof data.url !== 'string') {
          throw new Error(data.message || 'Unable to load the system logo.')
        }
        return data.url
      })
      .then((url) => {
        if (active) setLogoUrl(url)
      })
      .catch((error) => {
        console.error('load system logo failed', error)
        if (active) setLogoUrl('')
      })
    return () => { active = false }
  }, [logoVersion])

  useEffect(() => {
    const favicon = document.querySelector('link[rel="icon"]')
    if (!favicon) return
    if (logoUrl) {
      favicon.href = logoUrl
      favicon.removeAttribute('type')
    } else {
      favicon.href = '/favicon.svg'
      favicon.type = 'image/svg+xml'
    }
  }, [logoUrl])

  useEffect(() => {
    try {
      localStorage.setItem('brgy-legaspi-language', language)
    } catch {
      // Ignore storage write issues in restricted browsing environments.
    }
  }, [language])

  useEffect(() => {
    document.documentElement.lang = language
    const portalLabel = userRole === 'super_admin' ? t.superAdminPortal : userRole === 'admin' ? t.adminPortal : userRole === 'staff' ? t.staffPortal : t.residentPortal
    document.title = `${t.barangayLegaspi} - ${portalLabel}`
  }, [language, userRole, t.adminPortal, t.barangayLegaspi, t.residentPortal, t.staffPortal, t.superAdminPortal])

  useEffect(() => {
    const handleWindowError = (event) => {
      if (event.error) reportClientError('window-error', language, userRole)
    }
    const handleUnhandledRejection = () => reportClientError('unhandled-rejection', language, userRole)

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [language, userRole])

  useEffect(() => {
    if (!session?.user?.id) return
    const reminderStorageKey = getRequestReminderStorageKey(session.user.id)
    const checkDueReminders = () => {
      try {
        const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '{}')
        const dueReminders = Object.entries(reminders).filter(([, reminder]) => (
          !reminder.notified && new Date(reminder.scheduledAt).getTime() <= Date.now()
        ))
        if (dueReminders.length === 0) return

        for (const [, reminder] of dueReminders) {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification(t.reminderTitle, { body: `${t.reminderMessage} ${reminder.requestType}.` })
            } catch {
              // In-app reminder remains available if the browser blocks desktop notifications.
            }
          }
        }

        const dueAlerts = dueReminders.map(([id, reminder]) => ({ id, ...reminder }))
        setReminderAlerts((current) => {
          const currentIds = new Set(current.map((alert) => alert.id))
          return [...current, ...dueAlerts.filter((alert) => !currentIds.has(alert.id))]
        })
        for (const [id] of dueReminders) reminders[id] = { ...reminders[id], notified: true }
        localStorage.setItem(reminderStorageKey, JSON.stringify(reminders))
      } catch (error) {
        console.error('request reminder check failed', error)
      }
    }

    checkDueReminders()
    const interval = window.setInterval(checkDueReminders, 15_000)
    return () => window.clearInterval(interval)
  }, [language, session?.user?.id, t.reminderMessage, t.reminderTitle])

  useEffect(() => {
    if (!isAuthenticated || userRole !== 'staff' || !session?.token || session?.mustChangePassword || session?.user?.mustChangePassword) return undefined

    const updateStaffPresence = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const response = await fetch(`${API_BASE}/staff/presence`, { method: 'POST' })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.message || 'Unable to update staff presence.')
        }
      } catch (error) {
        console.error('staff presence heartbeat failed', error)
      }
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') updateStaffPresence()
    }

    updateStaffPresence()
    const interval = window.setInterval(updateStaffPresence, 30_000)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isAuthenticated, userRole, session?.token, session?.mustChangePassword, session?.user?.mustChangePassword])

  useEffect(() => {
    const loadUserData = async () => {
      if (!session?.token || session?.mustChangePassword || session?.user?.mustChangePassword) return

      try {
        // profile
        const profileResponse = await fetch(`${API_BASE}/profile`)
        if (profileResponse.ok) {
          const p = await profileResponse.json()
          setProfile(p.user || p)
        }

        if (userRole === 'resident') {
          try {
            const [dashboardResp, requestsResp] = await Promise.all([
              fetch(`${API_BASE}/dashboard`),
              fetch(`${API_BASE}/requests`),
            ])

            if (dashboardResp.ok) {
              const dashboard = await dashboardResp.json()
              setServices(dashboard.services || [])
              setAnnouncementsData(dashboard.announcements || [])
              setEvents(dashboard.events || [])
              setPayments(dashboard.payments || [])
            }

            if (requestsResp.ok) {
              const requestData = await requestsResp.json()
              setRequests(requestData.requests || [])
            }
          } catch (e) {
            console.error('failed to load resident dashboard data', e)
          }
        }

        // staff or admin: load shared staff data and request queue
        if (['staff', 'admin', 'super_admin'].includes(userRole)) {
          try {
            const [staffRequestsResp, staffMembersResp, announcementsResp] = await Promise.all([
              isAdminRole(userRole) ? fetch(`${API_BASE}/staff/requests`) : Promise.resolve(null),
              fetch(`${API_BASE}/staff/members`),
              fetch(`${API_BASE}/announcements`),
            ])

            if (staffRequestsResp?.ok) {
              const d = await staffRequestsResp.json()
              setRequests(d.requests || d || [])
            }
            if (staffMembersResp.ok) {
              const s = await staffMembersResp.json()
              setStaffMembers(s.staffMembers || [])
            }
            if (announcementsResp.ok) {
              const a = await announcementsResp.json()
              setAnnouncementsData(a.announcements || [])
            }
          } catch (e) {
            console.error('failed to load staff data', e)
          }
        }

        if (isAdminRole(userRole)) {
          // admin-only data
          try {
            const [usersResp, residentsResp, reportsResp] = await Promise.all([
              fetch(`${API_BASE}/admin/users`),
              fetch(`${API_BASE}/admin/residents-by-zone`),
              fetch(`${API_BASE}/admin/reports`),
            ])

            if (usersResp.ok) { const u = await usersResp.json(); setUsers(u.users || []) }
            if (residentsResp.ok) { const r = await residentsResp.json(); setResidents(r.residents || []) }
            if (reportsResp.ok) { const rep = await reportsResp.json(); setReports(rep.reports || []) }
          } catch (e) {
            console.error('failed to load admin data', e)
          }
        }
      } catch (e) {
        // on any failure: clear session to force login again
        console.error('loadUserData error', e)
        clearStoredSession()
        setSession(null)
      }
    }

    loadUserData()
  }, [session?.token, session?.mustChangePassword, session?.user?.mustChangePassword, userRole])

  const handleLogin = (newSession) => {
    const nextSession = { ...newSession, isActive: true }
    setProfile(newSession.user || initialProfile)
    setSession(nextSession)
    writeStoredSession(nextSession)
  }

  const handlePasswordChanged = ({ token, user }) => {
    const nextSession = { ...session, token, user, mustChangePassword: false, isActive: true }
    setProfile(user)
    setSession(nextSession)
    writeStoredSession(nextSession)
  }

  const handleProfileUpdated = (user) => {
    const nextSession = { ...session, user, isActive: true }
    setProfile(user)
    setSession(nextSession)
    writeStoredSession(nextSession)
  }

  const handleLogout = () => {
    clearStoredSession()
    setSession(null)
  }

  const handleRequestSubmit = (newRequest) => {
    setRequests((prev) => [newRequest, ...prev])
  }

  const handleRequestUpdated = (updatedRequest) => {
    setRequests((prev) => prev.map((request) => request.id === updatedRequest.id ? updatedRequest : request))
  }

  const handleRequestStatus = async (requestId, status, note = '') => {
    if (!session?.token) throw new Error('Your session has expired. Please sign in again.')

    try {
      const response = await fetch(`${API_BASE}/requests/${requestId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || 'Unable to update request status.')
      }

      setRequests((prev) => prev.map((item) => (item.id === requestId ? data.request : item)))
      return data.request
    } catch (e) {
      throw new Error(e.message || 'Unable to update request status.')
    }
  }

  const handleStaffMemberUpdated = (updated) => {
    setUsers((current) => current.map((user) => user.id === updated.id ? { ...user, ...updated } : user))
    setStaffMembers((current) => current.flatMap((member) => {
      if (member.id !== updated.id) return [member]
      const nextMember = { ...member, ...updated }
      return nextMember.role === 'staff' ? [nextMember] : []
    }))
  }

  const handlePortalAccountCreated = (createdUser) => {
    if (!createdUser?.id) return
    setUsers((current) => [createdUser, ...current.filter((user) => user.id !== createdUser.id)])
    if (createdUser.role === 'staff') {
      setStaffMembers((current) => [createdUser, ...current.filter((member) => member.id !== createdUser.id)])
    }
  }

  const handleDeleteStaffMember = async (staffId) => {
    try {
      const response = await fetch(`${API_BASE}/staff/members/${staffId}`, {
        method: 'DELETE',
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Unable to delete staff member.')
      }

      setStaffMembers((prev) => prev.filter((member) => member.id !== staffId))
    } catch (error) {
      alert(error.message || 'Unable to delete staff member.')
    }
  }

  const handleAddAnnouncement = async (announcement) => {
    try {
      const response = await fetch(`${API_BASE}/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: announcement.tag,
          title: announcement.title,
          content: announcement.content,
          date: announcement.date,
          socialChannels: Array.isArray(announcement.socialChannels) ? announcement.socialChannels : [],
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Unable to publish announcement.')
      }

      const nextAnnouncement = data.announcement || {
        ...announcement,
        id: `announcement-${Date.now()}`,
      }
      setAnnouncementsData((prev) => [nextAnnouncement, ...prev])
      return data
    } catch (error) {
      throw new Error(error.message || 'Unable to publish announcement.')
    }
  }

  const handleDeleteAnnouncement = async (announcementId) => {
    try {
      const response = await fetch(`${API_BASE}/announcements/${announcementId}`, {
        method: 'DELETE',
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Unable to delete announcement.')
      }

      setAnnouncementsData((prev) => prev.filter((announcement) => String(announcement.id || announcement.title) !== String(announcementId)))
      if (data.messengerMessagesCannotBeUnsent) alert(translations[language]?.messengerMessagesRemain || translations.en.messengerMessagesRemain)
    } catch (error) {
      alert(error.message || 'Unable to delete announcement.')
    }
  }

  const handleRetractAnnouncement = async (announcementId, content) => {
    const response = await fetch(`${API_BASE}/announcements/${announcementId}/retract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'Unable to publish the retraction.')

    setAnnouncementsData((prev) => [
      data.announcement,
      ...prev.map((announcement) => String(announcement.id) === String(announcementId)
        ? { ...announcement, retractionAnnouncementId: data.announcement.id }
        : announcement),
    ])
    return data
  }

  const mustChangePassword = Boolean(session?.mustChangePassword || session?.user?.mustChangePassword)
  if (isAuthenticated && mustChangePassword && location.pathname !== '/settings') {
    return <Navigate to="/settings" replace />
  }

  return (
    <BrandingContext.Provider value={{ logoUrl, refreshLogo: () => setLogoVersion((version) => version + 1) }}>
      {reminderAlerts.length > 0 && (
        <div className="request-reminder-alerts" role="status" aria-live="polite">
          {reminderAlerts.map((alert) => (
            <div className="request-reminder-alert" key={alert.id}>
              <div>
                <strong>{t.reminderTitle}</strong>
                <p>{t.reminderMessage} {alert.requestType}.</p>
              </div>
              <button type="button" className="secondary-btn tiny" onClick={() => setReminderAlerts((current) => current.filter((item) => item.id !== alert.id))}>{t.dismissReminder}</button>
            </div>
          ))}
        </div>
      )}
      <Routes>
        <Route path="/" element={isAuthenticated ? <Navigate to={getDashboardPath(userRole)} replace /> : <LoginPage onLogin={handleLogin} language={language} setLanguage={switchLanguage} />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to={getDashboardPath(userRole)} replace /> : <RegisterPage language={language} setLanguage={switchLanguage} />} />
        <Route path="/staff-invite" element={<StaffInvitationPage language={language} />} />
        <Route path="/super-admin-invite" element={<StaffInvitationPage language={language} accountType="super_admin" />} />
        <Route path="/staff-access" element={<StaffTemporaryAccessPage onLogin={handleLogin} language={language} setLanguage={switchLanguage} />} />
        <Route path="/dashboard" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><DashboardPage profile={profile} requests={requests} services={services} announcements={announcementsData} events={events} payments={payments} onLogout={handleLogout} onProfileUpdated={handleProfileUpdated} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/requests" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><RequestsPage requests={requests} onSubmit={handleRequestSubmit} onRequestUpdated={handleRequestUpdated} onLogout={handleLogout} language={language} setLanguage={switchLanguage} userId={session?.user?.id} /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><ProfilePage profile={profile} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/payments" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><PaymentsPage payments={payments} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/events" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><EventsPage events={events} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident', 'staff', 'admin', 'super_admin']} userRole={userRole}><SettingsPage profile={profile} onLogout={handleLogout} onPasswordChanged={handlePasswordChanged} onProfileUpdated={handleProfileUpdated} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/staff" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['staff', 'admin', 'super_admin']} userRole={userRole}><StaffPage staffMembers={staffMembers} announcements={announcementsData} currentUser={session?.user} userRole={userRole} onProcessRequest={handleRequestStatus} onLogout={handleLogout} onStaffMemberUpdated={handleStaffMemberUpdated} onPortalAccountCreated={handlePortalAccountCreated} onAddAnnouncement={handleAddAnnouncement} onDeleteAnnouncement={handleDeleteAnnouncement} onRetractAnnouncement={handleRetractAnnouncement} onDeleteStaffMember={handleDeleteStaffMember} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['admin']} userRole={userRole}><AdminPage users={users} residents={residents} requests={requests} reports={reports} currentUser={session?.user} onLogout={handleLogout} onPortalAccountCreated={handlePortalAccountCreated} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/super-admin" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['super_admin']} userRole={userRole}><AdminPage users={users} residents={residents} requests={requests} reports={reports} currentUser={session?.user} onLogout={handleLogout} onPortalAccountCreated={handlePortalAccountCreated} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={getDashboardPath(userRole)} replace />} />
      </Routes>
      <MauAssistant language={language} userRole={userRole} isAuthenticated={isAuthenticated} pathname={location.pathname} mobileDashboard={userRole === 'resident' && location.pathname === '/dashboard'} />
    </BrandingContext.Provider>
  )
}

export default App
