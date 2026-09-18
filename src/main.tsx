import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthShellV2 from './AuthShellV2'
import EducationModule from './EducationModule'
import HelpCenter from './HelpCenter'
import InstallPrompt from './InstallPrompt'
import QuickTools from './QuickTools'
import ZiviChrome from './ZiviChrome'
import { modulesForProfile, type BusinessProfileKey } from './businessProfiles'
import { initAutomaticBackup } from './cloudBackup'
import { dedupeStoredClients, startClientDedupWatcher } from './clientDedup'
import { db, ensureCompany } from './db'
import { installOperationalReadGuards } from './operationalReadGuards'
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
import './mobile-dock-layout.css'

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
try {
  installOperationalReadGuards()
} catch (error) {
  console.warn('[ZiviFactura] read guards no disponibles al iniciar:', error)
}

window.addEventListener('beforeinstallprompt', (event) => {
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
    // Service Worker is an enhancement, never a prerequisite for rendering.
    // Reuse an existing registration when the browser exposes one and do not
    // unregister workers during startup: some Android standalone contexts can
    // deny a fresh registration even though normal web execution is allowed.
    const existing = await navigator.serviceWorker.getRegistration('/').catch(() => undefined)
    const registration = existing || await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })

    void registration.update().catch(() => undefined)

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

async function upgradeBusinessProfileModules() {
  await ensureCompany()
  const companies = await db.company.toArray()
  for (const company of companies) {
    const profile = (company.businessProfile || 'services') as BusinessProfileKey
    const merged = [...new Set([...modulesForProfile(profile), ...(company.enabledModules || [])])]
    const current = company.enabledModules || []
    if (merged.length !== current.length || merged.some(module => !current.includes(module))) {
      await db.company.update(company.id, { enabledModules: merged, businessProfile: profile })
    }
  }
}

function mountApp() {
  const root = document.getElementById('root')
  if (!root) throw new Error('No se encontró el contenedor principal de ZiviFactura.')

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AuthShellV2 />
      <ZiviChrome />
      <QuickTools />
      <EducationModule />
      <HelpCenter />
      <InstallPrompt />
    </React.StrictMode>,
  )
}

async function runMaintenanceInBackground() {
  try {
    startClientDedupWatcher()
    initAutomaticBackup()
  } catch (error) {
    console.warn('[ZiviFactura] servicios secundarios no disponibles al iniciar:', error)
  }

  await dedupeStoredClients().catch(error => console.warn('[ZiviFactura] client cleanup:', error))
  await upgradeBusinessProfileModules().catch(error => console.warn('[ZiviFactura] business profile migration:', error))
}

// Paint the interface first. IndexedDB migrations, cleanup and PWA services
// must never be able to leave a fresh installation on a blank screen.
try {
  mountApp()
} catch (error) {
  console.error('[ZiviFactura] fallo crítico de montaje:', error)
  const root = document.getElementById('root')
  if (root) root.setAttribute('data-boot-error', '1')
}

void runMaintenanceInBackground()
