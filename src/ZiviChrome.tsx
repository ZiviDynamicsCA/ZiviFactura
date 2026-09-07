import { useEffect, useState } from 'react'
import { Bell, Building2, ChevronDown, LogOut, Plus } from 'lucide-react'
import { createCompany, db, ensureCompany } from './db'
import { getActiveCompanyId, setActiveCompanyId } from './companyScope'
import type { Company } from './types'

function clickWorkspace(index: number) {
  const nav = document.querySelector('.workspaceNav')
  const buttons = nav ? Array.from(nav.querySelectorAll<HTMLButtonElement>('button')) : []
  buttons[index]?.click()
}

function ZiviRibbonMark() {
  return <svg className="ziviRibbonMark" viewBox="0 0 220 220" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="zrBlue" x1="26" y1="28" x2="190" y2="82" gradientUnits="userSpaceOnUse">
        <stop stopColor="#00e7f5"/>
        <stop offset=".52" stopColor="#079cff"/>
        <stop offset="1" stopColor="#173c72"/>
      </linearGradient>
      <linearGradient id="zrGold" x1="176" y1="62" x2="70" y2="168" gradientUnits="userSpaceOnUse">
        <stop stopColor="#ffe56b"/>
        <stop offset=".5" stopColor="#ffc32f"/>
        <stop offset="1" stopColor="#ff9f0a"/>
      </linearGradient>
      <linearGradient id="zrPink" x1="58" y1="152" x2="194" y2="194" gradientUnits="userSpaceOnUse">
        <stop stopColor="#7b3dff"/>
        <stop offset=".5" stopColor="#d80aa8"/>
        <stop offset="1" stopColor="#ff2d9b"/>
      </linearGradient>
      <filter id="zrShadow" x="-25%" y="-25%" width="150%" height="160%">
        <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0b6fb8" floodOpacity=".16"/>
      </filter>
    </defs>
    <g filter="url(#zrShadow)">
      <path d="M20 58C56 24 117 22 173 40c29 10 49 26 57 46-34-15-71-16-107-6-37 10-70 15-98 5-16-6-29-16-39-29 9 5 20 6 34 2Z" fill="url(#zrBlue)"/>
      <path d="M185 60c31 20 36 50 20 77-21 34-56 53-88 69-32 16-52 31-57 55-16-14-25-33-20-51 7-27 34-47 75-70 40-23 65-45 70-80Z" fill="url(#zrGold)"/>
      <path d="M61 161c19 12 43 13 69 5 39-12 74-7 105 20-8 21-23 36-45 46-33-18-63-21-91-11-29 10-54 6-72-14-12-13-17-28-14-46 13 6 28 7 48 0Z" fill="url(#zrPink)"/>
      <path d="M22 56c31 20 63 22 99 11 25-8 50-9 76-4" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".43"/>
      <path d="M181 63c17 24 10 49-24 73" fill="none" stroke="#fff7bf" strokeWidth="4" strokeLinecap="round" opacity=".56"/>
      <path d="M55 164c27 15 54 15 81 6 33-11 63-6 91 12" fill="none" stroke="#ffc0e7" strokeWidth="4" strokeLinecap="round" opacity=".46"/>
    </g>
  </svg>
}

export default function ZiviChrome() {
  const [available, setAvailable] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [activeId, setActiveIdState] = useState(getActiveCompanyId())

  async function loadCompanies() {
    await ensureCompany()
    const rows = (await db.company.toArray()).sort((a, b) => a.id - b.id)
    setCompanies(rows)
    const current = getActiveCompanyId()
    if (rows.some(row => row.id === current)) setActiveIdState(current)
    else if (rows[0]) {
      setActiveIdState(rows[0].id)
      setActiveCompanyId(rows[0].id)
    }
  }

  useEffect(() => {
    const sync = () => {
      const ready = Boolean(document.querySelector('.workspaceNav'))
      setAvailable(ready)
      document.body.classList.toggle('zivi-v2-active', ready)
    }
    sync()
    void loadCompanies()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    const timer = window.setInterval(() => void loadCompanies(), 3500)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
      document.body.classList.remove('zivi-v2-active')
    }
  }, [])

  function changeBusiness(id: number) {
    if (!id || id === activeId) return
    setActiveCompanyId(id)
    setActiveIdState(id)
    window.location.reload()
  }

  async function addBusiness() {
    const name = window.prompt('Nombre del nuevo negocio o empresa:')?.trim()
    if (!name) return
    const company = await createCompany(name)
    setActiveCompanyId(company.id)
    window.location.reload()
  }

  function logout() {
    document.querySelector<HTMLButtonElement>('.accountIdentity button')?.click()
  }

  if (!available) return null

  const activeCompany = companies.find(company => company.id === activeId)
  const activeName = activeCompany?.name?.trim() || 'Mi empresa'

  return <header className="ziviChrome" aria-label="Cabecera de ZiviFactura">
    <button className="ziviChromeBrand ziviInstitutionalLockup" onClick={() => clickWorkspace(0)} aria-label="Ir al inicio">
      <span className="ziviBrandMark"><ZiviRibbonMark/></span>
      <span className="ziviBrandCopy">
        <strong>Zivi<span>Factura</span></strong>
        <small>por Zivi Dynamics C.A.</small>
      </span>
    </button>

    <div className="ziviChromeActions">
      <button className="ziviChromeBell" onClick={() => clickWorkspace(2)} title="Ver cobros y comprobantes" aria-label="Ver cobros y comprobantes"><Bell size={19}/><i/></button>
      <label className="ziviBusinessSelect" title={`Negocio activo: ${activeName}`}>
        <Building2 size={17}/>
        <span><small>Negocio activo</small><strong>{activeName}</strong></span>
        <ChevronDown className="ziviBusinessChevron" size={15}/>
        <select aria-label="Negocio activo" value={activeId} onChange={event => changeBusiness(Number(event.target.value))}>
          {companies.map(company => <option key={company.id} value={company.id}>{company.name || `Negocio ${company.id}`}</option>)}
        </select>
      </label>
      <button className="ziviAddBusiness" onClick={() => void addBusiness()} title="Agregar otro negocio" aria-label="Agregar otro negocio"><Plus size={18}/></button>
      {document.querySelector('.accountIdentity') && <button className="ziviLogout" onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={18}/></button>}
    </div>
  </header>
}
