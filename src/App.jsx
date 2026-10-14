import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import barangaySeal from './assets/barangay-seal-new.png'
import legaspiHero from './assets/legaspi-community.png'
import { getMauQuickOptions, getMauReply, getMauResidentAnswer, getMauWelcome } from './mau-responses'
import { reportClientError } from './client-error-reporting'
import { getReportDateRange } from './report-date-range'
import { isStaffReportResponse } from './report-contract'
import translations from './translations'
import './App.css'

const sessionKey = 'brgy-legaspi-session'
const getRequestReminderStorageKey = (userId) => `brgy-legaspi-request-reminders:${userId}`
const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')

if (!API_BASE) {
  throw new Error('VITE_API_BASE must be configured to point to the deployed API base URL, such as https://api.example.com/api.')
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
const getRequestStatusLabel = (status, t) => ({
  Pending: t.statusSubmitted,
  'In Review': t.statusUnderReview,
  'Needs Information': t.statusNeedsInformation,
  Approved: t.approved,
  Rejected: t.statusRejected,
  Available: t.availableLabel,
}[status] || status || t.statusSubmitted)
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
const passwordRequirements = 'at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character'

const LanguageToggle = ({ language, setLanguage }) => (
  <div className="language-toggle" role="group" aria-label={translations[language]?.languageSelectionLabel || translations.en.languageSelectionLabel}>
    <button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
    <button type="button" className={language === 'fil' ? 'active' : ''} aria-pressed={language === 'fil'} onClick={() => setLanguage('fil')}>FIL</button>
  </div>
)

function PasswordField({ id, label, value, onChange, autoComplete = 'new-password', minLength = 8, placeholder, required = true, helpText }) {
  const [visible, setVisible] = useState(false)

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
          aria-label={visible ? `Hide ${label || 'password'}` : `Show ${label || 'password'}`}
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
  { key: 'facebook', label: 'Facebook', connected: false },
  { key: 'instagram', label: 'Instagram', connected: false },
  { key: 'x', label: 'X / Twitter', connected: false },
  { key: 'messenger', label: 'Messenger', connected: false },
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

function WorkflowModal({ title, onClose, children, wide = false, disableClose = false, closeLabel = 'Close dialog', closeButtonRef, trapFocus = false }) {
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
        className={`modal-content workflow-modal${wide ? ' workflow-modal-wide' : ''}`}
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
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close user details">×</button>
        <div className="modal-header">
          <div className="modal-avatar">{initials}</div>
          <div>
            <h2>{fullName}</h2>
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
              <div><dt>Role</dt><dd>{allowEdit ? (
                <select value={editableUser.role ?? role} onChange={(event) => handleFieldChange('role', event.target.value)}>
                  <option value="resident">Resident</option>
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (role.charAt(0).toUpperCase() + role.slice(1))}</dd></div>
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
    const fallback = userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'
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

function CaptainPhotoSettings({ language }) {
  const t = translations[language] || translations.en
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [photoVersion, setPhotoVersion] = useState(0)
  const fileInput = useRef(null)

  const handleUpload = async (event) => {
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

    setBusy(true)
    setError('')
    try {
      const optimizedPhoto = await optimizeCaptainPhoto(file)
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(optimizedPhoto.type)) {
        throw new Error(t.captainPhotoInvalid)
      }
      if (optimizedPhoto.size < 1 || optimizedPhoto.size > 5 * 1024 * 1024) {
        throw new Error(t.captainPhotoTooLarge)
      }
      const linkResponse = await fetch(`${API_BASE}/admin/captain-photo/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: optimizedPhoto.type }),
      })
      const upload = await linkResponse.json().catch(() => ({}))
      if (!linkResponse.ok) throw new Error(upload.message || t.captainPhotoUploadFailed)

      const form = new FormData()
      for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
      form.append('file', optimizedPhoto, 'captain-photo.webp')
      const storageResponse = await fetch(upload.url, { method: 'POST', body: form })
      if (!storageResponse.ok) throw new Error(t.captainPhotoUploadFailed)

      const finalizeResponse = await fetch(`${API_BASE}/admin/captain-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: upload.key }),
      })
      const result = await finalizeResponse.json().catch(() => ({}))
      if (!finalizeResponse.ok) throw new Error(result.message || t.captainPhotoUploadFailed)
      setPhotoVersion(Date.now())
    } catch (uploadError) {
      console.error('upload captain photo failed', uploadError)
      setError(uploadError.message || t.captainPhotoUploadFailed)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/admin/captain-photo`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.captainPhotoUploadFailed)
      setPhotoVersion(Date.now())
    } catch (removeError) {
      console.error('remove captain photo failed', removeError)
      setError(removeError.message || t.captainPhotoUploadFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="panel-card captain-photo-settings">
      <div>
        <h2>{t.captainPhotoSettings}</h2>
        <p>{t.captainPhotoStorageHint}</p>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={t.captainPhotoLabel}
          disabled={busy}
          onChange={handleUpload}
        />
        <div className="captain-photo-settings-actions">
          <button className="primary-btn small" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? t.captainPhotoUploading : t.captainPhotoChoose}
          </button>
          <button className="secondary-btn small" type="button" disabled={busy} onClick={handleRemove}>
            {t.captainPhotoRemove}
          </button>
        </div>
        {error && <p className="captain-photo-error" role="alert">{error}</p>}
      </div>
      <img key={photoVersion} src={`${API_BASE}/captain-photo?v=${photoVersion}`} alt={t.captainPortraitAlt} onError={(event) => { event.currentTarget.hidden = true }} />
    </article>
  )
}

function LoginPage({ onLogin, language, setLanguage }) {
  const navigate = useNavigate()
  const t = translations[language] || translations.en
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
  const [resetting, setResetting] = useState(false)
  const [captainPhotoAvailable, setCaptainPhotoAvailable] = useState(true)

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
    const cleanedPassword = sanitizeText(form.password)

    if (!cleanedIdentifier || !cleanedPassword) {
      alert(t.loginRequired)
      return
    }

    if (!isValidIdentifier(cleanedIdentifier) || cleanedPassword.length < 8) {
      alert(t.loginFormatInvalid)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanedIdentifier, password: cleanedPassword }),
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
      onLogin({ token: data.token, user: data.user, identifier: cleanedIdentifier, role: nextRole, isActive: true })
      navigate(nextRole === 'staff' ? '/staff' : nextRole === 'admin' ? '/admin' : '/dashboard')
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
      navigate(nextRole === 'staff' ? '/staff' : nextRole === 'admin' ? '/admin' : '/dashboard')
    } catch (error) {
      alert(error.message || 'Your login details are not recognized. Please try again or use the demo account.')
    }
  }

  const handleResetSubmit = async (event) => {
    event.preventDefault()
    if (resetRequested && !isValidPassword(resetForm.newPassword)) {
      alert(`New password must have ${passwordRequirements}.`)
      return
    }
    setResetting(true)
    try {
      const endpoint = resetRequested ? `${API_BASE}/reset-password` : `${API_BASE}/reset-password/request`
      const body = resetRequested
        ? { token: resetForm.token, newPassword: resetForm.newPassword }
        : { identifier: resetForm.identifier }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to reset password.')

      if (!resetRequested) {
        if (data.deliveryStatus !== 'queued' && !data.resetToken) {
          alert(t.resetRequestGeneric)
          return
        }
        setResetRequested(true)
        if (data.resetToken) {
          setResetForm((current) => ({ ...current, token: data.resetToken }))
        }
        alert(data.message || t.resetRequestGeneric)
      } else {
        alert(data.message)
        setShowReset(false)
        setResetRequested(false)
        setForm((current) => ({ ...current, password: '' }))
        setResetForm({ identifier: '', token: '', newPassword: '' })
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
            <img src={barangaySeal} alt="" />
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
              <img className="seal-logo" src={barangaySeal} alt="Barangay Legaspi official seal" />
            </div>
            <div className="brand-copy">
              <span className="brand-kicker">{t.officialResident}</span>
              <h1>{t.barangayLegaspi}</h1>
              <p>{t.residentPortal}</p>
              <span className="brand-location">Tayug, Pangasinan</span>
            </div>
            <section className="captain-card" aria-label={t.captainIdentification}>
              <div className="captain-photo-picker">
                {captainPhotoAvailable ? (
                  <img
                    src={`${API_BASE}/captain-photo`}
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
                <strong>Arnold C. Cabaong</strong>
                <span className="captain-location">{t.captainLocation}</span>
              </div>
            </section>
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
        <div className="modal-overlay" onClick={() => setShowReset(false)}>
          <form className="modal-content reset-password-modal" onSubmit={handleResetSubmit} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setShowReset(false)} aria-label="Close password reset">×</button>
            <div className="modal-header">
              <div>
                <h2>{t.resetPassword}</h2>
                <p>{resetRequested ? 'Enter the one-time token and choose a new password.' : 'We will send a short-lived reset token to your registered contact.'}</p>
              </div>
            </div>
            <div className="modal-body">
              {!resetRequested && <div className="input-block">
                <label htmlFor="reset-identifier">Mobile number or email</label>
                <input id="reset-identifier" type="text" value={resetForm.identifier} onChange={(event) => setResetForm((current) => ({ ...current, identifier: event.target.value }))} required />
              </div>}
              {resetRequested && <div className="input-block">
                <label htmlFor="reset-token">{t.oneTimeResetToken}</label>
                <input id="reset-token" type="text" value={resetForm.token} onChange={(event) => setResetForm((current) => ({ ...current, token: event.target.value }))} required />
              </div>}
              {resetRequested && <div className="input-block">
                <PasswordField id="reset-new-password" label={t.password} value={resetForm.newPassword} onChange={(event) => setResetForm((current) => ({ ...current, newPassword: event.target.value }))} helpText={`${passwordRequirements}.`} />
              </div>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn small" onClick={() => { setShowReset(false); setResetRequested(false) }}>{t.cancel}</button>
                <button type="submit" className="primary-btn small" disabled={resetting}>{resetting ? t.working : resetRequested ? t.resetPasswordAction : t.sendResetToken}</button>
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
  const relationshipOptions = ['Parent', 'Sibling', 'Relative', 'Spouse', 'Child', 'Other']
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

    const nextForm = {
      firstName: sanitizeText(form.firstName),
      lastName: sanitizeText(form.lastName),
      mobile: sanitizeText(form.mobile),
      email: sanitizeText(form.email),
      address: sanitizeText(form.address),
      zone: Number(form.zone),
      householdMembers: form.householdMembers
        .map((member) => ({ name: sanitizeText(member.name), relationship: relationshipOptions.includes(member.relationship) ? member.relationship : 'Other' }))
        .filter((member) => member.name),
      password: sanitizeText(form.password),
    }

    if (!nextForm.firstName || !nextForm.lastName || !nextForm.mobile || !nextForm.email || !nextForm.address || !nextForm.zone || !nextForm.password) {
      alert('Please complete all required fields to register.')
      return
    }

    if (!/^09\d{9}$/.test(nextForm.mobile) || !/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(nextForm.email)) {
      alert('Please enter a valid mobile number and email address.')
      return
    }

    if (!isValidPassword(nextForm.password)) {
      alert(`Password must have ${passwordRequirements}.`)
      return
    }

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
        throw new Error(data.message || 'Registration failed.')
      }

      alert(data.message || 'Account created. Please wait for administrator approval before signing in.')
      navigate('/')
    } catch (error) {
      alert(error.message || 'Registration failed.')
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
            <img className="seal-logo small" src={barangaySeal} alt="Barangay Legaspi official seal" />
            <div>
              <h1>{t.createResidentTitle}</h1>
              <p>{t.createResidentSubtitle}</p>
              <p className="register-subtext">{t.newResidentPrompt}</p>
            </div>
          </div>

          <form className="register-form" onSubmit={handleSubmit}>
            <div className="info-strip" aria-label="Information collection notice">
              <p className="info-strip-title">{t.whyWeAskForThis}</p>
              <p>
                {language === 'fil'
                  ? 'Tanging impormasyon lamang ang kinokolekta namin upang i-verify ang iyong resident account, magtalaga ng zone, at magbigay ng serbisyo ng barangay. Opsyonal ang detalye ng household member.'
                  : 'We only collect the information needed to verify your resident account, assign your barangay zone, and provide barangay services. Household member details are optional.'}
              </p>
            </div>

            <div className="form-sections">
              <section className="form-section">
                <div className="form-section-heading">
                  <h2>1. {t.accountDetails}</h2>
                  <p>{t.usedForLogin}</p>
                </div>

                <div className="form-grid">
                  <div className="input-block">
                    <label>{t.firstNameLabel}</label>
                    <input type="text" name="firstName" value={form.firstName} onChange={handleChange} placeholder="Enter your first name" autoComplete="given-name" required />
                  </div>
                  <div className="input-block">
                    <label>{t.lastNameLabel}</label>
                    <input type="text" name="lastName" value={form.lastName} onChange={handleChange} placeholder="Enter your last name" autoComplete="family-name" required />
                  </div>
                  <div className="input-block">
                    <label>{t.mobileNumberLabel}</label>
                    <input type="text" name="mobile" value={form.mobile} onChange={handleChange} placeholder="09XXXXXXXXX" autoComplete="tel" inputMode="numeric" maxLength={11} required />
                  </div>
                  <div className="input-block">
                    <label>{t.emailAddressLabel}</label>
                    <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="name@email.com" autoComplete="email" required />
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
                    <label>{t.homeAddressLabel}</label>
                    <input type="text" name="address" value={form.address} onChange={handleChange} placeholder="House number, street, Barangay Legaspi" autoComplete="street-address" required />
                  </div>
                  <div className="input-block">
                    <label>{t.zoneLabel}</label>
                    <select name="zone" value={form.zone} onChange={handleChange} required>
                      <option value="">Select your zone</option>
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

                <div className="input-block full-width household-members-block">
                  <div className="household-members-header">
                    <div>
                      <label>{t.householdMembersLabel}</label>
                      <small>This section is optional and only helps maintain a more complete household record.</small>
                    </div>
                    <button type="button" className="secondary-btn small" onClick={addHouseholdMember}>{t.addMember}</button>
                  </div>
                  {form.householdMembers.map((member, index) => (
                    <div className="household-member-row" key={`household-member-${index}`}>
                      <input type="text" value={member.name} onChange={(event) => updateHouseholdMember(index, 'name', event.target.value)} placeholder="Full name" aria-label={`Household member ${index + 1} name`} />
                      <select value={member.relationship} onChange={(event) => updateHouseholdMember(index, 'relationship', event.target.value)} aria-label={`Household member ${index + 1} relationship`}>
                        {relationshipOptions.map((relationship) => <option key={relationship} value={relationship}>{relationship}</option>)}
                      </select>
                      <button type="button" className="small-action danger" onClick={() => removeHouseholdMember(index)} aria-label={`Remove household member ${index + 1}`}>{t.remove}</button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-heading">
                  <h2>4. {t.accountSecurity}</h2>
                  <p>{t.usedToProtect}</p>
                </div>

                <div className="form-grid">
                  <PasswordField id="registration-password" label={t.passwordLabel} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Create a strong password" helpText={`${passwordRequirements}.`} />
                </div>
              </section>
            </div>

            <p className="approval-notice">
              After registration, your account will remain pending until a barangay administrator verifies it. This helps keep
              resident records accurate and ensures only valid barangay residents receive access.
            </p>

            <div className="register-actions">
              <button type="submit" className="primary-btn wide">{t.registerAsResident}</button>
              <Link to="/" className="secondary-btn">{t.backToLogin}</Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}

function DashboardPage({ profile, requests, services, announcements, events, payments, onLogout, onProfileUpdated, language, setLanguage }) {
  const t = translations[language] || translations.en
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null)
  const announcementTriggerRef = useRef(null)
  const announcementDetailsCloseRef = useRef(null)
  const closeAnnouncementDetails = useCallback(() => setSelectedAnnouncement(null), [])
  const [editingProfile, setEditingProfile] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return localStorage.getItem(`brgy-legaspi-onboarding:${profile.email}`) !== 'complete'
    } catch {
      return true
    }
  })
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const stored = localStorage.getItem(`brgy-legaspi-notifications:${profile.email}`)
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
      complete: Boolean(profile.firstName && profile.lastName && profile.email && profile.mobile && profile.address),
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
      localStorage.setItem(`brgy-legaspi-onboarding:${profile.email}`, 'complete')
    } catch {
      // Ignore storage write issues in restricted browsing environments.
    }
  }

  const markNotificationsRead = () => {
    const nextReadIds = residentNotifications.map((notification) => notification.id)
    setReadNotificationIds(nextReadIds)
    try {
      localStorage.setItem(`brgy-legaspi-notifications:${profile.email}`, JSON.stringify(nextReadIds))
    } catch {
      // Ignore storage write issues in restricted browsing environments.
    }
  }

  const markNotificationRead = (notificationId) => {
    setReadNotificationIds((current) => {
      if (current.includes(notificationId)) return current
      const nextReadIds = [...current, notificationId]
      try {
        localStorage.setItem(`brgy-legaspi-notifications:${profile.email}`, JSON.stringify(nextReadIds))
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
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
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
                      required={['firstName', 'lastName', 'email', 'mobile'].includes(field)}
                    />
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

  const getRequestStatusMessage = (status) => {
    if (status === 'Approved') return t.requestStatusApprovedMessage
    if (status === 'Rejected') return t.requestStatusRejectedMessage
    if (status === 'Needs Information') return t.requestStatusNeedsInformationMessage
    if (status === 'In Review') return t.requestStatusInReviewMessage
    return t.requestStatusPendingMessage
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
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
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
                  <p>{getRequestStatusMessage(item.status)}</p>
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
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
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
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
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
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
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

function SettingsPage({ profile, onLogout, language, setLanguage }) {
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
  }, [])

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

  const dashboardPath = settingsProfile.role === 'admin' ? '/admin' : settingsProfile.role === 'staff' ? '/staff' : '/dashboard'

  const handlePasswordSubmit = async (event) => {
    event.preventDefault()
    if (!isValidPassword(passwordForm.newPassword)) {
      alert(`New password must have ${passwordRequirements}.`)
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
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>{settingsProfile.role === 'admin' ? t.adminPortal : settingsProfile.role === 'staff' ? t.staffPortal : t.residentPortal}</small>
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
              <dl>
                <div><dt>{t.name}</dt><dd>{settingsProfile.firstName} {settingsProfile.lastName}</dd></div>
                <div><dt>{t.email}</dt><dd>{settingsProfile.email}</dd></div>
                <div><dt>{t.mobileNumberLabel}</dt><dd>{settingsProfile.mobile}</dd></div>
              </dl>
            </div>

            <div className="info-box">
              <h3>{t.security}</h3>
              <form className="password-change-form" onSubmit={handlePasswordSubmit}>
                <PasswordField id="current-password" label={t.currentPassword} autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} />
                <PasswordField id="new-password" label={t.newPassword} value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} />
                <PasswordField id="confirm-password" label={t.confirmNewPassword} value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} helpText={`${passwordRequirements}.`} />
                <button type="submit" className="primary-btn small" disabled={savingPassword}>{savingPassword ? t.saving : t.changePassword}</button>
              </form>
            </div>

            <div className="info-box mfa-settings">
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
                <button type="button" className="primary-btn small" onClick={startMfaSetup} disabled={mfaBusy}>{mfaBusy ? t.working : t.mfaSetupAction}</button>
              )}
              {mfaMessage && <p className="mfa-message" role="status">{mfaMessage}</p>}
            </div>
          </div>

          <div className="profile-footer">
            <Link to={dashboardPath} className="secondary-btn small">{t.backToDashboard}</Link>
          </div>
        </div>
      </main>
    </div>
  )
}

function StaffPage({ staffMembers = [], announcements = [], currentUser, userRole = 'staff', onProcessRequest, onLogout, onAddStaffMember, onStaffMemberUpdated, onAddAnnouncement, onDeleteAnnouncement, onDeleteStaffMember, language, setLanguage }) {
  const t = translations[language] || translations.en
  const [activeTab, setActiveTab] = useState('queue')
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
  const [todayDate] = useState(() => new Date())
  const [requestStatusDrafts, setRequestStatusDrafts] = useState({})
  const [requestStatusNotes, setRequestStatusNotes] = useState({})
  const [selectedUser, setSelectedUser] = useState(null)
  const [staffForm, setStaffForm] = useState({
    firstName: '',
    lastName: '',
    position: 'Staff',
    availability: 'Available',
    email: '',
    mobile: '',
    password: '',
  })
  const connectedSocialAccounts = defaultSocialAccounts
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    content: '',
    tag: 'green',
    date: new Date().toLocaleDateString(),
    socialChannels: [],
  })
  const [showStaffForm, setShowStaffForm] = useState(false)
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false)
  const [archiveFiles, setArchiveFiles] = useState([])
  const [archiveError, setArchiveError] = useState('')
  const [archiveStatus, setArchiveStatus] = useState(null)
  const [archiving, setArchiving] = useState(false)
  const [activeRecordsPanel, setActiveRecordsPanel] = useState(null)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [selectedArchive, setSelectedArchive] = useState(null)
  const [confirmation, setConfirmation] = useState(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQueueSearch(queueSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [queueSearch])

  const effectiveQueueStatus = activeTab === 'approvals' ? 'Approved' : queueStatus
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
  const needsInformationCount = Number(dashboardSummary.needsInformation) || 0
  const approvedCount = Number(dashboardSummary.approved) || 0
  const totalRequests = Number(dashboardSummary.total) || 0
  const filteredQueueRequests = dashboardRequests
  const requestPages = Math.max(1, Math.ceil(dashboardTotal / queuePageSize))

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

  const loadArchiveFiles = async () => {
    try {
      const response = await fetch(`${API_BASE}/staff/archives`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.staffArchivesLoadFailed)
      if (!Array.isArray(data.archives)) throw new Error(t.staffArchivesLoadFailed)
      setArchiveFiles(data.archives)
      setArchiveError('')
    } catch (error) {
      console.error('load archive files error', error)
      setArchiveError(t.staffArchivesLoadFailed)
    }
  }

  const handleArchiveFile = async (fileName, download = false) => {
    try {
      const response = await fetch(`${API_BASE}/staff/archive-file?name=${encodeURIComponent(fileName)}`)
      if (!response.ok) throw new Error('Unable to open archive file.')
      if (download) {
        const blobUrl = URL.createObjectURL(await response.blob())
        const link = document.createElement('a')
        link.href = blobUrl
        link.download = fileName
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
      } else {
        setSelectedArchive({ name: fileName, contents: await response.json() })
      }
    } catch (error) {
      alert(error.message || 'Unable to open archive file.')
    }
  }

  useEffect(() => {
    if (activeTab === 'queue' || activeTab === 'approvals') {
      loadArchiveFiles()
    }
  }, [activeTab, t.staffArchivesLoadFailed])

  const handleArchiveQueue = async (days = 30) => {
    setArchiving(true)
    setArchiveStatus(null)
    try {
      const response = await fetch(`${API_BASE}/staff/archive-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || t.staffArchiveFailed)
      }
      setArchiveStatus(data.archive || null)
      setDashboardRefreshKey((current) => current + 1)
      await loadArchiveFiles()
    } catch (error) {
      console.error('staff archive error', error)
      throw new Error(error.message || t.staffArchiveFailed)
    } finally {
      setArchiving(false)
    }
  }

  const handleStaffSubmit = async (event) => {
    event.preventDefault()
    const firstName = sanitizeText(staffForm.firstName)
    const lastName = sanitizeText(staffForm.lastName)
    const position = sanitizeText(staffForm.position) || 'Staff'
    const email = sanitizeText(staffForm.email)
    const mobile = sanitizeText(staffForm.mobile)
    const password = sanitizeText(staffForm.password)

    if (!firstName || !lastName || !email || !mobile || !password) {
      alert('Please complete all staff member fields before saving.')
      return
    }
    if (!isValidPassword(password)) {
      alert(`Staff password must have ${passwordRequirements}.`)
      return
    }

    try {
      await onAddStaffMember?.({
        firstName,
        lastName,
        position,
        availability: staffForm.availability || 'Available',
        email,
        mobile,
        password,
        status: 'On Duty',
      })

      setStaffForm({
        firstName: '',
        lastName: '',
        position: 'Staff',
        availability: 'Available',
        email: '',
        mobile: '',
        password: '',
      })
      setShowStaffForm(false)
    } catch (error) {
      alert(error.message || 'Unable to add staff member.')
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
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>{t.staffPortal}</small>
          </div>
        </div>

        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <Link to="/settings" className="secondary-btn small">{t.settings}</Link>
          <span className="role-chip">{getDisplayName(currentUser)} • {getStaffPositionLabel(currentUser?.position || (userRole === 'admin' ? t.administrator : 'Staff'), t)}</span>
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="dashboard-main">
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
            <button
              type="button"
              className={`nav-item ${activeTab === 'approvals' ? 'active' : ''}`}
              aria-current={activeTab === 'approvals' ? 'page' : undefined}
              onClick={() => { setActiveTab('approvals'); setOpenRequestPanel('approvals'); setQueuePage(1) }}
            >
              <span className="nav-icon">✓</span><span>{t.approvals}</span>
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
              <span className="nav-icon">👥</span><span>{t.staffDirectory}</span>
            </button>
          </nav>
        </aside>

        <section className="content-panel" aria-label={t.staffOverviewLabel}>
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{t.operations}</p>
              <h1>{activeTab === 'queue' ? t.staffDashboardTitle : activeTab === 'reports' ? t.serviceReports : activeTab === 'announcements' ? t.announcements : activeTab === 'staff' ? t.staffDirectory : t.approvalsManagement}</h1>
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
            ) : <span className="counter-pill">{activeTab === 'approvals' ? approvedCount : totalRequests} {activeTab === 'approvals' ? t.processed : t.requests}</span>}
          </div>

          <div className="stats-grid staff-dashboard-metrics" aria-label={t.staffSummaryLabel}>
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
          </div>

          <div className="dashboard-body">
            <div className="main-column">
              {activeTab === 'queue' && (
                <>
                <section className="panel-card needs-attention" aria-labelledby="needs-attention-title">
                  <div className="panel-header left-align">
                    <h2 id="needs-attention-title">{t.needsAttention}</h2>
                  </div>
                  <div className="attention-items">
                    {pendingCount > 0 && (
                      <button type="button" onClick={() => setQueueFilter('Pending')}>
                        <strong>{pendingCount}</strong><span>{t.pendingReviewMetric}</span><small>{t.pendingAttentionDescription}</small>
                      </button>
                    )}
                    {inReviewCount > 0 && (
                      <button type="button" onClick={() => setQueueFilter('In Review')}>
                        <strong>{inReviewCount}</strong><span>{t.inProcessingMetric}</span><small>{t.reviewAttentionDescription}</small>
                      </button>
                    )}
                    {needsInformationCount > 0 && (
                      <button type="button" onClick={() => setQueueFilter('Needs Information')}>
                        <strong>{needsInformationCount}</strong><span>{t.statusNeedsInformation}</span><small>{t.informationAttentionDescription}</small>
                      </button>
                    )}
                    {!dashboardLoading && !dashboardError && pendingCount + inReviewCount + needsInformationCount === 0 && (
                      <p className="attention-empty">{t.attentionEmpty}</p>
                    )}
                  </div>
                  <p className="workflow-limit-notice">{t.noReleaseOrDeadlineTracking}</p>
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
                  <div className="staff-queue-filters">
                    <input type="search" value={queueSearch} onChange={(event) => { setQueueSearch(event.target.value); setQueuePage(1) }} placeholder={t.requestQueueSearch} aria-label={t.requestQueueSearch} />
                    <select value={queueStatus} onChange={(event) => { setQueueStatus(event.target.value); setQueuePage(1) }} aria-label={t.requestStatusFilter}>
                      <option value="active">{t.activeQueue}</option>
                      <option value="all">{t.allStatuses}</option>
                      <option value="Pending">{t.pending}</option>
                      <option value="In Review">{t.statusUnderReview}</option>
                      <option value="Needs Information">{t.statusNeedsInformation}</option>
                      <option value="Approved">{t.approved}</option>
                      <option value="Rejected">{t.statusRejected}</option>
                    </select>
                    <select value={queueType} onChange={(event) => { setQueueType(event.target.value); setQueuePage(1) }} aria-label={t.documentTypeFilter}>
                      <option value="all">{t.allDocumentTypes}</option>
                      {dashboardDocumentTypes.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    <select value={queueZone} onChange={(event) => { setQueueZone(event.target.value); setQueuePage(1) }} aria-label={t.requestZoneFilter}>
                      <option value="all">{t.allZonesLabel}</option>
                      {[1, 2, 3, 4, 5, 6, 7].map((zone) => <option key={zone} value={String(zone)}>Zone {zone}</option>)}
                    </select>
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
                          <th>{t.purpose}</th>
                          <th>{t.status}</th>
                          <th>{t.deliveryMethodLabel}</th>
                          <th>{t.latestFollowUp}</th>
                          <th>{t.requestStatusHistory}</th>
                          <th>{t.priority}</th>
                          <th>{t.actionsLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredQueueRequests.map((item) => (
                          <tr key={item.id}>
                            <td><button type="button" className="request-id-button" aria-label={t.viewRequestDetails.replace('{id}', String(item.id))} onClick={() => setSelectedRequest(item)}>{item.id}</button></td>
                            <td>{item.first_name || item.firstName || t.resident} {item.last_name || item.lastName || ''}</td>
                            <td>{item.type}</td>
                            <td>{formatRequestDate(item.date || item.createdAt || item.created_at)}</td>
                            <td>{item.purpose}</td>
                            <td><span className={`status-badge ${(item.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{getRequestStatusLabel(item.status, t)}</span></td>
                            <td>
                              {item.deliveryMethod === 'physical' || item.delivery_method === 'physical' ? t.physicalCopy : t.onlineCopy}
                              {(item.deliveryNote || item.delivery_note) && <small className="request-staff-note">{item.deliveryNote || item.delivery_note}</small>}
                            </td>
                            <td>{(item.followUps || item.follow_ups || []).slice(-1)[0]?.message || '—'}</td>
                            <td><details className="request-history-details"><summary>{t.requestStatusHistory}</summary><RequestHistory history={item.statusHistory || item.status_history} t={t} /></details></td>
                            <td><span className={`priority-badge ${item.type === 'Emergency Help' ? 'urgent' : 'normal'}`}>{item.type === 'Emergency Help' ? t.urgentLabel : t.normalLabel}</span></td>
                            <td>
                              {['Approved', 'Rejected'].includes(item.status)
                                ? <span>{getRequestStatusLabel(item.status, t)}</span>
                                : <button type="button" className="small-action success" onClick={() => setSelectedRequest(item)}>{t.requestStatusAction}</button>}
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
                <article className="panel-card">
                  <button
                    type="button"
                    className="collapsible-panel-header"
                    aria-expanded={openRequestPanel === 'approvals'}
                    onClick={() => setOpenRequestPanel((current) => current === 'approvals' ? null : 'approvals')}
                  >
                    <span>
                      <h2>{t.approvedRequests}</h2>
                      <span className="soft-label">{approvedCount} {t.approved}</span>
                    </span>
                    <span className={`collapse-chevron ${openRequestPanel === 'approvals' ? 'open' : ''}`}>▾</span>
                  </button>

                  {openRequestPanel === 'approvals' && <div className="request-table-wrap">
                    <table className="request-table">
                      <thead>
                        <tr>
                          <th>{t.resident}</th>
                          <th>{t.requestType}</th>
                          <th>{t.purpose}</th>
                          <th>{t.status}</th>
                          <th>{t.submissionDate}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardRequests.map((item) => (
                          <tr key={item.id}>
                            <td>{item.first_name || item.firstName || t.resident} {item.last_name || item.lastName || ''}</td>
                            <td>{item.type}</td>
                            <td>{item.purpose}</td>
                            <td><span className={`status-badge approved`}>{getRequestStatusLabel(item.status, t)}</span></td>
                            <td><span className="soft-label">{formatRequestDate(item.date || item.createdAt || item.created_at)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {dashboardLoading && <p className="request-dashboard-loading" role="status">{t.loadingRequests}</p>}
                    {!dashboardLoading && !dashboardError && dashboardRequests.length === 0 && <div className="empty-state">{t.approvalsEmpty}</div>}
                  </div>}
                  {dashboardError && <div className="request-dashboard-error" role="alert">
                    <span>{dashboardError}</span>
                    <button type="button" className="secondary-btn small" onClick={() => setDashboardRefreshKey((current) => current + 1)}>{t.retry}</button>
                  </div>}
                  {openRequestPanel === 'approvals' && <div className="request-pagination">
                    <span>{t.pageOfPages.replace('{page}', String(queuePage)).replace('{pages}', String(requestPages))} · {dashboardTotal}</span>
                    <div>
                      <button type="button" className="secondary-btn small" disabled={dashboardLoading || queuePage <= 1} onClick={() => setQueuePage((page) => Math.max(1, page - 1))}>{t.previousPage}</button>
                      <button type="button" className="secondary-btn small" disabled={dashboardLoading || queuePage >= requestPages} onClick={() => setQueuePage((page) => Math.min(requestPages, page + 1))}>{t.nextPage}</button>
                    </div>
                  </div>}

                </article>
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
                        <article className="stat-card report-summary-card unavailable">
                          <span className="label">{t.reportOverdue}</span>
                          <span className="stat-number">{t.reportNotTracked}</span>
                          <span className="staff-metric-description">{t.deadlinesNotTracked}</span>
                        </article>
                      </div>

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
                    <WorkflowModal title={t.publishAnnouncement} onClose={() => setShowAnnouncementForm(false)} wide>
                    <form className="editor-panel workflow-modal-form" onSubmit={handleAnnouncementSubmit}>
                    <div className="editor-grid">
                      <div className="input-block full-width">
                        <label>Title</label>
                        <input type="text" value={announcementForm.title} onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="e.g. Barangay Day celebration" />
                      </div>
                      <div className="input-block">
                        <label>Date</label>
                        <input type="text" value={announcementForm.date} onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, date: event.target.value }))} placeholder="June 25 • 8:00 AM" />
                      </div>
                      <div className="input-block">
                        <label>Priority</label>
                        <select value={announcementForm.tag} onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, tag: event.target.value }))}>
                          <option value="green">General</option>
                          <option value="blue">Information</option>
                          <option value="amber">Important</option>
                          <option value="red">Emergency</option>
                        </select>
                      </div>
                      <div className="input-block full-width">
                        <label>Message</label>
                        <textarea rows="4" value={announcementForm.content} onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, content: event.target.value }))} placeholder="Write the key message for residents and staff." />
                      </div>
                      <div className="input-block full-width">
                        <label>{t.socialMediaIntegration}</label>
                        <div className="social-account-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '8px' }}>
                          {connectedSocialAccounts.map((account) => {
                            const isSelected = (announcementForm.socialChannels || []).includes(account.key)
                            return (
                              <label key={account.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: '1px solid #d7dfe3', borderRadius: '999px', background: isSelected ? '#eafaf3' : '#f7f9fa', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleAnnouncementChannel(account.key)}
                                />
                                <span>{account.label}</span>
                                <small style={{ color: account.connected ? '#0e7a5d' : '#7a7f85' }}>{account.connected ? t.connected : t.connectLater}</small>
                              </label>
                            )
                          })}
                        </div>
                        <small className="request-staff-note">{t.socialIntegrationPending}</small>
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
                        </div>
                        <button
                          type="button"
                          className="small-action danger"
                          onClick={() => setConfirmation({
                            title: t.delete,
                            message: t.deleteAnnouncementConfirm,
                            confirmLabel: t.delete,
                            onConfirm: () => onDeleteAnnouncement?.(item.id || item.title),
                          })}
                        >
                          {t.delete}
                        </button>
                      </div>
                    ))}
                  </div>
                </article>
              )}

              {activeTab === 'staff' && (
                <article className="panel-card">
                  <div className="panel-header">
                    <h2>{t.staffDirectory}</h2>
                    <span className="soft-label">{staffMembers.length} {t.staffMembersAvailable}</span>
                    {userRole === 'admin' && <button type="button" className="primary-btn small" onClick={() => setShowStaffForm(true)}>{t.addStaffMember}</button>}
                  </div>

                  {showStaffForm && (
                    <WorkflowModal title={t.addStaffMember} onClose={() => setShowStaffForm(false)} wide>
                    <form className="editor-panel workflow-modal-form" onSubmit={handleStaffSubmit}>
                    <div className="editor-grid">
                      <div className="input-block">
                        <label>{t.firstName}</label>
                        <input type="text" value={staffForm.firstName} onChange={(event) => setStaffForm((prev) => ({ ...prev, firstName: event.target.value }))} placeholder={t.firstName} />
                      </div>
                      <div className="input-block">
                        <label>{t.lastName}</label>
                        <input type="text" value={staffForm.lastName} onChange={(event) => setStaffForm((prev) => ({ ...prev, lastName: event.target.value }))} placeholder={t.lastName} />
                      </div>
                      <div className="input-block">
                        <label>{t.positionLabel}</label>
                        <select value={staffForm.position} onChange={(event) => setStaffForm((prev) => ({ ...prev, position: event.target.value }))}>
                          <option value="Staff">{t.staffRole}</option>
                          <option value="Secretary">{t.secretaryRole}</option>
                          <option value="Barangay Captain">{t.barangayCaptainRole}</option>
                          <option value="Treasurer">{t.treasurerRole}</option>
                          <option value="Utility Worker">{t.utilityWorkerRole}</option>
                        </select>
                      </div>
                      <div className="input-block">
                        <label>{t.availabilityLabel}</label>
                        <select value={staffForm.availability} onChange={(event) => setStaffForm((prev) => ({ ...prev, availability: event.target.value }))}>
                          <option value="Available">{t.availableLabel}</option>
                          <option value="Busy">{t.busyStatus}</option>
                          <option value="On Duty">{t.onDutyStatus}</option>
                        </select>
                      </div>
                      <div className="input-block">
                        <label>{t.email}</label>
                        <input type="email" value={staffForm.email} onChange={(event) => setStaffForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="name@barangay.gov.ph" />
                      </div>
                      <div className="input-block">
                        <label htmlFor="staff-member-mobile">{t.mobileNumberLabel}</label>
                        <input id="staff-member-mobile" type="tel" inputMode="tel" value={staffForm.mobile} onChange={(event) => setStaffForm((prev) => ({ ...prev, mobile: event.target.value }))} placeholder="09XXXXXXXXX" />
                      </div>
                      <PasswordField id="staff-initial-password" label={t.initialPassword} value={staffForm.password} onChange={(event) => setStaffForm((prev) => ({ ...prev, password: event.target.value }))} placeholder={t.staffPasswordPlaceholder} helpText={`${passwordRequirements}.`} />
                    </div>
                    <div className="editor-actions">
                      <button type="button" className="secondary-btn small" onClick={() => setShowStaffForm(false)}>{t.cancel}</button>
                      <button type="submit" className="primary-btn small">{t.addStaffMember}</button>
                    </div>
                    </form>
                    </WorkflowModal>
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
                        {userRole === 'admin' && (
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
                  </div>
                </article>
              )}
            </div>

            <aside className="side-column">
              <article className="panel-card stack-card records-panel">
                <div className="panel-header left-align">
                  <h2>{t.records}</h2>
                </div>

                <div className="records-stack">
                  <button
                    type="button"
                    className={`record-panel-card ${activeRecordsPanel === 'queue' ? 'selected' : ''}`}
                    onClick={() => setActiveRecordsPanel((prev) => prev === 'queue' ? null : 'queue')}
                  >
                    <span className="record-panel-title">{t.requestsInQueue}</span>
                    <span className="record-panel-counts">
                      <span>{t.pending} <strong>{pendingCount}</strong></span>
                      <span>{t.approved} <strong>{approvedCount}</strong></span>
                    </span>
                  </button>

                  {activeRecordsPanel === 'queue' && (
                    <div className="record-dedicated-space">
                      <div className="record-details record-details-compact">
                        <div className="record-section">
                          <h4>Queue</h4>
                          <ul>
                            {dashboardRequests.slice(0, 6).map((item) => (
                              <li key={item.id}><span>{item.type}</span><strong>{getRequestStatusLabel(item.status, t)}</strong></li>
                            ))}
                            {totalRequests > 6 && <li className="summary-item">+ {totalRequests - 6} {t.moreRequestsWaiting}</li>}
                            {totalRequests === 0 && <li className="summary-item">{t.queueEmpty}</li>}
                          </ul>
                        </div>

                        <div className="record-section">
                          <h4>{t.approvals}</h4>
                          <p>{approvedCount} {t.approvedRequests.toLowerCase()}</p>
                          <button className="secondary-btn small" type="button" onClick={() => { setActiveTab('approvals'); setOpenRequestPanel('approvals'); setQueuePage(1) }}>{t.approvedRequests}</button>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className={`record-panel-card ${activeRecordsPanel === 'archive' ? 'selected' : ''}`}
                    onClick={() => setActiveRecordsPanel((prev) => prev === 'archive' ? null : 'archive')}
                  >
                    <span className="record-panel-title">{t.archiveQueueApprovals}</span>
                    <span className="record-panel-count">{archiveError ? '—' : archiveFiles.length}</span>
                  </button>

                  {activeRecordsPanel === 'archive' && (
                    <div className="record-dedicated-space">
                      <div className="record-details archive-record-details">
                        {archiveStatus && (
                          <p className="archive-note">{t.archiveSummary.replace('{count}', String(archiveStatus.count || 0)).replace('{date}', new Date(archiveStatus.archivedAt || Date.now()).toLocaleDateString(language === 'fil' ? 'fil-PH' : 'en-PH'))}</p>
                        )}
                        <div className="archive-inline-actions">
                          <button type="button" className="secondary-btn small" onClick={() => setConfirmation({
                            title: t.processedArchiveConfirmTitle,
                            message: t.processedArchiveOlderMessage,
                            confirmLabel: t.archiveOlderThan30Days,
                            onConfirm: () => handleArchiveQueue(30),
                          })} disabled={archiving}>{t.archiveOlderThan30Days}</button>
                          <button type="button" className="primary-btn small" onClick={() => setConfirmation({
                            title: t.processedArchiveConfirmTitle,
                            message: t.processedArchiveAllMessage,
                            confirmLabel: t.archiveAllProcessed,
                            onConfirm: () => handleArchiveQueue(0),
                          })} disabled={archiving}>{t.archiveAllProcessed}</button>
                        </div>
                        {archiveError && (
                          <div className="request-dashboard-error" role="alert">
                            <span>{archiveError}</span>
                            <button type="button" className="secondary-btn small" onClick={loadArchiveFiles}>{t.retry}</button>
                          </div>
                        )}
                        {!archiveError && <div className="archive-list">
                          {archiveFiles.length > 0 ? archiveFiles.map((file) => (
                            <div key={file.name} className="archive-item">
                              <div className="archive-main">
                                <strong>{file.name}</strong>
                                <span className="archive-meta">{new Date(file.mtime).toLocaleDateString()} • {(file.size / 1024).toFixed(1)} KB</span>
                              </div>
                              <div className="archive-actions">
                                  <button type="button" className="small-action secondary" onClick={() => handleArchiveFile(file.name)}>View</button>
                                  <button type="button" className="small-action success" onClick={() => handleArchiveFile(file.name, true)}>Download</button>
                              </div>
                            </div>
                          )) : (
                            <p className="soft-label">{t.noArchivedQueueRecords}</p>
                          )}
                        </div>}
                      </div>
                    </div>
                  )}
                </div>
              </article>

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
              <div><dt>{t.status}</dt><dd>{getRequestStatusLabel(selectedRequest.status, t)}</dd></div>
              <div><dt>{t.purpose}</dt><dd>{selectedRequest.purpose || '—'}</dd></div>
              {(selectedRequest.notes || selectedRequest.deliveryNote || selectedRequest.delivery_note) && (
                <div><dt>{t.notesLabel}</dt><dd>{selectedRequest.notes || selectedRequest.deliveryNote || selectedRequest.delivery_note}</dd></div>
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
      {selectedArchive && (
        <WorkflowModal title={selectedArchive.name} onClose={() => setSelectedArchive(null)} wide>
          <pre className="archive-preview">{JSON.stringify(selectedArchive.contents, null, 2)}</pre>
        </WorkflowModal>
      )}
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} allowEdit={userRole === 'admin'} onUserUpdated={(updated) => {
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

function AdminPage({ users, residents = [], requests, reports = [], currentUser, onLogout, language, setLanguage }) {
  const t = translations[language] || translations.en
  const zoneNumbers = [1, 2, 3, 4, 5, 6, 7]
  const [managedUsers, setManagedUsers] = useState(users)
  const [activeTab, setActiveTab] = useState('overview')
  const [healthRefreshKey, setHealthRefreshKey] = useState(0)
  const [apiHealth, setApiHealth] = useState({ status: 'checking', storage: null, checkedAt: null })
  const [searchQuery, setSearchQuery] = useState('')
  const [accessSearch, setAccessSearch] = useState('')
  const [adminForm, setAdminForm] = useState({ firstName: '', lastName: '', email: '', mobile: '', password: '' })
  const [showAdminForm, setShowAdminForm] = useState(false)
  const [staffForm, setStaffForm] = useState({
    firstName: '',
    lastName: '',
    position: 'Staff',
    availability: 'Available',
    email: '',
    mobile: '',
    password: '',
  })
  const [showStaffForm, setShowStaffForm] = useState(false)
  const [creatingStaff, setCreatingStaff] = useState(false)
  const [staffPasswordResetTarget, setStaffPasswordResetTarget] = useState(null)
  const [staffPasswordResetForm, setStaffPasswordResetForm] = useState({ password: '', confirmPassword: '' })
  const [resettingStaffPassword, setResettingStaffPassword] = useState(false)
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
  const pending = requests.filter((item) => ['Pending', 'In Review', 'Needs Information'].includes(item.status)).length
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
    pending > 0 && `${pending} service request${pending === 1 ? '' : 's'} need review`,
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

  const handleCreateAdmin = async (event) => {
    event.preventDefault()
    if (!isValidPassword(adminForm.password)) {
      alert(`Administrator password must have ${passwordRequirements}.`)
      return
    }
    try {
      const response = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminForm),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to create administrator.')
      setManagedUsers((current) => [data.user, ...current])
      setAdminForm({ firstName: '', lastName: '', email: '', mobile: '', password: '' })
      setShowAdminForm(false)
      alert('Administrator account created. Share the initial password securely and ask them to change it after signing in.')
    } catch (error) {
      alert(error.message || 'Unable to create administrator.')
    }
  }

  const handleCreateStaff = async (event) => {
    event.preventDefault()
    if (!isValidPassword(staffForm.password)) {
      alert(`${t.staffInitialPassword} must have ${passwordRequirements}.`)
      return
    }

    setCreatingStaff(true)
    try {
      const response = await fetch(`${API_BASE}/staff/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...staffForm,
          status: 'On Duty',
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t.staffCreateFailed)

      setManagedUsers((current) => [data.staffMember, ...current])
      setStaffForm({
        firstName: '',
        lastName: '',
        position: 'Staff',
        availability: 'Available',
        email: '',
        mobile: '',
        password: '',
      })
      setShowStaffForm(false)
      alert(t.staffCreatedNotice)
    } catch (error) {
      alert(error.message || t.staffCreateFailed)
    } finally {
      setCreatingStaff(false)
    }
  }

  const handleResetStaffPassword = async (event) => {
    event.preventDefault()
    if (!isValidPassword(staffPasswordResetForm.password)) {
      alert(`${t.newPassword} must have ${passwordRequirements}.`)
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
    <div className="dashboard-shell">
      <header className="dashboard-topbar admin-topbar">
        <div className="brand-wrap">
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>{t.adminPortal}</small>
          </div>
        </div>

        <div className="topbar-actions">
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <Link to="/settings" className="secondary-btn small">{t.settings}</Link>
          <div className="admin-identity" aria-label={`${t.signedInAs} ${getDisplayName(currentUser)}`}>
            <small>{t.signedInAs}</small>
            <strong>{getDisplayName(currentUser)}</strong>
            <span>{currentUser?.email || currentUser?.mobile || t.administrator}</span>
          </div>
          <span className="role-chip">{t.adminConsole}</span>
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <main className="dashboard-main">
        <aside className="sidebar" aria-label={t.adminNavigationLabel}>
          <nav className="sidebar-nav">
            <button
              type="button"
              className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
              aria-current={activeTab === 'overview' ? 'page' : undefined}
              onClick={() => setActiveTab('overview')}
            >
              <span className="nav-icon">🧭</span><span>{t.overview}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'residents' ? 'active' : ''}`}
              aria-current={activeTab === 'residents' ? 'page' : undefined}
              onClick={() => setActiveTab('residents')}
            >
              <span className="nav-icon">👥</span><span>{t.residents}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'access' ? 'active' : ''}`}
              aria-current={activeTab === 'access' ? 'page' : undefined}
              onClick={() => setActiveTab('access')}
            >
              <span className="nav-icon">🔐</span><span>{t.access}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'emergencies' ? 'active' : ''}`}
              aria-current={activeTab === 'emergencies' ? 'page' : undefined}
              onClick={() => setActiveTab('emergencies')}
            >
              <span className="nav-icon">🚨</span><span>{t.emergencies}</span>
            </button>
          </nav>
        </aside>

        <section className="content-panel" aria-label={t.adminOverviewLabel}>
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{t.governance}</p>
              <h1>{activeTab === 'overview' ? t.adminConsoleTitle : activeTab === 'residents' ? t.residentsByZone : activeTab === 'access' ? t.userAccessManagement : t.emergencyReportsTitle}</h1>
            </div>
            <span className="counter-pill">{pending} {t.pending}</span>
          </div>

          <div className="stats-grid" aria-label={t.adminSummaryLabel}>
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

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">{t.pending}</span>
              </div>
              <div className="stat-number">{pending}</div>
              <p>{t.serviceRequests}</p>
            </article>
          </div>

          <div className="dashboard-body">
            <div className="main-column">
              {activeTab === 'overview' && <CaptainPhotoSettings language={language} />}
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
                      <small>{pending} {t.pendingReview}</small>
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
                      <span className="soft-label">{pending} {t.pendingReview}</span>
                    </div>
                    <div className="overview-grid admin-metric-grid">
                      <div className="overview-item"><h4>{t.pending}</h4><p className="overview-value">{pending}</p><small>{t.awaitingStaffAction}</small></div>
                      <div className="overview-item"><h4>{t.approved}</h4><p className="overview-value">{requests.filter((item) => item.status === 'Approved').length}</p><small>{t.approvals}</small></div>
                      <div className="overview-item"><h4>{t.rejected || 'Rejected'}</h4><p className="overview-value">{requests.filter((item) => item.status === 'Rejected').length}</p><small>{t.declinedRequests}</small></div>
                      <div className="overview-item"><h4>{t.approvedResidents || 'Approved residents'}</h4><p className="overview-value">{approvedUsers}</p><small>{t.verifiedAccounts}</small></div>
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
                                  <span className="zone-sort-label">Sort by</span>
                                  <select
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
                    <span className="soft-label">{managedUsers.length} total users</span>
                    <div className="editor-actions">
                      <button type="button" className="secondary-btn small" onClick={() => setShowStaffForm(true)}>{t.addStaffMember}</button>
                      <button type="button" className="primary-btn small" onClick={() => setShowAdminForm(true)}>Create Administrator</button>
                    </div>
                  </div>

                  {showStaffForm && (
                    <WorkflowModal title={t.addStaffMember} onClose={() => setShowStaffForm(false)} wide>
                      <form className="editor-panel workflow-modal-form" onSubmit={handleCreateStaff}>
                        <div className="panel-header left-align">
                          <h3>{t.createStaffAccount}</h3>
                          <span className="soft-label">{t.staffRole}</span>
                        </div>
                        <div className="editor-grid">
                          <div className="input-block">
                            <label htmlFor="admin-staff-first-name">{t.firstName}</label>
                            <input id="admin-staff-first-name" value={staffForm.firstName} onChange={(event) => setStaffForm((current) => ({ ...current, firstName: event.target.value }))} required />
                          </div>
                          <div className="input-block">
                            <label htmlFor="admin-staff-last-name">{t.lastName}</label>
                            <input id="admin-staff-last-name" value={staffForm.lastName} onChange={(event) => setStaffForm((current) => ({ ...current, lastName: event.target.value }))} required />
                          </div>
                          <div className="input-block">
                            <label htmlFor="admin-staff-position">{t.positionLabel}</label>
                            <select id="admin-staff-position" value={staffForm.position} onChange={(event) => setStaffForm((current) => ({ ...current, position: event.target.value }))}>
                              <option value="Staff">{t.staffRole}</option>
                              <option value="Secretary">{t.secretaryRole}</option>
                              <option value="Barangay Captain">{t.barangayCaptainRole}</option>
                              <option value="Treasurer">{t.treasurerRole}</option>
                              <option value="Utility Worker">{t.utilityWorkerRole}</option>
                            </select>
                          </div>
                          <div className="input-block">
                            <label htmlFor="admin-staff-availability">{t.availabilityLabel}</label>
                            <select id="admin-staff-availability" value={staffForm.availability} onChange={(event) => setStaffForm((current) => ({ ...current, availability: event.target.value }))}>
                              <option value="Available">{t.availableLabel}</option>
                              <option value="Busy">{t.busyStatus}</option>
                              <option value="On Duty">{t.onDutyStatus}</option>
                            </select>
                          </div>
                          <div className="input-block">
                            <label htmlFor="admin-staff-email">{t.email}</label>
                            <input id="admin-staff-email" type="email" value={staffForm.email} onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))} required />
                          </div>
                          <div className="input-block">
                            <label htmlFor="admin-staff-mobile">{t.mobileNumberLabel}</label>
                            <input id="admin-staff-mobile" type="tel" inputMode="tel" value={staffForm.mobile} onChange={(event) => setStaffForm((current) => ({ ...current, mobile: event.target.value }))} placeholder="09XXXXXXXXX" required />
                          </div>
                          <PasswordField id="admin-staff-initial-password" label={t.staffInitialPassword} value={staffForm.password} onChange={(event) => setStaffForm((current) => ({ ...current, password: event.target.value }))} placeholder={t.staffPasswordPlaceholder} helpText={`${passwordRequirements}.`} />
                        </div>
                        <div className="editor-actions">
                          <button type="button" className="secondary-btn small" onClick={() => setShowStaffForm(false)} disabled={creatingStaff}>{t.cancel}</button>
                          <button type="submit" className="primary-btn small" disabled={creatingStaff}>{creatingStaff ? t.working : t.createStaffAccount}</button>
                        </div>
                      </form>
                    </WorkflowModal>
                  )}

                  {showAdminForm && (
                    <WorkflowModal title="Create Administrator" onClose={() => setShowAdminForm(false)} wide>
                      <form className="editor-panel admin-create-panel workflow-modal-form" onSubmit={handleCreateAdmin}>
                        <div className="panel-header left-align">
                          <h3>Create Administrator</h3>
                          <span className="soft-label">{t.adminOnly}</span>
                        </div>
                        <div className="editor-grid">
                          <input aria-label="Administrator first name" placeholder="First name" value={adminForm.firstName} onChange={(event) => setAdminForm((current) => ({ ...current, firstName: event.target.value }))} required />
                          <input aria-label="Administrator last name" placeholder="Last name" value={adminForm.lastName} onChange={(event) => setAdminForm((current) => ({ ...current, lastName: event.target.value }))} required />
                          <input aria-label="Administrator email" type="email" placeholder="Email" value={adminForm.email} onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))} required />
                          <input aria-label="Administrator mobile" placeholder="09XXXXXXXXX" value={adminForm.mobile} onChange={(event) => setAdminForm((current) => ({ ...current, mobile: event.target.value }))} required />
                          <PasswordField id="admin-initial-password" label="Administrator initial password" value={adminForm.password} onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))} placeholder="Initial password" helpText={null} />
                        </div>
                        <small>{passwordRequirements}.</small>
                        <div className="editor-actions">
                          <button type="button" className="secondary-btn small" onClick={() => setShowAdminForm(false)}>{t.cancel}</button>
                          <button type="submit" className="primary-btn small">Create Administrator</button>
                        </div>
                      </form>
                    </WorkflowModal>
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
                            value={staffPasswordResetForm.password}
                            onChange={(event) => setStaffPasswordResetForm((current) => ({ ...current, password: event.target.value }))}
                            helpText={`${passwordRequirements}.`}
                          />
                          <PasswordField
                            id="admin-staff-reset-password-confirm"
                            label={t.confirmNewPassword}
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
                                <span className="zone-sort-label">Sort by</span>
                                <select
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
  const hasBottomNavigation = ['staff', 'admin'].includes(userRole)
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [quickOptionsMinimized, setQuickOptionsMinimized] = useState(false)
  const [residencyCheck, setResidencyCheck] = useState(isHomepage ? 'asked' : 'confirmed')
  const triggerRef = useRef(null)
  const questionInputRef = useRef(null)
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
    if (open) {
      questionInputRef.current?.focus()
    } else {
      triggerRef.current?.focus()
    }

    return () => {
      window.removeEventListener('brgy-open-mau', openAssistant)
      document.removeEventListener('keydown', closeOnEscape)
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
        className={`mau-launcher ${hasBottomNavigation ? 'with-bottom-nav' : ''} ${mobileDashboard ? 'resident-mobile-dashboard' : ''}`}
        onClick={(event) => {
          if (!open) triggerRef.current = event.currentTarget
          setOpen((current) => !current)
        }}
        aria-label={t.mauOpenLabel}
        aria-expanded={open}
        aria-controls="mau-assistant-dialog"
      >
        <span className="mau-launcher-badge" aria-hidden="true">
          <img src={barangaySeal} alt="" />
        </span>
        <span>Mau</span>
      </button>

      {open && (
        <div
          id="mau-assistant-dialog"
          className={`mau-assistant ${hasBottomNavigation ? 'with-bottom-nav' : ''}`}
          role="dialog"
          aria-labelledby="mau-dialog-title"
        >
          <div className="mau-header">
            <div className="mau-avatar" aria-hidden="true">
              <img src={barangaySeal} alt="" />
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
  const [session, setSession] = useState(() => readStoredSession())
  const [reminderAlerts, setReminderAlerts] = useState([])

  const isAuthenticated = Boolean(session?.isActive)
  const userRole = session?.user?.role || session?.role || 'resident'
  const t = translations[language] || translations.en

  useEffect(() => {
    try {
      localStorage.setItem('brgy-legaspi-language', language)
    } catch {
      // Ignore storage write issues in restricted browsing environments.
    }
  }, [language])

  useEffect(() => {
    document.documentElement.lang = language
    const portalLabel = userRole === 'admin' ? t.adminPortal : userRole === 'staff' ? t.staffPortal : t.residentPortal
    document.title = `${t.barangayLegaspi} - ${portalLabel}`
  }, [language, userRole, t.adminPortal, t.barangayLegaspi, t.residentPortal, t.staffPortal])

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
    if (!isAuthenticated || userRole !== 'staff' || !session?.token) return undefined

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
  }, [isAuthenticated, userRole, session?.token])

  useEffect(() => {
    const loadUserData = async () => {
      if (!session?.token) return

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
        if (['staff', 'admin'].includes(userRole)) {
          try {
            const [staffRequestsResp, staffMembersResp, announcementsResp] = await Promise.all([
              userRole === 'admin' ? fetch(`${API_BASE}/staff/requests`) : Promise.resolve(null),
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

        if (userRole === 'admin') {
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
  }, [session?.token, userRole])

  const handleLogin = (newSession) => {
    const nextSession = { ...newSession, isActive: true }
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

  const handleAddStaffMember = async (member) => {
    try {
      const response = await fetch(`${API_BASE}/staff/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: member.firstName,
          lastName: member.lastName,
          position: member.position,
          availability: member.availability,
          email: member.email,
          mobile: member.mobile,
          password: member.password,
          status: member.status || 'On Duty',
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Unable to add staff member.')
      }

      const nextMember = data.staffMember || data.member || {
        ...member,
        id: `staff-${Date.now()}`,
      }
      setStaffMembers((prev) => {
        const existing = prev.some((item) => item.id === nextMember.id)
        return existing ? prev.map((item) => (item.id === nextMember.id ? nextMember : item)) : [nextMember, ...prev]
      })
    } catch (error) {
      throw new Error(error.message || 'Unable to add staff member.')
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
    } catch (error) {
      alert(error.message || 'Unable to delete announcement.')
    }
  }

  return (
    <>
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
        <Route path="/" element={isAuthenticated ? <Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace /> : <LoginPage onLogin={handleLogin} language={language} setLanguage={switchLanguage} />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace /> : <RegisterPage language={language} setLanguage={switchLanguage} />} />
        <Route path="/dashboard" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><DashboardPage profile={profile} requests={requests} services={services} announcements={announcementsData} events={events} payments={payments} onLogout={handleLogout} onProfileUpdated={setProfile} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/requests" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><RequestsPage requests={requests} onSubmit={handleRequestSubmit} onRequestUpdated={handleRequestUpdated} onLogout={handleLogout} language={language} setLanguage={switchLanguage} userId={session?.user?.id} /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><ProfilePage profile={profile} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/payments" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><PaymentsPage payments={payments} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/events" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><EventsPage events={events} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident', 'staff', 'admin']} userRole={userRole}><SettingsPage profile={profile} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/staff" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['staff', 'admin']} userRole={userRole}><StaffPage staffMembers={staffMembers} announcements={announcementsData} currentUser={session?.user} userRole={userRole} onProcessRequest={handleRequestStatus} onLogout={handleLogout} onAddStaffMember={handleAddStaffMember} onStaffMemberUpdated={handleStaffMemberUpdated} onAddAnnouncement={handleAddAnnouncement} onDeleteAnnouncement={handleDeleteAnnouncement} onDeleteStaffMember={handleDeleteStaffMember} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['admin']} userRole={userRole}><AdminPage users={users} residents={residents} requests={requests} reports={reports} currentUser={session?.user} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace />} />
      </Routes>
      <MauAssistant language={language} userRole={userRole} isAuthenticated={isAuthenticated} pathname={location.pathname} mobileDashboard={userRole === 'resident' && location.pathname === '/dashboard'} />
    </>
  )
}

export default App
