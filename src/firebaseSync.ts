import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { db, defaultCompany } from './db'
import { firestore } from './firebase'
import type { Client, Company, Invoice, Payment, Product } from './types'

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error'
type StatusCallback = (state: SyncState, message?: string) => void

let activeUid: string | null = null
let applyingRemote = false
let syncTimer: number | undefined
let statusCallback: StatusCallback | null = null

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const safeKey = (value: string) => encodeURIComponent(value.trim().toLowerCase()).slice(0, 900) || 'sin-id'
const companyIdOf = (row?: { companyId?: number } | null) => Number(row?.companyId) || 1
const normalizeInvoiceNumber = (value = '') => {
  const compact = value.trim().toLowerCase().replace(/\s+/g, '')
  const match = compact.match(/^([^0-9]*)([0-9]+)$/)
  if (!match) return compact.replace(/[^a-z0-9]/g, '')
  const prefix = match[1].replace(/[^a-z0-9]/g, '')
  const sequence = String(Number(match[2]))
  return `${prefix}:${sequence}`
}
const invoiceLogicalKey = (invoice: Invoice) => `${companyIdOf(invoice)}:${normalizeInvoiceNumber(invoice.number)}`
const invoiceKey = (invoice: Invoice) => safeKey(invoiceLogicalKey(invoice))
const clientKey = (client: Client) => safeKey(`${companyIdOf(client)}:${client.taxId || client.email || client.phone || client.name || String(client.id || 'cliente')}`)
const productKey = (product: Product) => safeKey(`${companyIdOf(product)}:${product.name || String(product.id || 'producto')}`)
const paymentKey = (payment: Payment) => safeKey(`${companyIdOf(payment)}:${payment.key}`)
const recordTime = (row?: { updatedAt?: string; createdAt?: string } | null) => Date.parse(row?.updatedAt || row?.createdAt || '') || 0

function companyForCloud(company: Company) {
  const copy = clean(company) as Company
  delete copy.logoDataUrl
  return copy
}

function isDefaultCompany(company?: Company) {
  if (!company) return true
  return !company.taxId && !company.phone && !company.email && !company.address && (!company.name || company.name === defaultCompany.name)
}

async function pushCompanies(uid: string) {
  if (!firestore) return
  const companies = await db.company.toArray()
  await Promise.all(companies.map(company => setDoc(doc(firestore, 'users', uid, 'companies', String(company.id)), companyForCloud(company), { merge: true })))
  const main = companies.find(company => company.id === 1)
  if (main) await setDoc(doc(firestore, 'users', uid, 'company', 'main'), companyForCloud(main), { merge: true })
}

async function pushInvoices(uid: string) {
  if (!firestore) return
  const invoices = await db.invoices.toArray()
  const canonical = new Map<string, Invoice>()
  for (const invoice of invoices) {
    if (!invoice.number?.trim()) continue
    const key = invoiceLogicalKey(invoice)
    const previous = canonical.get(key)
    if (!previous || recordTime(invoice) >= recordTime(previous)) canonical.set(key, invoice)
  }
  await Promise.all([...canonical.values()].map(invoice => setDoc(doc(firestore, 'users', uid, 'invoices', invoiceKey(invoice)), clean({ ...invoice, companyId: companyIdOf(invoice), id: undefined }), { merge: true })))
}
async function pushClients(uid: string) {
  if (!firestore) return
  const clients = await db.clients.toArray()
  await Promise.all(clients.map(client => setDoc(doc(firestore, 'users', uid, 'clients', clientKey(client)), clean({ ...client, companyId: companyIdOf(client), id: undefined }), { merge: true })))
}
async function pushProducts(uid: string) {
  if (!firestore) return
  const products = await db.products.toArray()
  await Promise.all(products.map(product => setDoc(doc(firestore, 'users', uid, 'products', productKey(product)), clean({ ...product, companyId: companyIdOf(product), id: undefined }), { merge: true })))
}
async function pushPayments(uid: string) {
  if (!firestore) return
  const payments = await db.payments.toArray()
  await Promise.all(payments.map(payment => setDoc(doc(firestore, 'users', uid, 'payments', paymentKey(payment)), clean({ ...payment, companyId: companyIdOf(payment), id: undefined }), { merge: true })))
}

