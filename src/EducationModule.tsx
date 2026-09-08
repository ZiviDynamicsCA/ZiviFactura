import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, CheckCircle2, ClipboardList, Copy, ExternalLink, GraduationCap, Plus, Save, Send, Trash2, UserCheck, Users, X } from 'lucide-react'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './db'
import { getActiveCompanyId } from './companyScope'
import { firebaseAuth, firestore } from './firebase'
import type { Client, Company } from './types'
import './education.css'

type FieldType = 'section' | 'text' | 'email' | 'phone' | 'date' | 'textarea' | 'select' | 'radio'
type SubmissionStatus = 'received' | 'review' | 'approved' | 'rejected'

type EducationField = {
  id: string
  key: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  helpText?: string
  options?: string[]
}

type EducationForm = {
  key: string
  companyId: number
  title: string
  description: string
  kind: 'enrollment' | 'custom'
  active: boolean
  publicId?: string
  fields: EducationField[]
  createdAt: string
  updatedAt: string
}

type EducationSubmission = {
  id: string
  formId: string
  formKey: string
  companyId: number
  ownerUid: string
  answers: Record<string, string>
  respondentName?: string
  respondentEmail?: string
  status: SubmissionStatus
  createdAt?: unknown
  submittedAt?: string
}

const RULES_SNIPPET = `// Agrega estos bloques dentro de service cloud.firestore { match /databases/{database}/documents { ... } }
match /publicForms/{formId} {
  allow read: if resource.data.active == true || (request.auth != null && request.auth.uid == resource.data.ownerUid);
  allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerUid;
  allow update, delete: if request.auth != null && request.auth.uid == resource.data.ownerUid;

  match /submissions/{submissionId} {
    allow create: if request.auth != null;
    allow read, update, delete: if request.auth != null
      && request.auth.uid == get(/databases/$(database)/documents/publicForms/$(formId)).data.ownerUid;
  }
}`

const now = () => new Date().toISOString()
const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID().replace(/-/g, '')
  : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

const f = (key: string, label: string, type: FieldType, required = false, extra: Partial<EducationField> = {}): EducationField => ({
  id: makeId(), key, label, type, required, ...extra,
})

function enrollmentTemplate(companyId: number): EducationForm {
  const createdAt = now()
  return {
    key: `enrollment-${companyId}-${Date.now().toString(36)}`,
    companyId,
    title: 'Planilla de inscripción',
    description: 'Completa la información del estudiante y de su representante. Los campos marcados como obligatorios deben ser respondidos antes de enviar la planilla.',
    kind: 'enrollment',
    active: false,
    createdAt,
    updatedAt: createdAt,
    fields: [
      f('student_section', 'Datos del estudiante', 'section'),
      f('email', 'Correo electrónico', 'email', true, { placeholder: 'correo@ejemplo.com' }),
      f('studentName', 'Nombre y apellidos del estudiante', 'text', true),
      f('birthDate', 'Fecha de nacimiento', 'date', true),
      f('gradeSchool', 'Grado que cursa y colegio de procedencia', 'text', true),
      f('address', 'Dirección de habitación', 'textarea', true),

      f('academic_section', 'Necesidades académicas', 'section'),
      f('supportAreas', 'Describa brevemente en qué áreas o asignaturas necesita apoyo su hijo(a)', 'textarea', true),
      f('serviceReasons', 'Describa brevemente las razones por las que solicita nuestros servicios', 'textarea', true),
      f('learningDiagnosis', '¿Tiene algún diagnóstico de aprendizaje? Si la respuesta es positiva, indique qué especialista apoyó en el proceso y recuerde consignar copia del informe.', 'textarea', false),

      f('guardian_section', 'Representante y responsable de pago', 'section'),
      f('representativeNameId', 'Nombre, apellido del representante y número de cédula', 'text', true),
      f('payerNameId', 'Nombre, apellido y número de cédula de la persona responsable del pago', 'text', true),
      f('payerPhone', 'Número de teléfono de contacto de la persona responsable del pago de mensualidades', 'phone', true),
      f('workplaceRole', 'Lugar de trabajo y cargo', 'text', false),
      f('homeContext', '¿Quién(es) vive(n) con el niño? Explique brevemente con quién pasa mayor tiempo su representante.', 'textarea', false),
      f('contactInfo', 'Indique su información de contacto: teléfono celular y correo electrónico', 'textarea', true),
      f('workInfo', 'Indique su información laboral: ocupación y dirección de trabajo', 'textarea', false),

      f('health_section', 'Salud y autorizaciones', 'section'),
      f('healthHistory', 'Indique algún historial de salud importante: condición médica especial, alergias alimentarias o a medicamentos y medicamentos que toma actualmente.', 'textarea', false),
      f('authorizedPickup', 'Indique las personas autorizadas para retirar a su representado: nombre y apellido, número de cédula y parentesco.', 'textarea', true),
      f('authorization', 'Autorizo al centro educativo a tomar fotografías, videos y audios de mi representado durante las actividades pedagógicas, culturales y de recreación, para fines institucionales y bajo uso responsable.', 'radio', true, { options: ['Sí', 'No'] }),
    ],
  }
}

