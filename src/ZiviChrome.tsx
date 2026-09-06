import { useEffect, useState } from 'react'
import { Bell, Building2, ChevronDown, LogOut, Plus } from 'lucide-react'
import { createCompany, db, ensureCompany } from './db'
import { getActiveCompanyId, setActiveCompanyId } from './companyScope'
import type { Company } from './types'

// Official Zivi Dynamics C.A. logo supplied by the user.
// It is embedded directly as a JPEG data URL so the institutional header does not
// depend on SVG nested-image support, browser CSP quirks, cache state or an external asset.
const OFFICIAL_ZIVI_LOGO = 'data:image/jpeg;base64,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'

function clickWorkspace(index: number) {
  const nav = document.querySelector('.workspaceNav')
  const buttons = nav ? Array.from(nav.querySelectorAll<HTMLButtonElement>('button')) : []
  buttons[index]?.click()
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
      <span className="ziviOfficialLogoFrame" aria-hidden="true">
        <img src={OFFICIAL_ZIVI_LOGO} alt="" />
      </span>
      <span className="ziviProductLockup">
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
