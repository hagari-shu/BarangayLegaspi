import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom'
import barangaySeal from './assets/barangay-seal.svg'
import './App.css'

const sessionKey = 'brgy-legaspi-session'
const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, '')

if (!API_BASE) {
  throw new Error('VITE_API_BASE must be configured to point to the deployed API base URL, such as https://api.example.com/api.')
}

// Simple fetch wrapper to automatically attach Authorization header for API calls when a session token exists
const _originalFetch = window.fetch.bind(window)
window.fetch = (input, init = {}) => {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(sessionKey) : null
    const token = saved ? JSON.parse(saved).token : null
    if (typeof input === 'string' && input.startsWith(API_BASE)) {
      init = init || {}
      init.headers = { ...(init.headers || {}), Authorization: token ? 'Bearer ' + token : '' }
    }
  } catch (e) {
    // ignore errors here to avoid breaking UI if localStorage inaccessible
  }
  return _originalFetch(input, init)
}

const sanitizeText = (value = '') => String(value).replace(/[<>]/g, '').trim()
const isValidIdentifier = (value) => /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$|^09\d{9}$/.test(String(value).trim())
const isValidPassword = (value) => {
  const password = String(value).trim()
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9\s]/.test(password)
}
const passwordRequirements = 'at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character'

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

const ADMIN_DEFAULT_EMAIL = 'admin@barangay.gov.ph'
const ADMIN_DEFAULT_PASSWORD = 'AdminPass123'
const shouldAutoLoginAdmin = import.meta.env.DEV && String(import.meta.env.VITE_ALLOW_AUTO_ADMIN_LOGIN ?? 'true').toLowerCase() !== 'false'

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

