import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}
type PwaWindow = Window & { __ziviInstallPrompt?: InstallPromptEvent | null }

function isStandalone() {
  const navigatorStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return navigatorStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export default function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(() => (window as PwaWindow).__ziviInstallPrompt || null)
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(() => isStandalone())

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

    syncPrompt()
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('zivi-install-ready', syncPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('zivi-installed', onInstalled)
    return () => {
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

  if (installed || dismissed || !promptEvent) return null

  return <aside className="pwaInstallCard" aria-label="Instalar ZiviFactura">
    <img src="/zivifactura-app-v28.png?v=30" alt="" aria-hidden="true" />
    <span className="pwaInstallCardCopy">
      <strong>Instalar ZiviFactura</strong>
      <small>Instálala como aplicación independiente, no como simple acceso directo.</small>
    </span>
    <button className="pwaInstallAction" type="button" onClick={() => void install()}><Download size={16}/> Instalar app</button>
    <button className="pwaInstallClose" type="button" aria-label="Cerrar" onClick={() => setDismissed(true)}><X size={17}/></button>
  </aside>
}