async function pullCompanies(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'companies'))
  if (snapshots.empty) {
    const legacy = await getDoc(doc(firestore, 'users', uid, 'company', 'main'))
    if (!legacy.exists()) return
    const local = await db.company.get(1)
    if (isDefaultCompany(local)) await db.company.put({ ...defaultCompany, ...(legacy.data() as Company), id: 1, logoDataUrl: local?.logoDataUrl })
    return
  }
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Company
    const id = Number(remote.id || snapshot.id) || 1
    const local = await db.company.get(id)
    if (!local || isDefaultCompany(local)) await db.company.put({ ...defaultCompany, ...remote, id, logoDataUrl: local?.logoDataUrl })
  }
}

async function dedupeLocalInvoices() {
  const rows = await db.invoices.toArray()
  const groups = new Map<string, Invoice[]>()
  for (const invoice of rows) {
    if (!invoice.number?.trim()) continue
    const key = invoiceLogicalKey(invoice)
    const group = groups.get(key) || []
    group.push(invoice)
    groups.set(key, group)
  }

  let removed = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort((a, b) => recordTime(b) - recordTime(a) || Number(a.id || 0) - Number(b.id || 0))
    const winner = ordered[0]
    const duplicates = ordered.slice(1).filter(invoice => typeof invoice.id === 'number')
    if (!winner?.id || !duplicates.length) continue

    await db.invoices.put({ ...winner, id: winner.id, companyId: companyIdOf(winner) })
    await db.invoices.bulkDelete(duplicates.map(invoice => invoice.id!))
    removed += duplicates.length
  }
  return removed
}

async function pullInvoices(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'invoices'))
  const locals = await db.invoices.toArray()
  const byKey = new Map(locals.filter(invoice => invoice.number?.trim()).map(invoice => [invoiceLogicalKey(invoice), invoice]))

  const remoteGroups = new Map<string, typeof snapshots.docs>()
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Invoice
    if (!remote.number?.trim()) continue
    const normalized = { ...remote, companyId: companyIdOf(remote) }
    const key = invoiceLogicalKey(normalized)
    const group = remoteGroups.get(key) || []
    group.push(snapshot)
    remoteGroups.set(key, group)
  }

  for (const [key, group] of remoteGroups) {
    const winnerSnapshot = [...group].sort((a, b) => recordTime(b.data() as Invoice) - recordTime(a.data() as Invoice))[0]
    const remote = winnerSnapshot.data() as Invoice
    const normalized: Invoice = { ...remote, companyId: companyIdOf(remote), id: undefined }
    const local = byKey.get(key)

    if (!local) {
      const id = Number(await db.invoices.add(normalized))
      byKey.set(key, { ...normalized, id })
    } else if (recordTime(normalized) > recordTime(local) && local.id) {
      const updated = { ...normalized, id: local.id }
      await db.invoices.put(updated)
      byKey.set(key, updated)
    }

    const canonicalId = invoiceKey(normalized)
    await setDoc(doc(firestore, 'users', uid, 'invoices', canonicalId), clean({ ...normalized, id: undefined }), { merge: true })
    const staleDocs = group.filter(snapshot => snapshot.id !== canonicalId)
    if (staleDocs.length) {
      await Promise.all(staleDocs.map(snapshot => deleteDoc(doc(firestore, 'users', uid, 'invoices', snapshot.id))))
    }
  }
}

async function pullClients(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'clients'))
  const locals = await db.clients.toArray()
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Client
    const companyId = companyIdOf(remote)
    const match = locals.find(client => companyIdOf(client) === companyId && ((remote.taxId && client.taxId === remote.taxId) || (remote.email && client.email === remote.email) || client.name.toLowerCase() === remote.name?.toLowerCase()))
    if (!match) {
      const id = Number(await db.clients.add({ ...remote, companyId, id: undefined }))
      locals.push({ ...remote, companyId, id })
    }
  }
}

async function pullProducts(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'products'))
  const locals = await db.products.toArray()
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Product
    if (!remote.name) continue
    const companyId = companyIdOf(remote)
    const match = locals.find(product => companyIdOf(product) === companyId && product.name.toLowerCase() === remote.name.toLowerCase())
    if (!match) {
      const id = Number(await db.products.add({ ...remote, companyId, id: undefined }))
      locals.push({ ...remote, companyId, id })
    }
  }
}

