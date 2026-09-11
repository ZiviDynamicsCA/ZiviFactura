import { useEffect } from 'react'

function svg(path: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
}

const profileIcon = svg('<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9h.01"/><path d="M9 12h.01"/><path d="M9 15h.01"/><path d="M9 18h.01"/>')
const educationIcon = svg('<path d="m22 10-10-5-10 5 10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>')
const helpIcon = svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>')

function makeButton(id: string, icon: string, title: string, subtitle: string, eventName: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.ziviModule = id
  button.innerHTML = `${icon}<span><strong>${title}</strong><small>${subtitle}</small></span>`
  button.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('.quickMoreSheet header button')?.click()
    window.setTimeout(() => window.dispatchEvent(new Event(eventName)), 40)
  })
  return button
}

export default function ModuleBridge() {
  useEffect(() => {
    const sync = () => {
      document.querySelectorAll<HTMLElement>('.quickMoreGrid').forEach(grid => {
        if (!grid.querySelector('[data-zivi-module="profile"]')) grid.prepend(makeButton('profile', profileIcon, 'Perfil del negocio', 'Educativo, comercio, servicios o floristería', 'zivifactura:open-business-profile'))
        if (!grid.querySelector('[data-zivi-module="education"]')) grid.appendChild(makeButton('education', educationIcon, 'Inscripciones', 'Formularios y flujo educativo', 'zivifactura:open-education'))
        if (!grid.querySelector('[data-zivi-module="help"]')) grid.appendChild(makeButton('help', helpIcon, 'Guía y tutoriales', 'Aprende cada función paso a paso', 'zivifactura:open-help'))
      })
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return null
}
