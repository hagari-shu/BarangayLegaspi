import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import barangaySeal from './assets/barangay-seal-new.png'
import legaspiHero from './assets/legaspi-community.png'
import { getMauQuickOptions, getMauReply, getMauResidentAnswer, getMauWelcome } from './mau-responses'
import { reportClientError } from './client-error-reporting'
import translations from './translations'
import StaffRegistryPanel from './StaffRegistryPanel'
import AdminEmergencyAccess from './AdminEmergencyAccess'
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

const getDisplayName = (user = {}) => {
  const firstName = user.firstName ?? user.first_name ?? ''
  const lastName = user.lastName ?? user.last_name ?? ''
  return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown user'
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

const getManilaDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

const shiftDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const getReportDateRange = (period, now = new Date()) => {
  const today = getManilaDateKey(now)
  if (period === 'today') return { from: today, to: today }
  if (period === 'last7') return { from: shiftDateKey(today, -6), to: today }
  if (period === 'last30') return { from: shiftDateKey(today, -29), to: today }
  if (period === 'thisMonth') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (period === 'previousMonth') {
    const previousMonth = shiftDateKey(`${today.slice(0, 7)}-01`, -1)
    const previousMonthEnd = shiftDateKey(`${today.slice(0, 7)}-01`, -1)
    return { from: `${previousMonth.slice(0, 7)}-01`, to: previousMonthEnd }
  }
  return { from: '', to: '' }
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
    const previousBodyOverflow = document.body.style.overflow
    const previousDocumentOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
    }
  }, [])

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
      <div
        className="modal-content user-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
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
              <div><dt>Mobile</dt><dd>{allowEdit ? <input value={editableUser.mobile || ''} onChange={(event) => handleFieldChange('mobile', event.target.value)} /> : (editableUser.mobile || 'N/A')}</dd></div>
              <div><dt>Role</dt><dd>{allowEdit ? (
                <select value={editableUser.role ?? role} onChange={(event) => handleFieldChange('role', event.target.value)}>
                  <option value="resident">Resident</option>
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (role.charAt(0).toUpperCase() + role.slice(1))}</dd></div>
              <div><dt>Status</dt><dd>{allowEdit ? <input value={editableUser.status || ''} onChange={(event) => handleFieldChange('status', event.target.value)} /> : (editableUser.status || 'N/A')}</dd></div>
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
                <div><dt>Email</dt><dd>{editableUser.email || 'N/A'}</dd></div>
                <div><dt>Mobile Number</dt><dd>{editableUser.mobile || 'N/A'}</dd></div>
                <div><dt>Status</dt><dd>{editableUser.status || 'N/A'}</dd></div>
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
        setResetRequested(true)
        if (data.resetToken) {
          setResetForm((current) => ({ ...current, token: data.resetToken }))
        }
        alert(data.message || 'Reset instructions have been sent.')
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

      alert(t.registrationPendingSuccess)
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
              {t.accountApprovalNotice}
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
      detail: profile.status === 'Active Resident' ? t.accountActive : t.waitingForStaffReview,
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
    return t.requestStatusSubmittedMessage
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

function StaffPage({ staffMembers = [], announcements = [], currentUser, userRole = 'staff', onProcessRequest, onLogout, language, setLanguage }) {
  const t = translations[language] || translations.en
  const [activeTab, setActiveTab] = useState('monitor')
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
  const [showQueueFilters, setShowQueueFilters] = useState(false)
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
  const [archiveFiles, setArchiveFiles] = useState([])
  const [archiveStatus, setArchiveStatus] = useState(null)
  const [archiving, setArchiving] = useState(false)
  const [activeRecordsPanel, setActiveRecordsPanel] = useState(null)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [selectedArchive, setSelectedArchive] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [residentAccountApprovals, setResidentAccountApprovals] = useState([])
  const [residentAccountApprovalsLoading, setResidentAccountApprovalsLoading] = useState(false)
  const [residentAccountApprovalsError, setResidentAccountApprovalsError] = useState('')
  const [residentAccountApprovalsRefresh, setResidentAccountApprovalsRefresh] = useState(0)
  const [monitorRefreshKey, setMonitorRefreshKey] = useState(0)
  const [monitorData, setMonitorData] = useState({ registry: null, announcements: null, events: null })
  const [monitorErrors, setMonitorErrors] = useState({})
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorUpdatedAt, setMonitorUpdatedAt] = useState(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQueueSearch(queueSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [queueSearch])

  useEffect(() => {
    if (activeTab !== 'account-approvals' || userRole !== 'staff') return undefined
    const controller = new AbortController()
    let active = true
    setResidentAccountApprovalsLoading(true)
    setResidentAccountApprovalsError('')
    fetch(`${API_BASE}/staff/account-approvals`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || 'Unable to load pending resident accounts.')
        if (!Array.isArray(data.approvals)) throw new Error('The pending resident account response is invalid.')
        if (active) setResidentAccountApprovals(data.approvals)
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('load resident account approvals failed', error)
          if (active) setResidentAccountApprovalsError(error.message || 'Unable to load pending resident accounts.')
        }
      })
      .finally(() => {
        if (active) setResidentAccountApprovalsLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [activeTab, userRole, residentAccountApprovalsRefresh])

  useEffect(() => {
    if (activeTab !== 'monitor') return undefined
    const controller = new AbortController()
    let active = true
    const loadMonitorData = async () => {
      setMonitorLoading(true)
      setMonitorErrors({})
      const endpoints = {
        registry: '/staff/demographics',
        announcements: '/announcements',
        events: '/events',
      }
      const results = await Promise.allSettled(Object.entries(endpoints).map(async ([key, path]) => {
        const response = await fetch(`${API_BASE}${path}`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || t.monitorDataUnavailable)
        if (key === 'registry' && (!data.overall || typeof data.overall.total !== 'number')) {
          throw new Error(t.monitorDataUnavailable)
        }
        if (key !== 'registry' && !Array.isArray(data[key])) throw new Error(t.monitorDataUnavailable)
        return [key, key === 'registry' ? data : data[key]]
      }))
      if (active) {
        const nextData = { registry: null, announcements: null, events: null }
        const nextErrors = {}
        results.forEach((result, index) => {
          const key = Object.keys(endpoints)[index]
          if (result.status === 'fulfilled') {
            const [resultKey, value] = result.value
            nextData[resultKey] = value
          } else if (result.reason.name !== 'AbortError') {
            console.error(`load staff monitoring ${key} failed`, result.reason)
            nextErrors[key] = result.reason.message || t.monitorDataUnavailable
          }
        })
        setMonitorData(nextData)
        setMonitorErrors(nextErrors)
        setMonitorUpdatedAt(new Date())
        setMonitorLoading(false)
      }
    }
    loadMonitorData()
    return () => {
      active = false
      controller.abort()
    }
  }, [activeTab, monitorRefreshKey, t.monitorDataUnavailable])

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
  const queueTabs = [
    { value: 'active', label: t.activeQueue, count: pendingCount + inReviewCount + needsInformationCount },
    { value: 'Pending', label: t.pendingReviewMetric, count: pendingCount },
    { value: 'In Review', label: t.inProcessingMetric, count: inReviewCount },
    { value: 'Needs Information', label: t.statusNeedsInformation, count: needsInformationCount },
    { value: 'Approved', label: t.approved, count: approvedCount },
    { value: 'Rejected', label: t.statusRejected, count: Number(dashboardSummary.rejected) || 0 },
    { value: 'all', label: t.allStatuses, count: totalRequests },
  ]

  const setQueueFilter = (status) => {
    setActiveTab('queue')
    setQueueStatus(status)
    setQueuePage(1)
    setOpenRequestPanel('queue')
  }

  const clearQueueFilters = () => {
    setQueueSearch('')
    setQueueStatus('active')
    setQueueZone('all')
    setQueueType('all')
    setQueueFrom('')
    setQueueTo('')
    setQueueSort('date')
    setQueueDirection('desc')
    setQueuePage(1)
    setShowQueueFilters(false)
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

  const confirmResidentAccountDecision = (account, status) => {
    const name = `${account.firstName || ''} ${account.lastName || ''}`.trim()
    const decision = status === 'Active Resident' ? t.approve : t.reject
    setConfirmation({
      title: decision,
      message: t.residentAccountDecisionConfirm.replace('{decision}', decision.toLowerCase()).replace('{name}', name),
      confirmLabel: decision,
      onConfirm: async () => {
        setResidentAccountApprovalsError('')
        try {
          const response = await fetch(`${API_BASE}/staff/account-approvals/${encodeURIComponent(account.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.message || t.residentAccountDecisionFailed)
          setResidentAccountApprovals((current) => current.filter((item) => item.id !== account.id))
        } catch (error) {
          console.error('update resident account approval failed', error)
          setResidentAccountApprovalsError(error.message || t.residentAccountDecisionFailed)
        }
      },
    })
  }

  const loadArchiveFiles = async () => {
    try {
      const response = await fetch(`${API_BASE}/staff/archives`)
      if (!response.ok) {
        setArchiveFiles([])
        return
      }
      const data = await response.json()
      setArchiveFiles(data.archives || [])
    } catch (error) {
      console.error('load archive files error', error)
      setArchiveFiles([])
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
  }, [activeTab])

  const handleArchiveQueue = async (days = 1) => {
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
        throw new Error(data.message || 'Archive failed')
      }
      setArchiveStatus(data.archive || null)
      await loadArchiveFiles()
    } catch (error) {
      console.error('staff archive error', error)
      alert(error.message || 'Archive failed')
    } finally {
      setArchiving(false)
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

      <main className="dashboard-main staff-dashboard-main">
        <aside className="sidebar" aria-label={t.staffNavigationLabel}>
          <nav className="sidebar-nav" aria-label={t.staffNavigationLabel}>
            <span className="staff-navigation-group">{t.staffMonitorGroup}</span>
            <button
              type="button"
              className={`nav-item ${activeTab === 'monitor' ? 'active' : ''}`}
              aria-current={activeTab === 'monitor' ? 'page' : undefined}
              onClick={() => setActiveTab('monitor')}
            >
              <span className="nav-icon">📡</span><span>{t.staffSystemMonitor}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
              aria-current={activeTab === 'queue' ? 'page' : undefined}
              onClick={() => setActiveTab('queue')}
            >
              <span className="nav-icon">📄</span><span>{t.staffDashboardTitle}</span>
            </button>
            <span className="staff-navigation-group">{t.staffResidentGroup}</span>
            <button
              type="button"
              className={`nav-item ${activeTab === 'residents' ? 'active' : ''}`}
              aria-current={activeTab === 'residents' ? 'page' : undefined}
              onClick={() => setActiveTab('residents')}
            >
              <span className="nav-icon">🏘️</span><span>{language === 'fil' ? 'Talaan ng residente' : 'Resident registry'}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'approvals' ? 'active' : ''}`}
              aria-current={activeTab === 'approvals' ? 'page' : undefined}
              onClick={() => { setActiveTab('approvals'); setOpenRequestPanel('approvals'); setQueuePage(1) }}
            >
              <span className="nav-icon">✓</span><span>{t.approvals}</span>
            </button>
            {userRole === 'staff' && (
              <button
                type="button"
                className={`nav-item ${activeTab === 'account-approvals' ? 'active' : ''}`}
                aria-current={activeTab === 'account-approvals' ? 'page' : undefined}
                onClick={() => setActiveTab('account-approvals')}
              >
                <span className="nav-icon">👤</span><span>{t.residentAccountApprovals}</span>
              </button>
            )}
            <span className="staff-navigation-group">{t.staffServiceGroup}</span>
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
            <span className="staff-navigation-group">{t.staffAdminGroup}</span>
            <Link className="nav-item" to="/admin" aria-label={t.staffAdminAccessNote}>
              <span className="nav-icon">🔒</span><span>{t.staffAdminPortal}</span>
            </Link>
          </nav>
        </aside>

        <section className={`content-panel staff-content-panel staff-module-${activeTab}`} aria-label={t.staffOverviewLabel}>
          {currentUser?.email === 'staff-preview@local.invalid' && (
            <p className="staff-monitor-local-notice" role="status">{t.staffMonitorLocalPreview}</p>
          )}
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{t.operations}</p>
              <h1>{activeTab === 'monitor' ? t.staffSystemMonitor : activeTab === 'queue' ? t.staffDashboardTitle : activeTab === 'reports' ? t.serviceReports : activeTab === 'announcements' ? t.announcements : activeTab === 'staff' ? t.staffDirectory : activeTab === 'residents' ? (language === 'fil' ? 'Talaan ng residente' : 'Resident registry') : activeTab === 'account-approvals' ? t.residentAccountApprovals : t.approvalsManagement}</h1>
              {activeTab === 'monitor' && <p className="staff-dashboard-subtitle">{t.staffMonitorSubtitle}</p>}
              {activeTab === 'queue' && <p className="staff-dashboard-subtitle">{t.staffDashboardSubtitle}</p>}
            </div>
            {activeTab === 'monitor' ? (
              <div className="staff-dashboard-meta">
                <span>{t.monitorCheckedAt}: {monitorUpdatedAt ? new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(monitorUpdatedAt) : '—'}</span>
                <button className="secondary-btn small" type="button" disabled={monitorLoading} onClick={() => { setMonitorRefreshKey((current) => current + 1); setDashboardRefreshKey((current) => current + 1) }}>
                  {monitorLoading ? t.working : t.refreshMonitor}
                </button>
              </div>
            ) : activeTab === 'queue' ? (
              <div className="staff-dashboard-meta">
                <span>{new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'full', timeZone: 'Asia/Manila' }).format(todayDate)}</span>
                <span>{t.lastUpdated}: {dashboardUpdatedAt ? new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(dashboardUpdatedAt) : '—'}</span>
                <button className="secondary-btn small" type="button" disabled={dashboardLoading} onClick={() => setDashboardRefreshKey((current) => current + 1)}>
                  {dashboardLoading ? t.loadingRequests : t.refreshRequests}
                </button>
              </div>
            ) : <span className="counter-pill">
              {activeTab === 'reports'
                ? reportLoading ? t.working : Number(reportData?.summary.received || 0)
                : activeTab === 'account-approvals' ? residentAccountApprovals.length
                  : activeTab === 'approvals' ? approvedCount : totalRequests}
              {' '}{activeTab === 'account-approvals' ? t.residentAccountApprovals : activeTab === 'approvals' ? t.processed : t.requests}
            </span>}
          </div>

          {activeTab === 'queue' && <div className="stats-grid staff-dashboard-metrics" aria-label={t.staffSummaryLabel}>
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
              {activeTab === 'monitor' && (
                <section className="staff-monitor" aria-label={t.staffSystemMonitor} aria-busy={monitorLoading}>
                  <p className="staff-monitor-privacy">{t.staffMonitorPrivacy}</p>
                  <div className="staff-monitor-grid">
                    <article className="panel-card staff-monitor-card">
                      <div className="panel-header"><h2>{t.monitorRequests}</h2></div>
                      {dashboardError ? <p className="registry-message error" role="alert">{dashboardError}</p> : dashboardLoading ? <p role="status">{t.loadingRequests}</p> : (
                        <>
                          <dl className="staff-monitor-counts">
                            <div><dt>{t.pendingReviewMetric}</dt><dd>{pendingCount.toLocaleString()}</dd></div>
                            <div><dt>{t.inProcessingMetric}</dt><dd>{inReviewCount.toLocaleString()}</dd></div>
                            <div><dt>{t.statusNeedsInformation}</dt><dd>{needsInformationCount.toLocaleString()}</dd></div>
                            <div><dt>{t.requests}</dt><dd>{totalRequests.toLocaleString()}</dd></div>
                          </dl>
                          <button type="button" className="secondary-btn small" onClick={() => setActiveTab('queue')}>{t.openRequestQueue}</button>
                        </>
                      )}
                    </article>
                    <article className="panel-card staff-monitor-card">
                      <div className="panel-header"><h2>{t.monitorRegistry}</h2></div>
                      {monitorErrors.registry ? <p className="registry-message error" role="alert">{monitorErrors.registry}</p> : monitorData.registry ? (
                        <>
                          <p className="staff-monitor-primary-count">{monitorData.registry.overall.total.toLocaleString()}</p>
                          <p>{t.monitorVerifiedPopulation}</p>
                          <p className="soft-label">{monitorData.registry.eligibility}</p>
                          <button type="button" className="secondary-btn small" onClick={() => setActiveTab('residents')}>{t.openRegistry}</button>
                        </>
                      ) : <p role="status">{monitorLoading ? t.working : t.monitorNoData}</p>}
                    </article>
                    <article className="panel-card staff-monitor-card">
                      <div className="panel-header"><h2>{t.announcements}</h2></div>
                      {monitorErrors.announcements ? <p className="registry-message error" role="alert">{monitorErrors.announcements}</p> : monitorData.announcements ? (
                        <>
                          <p className="staff-monitor-primary-count">{monitorData.announcements.length.toLocaleString()}</p>
                          <p>{t.monitorAnnouncementsCount}</p>
                          <button type="button" className="secondary-btn small" onClick={() => setActiveTab('announcements')}>{t.openAnnouncements}</button>
                        </>
                      ) : <p role="status">{monitorLoading ? t.working : t.monitorNoData}</p>}
                    </article>
                    <article className="panel-card staff-monitor-card">
                      <div className="panel-header"><h2>{t.monitorEvents}</h2></div>
                      {monitorErrors.events ? <p className="registry-message error" role="alert">{monitorErrors.events}</p> : monitorData.events ? (
                        <>
                          <p className="staff-monitor-primary-count">{monitorData.events.length.toLocaleString()}</p>
                          <p>{t.monitorEventsCount}</p>
                          {monitorData.events.length === 0 && <p className="soft-label">{t.monitorNoEvents}</p>}
                        </>
                      ) : <p role="status">{monitorLoading ? t.working : t.monitorNoData}</p>}
                    </article>
                  </div>
                </section>
              )}
              {activeTab === 'residents' && <StaffRegistryPanel language={language} />}
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

                  {openRequestPanel === 'queue' && (
                    <div className="request-queue-shell">
                      <div className="request-workflow-tabs" role="tablist" aria-label={t.requestStatusFilter}>
                        {queueTabs.map((tab) => (
                          <button
                            key={tab.value}
                            type="button"
                            className={`request-workflow-tab ${queueStatus === tab.value ? 'active' : ''}`}
                            aria-pressed={queueStatus === tab.value}
                            onClick={() => {
                              setQueueStatus(tab.value)
                              setQueuePage(1)
                            }}
                          >
                            <span>{tab.label}</span>
                            <small>{tab.count}</small>
                          </button>
                        ))}
                      </div>

                      <div className="request-toolbar">
                        <input type="search"
                          className="search-input"
                          value={queueSearch}
                          onChange={(event) => { setQueueSearch(event.target.value); setQueuePage(1) }}
                          placeholder={t.requestQueueSearch}
                          aria-label={t.requestQueueSearch}
                        />
                        <button type="button" className="secondary-btn small" onClick={() => setShowQueueFilters((current) => !current)}>
                          {t.requestStatusFilter || 'Filters'}
                        </button>
                      </div>

                      {showQueueFilters && (
                        <div className="staff-queue-filters">
                          <div className="queue-filter-grid">
                            <label className="queue-filter-field">
                              <span>{t.documentTypeFilter}</span>
                              <select value={queueType} onChange={(event) => { setQueueType(event.target.value); setQueuePage(1) }} aria-label={t.documentTypeFilter}>
                                <option value="all">{t.allDocumentTypes}</option>
                                {dashboardDocumentTypes.map((type) => (
                                  <option key={type} value={type}>{type}</option>
                                ))}
                              </select>
                            </label>
                            <label className="queue-filter-field">
                              <span>{t.requestZoneFilter}</span>
                              <select value={queueZone} onChange={(event) => { setQueueZone(event.target.value); setQueuePage(1) }} aria-label={t.requestZoneFilter}>
                                <option value="all">{t.allZonesLabel}</option>
                                {[1, 2, 3, 4, 5, 6, 7].map((zone) => <option key={zone} value={String(zone)}>Zone {zone}</option>)}
                              </select>
                            </label>
                            <label className="queue-filter-field">
                              <span>{t.fromDate}</span>
                              <input type="date" max={queueTo || undefined} value={queueFrom} onChange={(event) => { setQueueFrom(event.target.value); setQueuePage(1) }} />
                            </label>
                            <label className="queue-filter-field">
                              <span>{t.toDate}</span>
                              <input type="date" min={queueFrom || undefined} value={queueTo} onChange={(event) => { setQueueTo(event.target.value); setQueuePage(1) }} />
                            </label>
                            <label className="queue-filter-field">
                              <span>{t.sortRequestsBy}</span>
                              <select value={queueSort} onChange={(event) => { setQueueSort(event.target.value); setQueuePage(1) }}>
                                <option value="date">{t.sortSubmissionDate}</option>
                                <option value="status">{t.sortStatus}</option>
                              </select>
                            </label>
                            <label className="queue-filter-field">
                              <span>{t.sortDirection}</span>
                              <select value={queueDirection} onChange={(event) => { setQueueDirection(event.target.value); setQueuePage(1) }}>
                                <option value="desc">{t.descending}</option>
                                <option value="asc">{t.ascending}</option>
                              </select>
                            </label>
                          </div>
                          <div className="queue-filter-actions">
                            <button type="button" className="secondary-btn small" onClick={clearQueueFilters}>{t.reportClearFilters}</button>
                            <label className="queue-filter-field compact">
                              <span>{t.requestPageSize}</span>
                              <select value={queuePageSize} onChange={(event) => { setQueuePageSize(Number(event.target.value)); setQueuePage(1) }}>
                                {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                              </select>
                            </label>
                          </div>
                        </div>
                      )}

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
                                <td data-label={t.requestId}>
                                  <button type="button" className="request-id-button" aria-label={t.viewRequestDetails.replace('{id}', String(item.id))} onClick={() => setSelectedRequest(item)}>{item.id}</button>
                                </td>
                                <td data-label={t.resident}>{item.first_name || item.firstName || t.resident} {item.last_name || item.lastName || ''}</td>
                                <td data-label={t.requestType}>{item.type}</td>
                                <td data-label={t.submissionDate}>{formatRequestDate(item.date || item.createdAt || item.created_at)}</td>
                                <td data-label={t.status}><span className={`status-badge ${(item.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{getRequestStatusLabel(item.status, t)}</span></td>
                                <td data-label={t.actionsLabel}>
                                  {['Approved', 'Rejected'].includes(item.status)
                                    ? <span>{getRequestStatusLabel(item.status, t)}</span>
                                    : <button type="button" className="small-action success" onClick={() => setSelectedRequest(item)}>{t.requestStatusAction}</button>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!dashboardLoading && !dashboardError && filteredQueueRequests.length === 0 && (
                          <div className="queue-empty-state">
                            <h3>{t.noRequestsMatchFilters}</h3>
                            <p>{t.requestQueueSearch}</p>
                          </div>
                        )}
                      </div>

                      <div className="request-pagination">
                        <span>
                          {dashboardTotal > 0
                            ? `Showing ${Math.min((queuePage - 1) * queuePageSize + 1, dashboardTotal)}–${Math.min(queuePage * queuePageSize, dashboardTotal)} of ${dashboardTotal}`
                            : 'Showing 0–0 of 0'}
                        </span>
                        <div className="pager-actions">
                          <button type="button" className="secondary-btn small" disabled={dashboardLoading || queuePage <= 1} onClick={() => setQueuePage((page) => Math.max(1, page - 1))}>{t.previousPage}</button>
                          <button type="button" className="secondary-btn small" disabled={dashboardLoading || queuePage >= requestPages} onClick={() => setQueuePage((page) => Math.min(requestPages, page + 1))}>{t.nextPage}</button>
                        </div>
                      </div>
                    </div>
                  )}
                </article>                </>
              )}

              {activeTab === 'account-approvals' && userRole === 'staff' && (
                <article className="panel-card compact-panel">
                  <div className="panel-header">
                    <div>
                      <h2>{t.residentAccountApprovals}</h2>
                      <p className="soft-label">{t.residentAccountReviewHint}</p>
                    </div>
                    <button type="button" className="secondary-btn small" onClick={() => setResidentAccountApprovalsRefresh((key) => key + 1)} disabled={residentAccountApprovalsLoading}>
                      {residentAccountApprovalsLoading ? t.working : t.refresh}
                    </button>
                  </div>
                  {residentAccountApprovalsError && <p className="registry-message error" role="alert">{residentAccountApprovalsError}</p>}
                  {residentAccountApprovalsLoading ? <p role="status">{t.working}</p> : (
                    residentAccountApprovals.length > 0 ? (
                      <div className="admin-approval-list">
                        {residentAccountApprovals.map((account) => {
                          const name = `${account.firstName || ''} ${account.lastName || ''}`.trim()
                          return (
                            <div key={account.id} className="admin-approval-row">
                              <div>
                                <strong>{name}</strong>
                                <small>{account.mobile || account.email || t.noAddressProvided} • {t.registered} {formatDateValue(account.createdAt)}</small>
                                <small>{account.address || t.noAddressProvided} • Zone {account.zone || 'N/A'}</small>
                              </div>
                              <div className="action-row">
                                <button type="button" className="small-action success" onClick={() => confirmResidentAccountDecision(account, 'Active Resident')}>{t.approve}</button>
                                <button type="button" className="small-action danger" onClick={() => confirmResidentAccountDecision(account, 'Rejected')}>{t.reject}</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : <div className="empty-state">{t.noResidentAccountApprovals}</div>
                  )}
                </article>
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
                        <button type="button" className="secondary-btn small" disabled title={t.reportPrintUnavailable}>{t.reportPrint}</button>
                      </div>
                    </div>
                    <p className="soft-label" role="status">{t.reportPrintUnavailable}</p>
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
                  </div>

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
                  </div>

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
                      </div>
                    ))}
                  </div>
                </article>
              )}
            </div>

            <aside className="side-column" hidden={activeTab === 'monitor' || activeTab === 'residents' || activeTab === 'reports' || activeTab === 'announcements' || activeTab === 'staff' || activeTab === 'account-approvals'}>
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
                    <span className="record-panel-count">{archiveFiles.length}</span>
                  </button>

                  {activeRecordsPanel === 'archive' && (
                    <div className="record-dedicated-space">
                      <div className="record-details archive-record-details">
                        <div className="archive-inline-actions">
                          <button type="button" className="secondary-btn small" onClick={() => handleArchiveQueue(1)} disabled={archiving}>{t.archiveLastDay}</button>
                          <button type="button" className="primary-btn small" onClick={() => handleArchiveQueue(0)} disabled={archiving}>{t.storeToday}</button>
                        </div>
                        {archiveStatus && (
                          <p className="archive-note">{t.archiveSummary.replace('{count}', String(archiveStatus.count || 0)).replace('{date}', new Date(archiveStatus.archivedAt || Date.now()).toLocaleDateString(language === 'fil' ? 'fil-PH' : 'en-PH'))}</p>
                        )}
                        <div className="archive-list">
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
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </article>

              <article className="profile-card">
                <div className="profile-head">
                  <div className="profile-avatar">S</div>
                  <div>
                    <h3>{t.staffHighlights}</h3>
                    <span>{t.staffSupportDesk}</span>
                  </div>
                </div>
                <dl className="profile-list">
                  <div><dt>{t.shift}</dt><dd>08:00 AM – 05:00 PM</dd></div>
                  <div><dt>{t.desk}</dt><dd>{t.serviceDesk}</dd></div>
                  <div><dt>{t.priority}</dt><dd>{t.certificateClearance}</dd></div>
                  <div><dt>{t.notesLabel}</dt><dd>{t.responseTimeTarget}</dd></div>
                </dl>
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
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
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

function AdminPage({ users, residents = [], reports = [], currentUser, onLogout, language, setLanguage }) {
  const t = translations[language] || translations.en
  const zoneNumbers = [1, 2, 3, 4, 5, 6, 7]
  const [managedUsers, setManagedUsers] = useState(users)
  const [activeTab, setActiveTab] = useState('residents')
  const [searchQuery, setSearchQuery] = useState('')
  const [accessSearch, setAccessSearch] = useState('')
  const [selectedZone, setSelectedZone] = useState('all')
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedReport, setSelectedReport] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])
  const [auditLogsError, setAuditLogsError] = useState('')
  const [archives, setArchives] = useState([])
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
    
    const matchesZone = selectedZone === 'all' || resident.zone === parseInt(selectedZone)
    
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
      const normalizedRole = String(user.role || user.userRole || 'resident').toLowerCase()
      const zoneMatch = group.zone === 0
        ? !['resident'].includes(normalizedRole)
        : Number(user.zone ?? user.zoneNumber ?? 0) === group.zone
      return matchesSearch && zoneMatch
    })

    return sortByMode(zoneUsers, accessZoneSort[group.zone] || 'alphabetical')
  }

  const sortedUsers = [...managedUsers].sort((a, b) => {
    const left = `${a.first_name || a.firstName || ''} ${a.last_name || a.lastName || ''}`.trim().toLowerCase()
    const right = `${b.first_name || b.firstName || ''} ${b.last_name || b.lastName || ''}`.trim().toLowerCase()
    return left.localeCompare(right)
  })

  const accessZones = [...zoneNumbers, 0]
  const accessUsersByZone = accessZones.map((zone) => {
    const matchingUsers = sortedUsers.filter((user) => {
      const fullName = `${user.first_name || user.firstName || ''} ${user.last_name || user.lastName || ''}`.trim()
      const matchesSearch = accessSearch === '' || fullName.toLowerCase().includes(accessSearch.toLowerCase())
      const normalizedRole = String(user.role || user.userRole || 'resident').toLowerCase()
      const zoneMatch = zone === 0
        ? !['resident'].includes(normalizedRole)
        : Number(user.zone ?? user.zoneNumber ?? 0) === zone
      return matchesSearch && zoneMatch
    })

    return { zone, users: matchingUsers }
  }).filter((group) => group.users.length > 0)

  const getAccessZoneLabel = (zone) => zone === 0 ? 'Staff & Admin' : `Zone ${zone}`
  
  useEffect(() => {
    // Load archives and audit logs when Admin opens Access.
    const fetchArchives = async () => {
      try {
        const r = await fetch(`${API_BASE}/admin/archives`)
        if (r.ok) {
          const d = await r.json()
          setArchives(d.archives || [])
        }
      } catch (err) {
        console.error('fetch archives error', err)
      }
    }

    if (activeTab === 'access') {
      fetchArchives()
    }

    if (activeTab === 'access') {
      const refreshAuditLogs = () => {
        setAuditLogsError('')
        fetch(`${API_BASE}/admin/audit-logs?limit=500`)
          .then((response) => {
            if (!response.ok) throw new Error('Unable to refresh administrator activity.')
            return response.json()
          })
          .then((data) => {
            if (!Array.isArray(data.logs)) throw new Error('Administrator activity response is invalid.')
            setAuditLogs(data.logs)
          })
          .catch((error) => {
            console.error('fetch audit logs error', error)
            setAuditLogsError(error.message || 'Unable to load administrator activity.')
          })
      }
      refreshAuditLogs()
    }
  }, [activeTab])

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
          <span className="role-chip">{language === 'fil' ? 'Read-only ang access' : 'Read-only access'}</span>
          <button className="logout-btn" type="button" onClick={onLogout}>{t.logout}</button>
        </div>
      </header>

      <a className="skip-link" href="#admin-main-content">{language === 'fil' ? 'Lumaktaw sa pangunahing nilalaman' : 'Skip to main content'}</a>
      <main id="admin-main-content" tabIndex={-1} className="dashboard-main admin-dashboard-main">
        <aside className="sidebar" aria-label={t.adminNavigationLabel}>
          <nav className="sidebar-nav" aria-label={t.adminNavigationLabel}>
            <button
              type="button"
              className={`nav-item ${activeTab === 'residents' ? 'active' : ''}`}
              aria-current={activeTab === 'residents' ? 'page' : undefined}
              onClick={() => setActiveTab('residents')}
            >
              <span className="nav-icon" aria-hidden="true">👥</span><span>{t.residents}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'access' ? 'active' : ''}`}
              aria-current={activeTab === 'access' ? 'page' : undefined}
              onClick={() => setActiveTab('access')}
            >
              <span className="nav-icon" aria-hidden="true">🔐</span><span>{t.access}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${activeTab === 'emergencies' ? 'active' : ''}`}
              aria-current={activeTab === 'emergencies' ? 'page' : undefined}
              onClick={() => setActiveTab('emergencies')}
            >
              <span className="nav-icon" aria-hidden="true">🚨</span><span>{t.emergencies}</span>
            </button>
          </nav>
        </aside>

        <section className="content-panel" aria-labelledby="admin-page-title">
          {currentUser?.email === 'admin-preview@local.invalid' && (
            <p className="staff-monitor-local-notice" role="status">{t.adminLocalPreviewNotice}</p>
          )}
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{t.governance}</p>
              <h1 id="admin-page-title">{activeTab === 'residents' ? t.residentsByZone : activeTab === 'access' ? t.userAccessManagement : t.emergencyReportsTitle}</h1>
            </div>
          </div>

          <div className="dashboard-body">
            <div className="main-column">
              {activeTab === 'residents' && (
                <article className="panel-card compact-panel">
                  <div className="panel-header">
                    <h2>{t.residentManagement}</h2>
                    <span className="soft-label" role="status" aria-live="polite">{filteredResidents.length} {t.residentsFound}</span>
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
                      aria-label={t.filterResidentsByZone}
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
                              aria-expanded={isExpanded}
                              onClick={() => setExpandedZone((current) => current === group.zone ? null : group.zone)}
                            >
                              <div className="zone-toggle-left">
                                <span className="zone-toggle-number">Zone {group.zone}</span>
                                <span className="zone-toggle-meta">{group.residents.length} residents</span>
                              </div>
                              <span className={`zone-toggle-chevron ${isExpanded ? 'open' : ''}`} aria-hidden="true">▾</span>
                            </button>

                            {isExpanded && (
                              <div className="zone-group-body" id={`admin-resident-zone-${group.zone}`}>
                                <div className="zone-sort-row">
                                  <label className="zone-sort-label" htmlFor={`admin-resident-sort-${group.zone}`}>{t.sortBy}</label>
                                  <select
                                    id={`admin-resident-sort-${group.zone}`}
                                    className="zone-sort-select"
                                    value={residentZoneSort[group.zone] || 'alphabetical'}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => {
                                      event.stopPropagation()
                                      setResidentZoneSort((prev) => ({ ...prev, [group.zone]: event.target.value }))
                                    }}
                                  >
                                    <option value="alphabetical">{t.alphabetical}</option>
                                    <option value="newest">{t.recentlyCreated}</option>
                                  </select>
                                </div>

                                <div className="request-table-wrap">
                                  <table className="request-table">
                                    <caption className="sr-only">Residents in Zone {group.zone}</caption>
                                    <thead>
                                      <tr>
                                        <th scope="col">Resident</th>
                                        <th scope="col">Household ID</th>
                                        <th scope="col">Zone</th>
                                        <th scope="col">Family Members</th>
                                        <th scope="col">Email</th>
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
                        <caption className="sr-only">Filtered resident records</caption>
                        <thead>
                          <tr>
                            <th scope="col">Resident</th>
                            <th scope="col">Household ID</th>
                            <th scope="col">Zone</th>
                            <th scope="col">Family Members</th>
                            <th scope="col">Email</th>
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
                    <span className="soft-label" role="status" aria-live="polite">
                      {accessUsersByZone.reduce((total, group) => total + group.users.length, 0)} total users
                    </span>
                  </div>
                  <div className="search-and-filter">
                    <input
                      type="search"
                      placeholder={t.searchUsersByName}
                      value={accessSearch}
                      onChange={(e) => setAccessSearch(e.target.value)}
                      className="search-input"
                      aria-label={t.searchUsersByName}
                    />
                  </div>

                  <div className="zone-group-stack">
                    {accessUsersByZone.map((group) => {
                      const isExpanded = expandedZone === group.zone
                      const zoneUsers = getAccessZoneUsers(group)

                      return (
                        <div key={group.zone} className="zone-group-card">
                          <button
                            type="button"
                            className="zone-toggle"
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedZone((current) => current === group.zone ? null : group.zone)}
                          >
                            <div className="zone-toggle-left">
                              <span className="zone-toggle-number">{group.zone === 0 ? 'Staff & Admin' : `Zone ${group.zone}`}</span>
                              <span className="zone-toggle-meta">{group.users.length} users</span>
                            </div>
                            <span className={`zone-toggle-chevron ${isExpanded ? 'open' : ''}`} aria-hidden="true">▾</span>
                          </button>

                          {isExpanded && (
                            <div className="zone-group-body" id={`admin-access-zone-${group.zone}`}>
                              <div className="zone-sort-row">
                                <label className="zone-sort-label" htmlFor={`admin-access-sort-${group.zone}`}>{t.sortBy}</label>
                                <select
                                  id={`admin-access-sort-${group.zone}`}
                                  className="zone-sort-select"
                                  value={accessZoneSort[group.zone] || 'alphabetical'}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    event.stopPropagation()
                                    setAccessZoneSort((prev) => ({ ...prev, [group.zone]: event.target.value }))
                                  }}
                                >
                                  <option value="alphabetical">{t.alphabetical}</option>
                                  <option value="newest">{t.recentlyCreated}</option>
                                </select>
                              </div>

                              <div className="request-table-wrap">
                                <table className="request-table">
                                  <caption className="sr-only">{group.zone === 0 ? 'Staff and Admin users' : `Users in Zone ${group.zone}`}</caption>
                                  <thead>
                                    <tr>
                                      <th scope="col">Name</th>
                                      <th scope="col">Role</th>
                                      <th scope="col" style={{textAlign: 'right'}}>Created</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {zoneUsers.map((user) => (
                                      <tr key={user.id}>
                                        <td>
                                          <button className="link-button" onClick={async () => {
                                            try {
                                              const resp = await fetch(`${API_BASE}/admin/access/user/${user.id}`)
                                              if (resp.ok) {
                                                const data = await resp.json()
                                                setSelectedUser(data.user)
                                              } else {
                                                alert('Failed to load user details')
                                              }
                                            } catch (err) {
                                              console.error('fetch user detail error', err)
                                              alert('Failed to load user details')
                                            }
                                          }}>{user.first_name || user.firstName} {user.last_name || user.lastName}</button>
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

                  <section className="admin-audit-section" aria-labelledby="admin-audit-title">
                    <div className="panel-header">
                      <h2 id="admin-audit-title">{t.adminAuditTitle}</h2>
                    </div>
                    {auditLogsError ? (
                      <p className="registry-message error" role="alert">{auditLogsError}</p>
                    ) : auditLogs.length > 0 ? (
                      <ol className="admin-audit-list">
                        {auditLogs.slice(0, 20).map((entry) => (
                          <li key={entry.id}>
                            <strong>{entry.action}</strong>
                            <span>{entry.actorRole || 'system'} · {entry.targetType || 'record'} {entry.targetId || ''}</span>
                            <time dateTime={entry.createdAt || entry.created_at}>
                              {formatDateValue(entry.createdAt || entry.created_at)}
                            </time>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>{t.noRecentActivity}</p>
                    )}
                  </section>

                </article>
              )}

              {activeTab === 'emergencies' && (
                <>
                  <AdminEmergencyAccess language={language} />
                  <article className="panel-card">
                  <div className="panel-header">
                    <h2>{t.emergencyReportsTitle}</h2>
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
                </>
              )}
            </div>

            <aside className="side-column">
              <article className="panel-card archive-card">
                <div className="panel-subhead">
                  <h4>{t.archivedFiles}</h4>
                  <button className="secondary-btn tiny" type="button" onClick={async () => { try { const r = await fetch(`${API_BASE}/admin/archives`); if (r.ok) { setArchives((await r.json()).archives || []) } } catch (e) { console.error(e) } }}>{t.refresh}</button>
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
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
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

function StaffInvitationPage() {
  const [token, setToken] = useState(() => window.location.hash.slice(1))
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (!token) {
      setError('This invitation link is missing or has already been cleared. Ask the system operator for a new invitation.')
      return
    }
    if (!isValidPassword(form.password)) {
      setError(`Choose a password with ${passwordRequirements}.`)
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`${API_BASE}/staff-invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          firstName: form.firstName,
          lastName: form.lastName,
          password: form.password,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Unable to accept this invitation.')
      setToken('')
      setIsComplete(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to accept this invitation. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="staff-invitation-screen">
      <section className="staff-invitation-card" aria-labelledby="staff-invitation-title">
        <img className="staff-invitation-seal" src={barangaySeal} alt="Barangay Legaspi official seal" />
        <p className="landing-eyebrow">Barangay Legaspi</p>
        <h1 id="staff-invitation-title">{isComplete ? 'Invitation accepted' : 'Set up your staff account'}</h1>
        {isComplete ? (
          <>
            <p>Your staff account has been created. You can now sign in using the email or mobile number assigned to this invitation.</p>
            <Link className="primary-btn staff-invitation-action" to="/">Go to sign in</Link>
          </>
        ) : (
          <>
            <p>This single-use invitation expires after 24 hours. Choose your name and a strong password to finish setting up your staff account.</p>
            {!token && <p className="staff-invitation-error" role="alert">The invitation token is missing. Ask the system operator for a valid link.</p>}
            {error && <p className="staff-invitation-error" role="alert">{error}</p>}
            <form className="staff-invitation-form" onSubmit={handleSubmit}>
              <label htmlFor="staff-invite-first-name">First name</label>
              <input id="staff-invite-first-name" autoComplete="given-name" maxLength={100} required value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} />
              <label htmlFor="staff-invite-last-name">Last name</label>
              <input id="staff-invite-last-name" autoComplete="family-name" maxLength={100} required value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} />
              <PasswordField id="staff-invite-password" label="Create password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} helpText={`${passwordRequirements}.`} />
              <label htmlFor="staff-invite-confirm-password">Confirm password</label>
              <input id="staff-invite-confirm-password" type="password" autoComplete="new-password" required value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
              <button className="primary-btn staff-invitation-action" type="submit" disabled={isSubmitting || !token}>
                {isSubmitting ? 'Creating account…' : 'Create staff account'}
              </button>
            </form>
            <Link className="staff-invitation-login-link" to="/">Return to sign in</Link>
          </>
        )}
      </section>
    </main>
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
    const loadUserData = async () => {
      if (!session?.token) return

      try {
        // profile
        const profileResponse = await fetch(`${API_BASE}/profile`)
        if (profileResponse.status === 401) {
          clearStoredSession()
          setSession(null)
          return
        }
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

        // staff or admin: load shared staff data
        if (['staff', 'admin'].includes(userRole)) {
          try {
            const [staffMembersResp, announcementsResp] = await Promise.all([
              fetch(`${API_BASE}/staff/members`),
              fetch(`${API_BASE}/announcements`),
            ])

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
        <Route path="/staff-invite" element={<StaffInvitationPage />} />
        <Route path="/" element={isAuthenticated ? <Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace /> : <LoginPage onLogin={handleLogin} language={language} setLanguage={switchLanguage} />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace /> : <RegisterPage language={language} setLanguage={switchLanguage} />} />
        <Route path="/dashboard" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><DashboardPage profile={profile} requests={requests} services={services} announcements={announcementsData} events={events} payments={payments} onLogout={handleLogout} onProfileUpdated={setProfile} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/requests" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><RequestsPage requests={requests} onSubmit={handleRequestSubmit} onRequestUpdated={handleRequestUpdated} onLogout={handleLogout} language={language} setLanguage={switchLanguage} userId={session?.user?.id} /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><ProfilePage profile={profile} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/payments" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><PaymentsPage payments={payments} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/events" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><EventsPage events={events} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident', 'staff', 'admin']} userRole={userRole}><SettingsPage profile={profile} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/staff" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['staff', 'admin']} userRole={userRole}><StaffPage staffMembers={staffMembers} announcements={announcementsData} currentUser={session?.user} userRole={userRole} onProcessRequest={handleRequestStatus} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['admin']} userRole={userRole}><AdminPage users={users} residents={residents} reports={reports} currentUser={session?.user} onLogout={handleLogout} language={language} setLanguage={switchLanguage} /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace />} />
      </Routes>
      <MauAssistant language={language} userRole={userRole} isAuthenticated={isAuthenticated} pathname={location.pathname} mobileDashboard={userRole === 'resident' && location.pathname === '/dashboard'} />
    </>
  )
}

export default App