async function pullPayments(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'payments'))
  const locals = await db.payments.toArray()
  const byKey = new Map(locals.map(payment => [payment.key, payment]))
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Payment
    if (!remote.key || !remote.invoiceNumber) continue
    const normalized = { ...remote, companyId: companyIdOf(remote) }
    const local = byKey.get(remote.key)
    if (!local) {
      const id = Number(await db.payments.add({ ...normalized, id: undefined }))
      byKey.set(remote.key, { ...normalized, id })
      continue
    }
    const remoteTime = recordTime(remote)
    const localTime = recordTime(local)
    if (remoteTime > localTime && local.id) {
      const updated = { ...normalized, id: local.id }
      await db.payments.put(updated)
      byKey.set(remote.key, updated)
    }
  }
}

export async function syncFirebaseNow(uid = activeUid || '') {
  if (!firestore || !uid || !navigator.onLine) return
  statusCallback?.('syncing', 'Sincronizando con Firebase…')
  applyingRemote = true
  let removedInvoices = 0
  try {
    await Promise.all([pullCompanies(uid), pullInvoices(uid), pullClients(uid), pullProducts(uid), pullPayments(uid)])
    removedInvoices = await dedupeLocalInvoices()
  } finally {
    applyingRemote = false
  }
  try {
    await Promise.all([pushCompanies(uid), pushInvoices(uid), pushClients(uid), pushProducts(uid), pushPayments(uid)])
    await setDoc(doc(firestore, 'users', uid, 'meta', 'sync'), { lastSyncAt: new Date().toISOString() }, { merge: true })
    statusCallback?.('synced', removedInvoices > 0 ? `Se corrigieron ${removedInvoices} documentos duplicados.` : 'Datos sincronizados')
    window.dispatchEvent(new CustomEvent('zivifactura:data-synced', { detail: { removedInvoices } }))
  } catch (error) {
    console.warn('[ZiviFactura] Firebase sync:', error)
    statusCallback?.('error', 'No se pudo sincronizar. Se mantiene la copia local.')
  }
}

function scheduleSync() {
  if (applyingRemote || !activeUid) return
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => { if (activeUid) void syncFirebaseNow(activeUid) }, 900)
}

async function removeInvoice(uid: string, invoice?: Invoice) {
  if (!firestore || !invoice?.number) return
  await deleteDoc(doc(firestore, 'users', uid, 'invoices', invoiceKey(invoice)))
}
async function removeClient(uid: string, client?: Client) {
  if (!firestore || !client) return
  await deleteDoc(doc(firestore, 'users', uid, 'clients', clientKey(client)))
}
async function removeProduct(uid: string, product?: Product) {
  if (!firestore || !product) return
  await deleteDoc(doc(firestore, 'users', uid, 'products', productKey(product)))
}
async function removePayment(uid: string, payment?: Payment) {
  if (!firestore || !payment?.key) return
  await deleteDoc(doc(firestore, 'users', uid, 'payments', paymentKey(payment)))
}

db.company.hook('creating', () => scheduleSync())
db.company.hook('updating', () => scheduleSync())
db.clients.hook('creating', () => scheduleSync())
db.clients.hook('updating', () => scheduleSync())
db.products.hook('creating', () => scheduleSync())
db.products.hook('updating', () => scheduleSync())
db.invoices.hook('creating', () => scheduleSync())
db.invoices.hook('updating', () => scheduleSync())
db.payments.hook('creating', () => scheduleSync())
db.payments.hook('updating', () => scheduleSync())

db.invoices.hook('deleting', (_key, invoice) => { if (!applyingRemote && activeUid) void removeInvoice(activeUid, invoice).finally(scheduleSync) })
db.clients.hook('deleting', (_key, client) => { if (!applyingRemote && activeUid) void removeClient(activeUid, client).finally(scheduleSync) })
db.products.hook('deleting', (_key, product) => { if (!applyingRemote && activeUid) void removeProduct(activeUid, product).finally(scheduleSync) })
db.payments.hook('deleting', (_key, payment) => { if (!applyingRemote && activeUid) void removePayment(activeUid, payment).finally(scheduleSync) })

export function startFirebaseSync(uid: string, callback?: StatusCallback) {
  activeUid = uid
  statusCallback = callback || null
  const online = () => void syncFirebaseNow(uid)
  const visibility = () => { if (document.visibilityState === 'visible') void syncFirebaseNow(uid) }
  window.addEventListener('online', online)
  document.addEventListener('visibilitychange', visibility)
  void syncFirebaseNow(uid)
  const interval = window.setInterval(() => void syncFirebaseNow(uid), 60_000)
  return () => {
    if (activeUid === uid) activeUid = null
    statusCallback = null
    window.clearInterval(interval)
    window.removeEventListener('online', online)
    document.removeEventListener('visibilitychange', visibility)
  }
}
