import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
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

  async function install() {
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

  if (installed || dismissed) return null
  if (!promptEvent && !(isAndroid && fallbackReady)) return null

  const nativePwaReady = Boolean(promptEvent)

  return <aside className="pwaInstallCard" aria-label="Instalar ZiviFactura">
    <img src="/zivifactura-app-v28.png?v=33" alt="" aria-hidden="true" />
    <span className="pwaInstallCardCopy">
      <strong>{nativePwaReady ? 'Instalar ZiviFactura' : 'Instalar ZiviFactura en Android'}</strong>
      <small>
        {nativePwaReady
          ? 'Chrome ya habilitó la instalación PWA nativa.'
          : 'Chrome no habilitó WebAPK en este equipo. Usa el instalador Android de ZiviFactura: abre la misma aplicación web en modo app independiente.'}
      </small>
    </span>
    {nativePwaReady ? (
      <button className="pwaInstallAction" type="button" onClick={() => void install()}>
        <Download size={16}/> Instalar app
      </button>
    ) : (
      <a className="pwaInstallAction" href={ANDROID_INSTALLER_URL} target="_blank" rel="noreferrer">
        <ExternalLink size={16}/> Descargar instalador
      </a>
    )}
    <button className="pwaInstallClose" type="button" aria-label="Cerrar" onClick={() => setDismissed(true)}><X size={17}/></button>
  </aside>
}
