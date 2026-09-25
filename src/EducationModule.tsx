import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, CheckCircle2, ClipboardList, Copy, ExternalLink, GraduationCap, Plus, Save, Send, Trash2, UserCheck, Users, X } from 'lucide-react'
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
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

const RULES_SNIPPET = `match /publicForms/{formId} {
  allow read: if resource.data.active == true
    || (request.auth != null && request.auth.uid == resource.data.ownerUid);
  allow create: if request.auth != null
    && request.resource.data.ownerUid == request.auth.uid
    && request.resource.data.active == true;
  allow update, delete: if request.auth != null
    && request.auth.uid == resource.data.ownerUid;

  match /submissions/{submissionId} {
    allow create: if request.auth != null
      && request.auth.token.firebase.sign_in_provider == 'anonymous'
      && get(/databases/$(database)/documents/publicForms/$(formId)).data.active == true
      && request.resource.data.formId == formId
      && request.resource.data.ownerUid == get(/databases/$(database)/documents/publicForms/$(formId)).data.ownerUid
      && request.resource.data.anonymousUid == request.auth.uid
      && request.resource.data.status == 'received';
    allow read, update, delete: if request.auth != null
      && resource.data.ownerUid == request.auth.uid;
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

function standardField(key: string, label: string, type: FieldType, required = false, extra: Partial<EducationField> = {}): EducationField {
  return { id: `standard-${key}`, key, label, type, required, ...extra }
}

function enrollmentTemplate(companyId: number): EducationForm {
  const createdAt = now()
  return {
    key: `enrollment-standard-${companyId}`,
    companyId,
    title: 'Planilla de inscripción',
    description: 'Completa los datos del estudiante, su representante y la información administrativa solicitada. El centro revisará la inscripción y te contactará para continuar el proceso.',
    kind: 'enrollment',
    active: false,
    createdAt,
    updatedAt: createdAt,
    fields: [
      standardField('student_section', 'Datos del estudiante', 'section'),
      standardField('email', 'Email', 'email', true, { placeholder: 'correo@ejemplo.com' }),
      standardField('studentName', 'Nombres y apellidos del estudiante', 'text', true),
      standardField('birthDate', 'Fecha de nacimiento', 'date', true),
      standardField('gradeSchool', 'Grado que cursa y colegio de procedencia', 'text', true),
      standardField('address', 'Dirección de habitación', 'textarea', true),

      standardField('academic_section', 'Información académica', 'section'),
      standardField('supportAreas', 'Describa brevemente en qué áreas o asignaturas necesita apoyo su hijo(a)', 'textarea', true),
      standardField('admissionReason', 'Describa brevemente las razones por las que usted solicita nuestros servicios', 'textarea', true),
      standardField('learningDiagnosis', '¿Tiene algún diagnóstico de aprendizaje? Si la respuesta es positiva, indique qué especialista apoya en el proceso y recuerde consignar copia del informe', 'textarea', true),

      standardField('guardian_section', 'Datos del representante', 'section'),
      standardField('representativeNameId', 'Nombre y apellido del representante y número de cédula', 'text', true),
      standardField('homeContext', '¿Quién(es) vive(n) con el niño? Explique brevemente con quién pasa mayor tiempo su representado', 'textarea', true),
      standardField('contactInfo', 'Indique su información de contacto: 1) Teléfono celular 2) Correo electrónico', 'textarea', true),
      standardField('workInfo', 'Indique su información laboral: 1) Ocupación 2) Dirección de trabajo', 'textarea', true),

      standardField('payer_section', 'Responsable del pago', 'section'),
      standardField('payerNameId', 'Nombre, apellido y número de cédula de la persona responsable del pago', 'text', true),
      standardField('payerWork', 'Lugar de trabajo y dirección de la persona responsable del pago', 'textarea', true),
      standardField('payerPhone', 'Número de teléfono de la persona responsable del pago', 'phone', true),

      standardField('health_section', 'Salud y retiro', 'section'),
      standardField('healthHistory', 'Indique algún historial de salud importante: 1) antecedentes o condición médica especial 2) alergia alimentaria o a medicamentos 3) ¿toma algún medicamento?', 'textarea', true),
      standardField('authorizedPickup', 'Indique las personas autorizadas para retirar a su representado: nombre y apellido, número de cédula y parentesco', 'textarea', true),

      standardField('authorization_section', 'Autorización', 'section'),
      standardField('authorization', 'Autorizo al centro educativo a tomar fotografías, videos y audios a mi representado durante las actividades pedagógicas, para registrar avances significativos y para promoción y difusión de la labor educativa, preservando su integridad y privacidad y utilizando el material de manera responsable', 'radio', true, { options: ['Sí', 'No'] }),
    ]
  }
}

function ensureStandardEnrollment(companyId: number, source: EducationForm[]) {
  const standard = enrollmentTemplate(companyId)
  const existing = source.find(form => form.kind === 'enrollment')
  const normalized: EducationForm = existing
    ? {
        ...standard,
        key: existing.key || standard.key,
        publicId: existing.publicId,
        active: Boolean(existing.active),
        createdAt: existing.createdAt || standard.createdAt,
        updatedAt: now(),
      }
    : standard
  return [normalized, ...source.filter(form => form.kind !== 'enrollment')]
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
    updatedAt: now(),
  }
}

function encodeSharePayload(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function publicEnrollmentUrl(form: EducationForm, company: Company, ownerUid: string) {
  if (!form.publicId) return ''
  const base = `${window.location.origin}/inscripcion.html?id=${encodeURIComponent(form.publicId)}`
  if (form.kind !== 'enrollment') return base
  const embedded = encodeSharePayload({
    v: 1,
    standard: 1,
    active: true,
    ownerUid,
    companyId: form.companyId,
    company: { name: company.name, phone: company.phone || '', email: company.email || '', city: company.city || '' },
    formKey: form.key,
    title: form.title,
    description: form.description,
    kind: form.kind,
  })
  return `${base}#p=${embedded}`
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => { window.clearTimeout(timer); resolve(value) },
      error => { window.clearTimeout(timer); reject(error) },
    )
  })
}

function restValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } }
  switch (typeof value) {
    case 'string': return { stringValue: value }
    case 'boolean': return { booleanValue: value }
    case 'number': return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    case 'object': {
      const fields: Record<string, unknown> = {}
      Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
        if (entry !== undefined) fields[key] = restValue(entry)
      })
      return { mapValue: { fields } }
    }
    default: return { stringValue: String(value) }
  }
}

function restFields(value: Record<string, unknown>) {
  const fields: Record<string, unknown> = {}
  Object.entries(value).forEach(([key, entry]) => {
    if (entry !== undefined) fields[key] = restValue(entry)
  })
  return fields
}

async function publishFormViaRest(formId: string, payload: Record<string, unknown>) {
  const user = firebaseAuth?.currentUser
  if (!user) throw new Error('No hay una sesión activa para publicar la inscripción.')
  const token = await withTimeout(user.getIdToken(), 4000, 'No se pudo obtener la sesión de Firebase.')
  const endpoint = `https://firestore.googleapis.com/v1/projects/zivifactura/databases/(default)/documents/publicForms/${encodeURIComponent(formId)}`
  const response = await withTimeout(fetch(endpoint, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: restFields(payload) }),
  }), 8000, 'Firestore REST no respondió a tiempo.')
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Firestore REST ${response.status}: ${detail.slice(0, 220)}`)
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
  const publicUrl = activeForm?.publicId && company && firebaseAuth?.currentUser
    ? publicEnrollmentUrl(activeForm, company, firebaseAuth.currentUser.uid)
    : activeForm?.publicId
      ? `${window.location.origin}/inscripcion.html?id=${encodeURIComponent(activeForm.publicId)}`
      : ''
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

    const local = ensureStandardEnrollment(companyId, loadLocalForms(companyId))
    saveLocalForms(companyId, local)
    setForms(local)
    setActiveKey(local[0]?.key || '')
    const localEnabled = localStorage.getItem(localEnabledKey(companyId)) === '1'
    const isEducationProfile = current?.businessProfile === 'education' || current?.enabledModules?.includes('education_enrollment')
    const initialEnabled = localEnabled || Boolean(isEducationProfile)
    if (initialEnabled) localStorage.setItem(localEnabledKey(companyId), '1')
    setEnabled(initialEnabled)

    const user = firebaseAuth?.currentUser
    if (!firestore || !user) return

    void (async () => {
      try {
        const [moduleSnap, remote] = await Promise.all([
          withTimeout(getDoc(doc(firestore, 'users', user.uid, 'modules', `education-${companyId}`)), 4500, 'Módulo remoto lento'),
          withTimeout(getDocs(collection(firestore, 'users', user.uid, 'forms')), 4500, 'Planillas remotas lentas'),
        ])
        if (moduleSnap.exists() && Boolean(moduleSnap.data().enabled)) {
          localStorage.setItem(localEnabledKey(companyId), '1')
          setEnabled(true)
        }
        const remoteForms = remote.docs.map(item => item.data() as EducationForm).filter(form => Number(form.companyId) === companyId)
        const normalized = ensureStandardEnrollment(companyId, remoteForms.length ? remoteForms : local)
        setForms(normalized)
        saveLocalForms(companyId, normalized)
        setActiveKey(currentKey => normalized.some(form => form.key === currentKey) ? currentKey : normalized[0]?.key || '')
      } catch (error) {
        console.warn('[ZiviFactura] Education background load:', error)
      }
    })()
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
    const companyId = company.id || getActiveCompanyId()
    const nextForms = ensureStandardEnrollment(companyId, loadLocalForms(companyId))

    localStorage.setItem(localEnabledKey(companyId), '1')
    saveLocalForms(companyId, nextForms)
    setForms(nextForms)
    setActiveKey(nextForms[0]?.key || '')
    setEnabled(true)
    setTab('forms')
    setMessage('Planilla estándar lista. Solo pulsa Compartir inscripción para enviar el enlace.')

    const user = firebaseAuth?.currentUser
    if (firestore && user) {
      void setDoc(doc(firestore, 'users', user.uid, 'modules', `education-${companyId}`), {
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

  async function publishEnrollmentInBackground(published: EducationForm, currentCompany: Company, ownerUid: string) {
    if (!firestore || !published.publicId) return false
    const payload = publicPayload(published, currentCompany, ownerUid) as Record<string, unknown>
    try {
      await withTimeout(
        setDoc(doc(firestore, 'publicForms', published.publicId), payload, { merge: true }),
        3500,
        'Firestore SDK lento',
      )
    } catch (sdkError) {
      console.warn('[ZiviFactura] publicación de inscripción lenta por SDK; usando REST:', sdkError)
      try {
        await publishFormViaRest(published.publicId, payload)
      } catch (restError) {
        console.error('[ZiviFactura] publicación de inscripción falló por SDK y REST:', restError)
        const message = restError instanceof Error ? restError.message : String(restError || '')
        if (/403|permission|PERMISSION_DENIED/i.test(message)) setRulesNeeded(true)
        return false
      }
    }

    try {
      const verify = await withTimeout(getDoc(doc(firestore, 'publicForms', published.publicId)), 3500, 'No se pudo verificar la planilla pública.')
      return verify.exists() && verify.data().ownerUid === ownerUid && verify.data().active === true
    } catch (error) {
      console.warn('[ZiviFactura] no se pudo verificar la publicación:', error)
      return false
    }
  }

  async function ensurePublishedForm(form: EducationForm) {
    const user = firebaseAuth?.currentUser
    if (!firestore || !user || !company || !form.publicId) return false
    try {
      const snap = await withTimeout(getDoc(doc(firestore, 'publicForms', form.publicId)), 2500, 'Verificación lenta')
      if (snap.exists() && snap.data().ownerUid === user.uid && snap.data().active === true) return true
    } catch (error) {
      console.warn('[ZiviFactura] parent public form missing or inaccessible, repairing:', error)
    }
    return publishEnrollmentInBackground({ ...form, active: true }, company, user.uid)
  }

  function publishForm(form: EducationForm = activeForm as EducationForm) {
    if (!form || !company) return null
    const user = firebaseAuth?.currentUser
    if (!firestore || !user) {
      setMessage('Para compartir inscripciones desde otros teléfonos debes iniciar sesión con tu cuenta de ZiviFactura.')
      return null
    }

    const publicId = form.publicId || makeId()
    const published: EducationForm = { ...form, publicId, active: true, updatedAt: now() }
    const next = forms.map(item => item.key === published.key ? published : item)
    if (!next.some(item => item.key === published.key)) next.unshift(published)

    setForms(next)
    saveLocalForms(activeCompanyId, next)
    setActiveKey(published.key)
    setRulesNeeded(false)
    setMessage('Preparando enlace de inscripción…')
    syncFormsInBackground(next)
    return published
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
    setMessage('Sincronizando inscripciones…')
    setRulesNeeded(false)
    try {
      const published = forms.filter(form => form.publicId)
      const ready: EducationForm[] = []
      for (const form of published) {
        const ok = await ensurePublishedForm(form)
        if (ok) ready.push(form)
      }

      if (published.length && !ready.length) {
        setRulesNeeded(true)
        setMessage('No se pudo restablecer la conexión con Firestore. Revisa que las reglas publicadas incluyan publicForms y submissions.')
        return
      }

      const batches = await Promise.all(ready.map(async form => {
        const submissionsQuery = query(
          collection(firestore, 'publicForms', form.publicId!, 'submissions'),
          where('ownerUid', '==', user.uid),
        )
        const snap = await getDocs(submissionsQuery)
        return snap.docs.map(item => ({ id: item.id, ...(item.data() as Omit<EducationSubmission, 'id'>) }))
      }))
      const rows = batches.flat().sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))
      setSubmissions(rows)
      setMessage(rows.length ? `${rows.length} inscripción(es) recibida(s) listas para revisión.` : 'Conexión correcta. Todavía no hay inscripciones recibidas; si la prueba anterior no mostró confirmación, vuelve a enviarla.')
    } catch (error) {
      const code = (error as { code?: string })?.code || ''
      if (code.includes('permission-denied')) setRulesNeeded(true)
      setMessage(code.includes('permission-denied')
        ? 'Firestore rechazó la lectura de respuestas. La planilla puede abrir, pero la colección de respuestas aún no tiene permisos efectivos.'
        : 'No se pudieron cargar las respuestas.')
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
    if (!activeForm || !company) return
    const published = activeForm.active && activeForm.publicId ? activeForm : publishForm(activeForm)
    if (!published?.publicId) return
    const user = firebaseAuth?.currentUser
    if (!user) return

    setBusy(true)
    setMessage('Verificando que la planilla pueda recibir respuestas…')
    setRulesNeeded(false)
    try {
      const ready = await ensurePublishedForm(published)
      if (!ready) {
        setRulesNeeded(true)
        setMessage('No compartiré el enlace todavía porque Firestore no confirmó que pueda recibir respuestas. Revisa las reglas publicadas y pulsa nuevamente Compartir inscripción.')
        return
      }

      const url = publicEnrollmentUrl(published, company, user.uid)
      const text = `Hola. Te compartimos la planilla de inscripción de ${company.name || 'nuestro centro'}. Completa los datos desde este enlace:`
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Planilla de inscripción', text, url })
          setMessage('Planilla compartida y lista para recibir respuestas.')
          return
        } catch { /* user cancelled or native share unavailable */ }
      }
      await copyText(`${text}\n${url}`)
      setMessage('Enlace verificado y copiado. La planilla está lista para recibir respuestas.')
    } finally {
      setBusy(false)
    }
  }


  if (!open) return null

  const checklist = [
    { label: 'Planilla estándar lista', done: Boolean(activeForm?.kind === 'enrollment') },
    { label: 'Enlace compartible', done: Boolean(activeForm?.active && activeForm?.publicId) },
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
        {rulesNeeded && <div className="educationRules"><strong>Conexión de Inscripciones pendiente</strong><p>Firestore está rechazando el documento público o sus respuestas. Si ya publicaste las reglas de publicForms/submissions, pulsa Reintentar conexión para que ZiviFactura repare la planilla pública y vuelva a leer las respuestas.</p><div className="educationResponseActions"><button className="educationPrimary small" disabled={busy} onClick={() => void loadResponses()}>Reintentar conexión</button><button onClick={() => void copyText(RULES_SNIPPET)}><Copy size={15}/>Copiar bloque de reglas</button></div></div>}

        {tab === 'forms' && <div className="educationWorkspace">
          <aside className="educationFormList">
            <div className="educationListHead"><div><small>INSCRIPCIÓN</small><strong>Plantilla estándar</strong></div></div>
            {forms.map(form => <button key={form.key} className={activeForm?.key === form.key ? 'active' : ''} onClick={() => setActiveKey(form.key)}><span>{form.kind === 'enrollment' ? <GraduationCap size={17}/> : <ClipboardList size={17}/>}</span><div><strong>{form.title}</strong><small>{form.active ? 'Publicada' : 'Borrador'} · {questionCount(form)} preguntas</small></div></button>)}
            {!forms.length && <p>No hay planillas todavía.</p>}
          </aside>

          <main className="educationEditor">
            {activeForm ? <>
              <div className="educationEditorHead">
                <div><span className="educationEyebrow">{activeForm.kind === 'enrollment' ? 'PLANILLA ESTÁNDAR' : 'EDITOR GUIADO'}</span><h2>{activeForm.title}</h2><p>{questionCount(activeForm)} preguntas · {requiredCount(activeForm)} obligatorias · {fieldGroups.length} secciones</p></div>
                <div>{activeForm.kind === 'enrollment'
                  ? <><button className="educationPrimary small" disabled={!hasCloudSession} onClick={() => void shareForm()}><Send size={16}/>Compartir inscripción</button>{activeForm.active && <button className="educationWarn" disabled={busy} onClick={() => void unpublishForm()}>Pausar enlace</button>}</>
                  : <><button className="educationGhost" disabled={busy} onClick={() => void saveForm()}><Save size={16}/>Guardar</button>{activeForm.active ? <button className="educationWarn" disabled={busy} onClick={() => void unpublishForm()}>Pausar</button> : <button className="educationPrimary small" disabled={busy || !hasCloudSession} onClick={() => void publishForm()}><Send size={16}/>Publicar</button>}</>}
                </div>
              </div>

              {!hasCloudSession && <div className="educationNotice"><strong>Inicia sesión para compartir</strong><span>La planilla estándar ya está lista; solo necesitas una sesión activa para generar el enlace público.</span></div>}

              {activeForm.kind === 'enrollment' ? <>
                <section className="educationStandardShareCard">
                  <div className="educationStandardShareCopy">
                    <span>LISTA PARA PADRES Y REPRESENTANTES</span>
                    <h3>Comparte la inscripción sin editar ni construir formularios.</h3>
                    <p>La planilla ya contiene el estándar del centro. El representante abre el enlace, completa los datos y la respuesta llega directamente a ZiviFactura.</p>
                    <div className="educationStandardStatus"><CheckCircle2 size={16}/><strong>{publicUrl ? 'Enlace generado' : 'Se genera al compartir'}</strong><small>Publicación en segundo plano, sin bloquear la interfaz.</small></div>
                  </div>
                  <div className="educationStandardActions">
                    <button className="educationPrimary" disabled={!hasCloudSession} onClick={() => void shareForm()}><Send size={17}/>Compartir inscripción</button>
                    {publicUrl && <><button className="educationGhost" onClick={() => void copyText(publicUrl)}><Copy size={16}/>Copiar enlace</button><a className="educationOpenLink" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={16}/>Abrir formulario</a></>}
                  </div>
                </section>

                <details className="educationStandardDetails">
                  <summary><span><ClipboardList size={17}/>Ver campos incluidos en la planilla estándar</span><small>{questionCount(activeForm)} preguntas organizadas en {fieldGroups.length} secciones</small></summary>
                  <div className="educationStandardFieldList">
                    {fieldGroups.map((group, groupIndex) => <section key={group.section.id}><div><b>{groupIndex + 1}</b><strong>{group.section.label.replace(/^\d+\.\s*/, '')}</strong></div>{group.rows.map(({ field }) => <p key={field.id}><span>{field.required ? 'Obligatorio' : 'Opcional'}</span>{field.label}</p>)}</section>)}
                  </div>
                </details>
              </> : <>
                <div className="educationFormMeta">
                  <label><span>Título visible para representantes</span><input value={activeForm.title} onChange={event => updateActive({ title: event.target.value })}/></label>
                  <label><span>Mensaje inicial</span><textarea rows={3} value={activeForm.description} onChange={event => updateActive({ description: event.target.value })}/></label>
                </div>

                {publicUrl ? <div className="educationShare"><div><span>ENLACE DE INSCRIPCIÓN</span><strong>{publicUrl}</strong></div><button onClick={() => void copyText(publicUrl)} title="Copiar enlace"><Copy size={17}/></button><button onClick={() => void shareForm()} title="Compartir"><Send size={17}/></button><a href={publicUrl} target="_blank" rel="noreferrer" title="Abrir"><ExternalLink size={17}/></a></div> : <div className="educationFlowNote"><strong>Flujo de prueba</strong><span>Guarda la planilla → publícala → comparte el enlace → recibe respuestas → aprueba → crea cliente.</span></div>}

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
              </>}
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
