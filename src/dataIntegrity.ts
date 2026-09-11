import { db } from './db'
import { totals } from './pdf'
import type { Invoice, Payment } from './types'

export type DuplicateRepairResult = {
  scanned: number
  groups: number
  hidden: number
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

function invoiceRecordTime(invoice: Invoice) {
  return Date.parse(invoice.updatedAt || invoice.createdAt || '') || 0
}

function paymentRecordTime(payment: Payment) {
  return Date.parse(payment.updatedAt || payment.createdAt || '') || 0
}

function invoiceCanonicalScore(invoice: Invoice) {
  let score = 0
  if ((Number(invoice.companyId) || 1) > 0) score += 1_000_000
  if (invoice.publicShareId && !invoice.publicShareId.startsWith('local-')) score += 25_000
  if (invoice.syncId) score += 10_000
  return score + invoiceRecordTime(invoice)
}

function paymentCanonicalScore(payment: Payment) {
  let score = 0
  if ((Number(payment.companyId) || 1) > 0) score += 1_000_000
  if (payment.proofSubmissionId) score += 30_000
  if (payment.syncId) score += 10_000
  if (payment.key) score += 5_000
  return score + paymentRecordTime(payment)
}

export function isVisiblePayment(payment: Payment) {
  return (Number(payment.companyId) || 1) > 0 && !payment.technicalDuplicateOf
}

export async function repairExactInvoiceDuplicates(): Promise<InvoiceDuplicateRepairResult> {
  const invoices = await db.invoices.toArray()
  const active = invoices.filter(invoice => {
    const companyId = Number(invoice.companyId) || 1
    return companyId > 0 && !invoice.technicalDuplicateOf && Boolean(invoice.number?.trim())
  })

  const groups = new Map<string, Invoice[]>()
  for (const invoice of active) {
    const signature = invoiceTechnicalSignature(invoice)
    const rows = groups.get(signature) || []
    rows.push(invoice)
    groups.set(signature, rows)
  }

  let hidden = 0
  let duplicateGroups = 0
  const now = new Date().toISOString()

  await db.transaction('rw', db.invoices, async () => {
    for (const [signature, rows] of groups.entries()) {
      if (rows.length < 2) continue
      duplicateGroups += 1
      const [keeper, ...duplicates] = [...rows].sort((a, b) => invoiceCanonicalScore(b) - invoiceCanonicalScore(a))
      const duplicateOf = keeper.syncId || `local-invoice-${keeper.id || keeper.number}`

      for (const duplicate of duplicates) {
        if (!duplicate.id) continue
        const originalCompanyId = Number(duplicate.companyId) || 1
        await db.invoices.update(duplicate.id, {
          originalCompanyId,
          companyId: -Math.abs(originalCompanyId),
          technicalDuplicateOf: duplicateOf,
          technicalDuplicateHiddenAt: now,
          technicalDuplicateSignature: signature,
          updatedAt: now,
        } as Partial<Invoice>)
        hidden += 1
      }
    }
  })

  if (hidden > 0) {
    window.dispatchEvent(new CustomEvent('zivifactura:integrity-repaired', { detail: { hiddenInvoiceDuplicates: hidden } }))
  }

  return { scanned: invoices.length, groups: duplicateGroups, hidden }
}

export async function repairExactPaymentDuplicates(): Promise<PaymentDuplicateRepairResult> {
  const payments = await db.payments.toArray()
  const active = payments.filter(payment => {
    const companyId = Number(payment.companyId) || 1
    return companyId > 0 && !payment.technicalDuplicateOf && Boolean(payment.invoiceNumber?.trim())
  })

  const groups = new Map<string, Payment[]>()
  for (const payment of active) {
    const signature = paymentTechnicalSignature(payment)
    const rows = groups.get(signature) || []
    rows.push(payment)
    groups.set(signature, rows)
  }

  let hidden = 0
  let duplicateGroups = 0
  const now = new Date().toISOString()

  await db.transaction('rw', db.payments, async () => {
    for (const [signature, rows] of groups.entries()) {
      if (rows.length < 2) continue
      duplicateGroups += 1
      const [keeper, ...duplicates] = [...rows].sort((a, b) => paymentCanonicalScore(b) - paymentCanonicalScore(a))
      const duplicateOf = keeper.syncId || keeper.key || `local-payment-${keeper.id || keeper.invoiceNumber}`

      for (const duplicate of duplicates) {
        if (!duplicate.id) continue
        const originalCompanyId = Number(duplicate.companyId) || 1
        await db.payments.update(duplicate.id, {
          originalCompanyId,
          companyId: -Math.abs(originalCompanyId),
          technicalDuplicateOf: duplicateOf,
          technicalDuplicateHiddenAt: now,
          technicalDuplicateSignature: signature,
          updatedAt: now,
        } as Partial<Payment>)
        hidden += 1
      }
    }
  })

  if (hidden > 0) {
    window.dispatchEvent(new CustomEvent('zivifactura:integrity-repaired', { detail: { hiddenPaymentDuplicates: hidden } }))
  }

  return { scanned: payments.length, groups: duplicateGroups, hidden }
}
