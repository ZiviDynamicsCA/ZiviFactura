import { useEffect } from 'react'
import { db } from './db'
import { getActiveCompanyId } from './companyScope'

function svg(path: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
}

const educationIcon = svg('<path d="m22 10-10-5-10 5 10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>')
const tuitionIcon = svg('<rect width="18" height="14" x="3" y="5" rx="2"/><path d="M3 10h18"/><path d="M7 15h.01"/><path d="M11 15h2"/>')

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
    let running = false

    const sync = async () => {
      if (running) return
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.quickMoreGrid'))
      if (!grids.length) return

      running = true
      try {
        const companyId = getActiveCompanyId()
        const company = await db.company.get(companyId) || await db.company.get(1)
        const modules = new Set(company?.enabledModules || [])
        const educational = company?.businessProfile === 'education' || modules.has('education_enrollment') || modules.has('tuition')

        grids.forEach(grid => {
          grid.querySelectorAll('[data-zivi-module="education"], [data-zivi-module="tuition"]').forEach(node => node.remove())
          if (!educational) return

          if (company?.businessProfile === 'education' || modules.has('education_enrollment')) {
            grid.prepend(makeButton('education', educationIcon, 'Inscripciones', 'Planillas, respuestas y aprobación', 'zivifactura:open-education'))
          }
          if (company?.businessProfile === 'education' || modules.has('tuition')) {
            const enrollmentButton = grid.querySelector('[data-zivi-module="education"]')
            const tuitionButton = makeButton('tuition', tuitionIcon, 'Mensualidades', 'Cobros recurrentes, mora y estados de cuenta', 'zivifactura:open-tuition')
            enrollmentButton?.insertAdjacentElement('afterend', tuitionButton)
          }
        })
      } finally {
        running = false
      }
    }

    void sync()
    const observer = new MutationObserver(() => void sync())
    observer.observe(document.body, { childList: true, subtree: true })
    const onCompanyChange = () => void sync()
    window.addEventListener('zivifactura:company-change', onCompanyChange)
    return () => {
      observer.disconnect()
      window.removeEventListener('zivifactura:company-change', onCompanyChange)
    }
  }, [])
  return null
}
