import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { repairExactInvoiceDuplicates } from './dataIntegrity'
import { db, defaultCompany, invoiceLogicalKeyFor, makeSyncId } from './db'
import { firestore } from './firebase'
import type { Client, Company, Invoice, Payment, Product } from './types'

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error'
type StatusCallback = (state: SyncState, message?: string) => void

type SyncableRecord = {
  id?: number
  syncId?: string
  companyId?: number
  createdAt?: string
  updatedAt?: string
}

let activeUid: string | null = null
let applyingRemote = false
let syncTimer: number | undefined
let statusCallback: StatusCallback | null = null

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const safeKey = (value: string) => encodeURIComponent(value.trim()).slice(0, 900) || makeSyncId('doc')
const companyIdOf = (row?: { companyId?: number } | null) => Number(row?.companyId) || 1
const recordTime = (row?: { updatedAt?: string; createdAt?: string } | null) => Date.parse(row?.updatedAt || row?.createdAt || '') || 0
const newest = <T extends { updatedAt?: string; createdAt?: string }>(a: T, b: T) => recordTime(a) >= recordTime(b) ? a : b
const remoteId = (prefix: string, record: { syncId?: string }) => safeKey(record.syncId || makeSyncId(prefix))

function withSyncId<T extends SyncableRecord>(record: T, prefix: string): T {
  return { ...record, syncId: record.syncId || makeSyncId(prefix), companyId: companyIdOf(record) }
}

function companyForCloud(company: Company) {
  const copy = clean({ ...company, syncId: company.syncId || `company_${company.id || 1}` }) as Company
  delete copy.logoDataUrl
  return copy
}

function isDefaultCompany(company?: Company) {
  if (!company) return true
  return !company.taxId && !company.phone && !company.email && !company.address && (!company.name || company.name === defaultCompany.name)
}

async function ensureLocalSyncIds() {
  await db.transaction('rw', db.company, db.clients, db.products, db.invoices, db.payments, async () => {
    await db.company.toCollection().modify(company => { if (!company.syncId) company.syncId = `company_${company.id || 1}` })
    await db.clients.toCollection().modify(client => {
      if (!client.companyId) client.companyId = 1
      if (!client.syncId) client.syncId = makeSyncId('cli')
      if (!client.updatedAt) client.updatedAt = client.createdAt || new Date().toISOString()
    })
    await db.products.toCollection().modify(product => {
      if (!product.companyId) product.companyId = 1
      if (!product.syncId) product.syncId = makeSyncId('prd')
      if (!product.updatedAt) product.updatedAt = product.createdAt || new Date().toISOString()
    })
    await db.invoices.toCollection().modify(invoice => {
      const companyId = companyIdOf(invoice)
      invoice.companyId = companyId
      invoice.logicalKey = invoiceLogicalKeyFor({ companyId, number: invoice.number || '' })
      if (!invoice.syncId) invoice.syncId = makeSyncId('inv')
    })
    await db.payments.toCollection().modify(payment => {
      if (!payment.companyId) payment.companyId = 1
      if (!payment.syncId) payment.syncId = makeSyncId('pay')
      if (!payment.key) payment.key = `${payment.companyId}:${payment.invoiceNumber || 'sin-factura'}:${payment.date || payment.createdAt || Date.now()}`
    })
  })
}

async function pushCompanies(uid: string) {
  if (!firestore) return
  const companies = await db.company.toArray()
  await Promise.all(companies.map(company => {
    const normalized = { ...company, syncId: company.syncId || `company_${company.id || 1}` }
    return setDoc(doc(firestore, 'users', uid, 'companies', String(normalized.id || 1)), companyForCloud(normalized), { merge: true })
  }))
  const main = companies.find(company => company.id === 1)
  if (main) await setDoc(doc(firestore, 'users', uid, 'company', 'main'), companyForCloud(main), { merge: true })
}

async function pushInvoices(uid: string) {
  if (!firestore) return
  const invoices = await db.invoices.toArray()
  await Promise.all(invoices.map(async invoice => {
    const normalized = withSyncId({ ...invoice, logicalKey: invoiceLogicalKeyFor({ companyId: companyIdOf(invoice), number: invoice.number || '' }) }, 'inv') as Invoice
    if (!invoice.syncId && invoice.id) await db.invoices.update(invoice.id, { syncId: normalized.syncId, companyId: normalized.companyId, logicalKey: normalized.logicalKey })
    return setDoc(doc(firestore, 'users', uid, 'invoices', remoteId('inv', normalized)), clean({ ...normalized, id: undefined }), { merge: true })
  }))
}

async function pushClients(uid: string) {
  if (!firestore) return
  const clients = await db.clients.toArray()
  await Promise.all(clients.map(async client => {
    const normalized = withSyncId(client, 'cli') as Client
    if (!client.syncId && client.id) await db.clients.update(client.id, { syncId: normalized.syncId, companyId: normalized.companyId })
    return setDoc(doc(firestore, 'users', uid, 'clients', remoteId('cli', normalized)), clean({ ...normalized, id: undefined }), { merge: true })
  }))
}

