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
    name: company.name || '',
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
    companyId: Number(company.id) || 1,
    companySyncId: company.syncId || '',
    invoiceSyncId: invoice.syncId || '',
    invoiceNumber: invoice.number || '',
    invoiceType: invoice.type,
    status: invoice.status,
    date: invoice.date || '',
    dueDate: invoice.dueDate || '',
    currency: invoice.currency || 'USD',
    subtotal: Number(documentTotals.subtotal) || 0,
    discount: Number(documentTotals.discount) || 0,
    tax: Number(documentTotals.tax) || 0,
    taxRate: Number(invoice.taxRate) || 0,
    total: Number(documentTotals.total) || 0,
    client: {
      name: invoice.client.name || 'Cliente',
      taxId: invoice.client.taxId || '',
      phone: invoice.client.phone || '',
      email: invoice.client.email || '',
      address: invoice.client.address || '',
    },
    items: invoice.items.map(item => ({
      id: item.id || '',
      description: item.description || '',
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

function safePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function restValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } }

  switch (typeof value) {
    case 'string': return { stringValue: value }
    case 'boolean': return { booleanValue: value }
    case 'number':
      return Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value }
    case 'object': {
      const fields: Record<string, unknown> = {}
      Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
        if (entry !== undefined) fields[key] = restValue(entry)
      })
      return { mapValue: { fields } }
    }
    default:
      return { stringValue: String(value) }
  }
}

function restFields(value: Record<string, unknown>) {
  const fields: Record<string, unknown> = {}
  Object.entries(value).forEach(([key, entry]) => {
    if (entry !== undefined) fields[key] = restValue(entry)
  })
  return fields
}

async function publishViaRest(
  id: string,
  payload: Record<string, unknown>,
  user: NonNullable<typeof firebaseAuth>['currentUser'],
) {
  if (!user) throw new Error('No hay una sesión activa para publicar el documento.')
  const token = await withTimeout(user.getIdToken(), 4000, 'No se pudo obtener la sesión de Firebase.')
  const endpoint = `https://firestore.googleapis.com/v1/projects/zivifactura/databases/(default)/documents/publicDocuments/${encodeURIComponent(id)}`
  const response = await withTimeout(fetch(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: restFields({ ...payload, updatedAt: new Date().toISOString() }),
    }),
  }), 8000, 'Firestore REST no respondió a tiempo.')

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Firestore REST ${response.status}: ${detail.slice(0, 240)}`)
  }
}

async function markPublished(invoice: Invoice, shareIdValue: string) {
  if (!invoice.id) return
  const publishedAt = new Date().toISOString()
  await db.invoices.update(invoice.id, {
    publicShareId: shareIdValue,
    publicShareReadyAt: publishedAt,
  })
}

async function publishCloudInBackground(
  invoice: Invoice,
  shared: PreparedPublicShare,
  user: NonNullable<typeof firebaseAuth>['currentUser'],
) {
  if (!firestore || !user || shared.id.startsWith('local-')) return

  const payload = safePayload(shared.payload) as Record<string, unknown>
  const publicRef = doc(firestore, 'publicDocuments', shared.id)

  try {
    await withTimeout(
      setDoc(publicRef, { ...payload, updatedAt: serverTimestamp() }, { merge: true }),
      3500,
      'Firestore SDK lento',
    )
    await markPublished(invoice, shared.id)
    return
  } catch (sdkError) {
    console.warn('[ZiviFactura] Firestore SDK lento/fallido; usando REST:', sdkError)
  }

  try {
    await publishViaRest(shared.id, payload, user)
    await markPublished(invoice, shared.id)
  } catch (restError) {
    console.error('[ZiviFactura] publicación pública falló por SDK y REST:', restError)
  }
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
    void db.invoices.update(invoice.id, { publicShareId: id })
      .catch(error => console.warn('[ZiviFactura] no se pudo guardar el id público localmente:', error))
  }

  return { id, url, total: payload.total, payload }
}

export function publishPublicDocument(
  invoice: Invoice,
  company: Company,
  prepared?: PreparedPublicShare,
): PreparedPublicShare {
  const shared = prepared || preparePublicDocumentShare(invoice, company)
  const user = firebaseAuth?.currentUser || null

  if (firestore && user && !shared.id.startsWith('local-')) {
    void publishCloudInBackground(invoice, shared, user)
  }

  return shared
}

export function shareDocumentMessage(
  invoice: Invoice,
  url: string,
  total = totals(invoice).total,
  includeUrl = true,
) {
  const intro = `Hola ${invoice.client.name || ''}. Te comparto ${invoice.type.toLowerCase()} ${invoice.number} por ${money(total, invoice.currency)}.\n\nPulsa el enlace para revisar el documento, copiar los datos de pago y cargar el voucher o capture cuando realices el pago.`
  const footer = 'Dentro de la página también podrás descargar tu documento en PDF para conservarlo como soporte.'
  return includeUrl ? `${intro}\n\n${url}\n\n${footer}` : `${intro}\n\n${footer}`
}
