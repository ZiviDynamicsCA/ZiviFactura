import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, GraduationCap, Percent, Save, Users, WalletCards, X } from 'lucide-react'
import { db, ensureCompany } from './db'
import { getActiveCompanyId } from './companyScope'
import type { Client, Company } from './types'
import './tuition.css'

type TuitionTab = 'summary' | 'people' | 'settings'

export default function TuitionModule() {
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState<Company | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [tab, setTab] = useState<TuitionTab>('summary')
  const [billingDay, setBillingDay] = useState('5')
  const [lateFeePct, setLateFeePct] = useState('3')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const show = () => {
      setOpen(true)
      setTab('summary')
      setMessage('')
    }
    window.addEventListener('zivifactura:open-tuition', show)
    return () => window.removeEventListener('zivifactura:open-tuition', show)
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open])

  async function load() {
    await ensureCompany()
    const companyId = getActiveCompanyId()
    const current = await db.company.get(companyId) || await db.company.get(1) || null
    const people = (await db.clients.toArray())
      .filter(client => (client.companyId || 1) === companyId)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))

    setCompany(current)
    setClients(people)
    setBillingDay(String(current?.billingDay || 5))
    setLateFeePct(String(current?.monthlyLateFeePct ?? 3))
  }

  async function saveSettings() {
    if (!company) return
    const day = Math.min(28, Math.max(1, Math.round(Number(billingDay) || 5)))
    const fee = Math.max(0, Number(lateFeePct) || 0)
    await db.company.update(company.id, { billingDay: day, monthlyLateFeePct: fee })
    setCompany(current => current ? { ...current, billingDay: day, monthlyLateFeePct: fee } : current)
    setBillingDay(String(day))
    setLateFeePct(String(fee))
    setMessage('Configuración de mensualidades guardada.')
  }

  const contactable = useMemo(() => clients.filter(client => client.phone || client.email).length, [clients])

  if (!open) return null

  return <div className="tuitionOverlay" role="dialog" aria-modal="true" aria-label="Módulo de mensualidades">
    <div className="tuitionShell">
      <header className="tuitionTop">
        <div className="tuitionBrand">
          <span><WalletCards size={24}/></span>
          <div><small>MÓDULO EDUCATIVO</small><strong>Mensualidades</strong><p>{company?.name || 'Negocio activo'}</p></div>
        </div>
        <button className="tuitionClose" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={21}/></button>
      </header>

      <section className="tuitionHero">
        <div>
          <span>ZIVIFACTURA · EDUCACIÓN</span>
          <h1>Control de mensualidades y mora.</h1>
          <p>Esta es la base del flujo recurrente del centro. Desde aquí configuraremos vencimientos, alumnos, cargos mensuales, pagos y estados de cuenta.</p>
        </div>
        <div className="tuitionHeroBadge"><GraduationCap size={21}/><span>Perfil</span><strong>Educativo</strong></div>
      </section>

      <section className="tuitionMetrics">
        <article><Users size={20}/><span>Personas disponibles</span><strong>{clients.length}</strong><small>Clientes y representantes del negocio</small></article>
        <article><CalendarDays size={20}/><span>Día de cobro</span><strong>{company?.billingDay || 5}</strong><small>Cada mes</small></article>
        <article><Percent size={20}/><span>Mora configurada</span><strong>{company?.monthlyLateFeePct ?? 3}%</strong><small>Parámetro inicial editable</small></article>
      </section>

      <nav className="tuitionTabs">
        <button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Resumen</button>
        <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>Alumnos / representantes</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Configuración</button>
      </nav>

      {message && <div className="tuitionMessage">{message}</div>}

      {tab === 'summary' && <section className="tuitionPanel">
        <div className="tuitionPanelHead"><div><span>FLUJO DE MENSUALIDADES</span><h2>Base administrativa lista</h2></div></div>
        <div className="tuitionFlow">
          <article className="done"><b>1</b><div><strong>Inscripción y aprobación</strong><p>La planilla educativa recibe la información y permite convertir una inscripción aprobada en cliente.</p></div></article>
          <article className="done"><b>2</b><div><strong>Representante disponible</strong><p>{clients.length ? `${clients.length} registro(s) disponibles para asociar a un plan mensual.` : 'Aún no hay clientes aprobados o creados en este negocio.'}</p></div></article>
          <article><b>3</b><div><strong>Plan mensual por alumno</strong><p>Siguiente bloque: alumno, representante, concepto, monto, moneda, fecha de inicio y beca/descuento.</p></div></article>
          <article><b>4</b><div><strong>Generación de cargos</strong><p>Siguiente bloque: crear mensualidades por período y enviarlas a Por cobrar sin duplicar facturas.</p></div></article>
          <article><b>5</b><div><strong>Pago, mora y estado de cuenta</strong><p>Siguiente bloque: aplicar cobros existentes, mora configurable y estado de cuenta individual.</p></div></article>
        </div>
      </section>}

      {tab === 'people' && <section className="tuitionPanel">
        <div className="tuitionPanelHead"><div><span>BASE DE PERSONAS</span><h2>Alumnos y representantes por asociar</h2><p>Las inscripciones aprobadas hoy llegan a Clientes. El próximo paso será separar alumno y representante sin perder esta información.</p></div><strong>{contactable} con contacto</strong></div>
        {clients.length ? <div className="tuitionPeople">
          {clients.map(client => <article key={client.id || client.syncId || client.name}>
            <span className="tuitionAvatar">{client.name.trim().charAt(0).toUpperCase() || 'A'}</span>
            <div><strong>{client.name || 'Sin nombre'}</strong><small>{[client.phone, client.email].filter(Boolean).join(' · ') || 'Sin teléfono ni correo'}</small></div>
            <em>Pendiente de plan</em>
          </article>)}
        </div> : <div className="tuitionEmpty"><Users size={32}/><h3>Aún no hay personas para mensualidades</h3><p>Aprueba una inscripción o crea un cliente. Luego aparecerá aquí para asociarlo al plan mensual.</p></div>}
      </section>}

      {tab === 'settings' && <section className="tuitionPanel">
        <div className="tuitionPanelHead"><div><span>REGLAS DEL CENTRO</span><h2>Configuración general</h2><p>Estos valores serán la base para los cargos recurrentes cuando terminemos la generación automática.</p></div></div>
        <div className="tuitionSettings">
          <label><span>Día de vencimiento mensual</span><input type="number" min="1" max="28" value={billingDay} onChange={event => setBillingDay(event.target.value)}/><small>Usamos 1–28 para evitar problemas con meses cortos.</small></label>
          <label><span>Mora por retraso (%)</span><input type="number" min="0" step="0.01" value={lateFeePct} onChange={event => setLateFeePct(event.target.value)}/><small>Se aplicará cuando activemos el cálculo automático de mora.</small></label>
        </div>
        <button className="tuitionPrimary" onClick={() => void saveSettings()}><Save size={17}/>Guardar configuración</button>
      </section>}
    </div>
  </div>
}