function UserDetailModal({ user, onClose, onUserUpdated, allowEdit = false }) {
  const [editableUser, setEditableUser] = useState(() => ({ ...(user || {}) }))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditableUser({ ...(user || {}) })
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
              <div><dt>Email</dt><dd>{allowEdit ? <input value={editableUser.email || ''} onChange={(event) => handleFieldChange('email', event.target.value)} /> : (editableUser.email || 'N/A')}</dd></div>
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
                <div><dt>Household ID</dt><dd>{allowEdit ? <input value={editableUser.householdId || editableUser.household_id || ''} onChange={(event) => handleFieldChange('householdId', event.target.value)} /> : (editableUser.householdId || editableUser.household_id || 'N/A')}</dd></div>
                <div><dt>Family Members</dt><dd>{allowEdit ? <input type="number" min="1" value={editableUser.familyMembers ?? editableUser.family_members ?? 4} onChange={(event) => handleFieldChange('familyMembers', Number(event.target.value) || 0)} /> : (editableUser.familyMembers ?? editableUser.family_members ?? 'N/A')}</dd></div>
                <div><dt>Address</dt><dd>{allowEdit ? <input value={editableUser.address || ''} onChange={(event) => handleFieldChange('address', event.target.value)} /> : (editableUser.address || 'N/A')}</dd></div>
                <div><dt>Household Members</dt><dd>{Array.isArray(editableUser.householdMembers) && editableUser.householdMembers.length > 0 ? editableUser.householdMembers.map((member) => `${member.name} (${member.relationship})`).join(', ') : 'None listed'}</dd></div>
              </dl>
            </div>
          )}

          {role === 'staff' && (
            <div className="info-box">
              <h3>Staff Access Details</h3>
              <dl>
                <div><dt>Position</dt><dd>{allowEdit ? <input value={editableUser.position || ''} onChange={(event) => handleFieldChange('position', event.target.value)} /> : (editableUser.position || 'Staff')}</dd></div>
                <div><dt>Availability</dt><dd>{allowEdit ? <input value={editableUser.availability || ''} onChange={(event) => handleFieldChange('availability', event.target.value)} /> : (editableUser.availability || 'N/A')}</dd></div>
                <div><dt>Assigned Zone</dt><dd>{zone !== 'N/A' ? `Zone ${zone}` : 'N/A'}</dd></div>
              </dl>
            </div>
          )}

          {allowEdit && (
            <div className="modal-actions">
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

function LoginPage({ onLogin }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    identifier: '',
    password: '',
    rememberMe: false,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetForm, setResetForm] = useState({ identifier: '', token: '', newPassword: '' })
  const [resetRequested, setResetRequested] = useState(false)
  const [resetting, setResetting] = useState(false)

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target
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
      alert('Please enter both your mobile number or email and your password.')
      return
    }

    if (!isValidIdentifier(cleanedIdentifier) || cleanedPassword.length < 8) {
      alert('Incorrect credentials format. Please use a valid mobile number or email and a password with at least 8 characters.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanedIdentifier, password: cleanedPassword }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Login failed.')
      }

      const nextRole = data.user?.role || 'resident'

      onLogin({
        token: data.token,
        user: data.user,
        identifier: cleanedIdentifier,
        role: nextRole,
        isActive: true,
      })
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
      <header className="topbar" aria-label="Top bar">
        <div className="topbar-inner">
          <div className="topbar-title">Official Resident</div>
          <div className="topbar-location">Barangay Legaspi</div>
        </div>
      </header>

      <main className="login-screen">
        <div className="brand-block" aria-label="Barangay brand">
          <div className="brand-stack">
            <img
              className="seal-logo"
              src={barangaySeal}
              alt="Barangay Legaspi official seal"
              style={{
                borderRadius: '50%',
                padding: '0',
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
              }}
            />
            <div className="brand-copy">
              <h1>Barangay Legaspi</h1>
              <p>Resident Portal</p>
            </div>
          </div>
        </div>

        <section className="login-card" aria-label="Login form">
          <h2>Sign in to your account</h2>

          <form onSubmit={handleSubmit} noValidate>
            <div className="field-group">
              <label htmlFor="identifier">Mobile Number or Email</label>
              <input
                id="identifier"
                name="identifier"
                type="text"
                value={form.identifier}
                onChange={handleChange}
                placeholder="09XXXXXXXXX or email address"
                autoComplete="username"
              />
            </div>

            <div className="field-group password-field">
              <div className="label-row">
                <label htmlFor="password">Password</label>
                <button type="button" className="text-button" aria-label="Forgot password" onClick={() => setShowReset(true)}>
                  Forgot password?
                </button>
              </div>

              <div className="password-wrap">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="toggle-password"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
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
                <span>Remember me</span>
              </label>
            </div>

            <button type="submit" className="primary-btn" aria-label="Log in">
              Log In
            </button>
          </form>

          <div className="login-helper" aria-label="Official access notice">
            <span className="helper-pill">Official access only</span>
            <p>Use your barangay-issued mobile number or email and password.</p>
          </div>

          <p className="approval-notice">New resident accounts require administrator approval before web app access is granted.</p>

          <p className="signup-line">
            Don&apos;t have an account?
            <Link to="/register" aria-label="Create resident account">Create Resident Account</Link>
          </p>
        </section>

        <footer className="page-footer">Barangay Legaspi • Tayug, Pangasinan</footer>
      </main>

      {showReset && (
        <div className="modal-overlay" onClick={() => setShowReset(false)}>
          <form className="modal-content reset-password-modal" onSubmit={handleResetSubmit} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setShowReset(false)} aria-label="Close password reset">×</button>
            <div className="modal-header">
              <div>
                <h2>Reset password</h2>
                <p>{resetRequested ? 'Enter the one-time token and choose a new password.' : 'We will send a short-lived reset token to your registered contact.'}</p>
              </div>
            </div>
            <div className="modal-body">
              {!resetRequested && <div className="input-block">
                <label htmlFor="reset-identifier">Mobile number or email</label>
                <input id="reset-identifier" type="text" value={resetForm.identifier} onChange={(event) => setResetForm((current) => ({ ...current, identifier: event.target.value }))} required />
              </div>}
              {resetRequested && <div className="input-block">
                <label htmlFor="reset-token">One-time reset token</label>
                <input id="reset-token" type="text" value={resetForm.token} onChange={(event) => setResetForm((current) => ({ ...current, token: event.target.value }))} required />
              </div>}
              {resetRequested && <div className="input-block">
                <PasswordField id="reset-new-password" label="New password" value={resetForm.newPassword} onChange={(event) => setResetForm((current) => ({ ...current, newPassword: event.target.value }))} helpText={`${passwordRequirements}.`} />
              </div>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn small" onClick={() => { setShowReset(false); setResetRequested(false) }}>Cancel</button>
                <button type="submit" className="primary-btn small" disabled={resetting}>{resetting ? 'Working...' : resetRequested ? 'Reset password' : 'Send reset token'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function RegisterPage() {
  const navigate = useNavigate()
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
          <div className="topbar-title">Official Resident</div>
          <div className="topbar-location">Barangay Legaspi</div>
        </div>
      </header>

      <main className="register-screen">
        <div className="register-box">
          <div className="register-header">
            <img className="seal-logo small" src={barangaySeal} alt="Barangay Legaspi official seal" />
            <div>
              <h1>Create Resident Account</h1>
              <p>Register to access services and updates</p>
              <p className="register-subtext">You can add household members later if needed.</p>
            </div>
          </div>

          <form className="register-form" onSubmit={handleSubmit}>
            <div className="info-strip" aria-label="Information collection notice">
              <p className="info-strip-title">Why we ask for this</p>
              <p>
                We only collect the information needed to verify your resident account, assign your barangay zone,
                and provide barangay services. Household member details are optional.
              </p>
            </div>

            <div className="form-sections">
              <section className="form-section">
                <div className="form-section-heading">
                  <h2>1. Account details</h2>
                  <p>Used for login, contact, and verification.</p>
                </div>

                <div className="form-grid">
                  <div className="input-block">
                    <label>First Name</label>
                    <input type="text" name="firstName" value={form.firstName} onChange={handleChange} placeholder="Enter your first name" autoComplete="given-name" required />
                  </div>
                  <div className="input-block">
                    <label>Last Name</label>
                    <input type="text" name="lastName" value={form.lastName} onChange={handleChange} placeholder="Enter your last name" autoComplete="family-name" required />
                  </div>
                  <div className="input-block">
                    <label>Mobile Number</label>
                    <input type="text" name="mobile" value={form.mobile} onChange={handleChange} placeholder="09XXXXXXXXX" autoComplete="tel" inputMode="numeric" maxLength={11} required />
                  </div>
                  <div className="input-block">
                    <label>Email Address</label>
                    <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="name@email.com" autoComplete="email" required />
                  </div>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-heading">
                  <h2>2. Address details</h2>
                  <p>Used to verify your barangay record and assign your correct zone.</p>
                </div>

                <div className="form-grid">
                  <div className="input-block full-width">
                    <label>Home Address</label>
                    <input type="text" name="address" value={form.address} onChange={handleChange} placeholder="House number, street, Barangay Legaspi" autoComplete="street-address" required />
                  </div>
                  <div className="input-block">
                    <label>Zone</label>
                    <select name="zone" value={form.zone} onChange={handleChange} required>
                      <option value="">Select your zone</option>
                      {[1, 2, 3, 4, 5, 6, 7].map((zone) => <option key={zone} value={zone}>Zone {zone}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-heading">
                  <h2>3. Household details</h2>
                  <p>Optional. Add people who live at the same address if you want them included in the household record.</p>
                </div>

                <div className="input-block full-width household-members-block">
                  <div className="household-members-header">
                    <div>
                      <label>Household Members</label>
                      <small>This section is optional and only helps maintain a more complete household record.</small>
                    </div>
                    <button type="button" className="secondary-btn small" onClick={addHouseholdMember}>Add member</button>
                  </div>
                  {form.householdMembers.map((member, index) => (
                    <div className="household-member-row" key={`household-member-${index}`}>
                      <input type="text" value={member.name} onChange={(event) => updateHouseholdMember(index, 'name', event.target.value)} placeholder="Full name" aria-label={`Household member ${index + 1} name`} />
                      <select value={member.relationship} onChange={(event) => updateHouseholdMember(index, 'relationship', event.target.value)} aria-label={`Household member ${index + 1} relationship`}>
                        {relationshipOptions.map((relationship) => <option key={relationship} value={relationship}>{relationship}</option>)}
                      </select>
                      <button type="button" className="small-action danger" onClick={() => removeHouseholdMember(index)} aria-label={`Remove household member ${index + 1}`}>Remove</button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-heading">
                  <h2>4. Account security</h2>
                  <p>Used to protect your account and keep your login secure.</p>
                </div>

                <div className="form-grid">
                  <PasswordField id="registration-password" label="Password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Create a strong password" helpText={`${passwordRequirements}.`} />
                </div>
              </section>
            </div>

            <p className="approval-notice">
              After registration, your account will remain pending until a barangay administrator verifies it. This helps keep
              resident records accurate and ensures only valid barangay residents receive access.
            </p>

            <div className="register-actions">
              <button type="submit" className="primary-btn wide">Register as Resident</button>
              <Link to="/" className="secondary-btn">Back to Login</Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}

function DashboardPage({ profile, requests, services, announcements, events, payments, onLogout, onProfileUpdated }) {
  const [searchQuery, setSearchQuery] = useState('')
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
  const pendingRequests = (requests || []).filter((item) => item.status !== 'Approved').length

  useEffect(() => {
    setProfileForm(profile)
  }, [profile])

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
      label: 'Profile complete',
      complete: Boolean(profile.firstName && profile.lastName && profile.email && profile.mobile && profile.address),
      detail: 'Resident details are filled in',
    },
    {
      label: 'Approval status ready',
      complete: profile.status === 'Active Resident',
      detail: profile.status === 'Active Resident' ? 'Your account is active' : 'Waiting for admin verification',
    },
    {
      label: 'Recent request tracked',
      complete: (requests || []).length > 0,
      detail: (requests || []).length > 0 ? `${(requests || []).length} active request${(requests || []).length === 1 ? '' : 's'}` : 'No request submitted yet',
    },
  ]
  const onboardingProgress = Math.round((residentChecklist.filter((item) => item.complete).length / residentChecklist.length) * 100)
  const residentNotifications = [
    ...(profile.status !== 'Active Resident' ? [{ id: 'verification-pending', title: 'Verification pending', detail: 'Please wait for barangay confirmation before requesting services.' }] : []),
    ...((requests || []).slice(0, 3).map((request) => ({
      id: `request-${request.id}`,
      title: `${request.type}: ${request.status || 'Pending'}`,
      detail: request.purpose || 'Submitted and awaiting review.',
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
      <header className="dashboard-topbar">
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
              placeholder="Search services, updates..."
              aria-label="Search resident dashboard"
            />
          </label>
          <button className="notification-button" type="button" aria-label={`${unreadNotificationCount} unread notifications`} onClick={() => setNotificationsOpen((current) => !current)}>
            <span aria-hidden="true">🔔</span>
            {unreadNotificationCount > 0 && <span className="notification-count">{unreadNotificationCount}</span>}
          </button>
          <button className="profile-pill" type="button" aria-label="Edit profile" onClick={() => setEditingProfile(true)}>
            <span className="avatar">{(profile.firstName || '').charAt(0)}</span>
            <span>{profile.firstName}</span>
          </button>
          <button className="logout-btn" type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="dashboard-main resident-dashboard-main">
        <section className="content-panel resident-dashboard-panel">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">Good morning</p>
              <h1>Welcome back, {profile.firstName}</h1>
            </div>
            <p>Pending requests: {pendingRequests}</p>
          </div>

          <nav className="mobile-quick-nav" aria-label="Quick access">
            <button type="button" onClick={() => navigate('/requests')}><span aria-hidden="true">📄</span> Requests</button>
            <button type="button" onClick={() => document.getElementById('announcements-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span aria-hidden="true">📢</span> Updates</button>
            <button type="button" onClick={() => navigate('/events')}><span aria-hidden="true">📅</span> Events</button>
            <button type="button" onClick={() => navigate('/payments')}><span aria-hidden="true">💳</span> Payments</button>
          </nav>

          {profile.status && profile.status !== 'Active Resident' && (
            <div className="verification-banner">
              <strong>Account verification pending</strong>
              <span>An administrator must verify your Barangay Legaspi residency before you can submit service requests.</span>
            </div>
          )}

          {showOnboarding && (
            <div className="onboarding-welcome" role="dialog" aria-labelledby="onboarding-title">
              <div>
                <p className="eyebrow">New resident guide</p>
                <h2 id="onboarding-title">Everything you need is here.</h2>
                <p>Complete your profile, wait for verification, then choose a service to start a request. You can find updates and request progress on this dashboard.</p>
              </div>
              <div className="onboarding-actions">
                <button type="button" className="secondary-btn small" onClick={completeOnboarding}>Got it</button>
                <button type="button" className="primary-btn small" onClick={() => { completeOnboarding(); setEditingProfile(true) }}>Complete profile</button>
              </div>
            </div>
          )}

          <div className="onboarding-card">
            <div className="onboarding-header">
              <div>
                <p className="eyebrow">Resident progress</p>
                <h2>Getting started checklist</h2>
              </div>
              <span className="progress-pill">{onboardingProgress}% complete</span>
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

          <div className="stats-grid" aria-label="Resident summary">
            <article className="stat-card accent">
              <div className="stat-header">
                <span className="label">Requests</span>
                <span className="badge success">Live</span>
              </div>
              <div className="stat-number">{requests.length}</div>
              <p>Total submitted</p>
            </article>
            <article className="stat-card">
              <div className="stat-header">
                <span className="label">Pending</span>
                <span className="badge warning">Review</span>
              </div>
              <div className="stat-number">{pendingRequests}</div>
              <p>Awaiting action</p>
            </article>
            <article className="stat-card">
              <div className="stat-header">
                <span className="label">Services</span>
                <span className="badge info">Now</span>
              </div>
              <div className="stat-number">{filteredServices.length}</div>
              <p>Available services</p>
            </article>
            <article className="stat-card">
              <div className="stat-header">
                <span className="label">Announcements</span>
                <span className="badge danger">Updated</span>
              </div>
              <div className="stat-number">{filteredAnnouncements.length}</div>
              <p>Latest updates</p>
            </article>
          </div>

          <div className="dashboard-body">
            <div className="main-column">
              <article className="panel-card" id="announcements-section">
                <div className="panel-header">
                  <h2>Current Situation</h2>
                  <span className="soft-label">Recent announcements</span>
                </div>
                <ul className="notice-list">
                  {filteredAnnouncements.length > 0 ? filteredAnnouncements.map((announcement) => (
                    <li key={`${announcement.title}-${announcement.date}`}>
                      <span className={`dot ${announcement.tag || 'green'}`} aria-hidden="true" />
                      <div>
                        <strong>{announcement.title}</strong>
                        <small>{announcement.date}</small>
                        <p>{announcement.content}</p>
                      </div>
                    </li>
                  )) : <li><div className="empty-state">No current announcements match your search.</div></li>}
                </ul>
              </article>

              <article className="panel-card">
                <div className="panel-header">
                  <h2>Available Services</h2>
                  <span className="soft-label">Resident support</span>
                </div>
                <div className="service-list">
                  {filteredServices.length > 0 ? filteredServices.map((service) => (
                    <button
                      key={service.title}
                      type="button"
                      className="service-item"
                      aria-label={`Request ${service.title}`}
                      onClick={() => navigate(`/requests?service=${encodeURIComponent(service.title)}`)}
                    >
                      <span className={`service-icon ${service.tone || 'green'}`}>{service.icon || '📄'}</span>
                      <span>
                        <strong>{service.title}</strong>
                        <small>{service.subtitle}</small>
                      </span>
                      <span className={`service-status ${(requests || []).find((request) => request.type === service.title && request.status !== 'Rejected')?.status?.toLowerCase() || 'available'}`}>
                        {(requests || []).find((request) => request.type === service.title && request.status !== 'Rejected')?.status || 'Available'}
                      </span>
                    </button>
                  )) : <div className="empty-state">No services match your search.</div>}
                </div>
              </article>
            </div>

            <aside className="side-column">
              <article className="profile-card">
                <div className="profile-head">
                  <div className="profile-avatar">{(profile.firstName || 'R').charAt(0).toUpperCase()}</div>
                  <div>
                    <h3>{profile.firstName} {profile.lastName}</h3>
                    <span>Resident account</span>
                  </div>
                  <button type="button" className="secondary-btn tiny" onClick={() => setEditingProfile(true)}>Edit</button>
                </div>
                <dl className="profile-list">
                  <div><dt>Household ID</dt><dd>{profile.householdId || 'N/A'}</dd></div>
                  <div><dt>Address</dt><dd>{profile.address || 'N/A'}</dd></div>
                  <div><dt>Email</dt><dd>{profile.email || 'N/A'}</dd></div>
                  <div><dt>Mobile</dt><dd>{profile.mobile || 'N/A'}</dd></div>
                </dl>
              </article>

              <article className="panel-card compact-panel">
                <div className="panel-header notification-panel-header">
                  <h2>Updates &amp; Alerts</h2>
                  <button type="button" className="text-button" onClick={markNotificationsRead} disabled={unreadNotificationCount === 0}>Mark all read</button>
                </div>
                <ul className="notification-feed">
                  {residentNotifications.length > 0 ? residentNotifications.map((notification) => (
                    <li key={notification.id} className={readNotificationIds.includes(notification.id) ? 'read' : 'unread'}>
                      <strong>{notification.title}</strong>
                      <small>{notification.detail}</small>
                    </li>
                  )) : <li><div className="empty-state">No new alerts.</div></li>}
                </ul>
              </article>

              <article className="panel-card">
                <div className="panel-header left-align">
                  <h2>Upcoming Events</h2>
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
                  )) : <div className="empty-state">No events match your search.</div>}
                </div>
              </article>

              <article className="panel-card">
                <div className="panel-header left-align">
                  <h2>Payments</h2>
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
                  )) : <div className="empty-state">No payments match your search.</div>}
                </div>
              </article>
            </aside>
          </div>
        </section>
      </main>
      {notificationsOpen && (
        <div className="notification-popover" role="dialog" aria-label="Notification center">
          <div className="notification-popover-header">
            <div>
              <strong>Notification center</strong>
              <small>{unreadNotificationCount ? `${unreadNotificationCount} unread` : 'All caught up'}</small>
            </div>
            <button type="button" className="modal-close" aria-label="Close notification center" onClick={() => setNotificationsOpen(false)}>×</button>
          </div>
          <div className="notification-popover-list">
            {residentNotifications.length > 0 ? residentNotifications.map((notification) => (
              <button type="button" key={notification.id} className={`notification-popover-item ${readNotificationIds.includes(notification.id) ? 'read' : 'unread'}`} onClick={() => markNotificationRead(notification.id)}>
                <strong>{notification.title}</strong>
                <small>{notification.detail}</small>
              </button>
            )) : <span className="empty-state">No notifications yet.</span>}
          </div>
        </div>
      )}
      {editingProfile && (
        <div className="modal-overlay" onClick={() => setEditingProfile(false)}>
          <form className="modal-content profile-edit-modal" onSubmit={handleProfileSave} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setEditingProfile(false)} aria-label="Close profile editor">×</button>
            <div className="modal-header">
              <div>
                <h2>Edit profile</h2>
                <p>Update your resident account information.</p>
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
                <button type="button" className="secondary-btn small" onClick={() => setEditingProfile(false)}>Cancel</button>
                <button type="submit" className="primary-btn small" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function RequestsPage({ requests, onSubmit, onLogout }) {
  const requestTypes = ['Barangay Certificate', 'Barangay Clearance', 'Medical Assistance', 'Emergency Help']
  const requestedService = new URLSearchParams(window.location.search).get('service')
  const [form, setForm] = useState({
    type: requestTypes.includes(requestedService) ? requestedService : 'Barangay Certificate',
    purpose: '',
    notes: '',
  })
  const [submitted, setSubmitted] = useState(false)

  const requestStatusSteps = ['Submitted', 'In Review', 'Finalized']
  const recentRequests = [...(requests || [])].slice(0, 3)

  const getRequestStatusMessage = (status) => {
    if (status === 'Approved') return 'Approved and finalized by the barangay team.'
    if (status === 'Rejected') return 'Needs clarification or is not eligible for this request type.'
    if (status === 'In Review') return 'Your request is actively being reviewed by barangay staff.'
    return 'Your request has been submitted and is waiting for initial review.'
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
      alert('Please enter the purpose of your request.')
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
      })

      setSubmitted(true)
      setForm({
        type: 'Barangay Certificate',
        purpose: '',
        notes: '',
      })
    } catch (error) {
      alert(error.message || 'Request submission failed.')
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
          <button className="logout-btn" type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card">
          <div className="panel-header big-gap">
            <h2>Request a Service</h2>
            <Link to="/dashboard" className="secondary-btn small">Back to Dashboard</Link>
          </div>

          <form className="request-form" onSubmit={handleSubmit}>
            <div className="form-grid two-col">
              <div className="input-block">
                <label>Request Type</label>
                <select name="type" value={form.type} onChange={handleChange}>
                  {requestTypes.map((type) => <option key={type}>{type}</option>)}
                </select>
              </div>
              <div className="input-block">
                <label>Purpose</label>
                <input type="text" name="purpose" value={form.purpose} onChange={handleChange} placeholder="e.g. school requirement" />
              </div>
              <div className="input-block full-width">
                <label>Notes</label>
                <textarea name="notes" rows="5" value={form.notes} onChange={handleChange} placeholder="Add details for the barangay staff"></textarea>
              </div>
            </div>

            {submitted && (
              <div className="success-banner">Request submitted successfully. Barangay staff will review it soon.</div>
            )}

            <button type="submit" className="primary-btn wide">Submit Request</button>
          </form>

          <div className="status-tracker-panel">
            <div className="panel-header big-gap">
              <h3>Request Status Tracker</h3>
            </div>
            {recentRequests.length > 0 ? recentRequests.map((item) => {
              return (
                <div key={item.id} className="request-status-card">
                  <div className="request-status-title-row">
                    <strong>{item.type}</strong>
                    <span className={'status-badge ' + (item.status || '').toLowerCase().replace(/\s+/g, '-')}>{item.status || 'Pending'}</span>
                  </div>
                  <div className="status-steps" aria-label={`Status steps for ${item.type}`}>
                    {requestStatusSteps.map((step) => {
                      const isActive =
                        (item.status === 'Approved' && step === 'Finalized') ||
                        (item.status === 'Rejected' && step === 'Finalized') ||
                        (item.status === 'In Review' && step === 'In Review') ||
                        (!['Approved', 'Rejected', 'In Review'].includes(item.status) && step === 'Submitted')

                      return <span key={`${item.id}-${step}`} className={isActive ? 'active' : ''}>{step}</span>
                    })}
                  </div>
                  <p>{getRequestStatusMessage(item.status)}</p>
                </div>
              )
            }) : <div className="empty-state">Your recent requests will appear here after submission.</div>}
          </div>

          <div className="request-table-wrap">
            <h3>Recent Requests</h3>
            <table className="request-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item) => (
                  <tr key={item.id}>
                    <td>{item.type}</td>
                    <td>{item.purpose}</td>
                    <td><span className={'status-badge ' + (item.status || '').toLowerCase().replace(/\s+/g, '-')}>{item.status}</span></td>
                    <td>{item.date}</td>
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

function ProfilePage({ profile, onLogout }) {
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
          <button className="logout-btn" type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card profile-page">
          <div className="profile-banner">
            <div className="profile-avatar large">{profile.firstName.charAt(0)}</div>
            <div>
              <h2>{profile.firstName} {profile.lastName}</h2>
              <p>Resident • Household ID: {profile.householdId}</p>
            </div>
          </div>

          <div className="profile-grid">
            <div className="info-box">
              <h3>Contact Information</h3>
              <dl>
                <div><dt>Mobile</dt><dd>{profile.mobile}</dd></div>
                <div><dt>Email</dt><dd>{profile.email}</dd></div>
                <div><dt>Address</dt><dd>{profile.address}</dd></div>
              </dl>
            </div>

            <div className="info-box">
              <h3>Household Details</h3>
              <dl>
                <div><dt>Family Members</dt><dd>{profile.familyMembers}</dd></div>
                <div><dt>Barangay Status</dt><dd>{profile.status}</dd></div>
                <div><dt>Last Updated</dt><dd>June 24, 2026</dd></div>
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

function PaymentsPage({ payments, onLogout }) {
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
          <button className="logout-btn" type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card">
          <div className="panel-header big-gap">
            <h2>Payments</h2>
            <Link to="/dashboard" className="secondary-btn small">Back to Dashboard</Link>
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
                {(payments || []).map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.id}</td>
                    <td>{payment.label}</td>
                    <td><span className={'status-badge ' + String(payment.status).toLowerCase()}>{payment.status}</span></td>
                    <td>{payment.amount}</td>
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

function EventsPage({ events, onLogout }) {
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
          <button className="logout-btn" type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card">
          <div className="panel-header big-gap">
            <h2>Upcoming Events</h2>
            <Link to="/dashboard" className="secondary-btn small">Back to Dashboard</Link>
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

function SettingsPage({ profile, onLogout }) {
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [savingPassword, setSavingPassword] = useState(false)

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
            <small>Resident Portal</small>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="logout-btn" type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="page-content padded">
        <div className="page-card profile-page">
          <div className="profile-banner">
            <div className="profile-avatar large">{profile.firstName.charAt(0)}</div>
            <div>
              <h2>Preferences</h2>
              <p>Manage your resident account settings</p>
            </div>
          </div>

          <div className="profile-grid">
            <div className="info-box">
              <h3>Account</h3>
              <dl>
                <div><dt>Name</dt><dd>{profile.firstName} {profile.lastName}</dd></div>
                <div><dt>Email</dt><dd>{profile.email}</dd></div>
                <div><dt>Mobile</dt><dd>{profile.mobile}</dd></div>
              </dl>
            </div>

            <div className="info-box">
              <h3>Security</h3>
              <form className="password-change-form" onSubmit={handlePasswordSubmit}>
                <PasswordField id="current-password" label="Current password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} />
                <PasswordField id="new-password" label="New password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} />
                <PasswordField id="confirm-password" label="Confirm new password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} helpText={`${passwordRequirements}.`} />
                <button type="submit" className="primary-btn small" disabled={savingPassword}>{savingPassword ? 'Saving...' : 'Change password'}</button>
              </form>
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

function StaffPage({ requests, staffMembers = [], announcements = [], currentUser, userRole = 'staff', onProcessRequest, onLogout, onAddStaffMember, onAddAnnouncement, onDeleteAnnouncement, onDeleteStaffMember }) {
  const [activeTab, setActiveTab] = useState('queue')
  const [openRequestPanel, setOpenRequestPanel] = useState(null)
  const [queueSearch, setQueueSearch] = useState('')
  const [queueStatus, setQueueStatus] = useState('active')
  const [queueZone, setQueueZone] = useState('all')
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
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    content: '',
    tag: 'green',
    date: new Date().toLocaleDateString(),
  })
  const [archiveFiles, setArchiveFiles] = useState([])
  const [archiveStatus, setArchiveStatus] = useState(null)
  const [archiving, setArchiving] = useState(false)
  const [activeRecordsPanel, setActiveRecordsPanel] = useState(null)

  const pendingCount = requests.filter((item) => item.status === 'Pending' || item.status === 'In Review').length
  const approvedCount = requests.filter((item) => item.status === 'Approved').length
  const totalRequests = requests.length
  const filteredQueueRequests = requests.filter((item) => {
    const search = queueSearch.trim().toLowerCase()
    const residentName = `${item.first_name || item.firstName || ''} ${item.last_name || item.lastName || ''}`.toLowerCase()
    const matchesSearch = !search || residentName.includes(search) || String(item.type || '').toLowerCase().includes(search) || String(item.purpose || '').toLowerCase().includes(search)
    const matchesStatus = queueStatus === 'all' || (queueStatus === 'active' ? !['Approved', 'Rejected'].includes(item.status) : item.status === queueStatus)
    const matchesZone = queueZone === 'all' || String(item.zone || item.zoneNumber || '') === queueZone
    return matchesSearch && matchesStatus && matchesZone
  })

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
      const blobUrl = URL.createObjectURL(await response.blob())
      if (download) {
        const link = document.createElement('a')
        link.href = blobUrl
        link.download = fileName
        link.click()
      } else {
        window.open(blobUrl, '_blank', 'noopener,noreferrer')
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
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
    } catch (error) {
      alert(error.message || 'Unable to add staff member.')
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
      })

      setAnnouncementForm({
        title: '',
        content: '',
        tag: 'green',
        date: new Date().toLocaleDateString(),
      })
    } catch (error) {
      alert(error.message || 'Unable to publish announcement.')
    }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="brand-wrap">
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>Staff Portal</small>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="role-chip">{getDisplayName(currentUser)} • {userRole === 'admin' ? 'Administrator' : 'Staff'}</span>
          <button className="logout-btn" type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="dashboard-main">
        <aside className="sidebar" aria-label="Staff navigation">
          <nav className="sidebar-nav">
            <span 
              className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
              onClick={() => setActiveTab('queue')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">📄</span><span>Queue</span>
            </span>
            <span 
              className={`nav-item ${activeTab === 'approvals' ? 'active' : ''}`}
              onClick={() => setActiveTab('approvals')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">✓</span><span>Approvals</span>
            </span>
            <span 
              className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`}
              onClick={() => setActiveTab('reports')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">📊</span><span>Reports</span>
            </span>
            <span 
              className={`nav-item ${activeTab === 'announcements' ? 'active' : ''}`}
              onClick={() => setActiveTab('announcements')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">📣</span><span>Announcements</span>
            </span>
            <span 
              className={`nav-item ${activeTab === 'staff' ? 'active' : ''}`}
              onClick={() => setActiveTab('staff')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">👥</span><span>Staff Directory</span>
            </span>
          </nav>
        </aside>

        <section className="content-panel" aria-label="Staff overview">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">Operations</p>
              <h1>{activeTab === 'queue' ? 'Resident request review' : activeTab === 'reports' ? 'Service Reports' : activeTab === 'announcements' ? 'Announcements' : activeTab === 'staff' ? 'Staff Directory' : 'Approvals Management'}</h1>
            </div>
            <span className="counter-pill">{activeTab === 'queue' ? totalRequests : activeTab === 'approvals' ? approvedCount : ''} {activeTab === 'queue' ? 'requests' : activeTab === 'approvals' ? 'processed' : ''}</span>
          </div>

          <div className="stats-grid" aria-label="Staff summary">
            <article className="stat-card accent">
              <div className="stat-header">
                <span className="label">Pending</span>
              </div>
              <div className="stat-number">{pendingCount}</div>
              <p>Needs review</p>
            </article>

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">Approved</span>
              </div>
              <div className="stat-number">{approvedCount}</div>
              <p>Completed</p>
            </article>

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">Response</span>
              </div>
              <div className="stat-number">2h</div>
              <p>Average turnaround</p>
            </article>

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">On Queue</span>
              </div>
              <div className="stat-number">{Math.max(totalRequests - approvedCount, 0)}</div>
              <p>Active cases</p>
            </article>
          </div>

          <div className="dashboard-body">
            <div className="main-column">
              {activeTab === 'queue' && (
                <article className="panel-card">
                  <button
                    type="button"
                    className="collapsible-panel-header"
                    aria-expanded={openRequestPanel === 'queue'}
                    onClick={() => setOpenRequestPanel((current) => current === 'queue' ? null : 'queue')}
                  >
                    <span>
                      <h2>Resident Requests Queue</h2>
                      <span className="soft-label">Updated today</span>
                    </span>
                    <span className={`collapse-chevron ${openRequestPanel === 'queue' ? 'open' : ''}`}>▾</span>
                  </button>

                  {openRequestPanel === 'queue' && <>
                  <div className="staff-queue-filters">
                    <input type="search" value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Search resident, service, or purpose" aria-label="Search request queue" />
                    <select value={queueStatus} onChange={(event) => setQueueStatus(event.target.value)} aria-label="Filter request status">
                      <option value="active">Active queue</option>
                      <option value="all">All statuses</option>
                      <option value="Pending">Pending</option>
                      <option value="In Review">In Review</option>
                    </select>
                    <select value={queueZone} onChange={(event) => setQueueZone(event.target.value)} aria-label="Filter request zone">
                      <option value="all">All zones</option>
                      {[1, 2, 3, 4, 5, 6, 7].map((zone) => <option key={zone} value={String(zone)}>Zone {zone}</option>)}
                    </select>
                  </div>
                  <div className="request-table-wrap">
                    <table className="request-table">
                      <thead>
                        <tr>
                          <th>Resident</th>
                          <th>Type</th>
                          <th>Purpose</th>
                          <th>Priority</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredQueueRequests.map((item) => (
                          <tr key={item.id}>
                            <td>{item.first_name || item.firstName || 'Resident'} {item.last_name || item.lastName || ''}</td>
                            <td>{item.type}</td>
                            <td>{item.purpose}</td>
                            <td><span className={`priority-badge ${item.type === 'Emergency Help' ? 'urgent' : 'normal'}`}>{item.type === 'Emergency Help' ? 'Urgent' : 'Normal'}</span></td>
                            <td>
                              <div className="action-row">
                                <button type="button" className="small-action success" onClick={() => onProcessRequest(item.id, 'Approved')}>Approve</button>
                                <button type="button" className="small-action danger" onClick={() => onProcessRequest(item.id, 'Rejected')}>Reject</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredQueueRequests.length === 0 && <div className="empty-state">No requests match the selected filters.</div>}
                  </div>
                  </>}

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
                      <h2>Approved Requests</h2>
                      <span className="soft-label">{approvedCount} completed</span>
                    </span>
                    <span className={`collapse-chevron ${openRequestPanel === 'approvals' ? 'open' : ''}`}>▾</span>
                  </button>

                  {openRequestPanel === 'approvals' && <div className="request-table-wrap">
                    <table className="request-table">
                      <thead>
                        <tr>
                          <th>Resident</th>
                          <th>Type</th>
                          <th>Purpose</th>
                          <th>Status</th>
                          <th>Approved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.filter((item) => item.status === 'Approved').map((item) => (
                          <tr key={item.id}>
                            <td>{item.first_name || item.firstName || 'Resident'} {item.last_name || item.lastName || ''}</td>
                            <td>{item.type}</td>
                            <td>{item.purpose}</td>
                            <td><span className={`status-badge approved`}>Approved</span></td>
                            <td><span className="soft-label">{item.date}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>}

                </article>
              )}

              {activeTab === 'reports' && (
                <article className="panel-card">
                  <div className="panel-header">
                    <h2>Service Reports</h2>
                    <span className="soft-label">Monthly statistics</span>
                  </div>

                  <div className="report-grid">
                    <div className="report-item">
                      <div className="report-badge green">📈</div>
                      <div>
                        <h4>Total Requests Processed</h4>
                        <p className="report-value">{totalRequests}</p>
                      </div>
                    </div>
                    <div className="report-item">
                      <div className="report-badge blue">✓</div>
                      <div>
                        <h4>Approved Requests</h4>
                        <p className="report-value">{approvedCount}</p>
                      </div>
                    </div>
                    <div className="report-item">
                      <div className="report-badge amber">⏳</div>
                      <div>
                        <h4>Pending Review</h4>
                        <p className="report-value">{pendingCount}</p>
                      </div>
                    </div>
                    <div className="report-item">
                      <div className="report-badge">⚡</div>
                      <div>
                        <h4>Average Response Time</h4>
                        <p className="report-value">2 hours</p>
                      </div>
                    </div>
                  </div>

                  <div className="info-box" style={{marginTop: '20px'}}>
                    <h3>Service Efficiency</h3>
                    <dl>
                      <div><dt>Approval Rate</dt><dd>{totalRequests > 0 ? Math.round((approvedCount / totalRequests) * 100) : 0}%</dd></div>
                      <div><dt>Pending Rate</dt><dd>{totalRequests > 0 ? Math.round((pendingCount / totalRequests) * 100) : 0}%</dd></div>
                      <div><dt>Processing Time Target</dt><dd>Under 2 hours</dd></div>
                    </dl>
                  </div>
                </article>
              )}

              {activeTab === 'announcements' && (
                <article className="panel-card">
                  <div className="panel-header">
                    <h2>Announcements</h2>
                    <span className="soft-label">{announcements.length} active</span>
                  </div>

                  <form className="editor-panel" onSubmit={handleAnnouncementSubmit}>
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
                    </div>
                    <div className="editor-actions">
                      <button type="submit" className="primary-btn small">Publish Announcement</button>
                    </div>
                  </form>

                  <div className="announcement-list">
                    {announcements.map((item) => (
                      <div key={item.id || item.title} className="announcement-item">
                        <div className={'ann-badge ' + item.tag}></div>
                        <div className="ann-content">
                          <strong>{item.title}</strong>
                          <p>{item.content || 'No additional content'}</p>
                          <small>{item.date}</small>
                        </div>
                        <button
                          type="button"
                          className="small-action danger"
                          onClick={() => {
                            if (window.confirm('Delete this announcement?')) {
                              onDeleteAnnouncement?.(item.id || item.title)
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </article>
              )}

              {activeTab === 'staff' && (
                <article className="panel-card">
                  <div className="panel-header">
                    <h2>Staff Directory</h2>
                    <span className="soft-label">{staffMembers.length} staff members available</span>
                  </div>

                  <form className="editor-panel" onSubmit={handleStaffSubmit}>
                    <div className="editor-grid">
                      <div className="input-block">
                        <label>First Name</label>
                        <input type="text" value={staffForm.firstName} onChange={(event) => setStaffForm((prev) => ({ ...prev, firstName: event.target.value }))} placeholder="First name" />
                      </div>
                      <div className="input-block">
                        <label>Last Name</label>
                        <input type="text" value={staffForm.lastName} onChange={(event) => setStaffForm((prev) => ({ ...prev, lastName: event.target.value }))} placeholder="Last name" />
                      </div>
                      <div className="input-block">
                        <label>Position</label>
                        <select value={staffForm.position} onChange={(event) => setStaffForm((prev) => ({ ...prev, position: event.target.value }))}>
                          <option value="Staff">Staff</option>
                          <option value="Secretary">Secretary</option>
                          <option value="Barangay Captain">Barangay Captain</option>
                          <option value="Treasurer">Treasurer</option>
                          <option value="Utility Worker">Utility Worker</option>
                        </select>
                      </div>
                      <div className="input-block">
                        <label>Availability</label>
                        <select value={staffForm.availability} onChange={(event) => setStaffForm((prev) => ({ ...prev, availability: event.target.value }))}>
                          <option value="Available">Available</option>
                          <option value="Busy">Busy</option>
                          <option value="On Duty">On Duty</option>
                        </select>
                      </div>
                      <div className="input-block">
                        <label>Email</label>
                        <input type="email" value={staffForm.email} onChange={(event) => setStaffForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="name@barangay.gov.ph" />
                      </div>
                      <div className="input-block">
                        <label>Mobile</label>
                        <input type="text" value={staffForm.mobile} onChange={(event) => setStaffForm((prev) => ({ ...prev, mobile: event.target.value }))} placeholder="09XXXXXXXXX" />
                      </div>
                      <PasswordField id="staff-initial-password" label="Initial Password" value={staffForm.password} onChange={(event) => setStaffForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Create staff password" helpText={`${passwordRequirements}.`} />
                    </div>
                    <div className="editor-actions">
                      <button type="submit" className="primary-btn small">Add Staff Member</button>
                    </div>
                  </form>

                  <div className="staff-grid">
                    {staffMembers.map((member) => (
                      <div key={member.id} className="staff-card" onClick={() => setSelectedUser(member)} style={{ cursor: 'pointer' }}>
                        <div className="staff-avatar">{(member.firstName || 'S').charAt(0)}</div>
                        <div className="staff-info">
                          <h4>{member.firstName} {member.lastName}</h4>
                          <p className="position">{member.position}</p>
                          <p className="availability">
                            <span className={'availability-badge ' + (member.availability === 'Available' ? 'available' : 'unavailable')}>
                              {member.availability}
                            </span>
                          </p>
                          <p className="contact">{member.mobile}</p>
                          <p className="contact">{member.email}</p>
                        </div>
                        <button
                          type="button"
                          className="small-action danger"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (window.confirm(`Delete ${member.firstName} ${member.lastName} from the staff directory?`)) {
                              onDeleteStaffMember?.(member.id)
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </article>
              )}
            </div>

            <aside className="side-column">
              <article className="panel-card stack-card records-panel">
                <div className="panel-header left-align">
                  <h2>Records</h2>
                </div>

                <div className="records-stack">
                  <button
                    type="button"
                    className={`record-panel-card ${activeRecordsPanel === 'queue' ? 'selected' : ''}`}
                    onClick={() => setActiveRecordsPanel((prev) => prev === 'queue' ? null : 'queue')}
                  >
                    <span className="record-panel-title">On Queue &amp;<br />Approvals</span>
                    <span className="record-panel-counts">
                      <span>Pending <strong>{pendingCount}</strong></span>
                      <span>Approved <strong>{approvedCount}</strong></span>
                    </span>
                  </button>

                  {activeRecordsPanel === 'queue' && (
                    <div className="record-dedicated-space">
                      <div className="record-details record-details-compact">
                        <div className="record-section">
                          <h4>Queue</h4>
                          <ul>
                            {requests.slice(0, 6).map((item) => (
                              <li key={item.id}><span>{item.type}</span><strong>{item.status}</strong></li>
                            ))}
                            {totalRequests > 6 && <li className="summary-item">+ {totalRequests - 6} more requests waiting</li>}
                            {requests.length === 0 && <li className="summary-item">No requests in queue</li>}
                          </ul>
                        </div>

                        <div className="record-section">
                          <h4>Approvals</h4>
                          <ul>
                            {requests.filter((item) => item.status === 'Approved').slice(0, 6).map((item) => (
                              <li key={item.id}><span>{item.type}</span><strong>Approved</strong></li>
                            ))}
                            {approvedCount > 6 && <li className="summary-item">+ {approvedCount - 6} more approvals saved</li>}
                            {approvedCount === 0 && <li className="summary-item">No approvals recorded</li>}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className={`record-panel-card ${activeRecordsPanel === 'archive' ? 'selected' : ''}`}
                    onClick={() => setActiveRecordsPanel((prev) => prev === 'archive' ? null : 'archive')}
                  >
                    <span className="record-panel-title">Archive queue &amp;<br />approvals</span>
                    <span className="record-panel-count">{archiveFiles.length}</span>
                  </button>

                  {activeRecordsPanel === 'archive' && (
                    <div className="record-dedicated-space">
                      <div className="record-details archive-record-details">
                        <div className="archive-inline-actions">
                          <button type="button" className="secondary-btn small" onClick={() => handleArchiveQueue(1)} disabled={archiving}>Archive 24h</button>
                          <button type="button" className="primary-btn small" onClick={() => handleArchiveQueue(0)} disabled={archiving}>Store today</button>
                        </div>
                        {archiveStatus && (
                          <p className="archive-note">Archived {archiveStatus.count || 0} records on {new Date(archiveStatus.archivedAt || Date.now()).toLocaleDateString()}.</p>
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
                            <p className="soft-label">No archived queue records yet.</p>
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
                    <h3>Staff Highlights</h3>
                    <span>Barangay support desk</span>
                  </div>
                </div>
                <dl className="profile-list">
                  <div><dt>Shift</dt><dd>08:00 AM – 05:00 PM</dd></div>
                  <div><dt>Desk</dt><dd>Municipal Services</dd></div>
                  <div><dt>Priority</dt><dd>Certificate & clearance</dd></div>
                  <div><dt>Notes</dt><dd>Keep response time under 2 hours</dd></div>
                </dl>
              </article>
            </aside>
          </div>
        </section>
      </main>
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} allowEdit onUserUpdated={(updated) => {
        setSelectedUser((prev) => ({ ...(prev || {}), ...updated }))
        setUsers((prev) => prev.map((user) => user.id === updated.id ? { ...user, ...updated } : user))
      }} />}
    </div>
  )
}

function AdminPage({ users, residents = [], requests, reports = [], currentUser, onLogout }) {
  const zoneNumbers = [1, 2, 3, 4, 5, 6, 7]
  const [managedUsers, setManagedUsers] = useState(users)
  const [activeTab, setActiveTab] = useState('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [accessSearch, setAccessSearch] = useState('')
  const [adminForm, setAdminForm] = useState({ firstName: '', lastName: '', email: '', mobile: '', password: '' })
  const [selectedZone, setSelectedZone] = useState('all')
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedReport, setSelectedReport] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [archives, setArchives] = useState([])
  const [archiving, setArchiving] = useState(false)
  const [archiveResult, setArchiveResult] = useState(null)
  const [retentionDays, setRetentionDays] = useState(0)
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
  
  const residentCount = managedUsers.filter((user) => user.role === 'resident').length
  const staffCount = managedUsers.filter((user) => user.role === 'staff').length
  const admins = managedUsers.filter((user) => user.role === 'admin').length
  const pending = requests.filter((item) => item.status === 'Pending' || item.status === 'In Review').length
  const pendingVerificationUsers = managedUsers.filter((user) => user.role === 'resident' && user.status === 'Pending Verification')
  const approvedUsers = managedUsers.filter((user) => user.role === 'resident' && user.status === 'Active Resident').length
  const requestCountsByType = requests.reduce((counts, request) => {
    counts[request.type] = (counts[request.type] || 0) + 1
    return counts
  }, {})
  const notifications = [
    pendingVerificationUsers.length > 0 && `${pendingVerificationUsers.length} resident account${pendingVerificationUsers.length === 1 ? '' : 's'} awaiting verification`,
    pending > 0 && `${pending} service request${pending === 1 ? '' : 's'} need review`,
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
  const activityEntries = auditLogs.length > 0 ? auditLogs.slice(0, 8).map((entry) => ({
    id: entry.id,
    label: entry.action,
    detail: `${entry.actorRole || 'system'} • ${entry.targetType || 'record'} ${entry.targetId || ''}`,
    date: entry.createdAt || entry.created_at,
  })) : derivedActivityEntries

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
      alert('Administrator account created. Share the initial password securely and ask them to change it after signing in.')
    } catch (error) {
      alert(error.message || 'Unable to create administrator.')
    }
  }

  const handleVerification = (user, status) => {
    updateManagedUser(user.id, { status })
  }

  const getSortName = (person = {}) => {
    const firstName = person.firstName ?? person.first_name ?? ''
    const lastName = person.lastName ?? person.last_name ?? ''
    return `${lastName} ${firstName}`.trim().toLowerCase()
  }

  const filteredResidents = residents.filter((resident) => {
    const matchesSearch = searchQuery === '' || 
      (resident.firstName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (resident.lastName || '').toLowerCase().includes(searchQuery.toLowerCase())
    
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
  })).filter((group) => group.residents.length > 0 || selectedZone === 'all')

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
        if (resp.ok) {
          const data = await resp.json()
          setApprovals(data.approvals || [])
        }
      } catch (err) {
        console.error('fetch approvals error', err)
      }
    }

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
      fetchApprovals()
      fetchArchives()
    }

    if (activeTab === 'overview' || activeTab === 'access') {
      fetch(`${API_BASE}/admin/audit-logs`)
        .then((response) => response.ok ? response.json() : { logs: [] })
        .then((data) => setAuditLogs(data.logs || []))
        .catch((error) => console.error('fetch audit logs error', error))
    }
  }, [activeTab])

  const handleArchiveNow = async () => {
    const numericDays = Number(retentionDays)
    const daysToArchive = Number.isFinite(numericDays) ? Math.max(0, numericDays) : 7
    setArchiving(true)
    setArchiveResult(null)
    try {
      const resp = await fetch(`${API_BASE}/admin/archive-approvals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: daysToArchive }) })
      const data = await resp.json()
      setArchiveResult(data.archive || null)
      const r2 = await fetch(`${API_BASE}/admin/approvals`)
      if (r2.ok) { setApprovals((await r2.json()).approvals || []) }
      const r3 = await fetch(`${API_BASE}/admin/archives`)
      if (r3.ok) { setArchives((await r3.json()).archives || []) }
    } catch (err) {
      console.error('archive now error', err)
      alert('Archive failed')
    } finally {
      setArchiving(false)
    }
  }

  const handleDeleteArchive = async (fileName) => {
    if (!fileName) return
    if (!window.confirm(`Delete archive ${fileName}?`)) return

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
      <header className="dashboard-topbar">
        <div className="brand-wrap">
          <img className="seal-logo tiny" src={barangaySeal} alt="Barangay Legaspi official seal" />
          <div>
            <div className="brand-name">Barangay Legaspi</div>
            <small>Admin Portal</small>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="admin-identity" aria-label={`Signed in as ${getDisplayName(currentUser)}`}>
            <small>Signed in as</small>
            <strong>{getDisplayName(currentUser)}</strong>
            <span>{currentUser?.email || currentUser?.mobile || 'Administrator'}</span>
          </div>
          <span className="role-chip">Admin Console</span>
          <button className="logout-btn" type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="dashboard-main">
        <aside className="sidebar" aria-label="Admin navigation">
          <nav className="sidebar-nav">
            <span 
              className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">🧭</span><span>Overview</span>
            </span>
            <span 
              className={`nav-item ${activeTab === 'residents' ? 'active' : ''}`}
              onClick={() => setActiveTab('residents')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">👥</span><span>Residents</span>
            </span>
            <span 
              className={`nav-item ${activeTab === 'access' ? 'active' : ''}`}
              onClick={() => setActiveTab('access')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">🔐</span><span>Access</span>
            </span>
            <span 
              className={`nav-item ${activeTab === 'emergencies' ? 'active' : ''}`}
              onClick={() => setActiveTab('emergencies')}
              style={{cursor: 'pointer'}}
            >
              <span className="nav-icon">🚨</span><span>Emergencies</span>
            </span>
          </nav>
        </aside>

        <section className="content-panel" aria-label="Admin overview">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">Governance</p>
              <h1>{activeTab === 'overview' ? 'Barangay command center' : activeTab === 'residents' ? 'Residents by Zone' : activeTab === 'access' ? 'User Access Management' : 'Emergency Reports'}</h1>
            </div>
            <span className="counter-pill">{pending} pending</span>
          </div>

          <div className="stats-grid" aria-label="Admin summary">
            <article className="stat-card accent">
              <div className="stat-header">
                <span className="label">Residents</span>
              </div>
              <div className="stat-number">{residentCount}</div>
              <p>Active households</p>
            </article>

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">Staff</span>
              </div>
              <div className="stat-number">{staffCount}</div>
              <p>Assigned personnel</p>
            </article>

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">Admins</span>
              </div>
              <div className="stat-number">{admins}</div>
              <p>System operators</p>
            </article>

            <article className="stat-card">
              <div className="stat-header">
                <span className="label">Pending</span>
              </div>
              <div className="stat-number">{pending}</div>
              <p>Service requests</p>
            </article>
          </div>

          <div className="dashboard-body">
            <div className="main-column">
              {activeTab === 'overview' && (
                <article className="panel-card compact-panel">
                  <div className="panel-header">
                    <h2>System Overview</h2>
                    <span className="soft-label">Live statistics</span>
                  </div>

                  <div className="overview-grid">
                    <div className="overview-item">
                      <h4>Total Active Users</h4>
                      <p className="overview-value">{managedUsers.length}</p>
                      <small>Residents, Staff, and Admins</small>
                    </div>
                    <div className="overview-item">
                      <h4>Service Requests</h4>
                      <p className="overview-value">{requests.length}</p>
                      <small>{pending} pending review</small>
                    </div>
                    <div className="overview-item">
                      <h4>Zones Covered</h4>
                      <p className="overview-value">7</p>
                      <small>Distributed population</small>
                    </div>
                    <div className="overview-item">
                      <h4>Emergency Reports</h4>
                      <p className="overview-value">{reports.length}</p>
                      <small>Total incidents tracked</small>
                    </div>
                  </div>

                  <div className="info-box">
                    <h3>Residents by Zone</h3>
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
                      <h2>Pending Account Approvals</h2>
                      <span className="soft-label">{pendingVerificationUsers.length} waiting</span>
                    </div>
                    {pendingVerificationUsers.length > 0 ? (
                      <div className="admin-approval-list">
                        {pendingVerificationUsers.map((user) => (
                          <div key={user.id} className="admin-approval-row">
                            <div>
                              <strong>{user.firstName || user.first_name} {user.lastName || user.last_name}</strong>
                              <small>{user.mobile} • Registered {formatDateValue(user.createdAt || user.created_at)}</small>
                              <small>{user.address || 'No address provided'} • Zone {user.zone || user.zoneNumber || 'N/A'}</small>
                            </div>
                            <div className="action-row">
                              <button type="button" className="small-action success" onClick={() => handleVerification(user, 'Active Resident')}>Approve</button>
                              <button type="button" className="small-action danger" onClick={() => handleVerification(user, 'Rejected')}>Reject</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="empty-state">No accounts are waiting for verification.</div>}
                  </article>

                  <article className="panel-card compact-panel">
                    <div className="panel-header">
                      <h2>Request Monitoring</h2>
                      <span className="soft-label">{pending} need review</span>
                    </div>
                    <div className="overview-grid admin-metric-grid">
                      <div className="overview-item"><h4>Pending</h4><p className="overview-value">{pending}</p><small>Awaiting staff action</small></div>
                      <div className="overview-item"><h4>Approved</h4><p className="overview-value">{requests.filter((item) => item.status === 'Approved').length}</p><small>Completed requests</small></div>
                      <div className="overview-item"><h4>Rejected</h4><p className="overview-value">{requests.filter((item) => item.status === 'Rejected').length}</p><small>Declined requests</small></div>
                      <div className="overview-item"><h4>Approved residents</h4><p className="overview-value">{approvedUsers}</p><small>Verified accounts</small></div>
                    </div>
                    <div className="service-count-list">
                      {Object.entries(requestCountsByType).map(([type, count]) => <div key={type}><span>{type}</span><strong>{count}</strong></div>)}
                      {Object.keys(requestCountsByType).length === 0 && <div className="empty-state">No service requests recorded.</div>}
                    </div>
                  </article>

                  <article className="panel-card compact-panel">
                    <div className="panel-header">
                      <h2>Notifications &amp; Activity</h2>
                      <span className="soft-label">Admin alerts</span>
                    </div>
                    <div className="notification-list">
                      {notifications.map((notification) => <div key={notification} className="notification-item">{notification}</div>)}
                      {notifications.length === 0 && <div className="empty-state">No new admin notifications.</div>}
                    </div>
                    <div className="activity-list">
                      {activityEntries.map((entry) => <div key={entry.id} className="activity-item"><div><strong>{entry.label}</strong><small>{entry.detail}</small></div><time>{formatDateValue(entry.date)}</time></div>)}
                      {activityEntries.length === 0 && <div className="empty-state">No recent activity.</div>}
                    </div>
                  </article>
                </>
              )}

              {activeTab === 'residents' && (
                <article className="panel-card compact-panel">
                  <div className="panel-header">
                    <h2>Resident Management</h2>
                    <span className="soft-label">{filteredResidents.length} residents found</span>
                  </div>

                  <div className="search-and-filter">
                    <input 
                      type="text" 
                      placeholder="🔎 Search by name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="search-input"
                    />
                    <button type="button" className="primary-btn small search-button" onClick={() => setSearchQuery((prev) => prev.trim())}>Search</button>
                    <select 
                      value={selectedZone}
                      onChange={(e) => setSelectedZone(e.target.value)}
                      className="zone-filter"
                    >
                      <option value="all">All Zones</option>
                      <option value="1">Zone 1</option>
                      <option value="2">Zone 2</option>
                      <option value="3">Zone 3</option>
                      <option value="4">Zone 4</option>
                      <option value="5">Zone 5</option>
                      <option value="6">Zone 6</option>
                      <option value="7">Zone 7</option>
                    </select>
                  </div>

                  {selectedZone === 'all' ? (
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
                                        <th>Household ID</th>
                                        <th>Zone</th>
                                        <th>Family Members</th>
                                        <th>Email</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {zoneResidents.map((resident) => (
                                        <tr key={resident.id}>
                                          <td>{resident.householdId}</td>
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
                            <th>Household ID</th>
                            <th>Zone</th>
                            <th>Family Members</th>
                            <th>Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredResidents.map((resident) => (
                            <tr key={resident.id}>
                              <td>{resident.householdId}</td>
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
                  </div>

                  <form className="editor-panel admin-create-panel" onSubmit={handleCreateAdmin}>
                    <div className="panel-header left-align">
                      <h3>Create Administrator</h3>
                      <span className="soft-label">Admin only</span>
                    </div>
                    <div className="editor-grid">
                      <input aria-label="Administrator first name" placeholder="First name" value={adminForm.firstName} onChange={(event) => setAdminForm((current) => ({ ...current, firstName: event.target.value }))} required />
                      <input aria-label="Administrator last name" placeholder="Last name" value={adminForm.lastName} onChange={(event) => setAdminForm((current) => ({ ...current, lastName: event.target.value }))} required />
                      <input aria-label="Administrator email" type="email" placeholder="Email" value={adminForm.email} onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))} required />
                      <input aria-label="Administrator mobile" placeholder="09XXXXXXXXX" value={adminForm.mobile} onChange={(event) => setAdminForm((current) => ({ ...current, mobile: event.target.value }))} required />
                      <PasswordField id="admin-initial-password" label="Administrator initial password" value={adminForm.password} onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))} placeholder="Initial password" helpText={null} />
                    </div>
                    <small>{passwordRequirements}.</small>
                    <div className="editor-actions"><button type="submit" className="primary-btn small">Create Administrator</button></div>
                  </form>

                  <div className="search-and-filter">
                    <input
                      type="text"
                      placeholder="🔎 Search users by name..."
                      value={accessSearch}
                      onChange={(e) => setAccessSearch(e.target.value)}
                      className="search-input"
                    />
                    <button type="button" className="primary-btn small search-button" onClick={() => setSearchQuery(accessSearch)}>Search</button>
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

                  <div className="approvals-history">
                    <div className="history-header">
                      <div>
                        <h3>Approvals History</h3>
                        <p>Recent approvals and records</p>
                      </div>
                      <div className="history-actions">
                        <label className="retention-control">
                          <span>Retention</span>
                          <div className="inline-field">
                            <input
                              type="number"
                              min="0"
                              value={retentionDays}
                              onChange={(e) => setRetentionDays(Math.max(0, Number(e.target.value) || 0))}
                              title="0 = archive all current approvals immediately; > 0 = archive approvals older than N days"
                            />
                            <small>days</small>
                          </div>
                        </label>
                        <button className="primary-btn small" type="button" onClick={handleArchiveNow} disabled={archiving}>
                          {archiving ? 'Archiving…' : 'Archive Now'}
                        </button>
                        <button className="secondary-btn small" type="button" onClick={async () => { try { const r = await fetch(`${API_BASE}/admin/approvals`); if (r.ok) { const d = await r.json(); setApprovals(d.approvals || []) } } catch (e) { console.error(e) } }}>
                          Refresh
                        </button>
                      </div>
                    </div>

                    {archiveResult && (
                      <div className="status-banner">
                        Archived {archiveResult.count} items — {archiveResult.filename ? archiveResult.filename.split('/').pop() : 'summary'}
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
                              <div className="approval-status success">Approved</div>
                              <div className="approval-main">
                                <div className="approval-row-top">
                                  <strong>{a.id}</strong>
                                  <span>{a.dateApproved ? new Date(a.dateApproved).toLocaleString() : a.dateApproved}</span>
                                </div>
                                <div className="approval-meta">by {a.approvedByRole}</div>
                                <div className="approval-meta accent">{a.requestSnapshot?.type} — {a.requestSnapshot?.purpose}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state">No approvals in the recent active list.</div>
                      )}
                    </div>
                  </div>

                </article>
              )}

              {activeTab === 'emergencies' && (
                <article className="panel-card">
                  <div className="panel-header">
                    <h2>Emergency Reports</h2>
                    <span className="soft-label">{reports.length} incidents logged</span>
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
                      <p>No emergency reports logged yet.</p>
                    </div>
                  )}
                </article>
              )}
            </div>

            <aside className="side-column">
              <article className="profile-card">
                <div className="profile-head">
                  <div className="profile-avatar">A</div>
                  <div>
                    <h3>System Status</h3>
                    <span>Live overview</span>
                  </div>
                </div>
                <dl className="profile-list">
                  <div><dt>Portal</dt><dd>Operational</dd></div>
                  <div><dt>Security</dt><dd>RBAC enabled</dd></div>
                  <div><dt>Services</dt><dd>{requests.length} active</dd></div>
                  <div><dt>Alerts</dt><dd>{pending} require attention</dd></div>
                </dl>
              </article>

              <article className="panel-card archive-card">
                <div className="panel-subhead">
                  <h4>Archived Files</h4>
                  <button className="secondary-btn tiny" type="button" onClick={async () => { try { const r = await fetch(`${API_BASE}/admin/archives`); if (r.ok) { setArchives((await r.json()).archives || []) } } catch (e) { console.error(e) } }}>Refresh</button>
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
                          }}>Download</button>
                          <button type="button" className="small-action danger" onClick={() => handleDeleteArchive(f.name)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No archived files yet.</div>
                )}
              </article>
            </aside>
          </div>
        </section>
      </main>
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} allowEdit onUserUpdated={(updated) => {
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
    </div>
  )
}

function App() {
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

  const isAuthenticated = Boolean(session?.isActive)
  const userRole = session?.user?.role || session?.role || 'resident'

  useEffect(() => {
    let isMounted = true

    const autoLoginAdmin = async () => {
      if (session || !isMounted || !shouldAutoLoginAdmin) return

      try {
        const response = await fetch(`${API_BASE}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: ADMIN_DEFAULT_EMAIL, password: ADMIN_DEFAULT_PASSWORD }),
        })

        if (!response.ok) return

        const data = await response.json().catch(() => ({}))
        if (!data?.token || !data?.user) return

        const nextSession = {
          token: data.token,
          user: data.user,
          identifier: ADMIN_DEFAULT_EMAIL,
          role: data.user.role || 'admin',
          isActive: true,
        }

        if (isMounted) {
          setSession(nextSession)
          writeStoredSession(nextSession)
        }
      } catch (error) {
        console.error('Auto admin login failed', error)
      }
    }

    autoLoginAdmin()

    return () => {
      isMounted = false
    }
  }, [session])

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
              fetch(`${API_BASE}/staff/requests`),
              fetch(`${API_BASE}/staff/members`),
              fetch(`${API_BASE}/announcements`),
            ])

            if (staffRequestsResp.ok) {
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

  const handleRequestStatus = async (requestId, status) => {
    if (!session?.token) return

    try {
      const response = await fetch(`${API_BASE}/requests/${requestId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        console.error('Failed to update request status', response.status)
        return
      }

      const updated = await response.json()
      setRequests((prev) => prev.map((item) => (item.id === requestId ? { ...item, status: updated.request?.status || status } : item)))
    } catch (e) {
      console.error('handleRequestStatus error', e)
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
    <Routes>
      <Route path="/" element={isAuthenticated ? <Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace /> : <LoginPage onLogin={handleLogin} />} />
      <Route path="/register" element={isAuthenticated ? <Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace /> : <RegisterPage />} />
      <Route path="/dashboard" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><DashboardPage profile={profile} requests={requests} services={services} announcements={announcementsData} events={events} payments={payments} onLogout={handleLogout} onProfileUpdated={setProfile} /></ProtectedRoute>} />
      <Route path="/requests" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><RequestsPage requests={requests} onSubmit={handleRequestSubmit} onLogout={handleLogout} /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><ProfilePage profile={profile} onLogout={handleLogout} /></ProtectedRoute>} />
      <Route path="/payments" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><PaymentsPage payments={payments} onLogout={handleLogout} /></ProtectedRoute>} />
      <Route path="/events" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><EventsPage events={events} onLogout={handleLogout} /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['resident']} userRole={userRole}><SettingsPage profile={profile} onLogout={handleLogout} /></ProtectedRoute>} />
      <Route path="/staff" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['staff', 'admin']} userRole={userRole}><StaffPage requests={requests} staffMembers={staffMembers} announcements={announcementsData} currentUser={session?.user} userRole={userRole} onProcessRequest={handleRequestStatus} onLogout={handleLogout} onAddStaffMember={handleAddStaffMember} onAddAnnouncement={handleAddAnnouncement} onDeleteAnnouncement={handleDeleteAnnouncement} onDeleteStaffMember={handleDeleteStaffMember} /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute isAuthenticated={isAuthenticated} allowedRoles={['admin']} userRole={userRole}><AdminPage users={users} residents={residents} requests={requests} reports={reports} currentUser={session?.user} onLogout={handleLogout} /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to={userRole === 'staff' ? '/staff' : userRole === 'admin' ? '/admin' : '/dashboard'} replace />} />
    </Routes>
  )
}

export default App









