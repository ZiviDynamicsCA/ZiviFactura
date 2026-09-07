import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthShell from './AuthShell'
import InstallPrompt from './InstallPrompt'
import QuickTools from './QuickTools'
import ZiviChrome from './ZiviChrome'
import { initAutomaticBackup } from './cloudBackup'
import { dedupeStoredClients, startClientDedupWatcher } from './clientDedup'
import './styles.css'
import './payments.css'
import './proofs.css'
import './business.css'
import './zivi-v2.css'
import './brand-fixes.css'
import './polish-v22.css'
import './polish-v24.css'
import './polish-v27.css'
import './polish-v28.css'
import './auth-v29.css'

type DeferredInstallPrompt = Event & {
  prompt?: () => Promise<void>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type PwaWindow = Window & { __ziviInstallPrompt?: DeferredInstallPrompt | null }

const pwaWindow = window as PwaWindow
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  pwaWindow.__ziviInstallPrompt = event as DeferredInstallPrompt
  window.dispatchEvent(new Event('zivi-install-ready'))
})
window.addEventListener('appinstalled', () => {
  pwaWindow.__ziviInstallPrompt = null
  window.dispatchEvent(new Event('zivi-installed'))
})

async function bootstrap() {
  await dedupeStoredClients().catch(error => console.warn('[ZiviFactura] client cleanup:', error))
  startClientDedupWatcher()
  initAutomaticBackup()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AuthShell />
      <ZiviChrome />
      <QuickTools />
      <InstallPrompt />
    </React.StrictMode>,
  )
}

void bootstrap()
