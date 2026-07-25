import React from 'react'

// Catches any uncaught render error anywhere below it (e.g. a toast/alert
// accidentally being handed a non-string error object) and shows a
// recoverable screen instead of the app going fully blank with no way back.
// See project memory "prescription_save_blank_page.md" for the incident that
// prompted this — a raw FastAPI validation-error array passed to toast.error()
// crashed the whole app to a white screen with no error boundary to catch it.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Uncaught render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f8fafc', fontFamily: 'Inter, Arial, sans-serif', padding: '24px'
        }}>
          <div style={{
            maxWidth: '480px', background: 'white', borderRadius: '20px', padding: '32px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0', textAlign: 'center'
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚠️</div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: 1.5 }}>
              This screen hit an unexpected error and couldn't continue. Your data up to this point is
              usually safe on the server — reloading the page will take you back to a working screen.
            </p>
            {this.state.error?.message && (
              <pre style={{
                fontSize: '10px', color: '#94a3b8', background: '#f1f5f9', borderRadius: '8px',
                padding: '10px', textAlign: 'left', overflowX: 'auto', marginBottom: '20px'
              }}>
                {String(this.state.error.message)}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#4f46e5', color: 'white', border: 'none', borderRadius: '12px',
                padding: '10px 24px', fontWeight: 700, fontSize: '13px', cursor: 'pointer'
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