function localFormsKey(companyId: number) { return `zivifactura.education.forms.${companyId}` }
function localEnabledKey(companyId: number) { return `zivifactura.education.enabled.${companyId}` }

function loadLocalForms(companyId: number): EducationForm[] {
  try { return JSON.parse(localStorage.getItem(localFormsKey(companyId)) || '[]') as EducationForm[] } catch { return [] }
}
function saveLocalForms(companyId: number, forms: EducationForm[]) {
  localStorage.setItem(localFormsKey(companyId), JSON.stringify(forms))
}

function publicPayload(form: EducationForm, company: Company, ownerUid: string) {
  return {
    version: 1,
    active: form.active,
    ownerUid,
    companyId: form.companyId,
    company: { name: company.name, phone: company.phone || '', email: company.email || '', city: company.city || '' },
    formKey: form.key,
    title: form.title,
    description: form.description,
    kind: form.kind,
    fields: form.fields.map(field => ({
      id: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      required: Boolean(field.required),
      placeholder: field.placeholder || '',
      helpText: field.helpText || '',
      options: field.options || [],
    })),
    updatedAt: serverTimestamp(),
  }
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text) }
  catch {
    const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove()
  }
}

export default function EducationModule() {
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState<Company | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [forms, setForms] = useState<EducationForm[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [tab, setTab] = useState<'forms' | 'responses'>('forms')
  const [submissions, setSubmissions] = useState<EducationSubmission[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [rulesNeeded, setRulesNeeded] = useState(false)

  const activeForm = forms.find(form => form.key === activeKey) || forms[0] || null
  const activeCompanyId = company?.id || getActiveCompanyId()
  const activeSubmissions = useMemo(() => activeForm?.publicId ? submissions.filter(item => item.formId === activeForm.publicId) : [], [submissions, activeForm])

  useEffect(() => {
    const show = () => { setOpen(true); setMessage(''); setRulesNeeded(false) }
    window.addEventListener('zivifactura:open-education', show)
    return () => window.removeEventListener('zivifactura:open-education', show)
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open])

  async function load() {
    const companyId = getActiveCompanyId()
    const current = await db.company.get(companyId) || await db.company.get(1) || null
    setCompany(current || null)
    const local = loadLocalForms(companyId)
    setForms(local)
    if (local[0]) setActiveKey(local[0].key)
    let isEnabled = localStorage.getItem(localEnabledKey(companyId)) === '1'

    const user = firebaseAuth?.currentUser
    if (firestore && user) {
      try {
        const moduleSnap = await getDoc(doc(firestore, 'users', user.uid, 'modules', `education-${companyId}`))
        if (moduleSnap.exists()) isEnabled = Boolean(moduleSnap.data().enabled)
        const remote = await getDocs(collection(firestore, 'users', user.uid, 'forms'))
        const remoteForms = remote.docs.map(item => item.data() as EducationForm).filter(form => Number(form.companyId) === companyId)
        if (remoteForms.length) {
          const ordered = remoteForms.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
          setForms(ordered)
          saveLocalForms(companyId, ordered)
          if (!ordered.some(form => form.key === activeKey)) setActiveKey(ordered[0].key)
        }
      } catch (error) {
        console.warn('[ZiviFactura] Education load:', error)
      }
    }
    setEnabled(isEnabled)
  }

  async function persist(nextForms: EducationForm[]) {
    setForms(nextForms)
    saveLocalForms(activeCompanyId, nextForms)
    const user = firebaseAuth?.currentUser
    if (firestore && user) {
      await Promise.all(nextForms.map(form => setDoc(doc(firestore, 'users', user.uid, 'forms', form.key), form, { merge: true })))
    }
  }

  async function activate() {
    if (!company) return
    setBusy(true)
    try {
      localStorage.setItem(localEnabledKey(company.id), '1')
      const user = firebaseAuth?.currentUser
      if (firestore && user) await setDoc(doc(firestore, 'users', user.uid, 'modules', `education-${company.id}`), { enabled: true, companyId: company.id, updatedAt: serverTimestamp() }, { merge: true })
      setEnabled(true)
      if (!forms.length) {
        const template = enrollmentTemplate(company.id)
        await persist([template])
        setActiveKey(template.key)
      }
      setMessage('Módulo educativo activado. La planilla base ya está lista para personalizar.')
    } finally { setBusy(false) }
  }

  function updateActive(patch: Partial<EducationForm>) {
    if (!activeForm) return
    const next = forms.map(form => form.key === activeForm.key ? { ...form, ...patch, updatedAt: now() } : form)
    setForms(next)
    saveLocalForms(activeCompanyId, next)
  }

  function updateField(fieldId: string, patch: Partial<EducationField>) {
    if (!activeForm) return
    updateActive({ fields: activeForm.fields.map(field => field.id === fieldId ? { ...field, ...patch } : field) })
  }

  function addField() {
    if (!activeForm) return
    const index = activeForm.fields.filter(field => field.type !== 'section').length + 1
    updateActive({ fields: [...activeForm.fields, f(`field_${Date.now()}`, `Nueva pregunta ${index}`, 'text', false)] })
  }

  function removeField(fieldId: string) {
    if (!activeForm) return
    updateActive({ fields: activeForm.fields.filter(field => field.id !== fieldId) })
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    if (!activeForm) return
    const fields = [...activeForm.fields]
    const index = fields.findIndex(field => field.id === fieldId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= fields.length) return
    ;[fields[index], fields[target]] = [fields[target], fields[index]]
    updateActive({ fields })
  }

  async function saveForm() {
    if (!activeForm) return
    setBusy(true); setMessage(''); setRulesNeeded(false)
    try {
      await persist(forms.map(form => form.key === activeForm.key ? { ...form, updatedAt: now() } : form))
      setMessage('Planilla guardada.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la planilla.')
    } finally { setBusy(false) }
  }

  async function publishForm() {
    if (!activeForm || !company) return
    const user = firebaseAuth?.currentUser
    if (!firestore || !user) {
      setMessage('Para publicar y recibir inscripciones desde otros teléfonos debes iniciar sesión con tu cuenta de ZiviFactura.')
      return
    }
    setBusy(true); setMessage(''); setRulesNeeded(false)
    try {
      const publicId = activeForm.publicId || makeId()
      const published: EducationForm = { ...activeForm, publicId, active: true, updatedAt: now() }
      await setDoc(doc(firestore, 'publicForms', publicId), publicPayload(published, company, user.uid), { merge: true })
      const next = forms.map(form => form.key === published.key ? published : form)
      await persist(next)
      setActiveKey(published.key)
      setMessage('Planilla publicada. Ya puedes compartir el enlace con padres y representantes.')
    } catch (error) {
      const code = (error as { code?: string })?.code || ''
      if (code.includes('permission-denied')) setRulesNeeded(true)
      setMessage(code.includes('permission-denied') ? 'Firebase todavía no permite publicar formularios. Copia las reglas indicadas abajo y publícalas en Firestore.' : (error instanceof Error ? error.message : 'No se pudo publicar.'))
    } finally { setBusy(false) }
  }

  async function unpublishForm() {
    if (!activeForm?.publicId) return
    const user = firebaseAuth?.currentUser
    if (!firestore || !user) return
    setBusy(true)
    try {
      await updateDoc(doc(firestore, 'publicForms', activeForm.publicId), { active: false, updatedAt: serverTimestamp() })
      const next = forms.map(form => form.key === activeForm.key ? { ...form, active: false, updatedAt: now() } : form)
      await persist(next)
      setMessage('Planilla pausada. El enlace deja de aceptar nuevas respuestas.')
    } finally { setBusy(false) }
  }

  async function createForm() {
    if (!company) return
    const createdAt = now()
    const form: EducationForm = {
      key: `custom-${company.id}-${Date.now().toString(36)}`,
      companyId: company.id,
      title: 'Nueva planilla',
      description: 'Describe brevemente para qué usarás este formulario.',
      kind: 'custom', active: false, createdAt, updatedAt: createdAt,
      fields: [f('section_1', 'Información', 'section'), f(`field_${Date.now()}`, 'Primera pregunta', 'text', true)],
    }
    const next = [form, ...forms]
    await persist(next)
    setActiveKey(form.key)
    setTab('forms')
  }

  async function deleteForm() {
    if (!activeForm || !confirm(`¿Eliminar “${activeForm.title}”?`)) return
    const user = firebaseAuth?.currentUser
    if (firestore && user) {
      await deleteDoc(doc(firestore, 'users', user.uid, 'forms', activeForm.key)).catch(() => undefined)
      if (activeForm.publicId) await deleteDoc(doc(firestore, 'publicForms', activeForm.publicId)).catch(() => undefined)
    }
    const next = forms.filter(form => form.key !== activeForm.key)
    setForms(next); saveLocalForms(activeCompanyId, next); setActiveKey(next[0]?.key || '')
  }

  async function loadResponses() {
    const user = firebaseAuth?.currentUser
    if (!firestore || !user) { setMessage('Inicia sesión para consultar respuestas recibidas.'); return }
    setBusy(true); setMessage(''); setRulesNeeded(false)
    try {
      const published = forms.filter(form => form.publicId)
      const batches = await Promise.all(published.map(async form => {
        const snap = await getDocs(collection(firestore, 'publicForms', form.publicId!, 'submissions'))
        return snap.docs.map(item => ({ id: item.id, ...(item.data() as Omit<EducationSubmission, 'id'>) }))
      }))
      const rows = batches.flat().sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))
      setSubmissions(rows)
      setMessage(rows.length ? `${rows.length} respuesta(s) cargada(s).` : 'Todavía no hay respuestas recibidas.')
    } catch (error) {
      const code = (error as { code?: string })?.code || ''
      if (code.includes('permission-denied')) setRulesNeeded(true)
      setMessage(code.includes('permission-denied') ? 'Faltan permisos de Firestore para leer las inscripciones. Usa las reglas indicadas abajo.' : 'No se pudieron cargar las respuestas.')
    } finally { setBusy(false) }
  }

  async function setSubmissionStatus(submission: EducationSubmission, status: SubmissionStatus) {
    if (!firestore) return
    await updateDoc(doc(firestore, 'publicForms', submission.formId, 'submissions', submission.id), { status, reviewedAt: serverTimestamp() })
    setSubmissions(current => current.map(item => item.id === submission.id ? { ...item, status } : item))
  }

  async function approveAndCreateClient(submission: EducationSubmission) {
    const form = forms.find(item => item.publicId === submission.formId)
    if (!form) return
    const answers = submission.answers || {}
    const payer = answers.payerNameId || answers.representativeNameId || answers.studentName || 'Representante'
    const email = answers.email || ''
    const phone = answers.payerPhone || ''
    const address = answers.address || ''
    const clients = await db.clients.toArray()
    const normalized = (value = '') => value.trim().toLowerCase()
    const existing = clients.find(client => (client.companyId || 1) === activeCompanyId && ((email && normalized(client.email) === normalized(email)) || (phone && client.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')) || normalized(client.name) === normalized(payer)))
    let client: Client | undefined = existing
    if (!client) {
      const created: Client = { companyId: activeCompanyId, name: payer, taxId: '', phone, email, address, createdAt: now() }
      const id = Number(await db.clients.add(created))
      client = { ...created, id }
    }
    await setSubmissionStatus(submission, 'approved')
    setMessage(`Inscripción aprobada. ${client.name} quedó disponible como cliente para facturación y cobros.`)
  }

  async function shareForm() {
    if (!activeForm?.publicId) return
    const url = `${window.location.origin}/inscripcion.html?id=${encodeURIComponent(activeForm.publicId)}`
    const text = `Hola. Te compartimos la planilla “${activeForm.title}” de ${company?.name || 'nuestro centro'}. Completa la inscripción desde este enlace:\n${url}`
    if (navigator.share) {
      try { await navigator.share({ title: activeForm.title, text, url }); return } catch { /* user cancelled */ }
    }
    await copyText(text)
    setMessage('Mensaje y enlace copiados para compartir.')
  }

  if (!open) return null

  const publicUrl = activeForm?.publicId ? `${window.location.origin}/inscripcion.html?id=${encodeURIComponent(activeForm.publicId)}` : ''

  return <div className="educationOverlay" role="dialog" aria-modal="true" aria-label="Módulo educativo">
    <div className="educationShell">
      <header className="educationTop">
        <div className="educationBrand"><span><GraduationCap size={24}/></span><div><small>MÓDULO DEL NEGOCIO</small><strong>Inscripciones y educación</strong><p>{company?.name || 'Negocio activo'}</p></div></div>
        <button className="educationClose" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={21}/></button>
      </header>

      {!enabled ? <section className="educationActivation">
        <div className="educationActivationIcon"><BookOpen size={34}/></div>
        <span className="educationEyebrow">ACTIVACIÓN OPCIONAL</span>
        <h1>Convierte la inscripción en un flujo administrativo.</h1>
        <p>Este módulo se activa solo para el negocio que lo necesita. Permite crear planillas, compartirlas con padres o representantes, revisar respuestas y convertir una inscripción aprobada en cliente para facturación.</p>
        <div className="educationActivationGrid">
          <article><ClipboardList/><strong>Planillas propias</strong><span>Basadas en la planilla real que usas hoy, pero editables dentro de ZiviFactura.</span></article>
          <article><Send/><strong>Enlace público</strong><span>El representante llena la inscripción desde cualquier teléfono, sin tener cuenta.</span></article>
          <article><UserCheck/><strong>Aprobación</strong><span>Revisa la información y crea el cliente de cobro sin volver a transcribir datos.</span></article>
        </div>
        <button className="educationPrimary" disabled={busy} onClick={() => void activate()}><GraduationCap size={18}/>{busy ? 'Activando…' : `Activar para ${company?.name || 'este negocio'}`}</button>
      </section> : <>
        <nav className="educationTabs">
          <button className={tab === 'forms' ? 'active' : ''} onClick={() => setTab('forms')}><ClipboardList size={17}/>Planillas</button>
          <button className={tab === 'responses' ? 'active' : ''} onClick={() => { setTab('responses'); void loadResponses() }}><Users size={17}/>Respuestas</button>
          <button onClick={() => window.dispatchEvent(new Event('zivifactura:open-help'))}><BookOpen size={17}/>Tutorial</button>
        </nav>

        {message && <div className="educationMessage">{message}</div>}
        {rulesNeeded && <div className="educationRules"><strong>Configuración necesaria en Firestore</strong><p>El módulo está listo, pero Firebase debe permitir la lectura del formulario público y la creación de respuestas anónimas.</p><pre>{RULES_SNIPPET}</pre><button onClick={() => void copyText(RULES_SNIPPET)}><Copy size={15}/>Copiar reglas</button></div>}

        {tab === 'forms' && <div className="educationWorkspace">
          <aside className="educationFormList">
            <div className="educationListHead"><div><small>FORMULARIOS</small><strong>{forms.length} planilla(s)</strong></div><button onClick={() => void createForm()} title="Nueva planilla"><Plus size={18}/></button></div>
            {forms.map(form => <button key={form.key} className={activeForm?.key === form.key ? 'active' : ''} onClick={() => setActiveKey(form.key)}><span>{form.kind === 'enrollment' ? <GraduationCap size={17}/> : <ClipboardList size={17}/>}</span><div><strong>{form.title}</strong><small>{form.active ? 'Publicada' : 'Borrador'}</small></div></button>)}
            {!forms.length && <p>No hay planillas todavía.</p>}
          </aside>

          <main className="educationEditor">
            {activeForm ? <>
              <div className="educationEditorHead"><div><span className="educationEyebrow">EDITOR DE PLANILLA</span><h2>{activeForm.title}</h2><p>{activeForm.fields.filter(field => field.type !== 'section').length} preguntas · {activeForm.fields.filter(field => field.required).length} obligatorias</p></div><div><button className="educationGhost" disabled={busy} onClick={() => void saveForm()}><Save size={16}/>Guardar</button>{activeForm.active ? <button className="educationWarn" onClick={() => void unpublishForm()}>Pausar</button> : <button className="educationPrimary small" disabled={busy} onClick={() => void publishForm()}><Send size={16}/>Publicar</button>}</div></div>

              <div className="educationFormMeta">
                <label><span>Título</span><input value={activeForm.title} onChange={event => updateActive({ title: event.target.value })}/></label>
                <label><span>Introducción</span><textarea rows={3} value={activeForm.description} onChange={event => updateActive({ description: event.target.value })}/></label>
              </div>

              {publicUrl && <div className="educationShare"><div><span>ENLACE DE INSCRIPCIÓN</span><strong>{publicUrl}</strong></div><button onClick={() => void copyText(publicUrl)} title="Copiar enlace"><Copy size={17}/></button><button onClick={() => void shareForm()} title="Compartir"><Send size={17}/></button><a href={publicUrl} target="_blank" rel="noreferrer" title="Abrir"><ExternalLink size={17}/></a></div>}

              <div className="educationFields">
                {activeForm.fields.map((field, index) => field.type === 'section' ? <article className="educationSectionField" key={field.id}><div><BookOpen size={17}/><input value={field.label} onChange={event => updateField(field.id, { label: event.target.value })}/></div><div><button disabled={index === 0} onClick={() => moveField(field.id, -1)}><ArrowUp size={15}/></button><button disabled={index === activeForm.fields.length - 1} onClick={() => moveField(field.id, 1)}><ArrowDown size={15}/></button><button onClick={() => removeField(field.id)}><Trash2 size={15}/></button></div></article> : <article className="educationQuestion" key={field.id}>
                  <div className="educationQuestionTop"><span>{index + 1}</span><input value={field.label} onChange={event => updateField(field.id, { label: event.target.value })}/><div><button disabled={index === 0} onClick={() => moveField(field.id, -1)}><ArrowUp size={15}/></button><button disabled={index === activeForm.fields.length - 1} onClick={() => moveField(field.id, 1)}><ArrowDown size={15}/></button><button onClick={() => removeField(field.id)}><Trash2 size={15}/></button></div></div>
                  <div className="educationQuestionOptions"><label><span>Tipo</span><select value={field.type} onChange={event => updateField(field.id, { type: event.target.value as FieldType })}><option value="text">Respuesta corta</option><option value="textarea">Respuesta larga</option><option value="email">Correo</option><option value="phone">Teléfono</option><option value="date">Fecha</option><option value="select">Lista</option><option value="radio">Selección única</option></select></label><label className="educationCheck"><input type="checkbox" checked={Boolean(field.required)} onChange={event => updateField(field.id, { required: event.target.checked })}/><span>Obligatoria</span></label>{(field.type === 'select' || field.type === 'radio') && <label className="wide"><span>Opciones separadas por coma</span><input value={(field.options || []).join(', ')} onChange={event => updateField(field.id, { options: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })}/></label>}</div>
                </article>)}
                <button className="educationAddQuestion" onClick={addField}><Plus size={17}/>Agregar pregunta</button>
              </div>

              <div className="educationEditorFooter"><button className="educationDanger" onClick={() => void deleteForm()}><Trash2 size={16}/>Eliminar planilla</button><button className="educationPrimary" disabled={busy} onClick={() => void saveForm()}><Save size={16}/>Guardar cambios</button></div>
            </> : <div className="educationEmpty"><ClipboardList size={30}/><h3>Crea tu primera planilla</h3><p>La plantilla de inscripción educativa replica el flujo principal de la planilla que usas actualmente, eliminando preguntas duplicadas y organizándola por secciones.</p><button className="educationPrimary" onClick={() => void activate()}><Plus size={17}/>Crear plantilla base</button></div>}
          </main>
        </div>}

        {tab === 'responses' && <section className="educationResponses">
          <div className="educationResponseHead"><div><span className="educationEyebrow">INSCRIPCIONES RECIBIDAS</span><h2>Revisión y aprobación</h2><p>Las respuestas quedan separadas de la facturación hasta que decidas aprobarlas.</p></div><button className="educationGhost" disabled={busy} onClick={() => void loadResponses()}>Actualizar</button></div>
          {!submissions.length ? <div className="educationEmpty"><Users size={30}/><h3>Aún no hay inscripciones</h3><p>Publica y comparte una planilla. Cuando un representante la envíe, aparecerá aquí para revisión.</p></div> : <div className="educationResponseList">{submissions.map(submission => {
            const form = forms.find(item => item.publicId === submission.formId)
            return <details key={`${submission.formId}-${submission.id}`} className="educationResponseCard"><summary><span><UserCheck size={18}/></span><div><strong>{submission.respondentName || submission.answers?.studentName || 'Nueva inscripción'}</strong><small>{form?.title || 'Planilla'} · {submission.status === 'approved' ? 'Aprobada' : submission.status === 'review' ? 'En revisión' : submission.status === 'rejected' ? 'Rechazada' : 'Recibida'}</small></div><b>{submission.respondentEmail || submission.answers?.email || ''}</b></summary><div className="educationAnswerGrid">{form?.fields.filter(field => field.type !== 'section').map(field => <article key={field.id}><span>{field.label}</span><strong>{submission.answers?.[field.key] || '—'}</strong></article>)}</div><div className="educationResponseActions"><button onClick={() => void setSubmissionStatus(submission, 'review')}>Marcar en revisión</button><button className="educationDanger" onClick={() => void setSubmissionStatus(submission, 'rejected')}>Rechazar</button><button className="educationPrimary small" onClick={() => void approveAndCreateClient(submission)}><CheckCircle2 size={15}/>Aprobar y crear cliente</button></div></details>
          })}</div>}
        </section>}
      </>}
    </div>
  </div>
}
