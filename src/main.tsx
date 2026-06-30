import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './theme.css'
import './index.css'
import './app.css'
import { AuthProvider } from './auth'
import App from './App'

// Apply persisted theme before first render to avoid a flash.
const savedTheme = localStorage.getItem('theme')
if (savedTheme === 'dark') {
  document.documentElement.dataset.theme = 'dark'
} else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.dataset.theme = 'dark'
}

// HashRouter: GitHub Pages serves static files only and can't rewrite deep
// links to index.html, so hash routing keeps client navigation robust.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
