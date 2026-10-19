import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')

export default function StaffInvitationPage({ language = 'en', accountType = 'staff' }) {
  const isSuperAdmin = accountType === 'super_admin'
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
  const [invitation, setInvitation] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(false)
  const copy = language === 'fil'
    ? isSuperAdmin
      ? {
        title: 'I-set up ang Super Admin account',
        intro: 'Gamitin ang imbitasyong ito para gumawa ng Super Admin account. Isang beses lang ito magagamit at mawawalan ng bisa pagkalipas ng 12 oras.',
        firstName: 'Pangalan',
        lastName: 'Apelyido',
        mobile: 'Mobile (09XXXXXXXXX)',
        password: 'Gumawa ng password',
        confirmPassword: 'Ulitin ang password',
        submit: 'Gumawa ng account',
        success: 'Nagawa na ang Super Admin account. Maaari ka nang mag-sign in.',
        login: 'Pumunta sa sign in',
        invalid: 'Hindi wasto, paso na, o nagamit na ang imbitasyon.',
        mismatch: 'Hindi magkapareho ang mga password.',
      }
      : {
      title: 'I-set up ang staff account',
      intro: 'Gamitin ang imbitasyong ito para gumawa ng staff account. Isang beses lang ito magagamit at mawawalan ng bisa pagkalipas ng 12 oras.',
      firstName: 'Pangalan',
      lastName: 'Apelyido',
      mobile: 'Mobile (09XXXXXXXXX)',
      password: 'Gumawa ng password',
      confirmPassword: 'Ulitin ang password',
      submit: 'Gumawa ng account',
      success: 'Nagawa na ang staff account. Maaari ka nang mag-sign in.',
      login: 'Pumunta sa sign in',
      invalid: 'Hindi wasto, paso na, o nagamit na ang imbitasyon.',
      mismatch: 'Hindi magkapareho ang mga password.',
    }
    : isSuperAdmin
      ? {
        title: 'Set up your Super Admin account',
        intro: 'Use this invitation to create your Super Admin account. It can be used once and expires after 12 hours.',
        firstName: 'First name',
        lastName: 'Last name',
        mobile: 'Mobile (09XXXXXXXXX)',
        password: 'Create password',
        confirmPassword: 'Confirm password',
        submit: 'Create account',
        success: 'Your Super Admin account is ready. You can now sign in.',
        login: 'Go to sign in',
        invalid: 'This invitation is invalid, expired, or already used.',
        mismatch: 'The passwords do not match.',
      }
      : {
      title: 'Set up your staff account',
      intro: 'Use this invitation to create your staff account. It can be used once and expires after 12 hours.',
      firstName: 'First name',
      lastName: 'Last name',
      mobile: 'Mobile (09XXXXXXXXX)',
      password: 'Create password',
      confirmPassword: 'Confirm password',
      submit: 'Create account',
      success: 'Your staff account is ready. You can now sign in.',
      login: 'Go to sign in',
      invalid: 'This invitation is invalid, expired, or already used.',
      mismatch: 'The passwords do not match.',
    }
  const invitationApiPath = isSuperAdmin ? 'super-admin/invitations' : 'staff/invitations'

  useEffect(() => {
    if (token) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    if (!token) return undefined

    const controller = new AbortController()
    fetch(`${API_BASE}/${invitationApiPath}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || copy.invalid)
        setInvitation(data)
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message || copy.invalid)
      })

    return () => controller.abort()
  }, [token, copy.invalid, invitationApiPath])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const formData = new FormData(event.currentTarget)
    const password = String(formData.get('password') || '')
    if (password !== String(formData.get('confirmPassword') || '')) {
      setError(copy.mismatch)
      return
    }

    setBusy(true)
    try {
      const response = await fetch(`${API_BASE}/${invitationApiPath}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          firstName: formData.get('firstName'),
          lastName: formData.get('lastName'),
          mobile: formData.get('mobile'),
          password,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || copy.invalid)
      setCreated(true)
    } catch (requestError) {
      setError(requestError.message || (isSuperAdmin ? 'Unable to create the Super Admin account.' : 'Unable to create the staff account.'))
    } finally {
      setBusy(false)
    }
  }

  const errorMessage = token ? error : copy.invalid

  return (
    <main className="staff-invitation-page">
      <section className="staff-invitation-card" aria-labelledby="staff-invitation-title">
        <h1 id="staff-invitation-title">{copy.title}</h1>
        <p>{copy.intro}</p>
        {errorMessage && <p className="staff-invitation-error" role="alert">{errorMessage}</p>}
        {created ? (
          <div role="status">
            <p>{copy.success}</p>
            <Link className="primary-btn" to="/">{copy.login}</Link>
          </div>
        ) : invitation ? (
          <form onSubmit={submit}>
            <label>
              Email
              <input type="email" value={invitation.email} readOnly autoComplete="email" />
            </label>
            <label>
              {copy.firstName}
              <input name="firstName" required maxLength={100} autoComplete="given-name" />
            </label>
            <label>
              {copy.lastName}
              <input name="lastName" required maxLength={100} autoComplete="family-name" />
            </label>
            <label>
              {copy.mobile}
              <input name="mobile" required inputMode="tel" pattern="09[0-9]{9}" maxLength={11} autoComplete="tel" />
            </label>
            <label>
              {copy.password}
              <input name="password" type="password" required autoComplete="new-password" />
            </label>
            <label>
              {copy.confirmPassword}
              <input name="confirmPassword" type="password" required autoComplete="new-password" />
            </label>
            <button className="primary-btn" type="submit" disabled={busy}>
              {busy ? '…' : copy.submit}
            </button>
          </form>
        ) : !errorMessage ? (
          <p role="status">Checking invitation…</p>
        ) : null}
      </section>
    </main>
  )
}
