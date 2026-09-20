import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './ui/components/AppErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)

// The desktop shell serves immutable local assets through project-flight://game. It has no
// network dependency, so a browser-style service worker adds startup noise without improving
// reliability. The web/PWA build retains its offline worker unchanged.
const isDesktopShell = window.location.protocol === 'project-flight:'

if ('serviceWorker' in navigator && import.meta.env.PROD && !isDesktopShell) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed', err)
    })
  })
}
