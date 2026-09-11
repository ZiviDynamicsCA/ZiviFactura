import { useEffect, useState } from 'react'
import { BriefcaseBusiness, CheckCircle2, Flower2, GraduationCap, PackageCheck, Settings, Store, X } from 'lucide-react'
import { db } from './db'
import { getActiveCompanyId } from './companyScope'
import { BUSINESS_PROFILES, modulesForProfile, type BusinessProfileKey } from './businessProfiles'
import type { Company } from './types'
import './business-profile.css'

const profileIcons: Record<BusinessProfileKey, JSX.Element> = {
  services: <BriefcaseBusiness size={23}/>,
  education: <GraduationCap size={23}/>,
  commerce: <Store size={23}/>,
  florist: <Flower2 size={23}/>,
}

export default function BusinessProfileModule() {
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState<Company | null>(null)
  const [selected, setSelected] = useState<BusinessProfileKey>('services')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const show = () => { setOpen(true); setMessage(''); void load() }
    window.addEventListener('zivifactura:open-business-profile', show)
    return () => window.removeEventListener('zivifactura:open-business-profile', show)
  }, [])

  async function load() {
    const companyId = getActiveCompanyId()
    const current = await db.company.get(companyId) || await db.company.get(1) || null
    setCompany(current)
    setSelected((current?.businessProfile || 'services') as BusinessProfileKey)
  }

  async function saveProfile(profile: BusinessProfileKey) {
    const companyId = company?.id || getActiveCompanyId()
    const modules = modulesForProfile(profile)
    await db.company.update(companyId, {
      businessProfile: profile,
      enabledModules: modules,
      monthlyLateFeePct: profile === 'education' ? Number(company?.monthlyLateFeePct || 3) : company?.monthlyLateFeePct,
      billingDay: profile === 'education' ? Number(company?.billingDay || 5) : company?.billingDay,
    } as Partial<Company>)
    setSelected(profile)
    const updated = await db.company.get(companyId)
    setCompany(updated || company)
    setMessage('Perfil de negocio actualizado. Los módulos recomendados quedan listos para las próximas fases.')
    if (profile === 'education') localStorage.setItem(`zivifactura.education.enabled.${companyId}`, '1')
  }

  if (!open) return null

  const activePreset = BUSINESS_PROFILES.find(item => item.key === selected) || BUSINESS_PROFILES[0]

  return <div className="businessProfileOverlay" role="dialog" aria-modal="true" aria-label="Perfil de negocio">
    <div className="businessProfileShell">
      <header className="businessProfileTop">
        <div><span><Settings size={20}/></span><div><small>CONFIGURACIÓN MODULAR</small><strong>Perfil del negocio</strong><p>{company?.name || 'Negocio activo'}</p></div></div>
        <button onClick={() => setOpen(false)} aria-label="Cerrar"><X size={21}/></button>
      </header>

      <section className="businessProfileHero">
        <span>TIPO DE OPERACIÓN</span>
        <h1>Elige cómo trabaja este negocio.</h1>
        <p>ZiviFactura activa módulos distintos según el perfil: un centro educativo no necesita lo mismo que una floristería, y Zivi Dynamics no trabaja igual que un comercio de inventario.</p>
      </section>

      <section className="businessProfileGrid">
        {BUSINESS_PROFILES.map(profile => <button key={profile.key} className={selected === profile.key ? 'active' : ''} onClick={() => void saveProfile(profile.key)}>
          <span>{profileIcons[profile.key]}</span>
          <strong>{profile.title}</strong>
          <small>{profile.description}</small>
          <em>{profile.bestFor}</em>
        </button>)}
      </section>

      <section className="businessProfilePlan">
        <div><PackageCheck size={21}/><span>Perfil activo</span><strong>{activePreset.title}</strong></div>
        <div className="businessProfileModules">{activePreset.modules.map(module => <span key={module}>{module.replace(/_/g, ' ')}</span>)}</div>
      </section>

      <section className="businessProfileNext">
        <strong>Siguiente desarrollo para este perfil</strong>
        <div>{activePreset.nextPhase.map(item => <span key={item}><CheckCircle2 size={15}/>{item}</span>)}</div>
      </section>

      {message && <div className="businessProfileMessage">{message}</div>}
    </div>
  </div>
}
