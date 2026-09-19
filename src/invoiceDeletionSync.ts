import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from './db'
import { invoiceStableIdentity } from './dataIntegrity'
import { firebaseAuth, firestore } from './firebase'
import type { Invoice } from './types'

export type InvoiceDeletionTombstone = {
  identityKey: string
  deletedAt: string
  companyId: number
  invoiceNumber: string
  syncIds: string[]
  publicShareIds: string[]
}

const PENDING_PREFIX = 'zivifactura.invoice-deletions.v1:'

function safeKey(value: string) {
  return encodeURIComponent(value.trim()).slice(0, 900) || \`deleted-\${Date.now()}\`
}

function pendingKey(uid: string) {
  return \`\${PENDING_PREFIX}\${uid}\`
}

function readPending(uid: string): InvoiceDeletionTombstone[] {
  try {
    const raw = localStorage.getItem(pendingKey(uid))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writePending(uid: string, rows: InvoiceDeletionTombstone[]) {
  try {
    if (rows.length) localStorage.setItem(pendingKey(uid), JSON.stringify(rows))
    else localStorage.removeItem(pendingKey(uid))
  } catch {
    // Local deletion already happened. Cloud reconciliation can retry next session.
  }
}

function mergePending(uid: string, tombstone: InvoiceDeletionTombstone) {
  const rows = readPending(uid)
  const current = rows.find(row => row.identityKey === tombstone.identityKey)
  if (current) {
    current.deletedAt = tombstone.deletedAt
    current.companyId = tombstone.companyId
    current.invoiceNumber = tombstone.invoiceNumber
    current.syncIds = [...new Set([...current.syncIds, ...tombstone.syncIds])]
    current.publicShareIds = [...new Set([...current.publicShareIds, ...tombstone.publicShareIds])]
  } else {
    rows.push(tombstone)
  }
  writePending(uid, rows)
}

async function remoteVariants(uid: string, identityKey: string) {
  if (!firestore) return []
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'invoices'))
  return snapshots.docs.filter(snapshot => {
    try {
      const invoice = { ...snapshot.data(), syncId: snapshot.data().syncId || snapshot.id } as Invoice
      return invoiceStableIdentity(invoice) === identityKey
    } catch {
      return false
    }
  })
}

export async function flushPendingInvoiceDeletions(uid = firebaseAuth?.currentUser?.uid || '') {
  if (!firestore || !uid || !navigator.onLine) return
  const rows = readPending(uid)
  if (!rows.length) return

  const remaining: InvoiceDeletionTombstone[] = []

  for (const tombstone of rows) {
    try {
      const tombstoneRef = doc(firestore, 'users', uid, 'invoiceDeletions', safeKey(tombstone.identityKey))
      await setDoc(tombstoneRef, tombstone, { merge: true })

      const matches = await remoteVariants(uid, tombstone.identityKey)
      const remoteShareIds = matches
        .map(snapshot => String(snapshot.data().publicShareId || ''))
        .filter(Boolean)

      await Promise.all([
        ...matches.map(snapshot => deleteDoc(snapshot.ref)),
        ...tombstone.syncIds.map(syncId => deleteDoc(doc(firestore, 'users', uid, 'invoices', safeKey(syncId))).catch(() => undefined)),
        ...[...new Set([...tombstone.publicShareIds, ...remoteShareIds])]
          .filter(id => id && !id.startsWith('local-'))
          .map(id => deleteDoc(doc(firestore, 'publicDocuments', id)).catch(() => undefined)),
      ])
    } catch (error) {
      console.warn('[ZiviFactura] eliminación remota pendiente:', error)
      remaining.push(tombstone)
    }
  }

  writePending(uid, remaining)
}

export async function pullInvoiceDeletionTombstones(uid: string) {
  const identities = new Set<string>()
  if (!firestore || !uid) return identities

  const snapshots = await getDocs(collection(firestore, 'users', uid, 'invoiceDeletions'))
  snapshots.docs.forEach(snapshot => {
    const identityKey = String(snapshot.data().identityKey || '')
    if (identityKey) identities.add(identityKey)
  })

  if (!identities.size) return identities

  const local = await db.invoices.toArray()
  const idsToDelete = local
    .filter(invoice => identities.has(invoiceStableIdentity(invoice)))
    .map(invoice => invoice.id)
    .filter((id): id is number => typeof id === 'number')

  if (idsToDelete.length) await db.invoices.bulkDelete(idsToDelete)
  return identities
}

export async function deleteInvoiceEverywhere(invoice: Invoice) {
  const identityKey = invoiceStableIdentity(invoice)
  const local = await db.invoices.toArray()
  const variants = local.filter(row => invoiceStableIdentity(row) === identityKey)
  const ids = variants.map(row => row.id).filter((id): id is number => typeof id === 'number')

  const tombstone: InvoiceDeletionTombstone = {
    identityKey,
    deletedAt: new Date().toISOString(),
    companyId: Number(invoice.companyId) || 1,
    invoiceNumber: invoice.number || '',
    syncIds: [...new Set(variants.map(row => row.syncId || '').filter(Boolean))],
    publicShareIds: [...new Set(variants.map(row => row.publicShareId || '').filter(Boolean))],
  }

  if (ids.length) await db.invoices.bulkDelete(ids)

  const uid = firebaseAuth?.currentUser?.uid || ''
  if (uid && firestore) {
    mergePending(uid, tombstone)
    if (navigator.onLine) await flushPendingInvoiceDeletions(uid)
  }

  return Math.max(1, variants.length)
}
