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

function ZiviFacturaHeaderMark() {
  return <svg className="ziviHeaderLogoSvg" viewBox="0 0 620 190" role="img" aria-label="ZiviFactura por Zivi Dynamics C.A.">
    <defs>
      <linearGradient id="zfBlue" x1="30" y1="20" x2="180" y2="70" gradientUnits="userSpaceOnUse">
        <stop stopColor="#00e7f5"/>
        <stop offset=".52" stopColor="#008fe9"/>
        <stop offset="1" stopColor="#103a9c"/>
      </linearGradient>
      <linearGradient id="zfGold" x1="155" y1="52" x2="65" y2="140" gradientUnits="userSpaceOnUse">
        <stop stopColor="#ffe45a"/>
        <stop offset=".5" stopColor="#ffbf08"/>
        <stop offset="1" stopColor="#ff9800"/>
      </linearGradient>
      <linearGradient id="zfPink" x1="55" y1="130" x2="182" y2="166" gradientUnits="userSpaceOnUse">
        <stop stopColor="#7a19a8"/>
        <stop offset=".45" stopColor="#d80aa8"/>
        <stop offset="1" stopColor="#ff1194"/>
      </linearGradient>
      <linearGradient id="zfWord" x1="245" y1="55" x2="560" y2="55" gradientUnits="userSpaceOnUse">
        <stop stopColor="#142a55"/>
        <stop offset=".42" stopColor="#142a55"/>
        <stop offset=".44" stopColor="#0aa8f4"/>
        <stop offset="1" stopColor="#1167dd"/>
      </linearGradient>
      <filter id="zfShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#3b82f6" floodOpacity=".12"/>
      </filter>
    </defs>
    <g filter="url(#zfShadow)" transform="translate(4 8)">
      <path d="M23 45C54 16 107 15 155 31c25 8 43 22 49 39-29-13-61-13-92-5-32 9-60 13-84 4-14-5-25-13-34-25 8 5 17 5 29 1Z" fill="url(#zfBlue)"/>
      <path d="M166 46c27 18 31 43 17 67-18 29-48 45-76 59-27 14-45 27-49 47-14-12-22-28-18-44 6-23 29-40 64-59 35-20 57-39 62-70Z" fill="url(#zfGold)"/>
      <path d="M58 135c17 10 37 11 59 4 34-10 64-6 91 17-7 18-20 31-39 39-28-15-54-18-78-9-25 9-46 5-62-12-10-11-14-24-12-39 11 5 24 6 41 0Z" fill="url(#zfPink)"/>
      <path d="M25 44c26 17 54 19 85 9 22-7 43-8 65-4" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" opacity=".42"/>
      <path d="M163 48c14 20 8 42-20 62" fill="none" stroke="#fff7bf" strokeWidth="3.5" strokeLinecap="round" opacity=".55"/>
      <path d="M52 137c23 13 46 13 69 5 28-9 54-5 78 10" fill="none" stroke="#ffc0e7" strokeWidth="3.5" strokeLinecap="round" opacity=".44"/>
    </g>
    <text x="232" y="82" fontFamily="Inter,Arial,sans-serif" fontSize="60" fontWeight="800" letterSpacing="-3" fill="url(#zfWord)">ZiviFactura</text>
    <circle cx="303" cy="33" r="7" fill="#14c7ee"/>
    <circle cx="378" cy="33" r="7" fill="#f20aa1"/>
    <text x="235" y="123" fontFamily="Inter,Arial,sans-serif" fontSize="23" fontWeight="500" fill="#6d84a6">por Zivi Dynamics C.A.</text>
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
      <span className="ziviHeaderBrandAsset"><ZiviFacturaHeaderMark/></span>
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
