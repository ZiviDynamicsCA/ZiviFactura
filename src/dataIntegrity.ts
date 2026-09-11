import { db } from './db'
import { totals } from './pdf'
import type { Invoice, Payment } from './types'

export type DuplicateRepairResult = {
  scanned: number
  groups: number
  hidden: number
}

export type RestoreArchivedResult = {
  invoices: number
  payments: number
}

export type InvoiceDuplicateRepairResult = DuplicateRepairResult
export type PaymentDuplicateRepairResult = DuplicateRepairResult

function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeCode(value = '') {
  return normalizeText(value).replace(/\s+/g, '').replace(/[^a-z0-9@._:-]/g, '')
}

function moneyKey(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(4)) : 0
}

function visibleCompanyId(row: { companyId?: number; originalCompanyId?: number }) {
  return Number(row.originalCompanyId || row.companyId) || 1
}

export function invoiceTechnicalSignature(invoice: Invoice) {
  const total = totals(invoice).total
  return JSON.stringify({
    companyId: visibleCompanyId(invoice),
    number: normalizeText(invoice.number),
    type: invoice.type,
    status: invoice.status,
    date: invoice.date || '',
    dueDate: invoice.dueDate || '',
    currency: invoice.currency || 'USD',
    client: {
      name: normalizeText(invoice.client?.name),
      taxId: normalizeText(invoice.client?.taxId),
      phone: normalizeText(invoice.client?.phone).replace(/\D/g, ''),
      email: normalizeText(invoice.client?.email),
      address: normalizeText(invoice.client?.address),
    },
    items: (invoice.items || []).map(item => ({
      description: normalizeText(item.description),
      quantity: moneyKey(item.quantity),
      unitPrice: moneyKey(item.unitPrice),
    })),
    discount: moneyKey(invoice.discount),
    taxRate: moneyKey(invoice.taxRate),
    total: moneyKey(total),
    paymentMethod: normalizeText(invoice.paymentMethod),
    notes: normalizeText(invoice.notes),
    rateSource: invoice.rateSource || 'none',
    rateValue: moneyKey(invoice.rateValue),
  })
}

export function paymentTechnicalSignature(payment: Payment) {
  return JSON.stringify({
    companyId: visibleCompanyId(payment),
    invoiceNumber: normalizeCode(payment.invoiceNumber),
    invoiceCurrency: normalizeCode(payment.invoiceCurrency || 'USD').toUpperCase(),
    amountApplied: moneyKey(payment.amountApplied),
    amountVes: moneyKey(payment.amountVes),
    method: payment.method || 'other',
    date: payment.date || '',
    reference: normalizeCode(payment.reference || ''),
    proofSubmissionId: normalizeCode(payment.proofSubmissionId || ''),
    rateValue: moneyKey(payment.rateValue),
    notes: normalizeText(payment.notes || ''),
  })
}

function groupedCount<T>(rows: T[], signature: (row: T) => string) {
  const groups = new Map<string, number>()
  for (const row of rows) groups.set(signature(row), (groups.get(signature(row)) || 0) + 1)
  return Array.from(groups.values()).filter(count => count > 1).length
}

export function isVisiblePayment(payment: Payment) {
  return (Number(payment.companyId) || 1) > 0 && !payment.technicalDuplicateOf
}

export async function restoreArchivedTechnicalRecords(): Promise<RestoreArchivedResult> {
  const [invoices, payments] = await Promise.all([db.invoices.toArray(), db.payments.toArray()])
  const archivedInvoices = invoices.filter(invoice => Number(invoice.companyId) < 0 || Boolean(invoice.technicalDuplicateOf))
  const archivedPayments = payments.filter(payment => Number(payment.companyId) < 0 || Boolean(payment.technicalDuplicateOf))
  let restoredInvoices = 0
  let restoredPayments = 0
  const now = new Date().toISOString()

  await db.transaction('rw', db.invoices, db.payments, async () => {
    for (const invoice of archivedInvoices) {
      if (!invoice.id) continue
      const restoredCompanyId = Math.abs(Number(invoice.originalCompanyId || invoice.companyId || 1)) || 1
      await db.invoices.update(invoice.id, {
        companyId: restoredCompanyId,
        originalCompanyId: undefined,
        technicalDuplicateOf: undefined,
        technicalDuplicateHiddenAt: undefined,
        technicalDuplicateSignature: undefined,
        updatedAt: now,
      } as Partial<Invoice>)
      restoredInvoices += 1
    }

    for (const payment of archivedPayments) {
      if (!payment.id) continue
      const restoredCompanyId = Math.abs(Number(payment.originalCompanyId || payment.companyId || 1)) || 1
      await db.payments.update(payment.id, {
        companyId: restoredCompanyId,
        originalCompanyId: undefined,
        technicalDuplicateOf: undefined,
        technicalDuplicateHiddenAt: undefined,
        technicalDuplicateSignature: undefined,
        updatedAt: now,
      } as Partial<Payment>)
      restoredPayments += 1
    }
  })

  if (restoredInvoices || restoredPayments) {
    window.dispatchEvent(new CustomEvent('zivifactura:integrity-restored', {
      detail: { restoredInvoices, restoredPayments },
    }))
  }

  return { invoices: restoredInvoices, payments: restoredPayments }
}

// Política de seguridad:
// Estas funciones ya NO ocultan ni mueven registros automáticamente.
// Solo analizan cuántos grupos duplicados existirían. Cualquier consolidación
// deberá hacerse luego desde una pantalla manual con confirmación del usuario.
export async function repairExactInvoiceDuplicates(): Promise<InvoiceDuplicateRepairResult> {
  const invoices = await db.invoices.toArray()
  const active = invoices.filter(invoice => {
    const companyId = Number(invoice.companyId) || 1
    return companyId > 0 && Boolean(invoice.number?.trim())
  })
  return { scanned: invoices.length, groups: groupedCount(active, invoiceTechnicalSignature), hidden: 0 }
}

export async function repairExactPaymentDuplicates(): Promise<PaymentDuplicateRepairResult> {
  const payments = await db.payments.toArray()
  const active = payments.filter(payment => {
    const companyId = Number(payment.companyId) || 1
    return companyId > 0 && Boolean(payment.invoiceNumber?.trim())
  })
  return { scanned: payments.length, groups: groupedCount(active, paymentTechnicalSignature), hidden: 0 }
}
