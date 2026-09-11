import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './db'
import { firebaseAuth, firestore } from './firebase'
import { money, totals } from './pdf'
import type { Company, Invoice, PaymentDisplay } from './types'

function shareId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '')
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

function encodeCopyPayload(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function localDocumentUrl(payload: unknown) {
  return `${window.location.origin}/copiar.html#${encodeCopyPayload(payload)}`
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
    taxId: company.taxId,
    phone: company.phone,
    email: company.email,
    address: company.address,
    city: company.city,
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
    taxRate: invoice.taxRate,
    total: documentTotals.total,
    client: {
      name: invoice.client.name || 'Cliente',
      taxId: invoice.client.taxId || '',
      phone: invoice.client.phone || '',
      email: invoice.client.email || '',
      address: invoice.client.address || '',
    },
    items: invoice.items.map(item => ({
      id: item.id,
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

export async function publishPublicDocument(invoice: Invoice, company: Company) {
  if (!invoice.id) throw new Error('Guarda el documento antes de compartirlo por enlace.')

  const user = firebaseAuth?.currentUser || null
  const id = invoice.publicShareId || shareId()
  const payload = buildPublicPayload(invoice, company, user?.uid || 'local')

  if (firestore && user) {
    await setDoc(doc(firestore, 'publicDocuments', id), { ...payload, updatedAt: serverTimestamp() }, { merge: true })
    if (!invoice.publicShareId) {
      await db.invoices.update(invoice.id, { publicShareId: id, updatedAt: new Date().toISOString() })
    }
    return {
      id,
      url: `${window.location.origin}/documento.html?id=${encodeURIComponent(id)}`,
      total: payload.total,
    }
  }

  // Fallback seguro para modo local: permite compartir una página autocontenida
  // sin requerir sesión Firebase. No habilita carga de voucher en la nube.
  return {
    id: `local-${id}`,
    url: localDocumentUrl({ ...payload, publicShareId: id }),
    total: payload.total,
  }
}

export function shareDocumentMessage(invoice: Invoice, url: string, total = totals(invoice).total) {
  return `Hola ${invoice.client.name || ''}. Te comparto ${invoice.type.toLowerCase()} ${invoice.number} por ${money(total, invoice.currency)}.\n\nPulsa este enlace para revisar el documento, copiar los datos de pago y cargar el voucher o capture cuando realices el pago:\n${url}\n\nDentro de la página también podrás descargar tu documento en PDF para conservarlo como soporte.`
}
