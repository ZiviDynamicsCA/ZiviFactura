import { useEffect, useState } from 'react'
import { BriefcaseBusiness, CheckCircle2, Flower2, GraduationCap, PackageCheck, Store } from 'lucide-react'
import { BUSINESS_PROFILES, modulesForProfile, type BusinessProfileKey } from './businessProfiles'
import { db } from './db'
import { getActiveCompanyId } from './companyScope'
import type { Company } from './types'
import './modular-workspace.css'

const icons: Record<BusinessProfileKey, JSX.Element> = {
  services: <BriefcaseBusiness size={24}/>,
  education: <GraduationCap size={24}/>,
  commerce: <Store size={24}/>,
  florist: <Flower2 size={24}/>,
}

export default function BusinessProfileView({ onChanged }: { onChanged?: (company: Company) => void }) {
  const companyId = getActiveCompanyId()
  const [company, setCompany] = useState<Company | null>(null)
  const [selected, setSelected] = useState<BusinessProfileKey>('services')
  const [message, setMessage] = useState('')

  async function load() {
    const row = await db.company.get(companyId) || await db.company.get(1) || null
    setCompany(row)
    setSelected((row?.businessProfile || 'services') as BusinessProfileKey)
  }

  useEffect(() => { void load() }, [companyId])

  async function select(profile: BusinessProfileKey) {
    if (!company) return
    const modules = modulesForProfile(profile)
    await db.company.update(company.id, {
      businessProfile: profile,
      enabledModules: modules,
      monthlyLateFeePct: profile === 'education' ? Number(company.monthlyLateFeePct || 3) : company.monthlyLateFeePct,
      billingDay: profile === 'education' ? Number(company.billingDay || 5) : company.billingDay,
    } as Partial<Company>)
    if (profile === 'education') localStorage.setItem(`zivifactura.education.enabled.${company.id}`, '1')
    const updated = await db.company.get(company.id)
    if (updated) {
      setCompany(updated)
      setSelected(profile)
      onChanged?.(updated)
    }
    setMessage('Perfil actualizado. La navegación del negocio se ajustó a sus módulos activos.')
  }

  const active = BUSINESS_PROFILES.find(item => item.key === selected) || BUSINESS_PROFILES[0]

  return <main className="modulePage">
    <section className="moduleHero">
      <div><span>ZIVIFACTURA · CONFIGURACIÓN MODULAR</span><h1>Un sistema distinto para cada tipo de negocio.</h1><p>El perfil controla qué módulos operativos aparecen para el negocio activo sin mezclar herramientas que no necesitas.</p></div>
      <div className="profileActiveBadge"><PackageCheck size={20}/><span>Perfil activo</span><strong>{active.shortTitle}</strong></div>
    </section>

    <section className="profileGrid">{BUSINESS_PROFILES.map(profile => <button key={profile.key} className={selected === profile.key ? 'active' : ''} onClick={() => void select(profile.key)}>
      <span className="profileIcon">{icons[profile.key]}</span>
      <strong>{profile.title}</strong>
      <p>{profile.description}</p>
      <small>{profile.bestFor}</small>
      {selected === profile.key && <em><CheckCircle2 size={15}/>Activo</em>}
    </button>)}</section>

    <section className="moduleCard profilePlan">
      <div className="moduleCardHead"><div><span>MÓDULOS ACTIVOS</span><h2>{active.title}</h2></div></div>
      <div className="profileModuleTags">{active.modules.map(module => <span key={module}>{module.replace(/_/g, ' ')}</span>)}</div>
      <div className="profileNext"><strong>Próximos bloques recomendados</strong>{active.nextPhase.map(item => <span key={item}><CheckCircle2 size={15}/>{item}</span>)}</div>
      {message && <div className="moduleMessage">{message}</div>}
    </section>
  </main>
}
