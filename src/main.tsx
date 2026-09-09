import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthShell from './AuthShell'
import EducationModule from './EducationModule'
import HelpCenter from './HelpCenter'
import InstallPrompt from './InstallPrompt'
import ModuleBridge from './ModuleBridge'
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

type PwaWindow = Window & {
  __ziviInstallPrompt?: DeferredInstallPrompt | null
  __ziviSwReady?: boolean
  __ziviSwError?: string
}

const pwaWindow = window as PwaWindow

window.addEventListener('beforeinstallprompt', (event) => {
  // Guardamos el evento para el botón propio de instalación. Chrome solo emite
  // este evento cuando la aplicación ya cumple sus criterios de instalación.
  event.preventDefault()
  pwaWindow.__ziviInstallPrompt = event as DeferredInstallPrompt
  window.dispatchEvent(new Event('zivi-install-ready'))
})

window.addEventListener('appinstalled', () => {
  pwaWindow.__ziviInstallPrompt = null
  window.dispatchEvent(new Event('zivi-installed'))
})

async function registerPwaServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    pwaWindow.__ziviSwReady = false
    pwaWindow.__ziviSwError = 'Este navegador no admite Service Worker.'
    window.dispatchEvent(new CustomEvent('zivi-pwa-status', { detail: { ready: false, error: pwaWindow.__ziviSwError } }))
    return
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })

    // Fuerza a Chrome a comprobar la versión recién desplegada en vez de
    // conservar indefinidamente un worker antiguo de las pruebas anteriores.
    await registration.update().catch(() => undefined)
    await navigator.serviceWorker.ready

    pwaWindow.__ziviSwReady = true
    pwaWindow.__ziviSwError = ''
    window.dispatchEvent(new CustomEvent('zivi-pwa-status', {
      detail: {
        ready: true,
        scope: registration.scope,
        controlled: Boolean(navigator.serviceWorker.controller),
      },
    }))
  } catch (error) {
    pwaWindow.__ziviSwReady = false
    pwaWindow.__ziviSwError = error instanceof Error ? error.message : 'No se pudo registrar el Service Worker.'
    console.error('[ZiviFactura] PWA service worker:', error)
    window.dispatchEvent(new CustomEvent('zivi-pwa-status', { detail: { ready: false, error: pwaWindow.__ziviSwError } }))
  }
}

if (document.readyState === 'complete') void registerPwaServiceWorker()
else window.addEventListener('load', () => void registerPwaServiceWorker(), { once: true })

const INVOICE_REPAIR_RELOAD_KEY = 'zivifactura.invoice-repair-reload.v1'
window.addEventListener('zivifactura:data-synced', (event) => {
  const detail = (event as CustomEvent<{ removedInvoices?: number }>).detail
  const removed = Number(detail?.removedInvoices || 0)
  if (removed <= 0 || sessionStorage.getItem(INVOICE_REPAIR_RELOAD_KEY)) return
  sessionStorage.setItem(INVOICE_REPAIR_RELOAD_KEY, '1')
  window.setTimeout(() => window.location.reload(), 180)
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
      <ModuleBridge />
      <EducationModule />
      <HelpCenter />
      <InstallPrompt />
    </React.StrictMode>,
  )
}

void bootstrap()
