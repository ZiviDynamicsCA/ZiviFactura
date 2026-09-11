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

type FieldGroup = {
  section: EducationField
  sectionIndex: number
  rows: Array<{ field: EducationField; index: number; number: number }>
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

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  section: 'Sección',
  text: 'Respuesta corta',
  email: 'Correo',
  phone: 'Teléfono',
  date: 'Fecha',
  textarea: 'Respuesta larga',
  select: 'Lista',
  radio: 'Selección única',
}

const now = () => new Date().toISOString()
const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID().replace(/-/g, '')
  : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

const f = (key: string, label: string, type: FieldType, required = false, extra: Partial<EducationField> = {}): EducationField => ({
  id: makeId(),
  key,
  label,
  type,
  required,
  ...extra,
})

function enrollmentTemplate(companyId: number): EducationForm {
  const createdAt = now()
  return {
    key: `enrollment-${companyId}-${Date.now().toString(36)}`,
    companyId,
    title: 'Planilla de inscripción',
    description: 'Completa la información del estudiante y de su representante. El centro revisará la solicitud y te contactará para confirmar el proceso administrativo.',
    kind: 'enrollment',
    active: false,
    createdAt,
    updatedAt: createdAt,
    fields: [
      f('student_section', '1. Datos del estudiante', 'section'),
      f('email', 'Correo electrónico del representante', 'email', true, { placeholder: 'correo@ejemplo.com' }),
      f('studentName', 'Nombre y apellidos del estudiante', 'text', true),
      f('birthDate', 'Fecha de nacimiento', 'date', true),
      f('studentId', 'Cédula escolar / documento del estudiante', 'text', false),
      f('gradeSchool', 'Grado a cursar y colegio de procedencia', 'text', true),
      f('address', 'Dirección de habitación', 'textarea', true),

      f('guardian_section', '2. Representante y responsable de pago', 'section'),
      f('representativeNameId', 'Nombre, apellido y cédula del representante', 'text', true),
      f('payerNameId', 'Nombre, apellido y cédula de la persona responsable del pago', 'text', true),
      f('payerPhone', 'Teléfono de contacto para mensualidades', 'phone', true),
      f('contactInfo', 'Teléfono alternativo y correo adicional', 'textarea', false),
      f('workInfo', 'Ocupación, empresa y dirección de trabajo', 'textarea', false),

      f('academic_section', '3. Información académica y familiar', 'section'),
      f('supportAreas', 'Áreas o asignaturas donde necesita apoyo', 'textarea', false),
      f('learningDiagnosis', 'Diagnóstico de aprendizaje o informe profesional, si aplica', 'textarea', false),
      f('homeContext', 'Personas con quienes vive el estudiante y observaciones familiares importantes', 'textarea', false),

      f('billing_section', '4. Datos administrativos y pagos', 'section'),
      f('enrollmentPlan', 'Modalidad solicitada', 'select', true, { options: ['Inscripción regular', 'Inscripción + primera mensualidad', 'Mensualidad', 'Reingreso'] }),
      f('paymentResponsible', '¿Quién recibirá las facturas y avisos de pago?', 'text', true),
      f('lateFeeAccepted', 'Acepta las condiciones de mora por retraso de pago', 'radio', true, { options: ['Sí', 'No'] }),

      f('health_section', '5. Salud y autorizaciones', 'section'),
      f('healthHistory', 'Condición médica, alergias o medicamentos importantes', 'textarea', false),
      f('authorizedPickup', 'Personas autorizadas para retirar al estudiante', 'textarea', true),
      f('authorization', 'Autorizo el uso responsable de fotografías, videos y audios en actividades institucionales', 'radio', true, { options: ['Sí', 'No'] }),
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
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function statusLabel(status: SubmissionStatus) {
  if (status === 'approved') return 'Aprobada'
  if (status === 'review') return 'En revisión'
  if (status === 'rejected') return 'Rechazada'
  return 'Recibida'
}

function groupFields(fields: EducationField[]): FieldGroup[] {
  const groups: FieldGroup[] = []
  let questionNumber = 0
  let current: FieldGroup = {
    section: { id: '__general', key: '__general', label: 'Información general', type: 'section' },
    sectionIndex: -1,
    rows: [],
  }

  fields.forEach((field, index) => {
    if (field.type === 'section') {
      if (current.rows.length || current.sectionIndex >= 0) groups.push(current)
      current = { section: field, sectionIndex: index, rows: [] }
      return
    }
    questionNumber += 1
    current.rows.push({ field, index, number: questionNumber })
  })

  if (current.rows.length || current.sectionIndex >= 0) groups.push(current)
  return groups
}

function requiredCount(form?: EducationForm | null) {
  return form?.fields.filter(field => field.type !== 'section' && field.required).length || 0
}

function questionCount(form?: EducationForm | null) {
  return form?.fields.filter(field => field.type !== 'section').length || 0
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

  const activeCompanyId = company?.id || getActiveCompanyId()
  const activeForm = forms.find(form => form.key === activeKey) || forms[0] || null
  const fieldGroups = useMemo(() => groupFields(activeForm?.fields || []), [activeForm])
  const activeSubmissions = useMemo(() => activeForm?.publicId ? submissions.filter(item => item.formId === activeForm.publicId) : [], [submissions, activeForm])
  const publicUrl = activeForm?.publicId ? `${window.location.origin}/inscripcion.html?id=${encodeURIComponent(activeForm.publicId)}` : ''
  const hasCloudSession = Boolean(firebaseAuth?.currentUser && firestore)

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

  async function persistLocalFirst(nextForms: EducationForm[], options: { sync?: boolean } = {}) {
    setForms(nextForms)
    saveLocalForms(activeCompanyId, nextForms)
    if (!options.sync) return
    const user = firebaseAuth?.currentUser
    if (firestore && user) {
      await Promise.all(nextForms.map(form => setDoc(doc(firestore, 'users', user.uid, 'forms', form.key), form, { merge: true })))
    }
  }

  function syncFormsInBackground(nextForms: EducationForm[]) {
    const user = firebaseAuth?.currentUser
    if (!firestore || !user) return
    Promise.all(nextForms.map(form => setDoc(doc(firestore, 'users', user.uid, 'forms', form.key), form, { merge: true })))
      .catch(error => console.warn('[ZiviFactura] Education background sync:', error))
  }

  async function activate() {
    if (!company) return
    setBusy(true)
    setMessage('')
    setRulesNeeded(false)

    const companyId = company.id || getActiveCompanyId()
    const local = loadLocalForms(companyId)
    const nextForms = local.length ? local : [enrollmentTemplate(companyId)]

    localStorage.setItem(localEnabledKey(companyId), '1')
    saveLocalForms(companyId, nextForms)
    setForms(nextForms)
    setActiveKey(nextForms[0]?.key || '')
    setEnabled(true)
    setTab('forms')
    setMessage('Módulo educativo activado. Edita la planilla, publícala y comparte el enlace con representantes.')
    setBusy(false)

    const user = firebaseAuth?.currentUser
    if (firestore && user) {
      setDoc(doc(firestore, 'users', user.uid, 'modules', `education-${companyId}`), {
        enabled: true,
        companyId,
        businessProfile: 'education',
        updatedAt: serverTimestamp(),
      }, { merge: true })
        .then(() => syncFormsInBackground(nextForms))
        .catch(error => console.warn('[ZiviFactura] Education module cloud activation:', error))
    }
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

  function addField(afterIndex?: number) {
    if (!activeForm) return
    const index = activeForm.fields.filter(field => field.type !== 'section').length + 1
    const newField = f(`field_${Date.now()}`, `Nueva pregunta ${index}`, 'text', false)
    const fields = [...activeForm.fields]
    if (typeof afterIndex === 'number') fields.splice(afterIndex + 1, 0, newField)
    else fields.push(newField)
    updateActive({ fields })
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
    setBusy(true)
    setMessage('')
    setRulesNeeded(false)
    try {
      const next = forms.map(form => form.key === activeForm.key ? { ...form, updatedAt: now() } : form)
      await persistLocalFirst(next, { sync: Boolean(firebaseAuth?.currentUser && firestore) })
      setMessage('Planilla guardada.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la planilla.')
    } finally {
      setBusy(false)
    }
  }

  async function publishForm() {
    if (!activeForm || !company) return
    const user = firebaseAuth?.currentUser
    if (!firestore || !user) {
      setMessage('Para publicar y recibir inscripciones desde otros teléfonos debes iniciar sesión con tu cuenta de ZiviFactura.')
      return
    }
    setBusy(true)
    setMessage('')
    setRulesNeeded(false)
    try {
      const publicId = activeForm.publicId || makeId()
      const published: EducationForm = { ...activeForm, publicId, active: true, updatedAt: now() }
      await setDoc(doc(firestore, 'publicForms', publicId), publicPayload(published, company, user.uid), { merge: true })
      const next = forms.map(form => form.key === published.key ? published : form)
      await persistLocalFirst(next, { sync: true })
      setActiveKey(published.key)
      setMessage('Planilla publicada. Ya puedes compartir el enlace con padres y representantes.')
    } catch (error) {
      const code = (error as { code?: string })?.code || ''
      if (code.includes('permission-denied')) setRulesNeeded(true)
      setMessage(code.includes('permission-denied') ? 'Firebase todavía no permite publicar formularios. Copia las reglas indicadas abajo y publícalas en Firestore.' : (error instanceof Error ? error.message : 'No se pudo publicar.'))
    } finally {
      setBusy(false)
    }
  }

  async function unpublishForm() {
    if (!activeForm?.publicId) return
    const user = firebaseAuth?.currentUser
    if (!firestore || !user) return
    setBusy(true)
    try {
      await updateDoc(doc(firestore, 'publicForms', activeForm.publicId), { active: false, updatedAt: serverTimestamp() })
      const next = forms.map(form => form.key === activeForm.key ? { ...form, active: false, updatedAt: now() } : form)
      await persistLocalFirst(next, { sync: true })
      setMessage('Planilla pausada. El enlace deja de aceptar nuevas respuestas.')
    } finally {
      setBusy(false)
    }
  }

  async function createForm() {
    if (!company) return
    const createdAt = now()
    const form: EducationForm = {
      key: `custom-${company.id}-${Date.now().toString(36)}`,
      companyId: company.id,
      title: 'Nueva planilla',
      description: 'Describe brevemente para qué usarás este formulario.',
      kind: 'custom',
      active: false,
      createdAt,
      updatedAt: createdAt,
      fields: [f('section_1', 'Información', 'section'), f(`field_${Date.now()}`, 'Primera pregunta', 'text', true)],
    }
    const next = [form, ...forms]
    await persistLocalFirst(next, { sync: Boolean(firebaseAuth?.currentUser && firestore) })
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
    setForms(next)
    saveLocalForms(activeCompanyId, next)
    setActiveKey(next[0]?.key || '')
  }

  async function loadResponses() {
    const user = firebaseAuth?.currentUser
    if (!firestore || !user) {
      setMessage('Inicia sesión para consultar respuestas recibidas.')
      return
    }
    setBusy(true)
    setMessage('')
    setRulesNeeded(false)
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
    } finally {
      setBusy(false)
    }
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
      const created: Client = { companyId: activeCompanyId, name: payer, taxId: '', phone, email, address, createdAt: now(), updatedAt: now() }
      const id = Number(await db.clients.add(created))
      client = { ...created, id }
    }
    await setSubmissionStatus(submission, 'approved')
    const confirmText = `Hola ${payer}. Tu inscripción fue aprobada por ${company?.name || 'el centro educativo'}. Te contactaremos para continuar con inscripción, mensualidad y facturación.`
    await copyText(confirmText)
    setMessage(`Inscripción aprobada. ${client.name} quedó disponible como cliente para facturación. También copié un mensaje de confirmación para enviarlo por WhatsApp o correo.`)
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

  const checklist = [
    { label: 'Editar planilla', done: Boolean(activeForm) },
    { label: 'Publicar enlace', done: Boolean(activeForm?.active && activeForm?.publicId) },
    { label: 'Recibir respuestas', done: submissions.length > 0 },
    { label: 'Aprobar y cobrar', done: submissions.some(item => item.status === 'approved') },
  ]

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
        <p>Activa este módulo solo para negocios educativos. Te permite crear planillas, compartir un enlace público, revisar respuestas y convertir una inscripción aprobada en cliente para inscripción, mensualidad y mora.</p>
        <div className="educationActivationGrid">
          <article><ClipboardList/><strong>Planilla tipo Google Form</strong><span>Preguntas organizadas por secciones, editables y listas para compartir.</span></article>
          <article><Send/><strong>Enlace público real</strong><span>El representante llena la inscripción en producción desde cualquier teléfono.</span></article>
          <article><UserCheck/><strong>Aprobación administrativa</strong><span>Apruebas, creas cliente y preparas el flujo de cobro sin transcribir datos.</span></article>
        </div>
        <button className="educationPrimary" disabled={busy || !company} onClick={() => void activate()}><GraduationCap size={18}/>{busy ? 'Activando…' : `Activar para ${company?.name || 'este negocio'}`}</button>
      </section> : <>
        <section className="educationDashboard">
          <div className="educationDashboardCopy">
            <span className="educationEyebrow">CENTRO EDUCATIVO</span>
            <h1>Inscripciones, representantes y mensualidades.</h1>
            <p>Gestiona el flujo desde la planilla pública hasta la aprobación. La facturación y los cobros quedan separados para avanzar luego con mensualidades, mora y estados de pago.</p>
          </div>
          <div className="educationModuleSummary">
            <article><ClipboardList/><span>Planillas</span><strong>{forms.length}</strong></article>
            <article><Send/><span>Publicadas</span><strong>{forms.filter(form => form.active).length}</strong></article>
            <article><Users/><span>Respuestas</span><strong>{activeSubmissions.length || submissions.length}</strong></article>
          </div>
        </section>

        <section className="educationChecklist">
          {checklist.map((item, index) => <article key={item.label} className={item.done ? 'done' : ''}><b>{index + 1}</b><CheckCircle2 size={15}/><span>{item.label}</span></article>)}
        </section>

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
            {forms.map(form => <button key={form.key} className={activeForm?.key === form.key ? 'active' : ''} onClick={() => setActiveKey(form.key)}><span>{form.kind === 'enrollment' ? <GraduationCap size={17}/> : <ClipboardList size={17}/>}</span><div><strong>{form.title}</strong><small>{form.active ? 'Publicada' : 'Borrador'} · {questionCount(form)} preguntas</small></div></button>)}
            {!forms.length && <p>No hay planillas todavía.</p>}
          </aside>

          <main className="educationEditor">
            {activeForm ? <>
              <div className="educationEditorHead">
                <div><span className="educationEyebrow">EDITOR GUIADO</span><h2>{activeForm.title}</h2><p>{questionCount(activeForm)} preguntas · {requiredCount(activeForm)} obligatorias · {fieldGroups.length} secciones</p></div>
                <div><button className="educationGhost" disabled={busy} onClick={() => void saveForm()}><Save size={16}/>Guardar</button>{activeForm.active ? <button className="educationWarn" disabled={busy} onClick={() => void unpublishForm()}>Pausar</button> : <button className="educationPrimary small" disabled={busy || !hasCloudSession} onClick={() => void publishForm()}><Send size={16}/>Publicar</button>}</div>
              </div>

              {!hasCloudSession && <div className="educationNotice"><strong>Modo local de edición</strong><span>Inicia sesión para publicar un enlace real y recibir respuestas desde otros teléfonos.</span></div>}

              <div className="educationFormMeta">
                <label><span>Título visible para representantes</span><input value={activeForm.title} onChange={event => updateActive({ title: event.target.value })}/></label>
                <label><span>Mensaje inicial</span><textarea rows={3} value={activeForm.description} onChange={event => updateActive({ description: event.target.value })}/></label>
              </div>

              {publicUrl ? <div className="educationShare"><div><span>ENLACE DE INSCRIPCIÓN</span><strong>{publicUrl}</strong></div><button onClick={() => void copyText(publicUrl)} title="Copiar enlace"><Copy size={17}/></button><button onClick={() => void shareForm()} title="Compartir"><Send size={17}/></button><a href={publicUrl} target="_blank" rel="noreferrer" title="Abrir"><ExternalLink size={17}/></a></div> : <div className="educationFlowNote"><strong>Flujo de prueba</strong><span>Guarda la planilla → publícala → comparte el enlace → recibe respuestas → aprueba → crea cliente para inscripción, mensualidad o mora.</span></div>}

              <div className="educationFields grouped">
                {fieldGroups.map((group, groupIndex) => <details className="educationFieldGroup" key={group.section.id} open={groupIndex === 0}>
                  <summary><span>{groupIndex + 1}</span><div><strong>{group.section.label}</strong><small>{group.rows.length} pregunta(s) en esta sección</small></div></summary>
                  {group.sectionIndex >= 0 && <div className="educationSectionTools"><label><span>Nombre de la sección</span><input value={group.section.label} onChange={event => updateField(group.section.id, { label: event.target.value })}/></label><div><button disabled={group.sectionIndex === 0} onClick={() => moveField(group.section.id, -1)}><ArrowUp size={15}/></button><button disabled={group.sectionIndex === activeForm.fields.length - 1} onClick={() => moveField(group.section.id, 1)}><ArrowDown size={15}/></button><button onClick={() => removeField(group.section.id)}><Trash2 size={15}/></button></div></div>}
                  <div className="educationQuestionStack">
                    {group.rows.map(({ field, index, number }) => <article className="educationQuestion" key={field.id}>
                      <div className="educationQuestionTop"><span>{number}</span><input value={field.label} onChange={event => updateField(field.id, { label: event.target.value })}/><div><button disabled={index === 0} onClick={() => moveField(field.id, -1)}><ArrowUp size={15}/></button><button disabled={index === activeForm.fields.length - 1} onClick={() => moveField(field.id, 1)}><ArrowDown size={15}/></button><button onClick={() => removeField(field.id)}><Trash2 size={15}/></button></div></div>
                      <div className="educationQuestionOptions"><label><span>Tipo</span><select value={field.type} onChange={event => updateField(field.id, { type: event.target.value as FieldType })}>{Object.entries(FIELD_TYPE_LABELS).filter(([key]) => key !== 'section').map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label className="educationCheck"><input type="checkbox" checked={Boolean(field.required)} onChange={event => updateField(field.id, { required: event.target.checked })}/><span>Obligatoria</span></label>{(field.type === 'select' || field.type === 'radio') && <label className="wide"><span>Opciones separadas por coma</span><input value={(field.options || []).join(', ')} onChange={event => updateField(field.id, { options: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })}/></label>}</div>
                    </article>)}
                  </div>
                  <button className="educationAddQuestion compact" onClick={() => addField(group.rows.at(-1)?.index ?? group.sectionIndex)}><Plus size={17}/>Agregar pregunta en esta sección</button>
                </details>)}
                <button className="educationAddQuestion" onClick={() => addField()}><Plus size={17}/>Agregar pregunta al final</button>
              </div>

              <div className="educationEditorFooter"><button className="educationDanger" onClick={() => void deleteForm()}><Trash2 size={16}/>Eliminar planilla</button><button className="educationPrimary" disabled={busy} onClick={() => void saveForm()}><Save size={16}/>Guardar cambios</button></div>
            </> : <div className="educationEmpty"><ClipboardList size={30}/><h3>Crea tu primera planilla</h3><p>La plantilla educativa organiza la información por secciones para que el centro pueda revisar sin transcribir datos.</p><button className="educationPrimary" onClick={() => void activate()}><Plus size={17}/>Crear plantilla base</button></div>}
          </main>
        </div>}

        {tab === 'responses' && <section className="educationResponses">
          <div className="educationResponseHead"><div><span className="educationEyebrow">INSCRIPCIONES RECIBIDAS</span><h2>Revisión y aprobación</h2><p>Las respuestas quedan separadas de la facturación hasta que decidas aprobarlas.</p></div><button className="educationGhost" disabled={busy} onClick={() => void loadResponses()}>Actualizar</button></div>
          {!submissions.length ? <div className="educationEmpty"><Users size={30}/><h3>Aún no hay inscripciones</h3><p>Publica y comparte una planilla. Cuando un representante la envíe, aparecerá aquí para revisión.</p></div> : <div className="educationResponseList">{submissions.map(submission => {
            const form = forms.find(item => item.publicId === submission.formId)
            return <details key={`${submission.formId}-${submission.id}`} className="educationResponseCard"><summary><span><UserCheck size={18}/></span><div><strong>{submission.respondentName || submission.answers?.studentName || 'Nueva inscripción'}</strong><small>{form?.title || 'Planilla'} · {statusLabel(submission.status)}</small></div><b>{submission.respondentEmail || submission.answers?.email || ''}</b></summary><div className="educationAnswerGrid">{form?.fields.filter(field => field.type !== 'section').map(field => <article key={field.id}><span>{field.label}</span><strong>{submission.answers?.[field.key] || '—'}</strong></article>)}</div><div className="educationResponseActions"><button onClick={() => void setSubmissionStatus(submission, 'review')}>Marcar en revisión</button><button className="educationDanger" onClick={() => void setSubmissionStatus(submission, 'rejected')}>Rechazar</button><button className="educationPrimary small" onClick={() => void approveAndCreateClient(submission)}><CheckCircle2 size={15}/>Aprobar y crear cliente</button></div></details>
          })}</div>}
        </section>}
      </>}
    </div>
  </div>
}
