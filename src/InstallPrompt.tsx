import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

function isStandalone() {
  const navigatorStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return navigatorStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export default function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(() => isStandalone())

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (!promptEvent) return
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice.catch(() => null)
    if (choice?.outcome === 'accepted') setInstalled(true)
    setPromptEvent(null)
  }

  if (installed || dismissed || !promptEvent) return null

  return <aside className="pwaInstallCard" aria-label="Instalar ZiviFactura">
    <img src="/zivifactura-app-v28.png?v=29" alt="" aria-hidden="true" />
    <span className="pwaInstallCardCopy">
      <strong>Instalar ZiviFactura</strong>
      <small>Úsala como app, con acceso directo y pantalla independiente.</small>
    </span>
    <button className="pwaInstallAction" type="button" onClick={() => void install()}><Download size={16}/> Instalar</button>
    <button className="pwaInstallClose" type="button" aria-label="Cerrar" onClick={() => setDismissed(true)}><X size={17}/></button>
  </aside>
}
