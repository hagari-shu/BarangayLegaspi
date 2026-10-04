const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')
const allowedTypes = new Set(['render', 'window-error', 'unhandled-rejection'])
const allowedRoles = new Set(['resident', 'staff', 'admin', 'unknown'])
const allowedRoutes = new Set(['/', '/register', '/dashboard', '/requests', '/staff', '/admin', '/settings', '/events', '/payments'])

export function reportClientError(type, language = 'en', role = 'unknown') {
  if (!allowedTypes.has(type)) throw new Error('Unsupported client error type.')

  const route = allowedRoutes.has(window.location.pathname) ? window.location.pathname : '/other'
  const userRole = allowedRoles.has(role) ? role : 'resident'

  void window.fetch(`${API_BASE}/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      route,
      language: language === 'fil' ? 'fil' : 'en',
      role: userRole,
    }),
    keepalive: true,
  }).then((response) => {
    if (!response.ok) console.warn('Client error report was rejected by the API.', response.status)
  }).catch((error) => {
    console.warn('Client error report could not reach the API.', error)
  })
}
