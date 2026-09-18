import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './db'
import { firebaseAuth, firestore } from './firebase'
import { money, totals } from './pdf'
import type { Company, Invoice, PaymentDisplay } from './types'

function shareId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '')
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

function encodePayload(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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

function availablePaymentMethods(company: Company): PaymentDisplay[] {
  const methods: PaymentDisplay[] = []
  if (company.mobilePaymentBank || company.mobilePaymentPhone || company.mobilePaymentId) methods.push('mobile')
  if (company.bankName || company.bankAccountType || company.bankAccountNumber || company.bankAccountHolder) methods.push('bank')
  if (company.binanceId) methods.push('binance')
  if (company.paymentNotes) methods.push('notes')
  return methods
}

function publicCompany(company: Company) {
  return {
    id: company.id,
    syncId: company.syncId || '',
    name: company.name,
    taxId: company.taxId || '',
    phone: company.phone || '',
    email: company.email || '',
    address: company.address || '',
    city: company.city || '',
    mobilePaymentBank: company.mobilePaymentBank || '',
    mobilePaymentPhone: company.mobilePaymentPhone || '',
    mobilePaymentId: company.mobilePaymentId || '',
    bankName: company.bankName || '',
    bankAccountType: company.bankAccountType || '',
    bankAccountNumber: company.bankAccountNumber || '',
    bankAccountHolder: company.bankAccountHolder || '',
    binanceId: company.binanceId || '',
    paymentNotes: company.paymentNotes || '',
  }
}

function buildPublicPayload(invoice: Invoice, company: Company, ownerUid = 'local') {
  const documentTotals = totals(invoice)
  const visiblePayments = invoice.paymentMethodsVisible !== undefined
    ? invoice.paymentMethodsVisible
    : availablePaymentMethods(company)

  return {
    version: 2,
    active: true,
    localOnly: ownerUid === 'local',
    ownerUid,
    companyId: company.id,
    companySyncId: company.syncId || '',
    invoiceSyncId: invoice.syncId || '',
    invoiceNumber: invoice.number,
    invoiceType: invoice.type,
    status: invoice.status,
    date: invoice.date,
    dueDate: invoice.dueDate || '',
    currency: invoice.currency,
    subtotal: documentTotals.subtotal,
    discount: documentTotals.discount,
    tax: documentTotals.tax,
    taxRate: Number(invoice.taxRate) || 0,
    total: documentTotals.total,
    client: {
      name: invoice.client.name || 'Cliente',
      taxId: invoice.client.taxId || '',
      phone: invoice.client.phone || '',
      email: invoice.client.email || '',
      address: invoice.client.address || '',
    },
    items: invoice.items.map(item => ({
      id: item.id || '',
      description: item.description,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
    })),
    notes: invoice.notes || '',
    rateSource: invoice.rateSource || 'none',
    rateLabel: invoice.rateLabel || '',
    rateValue: Number(invoice.rateValue) || 0,
    rateCapturedAt: invoice.rateCapturedAt || '',
    rateSnapshot: invoice.rateSnapshot || null,
    conversionTargets: invoice.conversionTargets || [],
    paymentMethodsVisible: visiblePayments,
    company: publicCompany(company),
  }
}

export type PreparedPublicShare = {
  id: string
  url: string
  total: number
  payload: ReturnType<typeof buildPublicPayload>
}

export function preparePublicDocumentShare(invoice: Invoice, company: Company): PreparedPublicShare {
  if (!invoice.id) throw new Error('Guarda el documento antes de compartirlo por enlace.')

  const user = firebaseAuth?.currentUser || null
  const existing = invoice.publicShareId || ''
  const cloudId = existing && !existing.startsWith('local-') ? existing : shareId()
  const id = user ? cloudId : (existing.startsWith('local-') ? existing : `local-${cloudId}`)
  const payload = buildPublicPayload(invoice, company, user?.uid || 'local')
  const url = user && firestore
    ? `${window.location.origin}/documento.html?id=${encodeURIComponent(id)}`
    : `${window.location.origin}/copiar.html#${encodePayload({
        ...payload,
        publicShareId: id,
        shareId: id,
      })}`

  if (invoice.id && invoice.publicShareId !== id) {
    void db.invoices.update(invoice.id, { publicShareId: id, updatedAt: new Date().toISOString() })
      .catch(error => console.warn('[ZiviFactura] no se pudo guardar el id público localmente:', error))
  }

  return { id, url, total: payload.total, payload }
}

export async function publishPublicDocument(
  invoice: Invoice,
  company: Company,
  prepared?: PreparedPublicShare,
) {
  const shared = prepared || preparePublicDocumentShare(invoice, company)
  const user = firebaseAuth?.currentUser || null

  if (!firestore || !user || shared.id.startsWith('local-')) return shared

  const publicRef = doc(firestore, 'publicDocuments', shared.id)
  try {
    // JSON round-trip strips every undefined value before it reaches Firestore.
    // Firestore rejects an entire write if even one optional field is undefined.
    const safePayload = JSON.parse(JSON.stringify(shared.payload))
    await withTimeout(
      setDoc(publicRef, { ...safePayload, updatedAt: serverTimestamp() }, { merge: true }),
      15000,
      'Firebase tardó demasiado publicando el documento.',
    )

    const publishedAt = new Date().toISOString()
    if (invoice.id) {
      await db.invoices.update(invoice.id, {
        publicShareId: shared.id,
        publicShareReadyAt: publishedAt,
        updatedAt: invoice.updatedAt || publishedAt,
      })
    }
    return { ...shared, publishedAt }
  } catch (error) {
    const code = (error as { code?: string })?.code || ''
    const detail = error instanceof Error ? error.message : String(error || '')
    console.warn('[ZiviFactura] publicación remota fallida:', code, detail, error)
    if (code === 'permission-denied') {
      throw new Error('Firebase rechazó la publicación del documento. Deben revisarse las reglas de Firestore.')
    }
    if (code === 'unavailable' || code === 'network-request-failed') {
      throw new Error('No hubo conexión con Firebase para publicar el documento.')
    }
    throw new Error(detail || 'No se pudo publicar el documento en Firebase.')
  }
}

export function shareDocumentMessage(invoice: Invoice, url: string, total = totals(invoice).total) {
  return `Hola ${invoice.client.name || ''}. Te comparto ${invoice.type.toLowerCase()} ${invoice.number} por ${money(total, invoice.currency)}.\n\nPulsa este enlace para revisar el documento, copiar los datos de pago y cargar el voucher o capture cuando realices el pago:\n${url}\n\nDentro de la página también podrás descargar tu documento en PDF para conservarlo como soporte.`
}
