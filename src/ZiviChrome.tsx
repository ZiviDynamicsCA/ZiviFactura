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
      <span className="ziviHeaderBrandAsset" aria-hidden="true">
        <img src="/zivifactura-header-light.svg?v=2" alt="" />
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
