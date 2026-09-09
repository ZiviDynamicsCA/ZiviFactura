import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}
type WebInstallNavigator = Navigator & {
  install?: (options?: { manifest?: string; manifestId?: string }) => Promise<void>
}
type PwaWindow = Window & { __ziviInstallPrompt?: InstallPromptEvent | null }

const ANDROID_INSTALLER_URL = 'https://github.com/waldjos/ZiviFactura/releases/download/android-installer-v1/ZiviFactura-Android.apk'

function isStandalone() {
  const navigatorStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return navigatorStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export default function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(() => (window as PwaWindow).__ziviInstallPrompt || null)
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(() => isStandalone())
  const [fallbackReady, setFallbackReady] = useState(false)
  const isAndroid = useMemo(() => /Android/i.test(navigator.userAgent), [])
  const webInstallSupported = typeof (navigator as WebInstallNavigator).install === 'function'

  useEffect(() => {
    const syncPrompt = () => setPromptEvent((window as PwaWindow).__ziviInstallPrompt || null)
    const onPrompt = (event: Event) => {
      ;(window as PwaWindow).__ziviInstallPrompt = event as InstallPromptEvent
      setPromptEvent(event as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }

    const fallbackTimer = window.setTimeout(() => setFallbackReady(true), 6500)
    syncPrompt()
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('zivi-install-ready', syncPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('zivi-installed', onInstalled)
    return () => {
      window.clearTimeout(fallbackTimer)
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('zivi-install-ready', syncPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('zivi-installed', onInstalled)
    }
  }, [])

  async function installLegacyPwa() {
    const current = promptEvent || (window as PwaWindow).__ziviInstallPrompt || null
    if (!current) return
    try {
      await current.prompt()
      const choice = await current.userChoice.catch(() => null)
      if (choice?.outcome === 'accepted') setInstalled(true)
    } finally {
      ;(window as PwaWindow).__ziviInstallPrompt = null
      setPromptEvent(null)
    }
  }

  async function installWithWebInstallApi() {
    const installApi = (navigator as WebInstallNavigator).install
    if (!installApi) return
    try {
      await installApi.call(navigator)
      setInstalled(true)
    } catch (error) {
      console.warn('[ZiviFactura] Web Install API:', error)
    }
  }

  if (installed || dismissed) return null
  if (!promptEvent && !webInstallSupported && !(isAndroid && fallbackReady)) return null

  const mode = promptEvent ? 'legacy-pwa' : webInstallSupported ? 'web-install-api' : 'android-fallback'

  return <aside className="pwaInstallCard" aria-label="Instalar ZiviFactura">
    <img src="/zivifactura-app-v28.png?v=34" alt="" aria-hidden="true" />
    <span className="pwaInstallCardCopy">
      <strong>{mode === 'android-fallback' ? 'Instalar ZiviFactura en Android' : 'Instalar ZiviFactura'}</strong>
      <small>
        {mode === 'legacy-pwa' && 'Chrome habilitó la instalación PWA nativa.'}
        {mode === 'web-install-api' && 'Tu navegador admite la nueva API de instalación web. Instala ZiviFactura directamente como aplicación.'}
        {mode === 'android-fallback' && 'Chrome no habilitó WebAPK en este equipo. Usa el instalador Android de ZiviFactura: abre la misma aplicación web en modo app independiente.'}
      </small>
    </span>

    {mode === 'legacy-pwa' && (
      <button className="pwaInstallAction" type="button" onClick={() => void installLegacyPwa()}>
        <Download size={16}/> Instalar app
      </button>
    )}

    {mode === 'web-install-api' && (
      <button className="pwaInstallAction" type="button" onClick={() => void installWithWebInstallApi()}>
        <Download size={16}/> Instalar app
      </button>
    )}

    {mode === 'android-fallback' && (
      <a className="pwaInstallAction" href={ANDROID_INSTALLER_URL} target="_blank" rel="noreferrer">
        <ExternalLink size={16}/> Descargar instalador
      </a>
    )}

    <button className="pwaInstallClose" type="button" aria-label="Cerrar" onClick={() => setDismissed(true)}><X size={17}/></button>
  </aside>
}