async function pushProducts(uid: string) {
  if (!firestore) return
  const products = await db.products.toArray()
  await Promise.all(products.map(async product => {
    const normalized = withSyncId(product, 'prd') as Product
    if (!product.syncId && product.id) await db.products.update(product.id, { syncId: normalized.syncId, companyId: normalized.companyId })
    return setDoc(doc(firestore, 'users', uid, 'products', remoteId('prd', normalized)), clean({ ...normalized, id: undefined }), { merge: true })
  }))
}

async function pushPayments(uid: string) {
  if (!firestore) return
  const payments = await db.payments.toArray()
  await Promise.all(payments.map(async payment => {
    const normalized = withSyncId({
      ...payment,
      key: payment.key || `${companyIdOf(payment)}:${payment.invoiceNumber || 'sin-factura'}:${payment.date || payment.createdAt || Date.now()}`,
    }, 'pay') as Payment
    if ((!payment.syncId || !payment.key) && payment.id) await db.payments.update(payment.id, { syncId: normalized.syncId, companyId: normalized.companyId, key: normalized.key })
    return setDoc(doc(firestore, 'users', uid, 'payments', remoteId('pay', normalized)), clean({ ...normalized, id: undefined }), { merge: true })
  }))
}

async function pullCompanies(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'companies'))
  if (snapshots.empty) {
    const legacy = await getDoc(doc(firestore, 'users', uid, 'company', 'main'))
    if (!legacy.exists()) return
    const local = await db.company.get(1)
    if (isDefaultCompany(local)) await db.company.put({ ...defaultCompany, ...(legacy.data() as Company), id: 1, syncId: 'company_1', logoDataUrl: local?.logoDataUrl })
    return
  }

  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Company
    const id = Number(remote.id || snapshot.id) || 1
    const local = await db.company.get(id)
    const incoming = { ...defaultCompany, ...remote, id, syncId: remote.syncId || `company_${id}`, logoDataUrl: local?.logoDataUrl }
    if (!local || isDefaultCompany(local)) await db.company.put(incoming)
    else if (recordTime(incoming) > recordTime(local)) await db.company.put({ ...local, ...incoming, logoDataUrl: local.logoDataUrl })
  }
}

async function upsertBySyncId<T extends SyncableRecord>(
  table: typeof db.clients | typeof db.products | typeof db.invoices | typeof db.payments,
  remote: T,
  snapshotId: string,
  prefix: string,
) {
  const normalized = withSyncId({ ...remote, syncId: remote.syncId || snapshotId }, prefix)
  const local = await table.where('syncId').equals(normalized.syncId!).first() as T | undefined

  if (!local) {
    await table.add({ ...normalized, id: undefined } as never)
    return
  }

  if (local.id && newest(normalized, local) === normalized) {
    await table.put({ ...local, ...normalized, id: local.id } as never)
  }
}

async function pullInvoices(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'invoices'))
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Invoice
    if (!remote.number?.trim()) continue
    const companyId = companyIdOf(remote)
    await upsertBySyncId(db.invoices, {
      ...remote,
      companyId,
      logicalKey: remote.logicalKey || invoiceLogicalKeyFor({ companyId, number: remote.number || '' }),
    }, snapshot.id, 'inv')
  }
}

async function pullClients(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'clients'))
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Client
    if (!remote.name?.trim()) continue
    await upsertBySyncId(db.clients, remote, snapshot.id, 'cli')
  }
}

async function pullProducts(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'products'))
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Product
    if (!remote.name?.trim()) continue
    await upsertBySyncId(db.products, remote, snapshot.id, 'prd')
  }
}

async function pullPayments(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'payments'))
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Payment
    if (!remote.invoiceNumber?.trim()) continue
    await upsertBySyncId(db.payments, {
      ...remote,
      key: remote.key || `${companyIdOf(remote)}:${remote.invoiceNumber}:${remote.date || remote.createdAt || snapshot.id}`,
    }, snapshot.id, 'pay')
  }
}

export async function syncFirebaseNow(uid = activeUid || '') {
  if (!firestore || !uid || !navigator.onLine) return
  statusCallback?.('syncing', 'Sincronizando con Firebase…')
  applyingRemote = true
  try {
    await ensureLocalSyncIds()
    await Promise.all([pullCompanies(uid), pullInvoices(uid), pullClients(uid), pullProducts(uid), pullPayments(uid)])
    const repair = await repairExactInvoiceDuplicates()
    if (repair.hidden > 0) console.info(`[ZiviFactura] ${repair.hidden} duplicado(s) técnico(s) ocultado(s) durante sync.`)
  } finally {
    applyingRemote = false
  }

  try {
    await Promise.all([pushCompanies(uid), pushInvoices(uid), pushClients(uid), pushProducts(uid), pushPayments(uid)])
    await setDoc(doc(firestore, 'users', uid, 'meta', 'sync'), {
      lastSyncAt: new Date().toISOString(),
      strategy: 'non-destructive-sync-id-v2-safe-duplicate-archive',
    }, { merge: true })
    statusCallback?.('synced', 'Datos sincronizados sin eliminación automática')
    window.dispatchEvent(new CustomEvent('zivifactura:data-synced', { detail: { removedInvoices: 0 } }))
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

// Data-safety policy: deletes are not propagated to Firestore here.
// Exact duplicate invoice records are archived by moving their companyId to a
// negative internal scope. They remain inside IndexedDB and backups.

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
