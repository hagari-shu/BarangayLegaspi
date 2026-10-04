import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { reportClientError } from './client-error-reporting.js'

class AppErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.error('Uncaught application render error', error, info.componentStack)
    reportClientError('render', document.documentElement.lang)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app-error-boundary" role="alert">
          <h1>We could not load the portal / Hindi ma-load ang portal</h1>
          <p>Please refresh the page. If the problem continues, contact the barangay office.</p>
          <p>I-refresh ang pahina. Kung magpatuloy ang problema, makipag-ugnayan sa tanggapan ng barangay.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Refresh / I-refresh
          </button>
        </main>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
