import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { firebaseAuth, firestore } from './firebase'

export type DeliveryNoteStatus = 'draft' | 'delivered' | 'cancelled'

export type DeliveryNoteItem = {
  id: string
  description: string
  quantity: number
  unit: string
}

export type DeliveryNote = {
  syncId: string
  companyId: number
  number: string
  status: DeliveryNoteStatus
  date: string
  clientName: string
  clientTaxId?: string
  clientPhone?: string
  address?: string
  reference?: string
  relatedInvoiceNumber?: string
  items: DeliveryNoteItem[]
  notes?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

const now = () => new Date().toISOString()
const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID().replace(/-/g, '')
  : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

function ownerScope() {
  return firebaseAuth?.currentUser?.uid || 'local'
}

function storageKey(companyId: number, scope = ownerScope()) {
  return `zivifactura.deliveryNotes.${scope}.${companyId}`
}

function timestamp(note: DeliveryNote) {
  return Date.parse(note.updatedAt || note.createdAt || '') || 0
}

function uniqueNewest(rows: DeliveryNote[]) {
  const map = new Map<string, DeliveryNote>()
  rows.forEach(row => {
    const current = map.get(row.syncId)
    if (!current || timestamp(row) >= timestamp(current)) map.set(row.syncId, row)
  })
  return [...map.values()].sort((a, b) => timestamp(b) - timestamp(a))
}

function parseStored(key: string) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as DeliveryNote[] } catch { return [] }
}

export function readLocalDeliveryNotes(companyId: number) {
  const scope = ownerScope()
  const scoped = parseStored(storageKey(companyId, scope))
  const localFallback = scope === 'local' ? [] : parseStored(storageKey(companyId, 'local'))
  return uniqueNewest([...scoped, ...localFallback])
}

function writeLocalDeliveryNotes(companyId: number, rows: DeliveryNote[]) {
  localStorage.setItem(storageKey(companyId), JSON.stringify(uniqueNewest(rows)))
}

export function nextDeliveryNoteNumber(rows: DeliveryNote[]) {
  const year = new Date().getFullYear()
  const prefix = `NE-${year}-`
  const max = rows.reduce((highest, row) => {
    if (!row.number.startsWith(prefix)) return highest
    const value = Number(row.number.slice(prefix.length)) || 0
    return Math.max(highest, value)
  }, 0)
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

export function createBlankDeliveryNote(companyId: number, existing: DeliveryNote[] = []): DeliveryNote {
  const createdAt = now()
  return {
    syncId: `dn_${makeId()}`,
    companyId,
    number: nextDeliveryNoteNumber(existing),
    status: 'draft',
    date: createdAt.slice(0, 10),
    clientName: '',
    items: [{ id: makeId(), description: '', quantity: 1, unit: 'und' }],
    createdAt,
    updatedAt: createdAt,
  }
}

export async function loadDeliveryNotes(companyId: number) {
  const local = readLocalDeliveryNotes(companyId)
  const user = firebaseAuth?.currentUser
  if (!firestore || !user || !navigator.onLine) return local

  try {
    const snapshot = await getDocs(collection(firestore, 'users', user.uid, 'deliveryNotes'))
    const remote = snapshot.docs
      .map(item => item.data() as DeliveryNote)
      .filter(item => Number(item.companyId) === companyId && Boolean(item.syncId))
    const merged = uniqueNewest([...local, ...remote])
    writeLocalDeliveryNotes(companyId, merged)

    // Reenvía la vista reconciliada para que las notas creadas o archivadas
    // sin conexión terminen llegando a Firestore al recuperar internet.
    void Promise.all(merged.map(note => setDoc(doc(firestore, 'users', user.uid, 'deliveryNotes', note.syncId), note, { merge: true })))
      .catch(error => console.warn('[ZiviFactura] delivery notes reconcile:', error))

    return merged
  } catch (error) {
    console.warn('[ZiviFactura] delivery notes pull:', error)
    return local
  }
}

export async function saveDeliveryNote(note: DeliveryNote) {
  const updated: DeliveryNote = { ...note, updatedAt: now() }
  const rows = readLocalDeliveryNotes(note.companyId)
  writeLocalDeliveryNotes(note.companyId, [...rows.filter(row => row.syncId !== note.syncId), updated])

  const user = firebaseAuth?.currentUser
  if (firestore && user) {
    void setDoc(doc(firestore, 'users', user.uid, 'deliveryNotes', updated.syncId), updated, { merge: true })
      .catch(error => console.warn('[ZiviFactura] delivery note sync:', error))
  }
  return updated
}

export async function archiveDeliveryNote(note: DeliveryNote) {
  return saveDeliveryNote({ ...note, deletedAt: now(), status: 'cancelled' })
}

export function visibleDeliveryNotes(rows: DeliveryNote[]) {
  return rows.filter(row => !row.deletedAt)
}
