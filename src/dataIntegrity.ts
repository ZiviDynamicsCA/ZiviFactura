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
  return Math.abs(Number(row.originalCompanyId || row.companyId) || 1)
}

function recordTime(row: { updatedAt?: string; createdAt?: string }) {
  return Date.parse(row.updatedAt || row.createdAt || '') || 0
}

function invoiceStatusScore(status: Invoice['status']) {
  if (status === 'paid') return 400
  if (status === 'issued') return 300
  if (status === 'draft') return 200
  if (status === 'cancelled') return 100
  return 0
}

function invoiceCanonicalScore(invoice: Invoice) {
  let score = recordTime(invoice)
  score += invoiceStatusScore(invoice.status)
  if (invoice.publicShareId && !invoice.publicShareId.startsWith('local-')) score += 10_000
  if (invoice.syncId) score += 5_000
  if (!invoice.technicalDuplicateOf && (Number(invoice.companyId) || 1) > 0) score += 2_500
  return score
}

function paymentCanonicalScore(payment: Payment) {
  let score = recordTime(payment)
  if (payment.proofSubmissionId) score += 10_000
  if (payment.syncId) score += 5_000
  if (payment.key) score += 2_500
  if (!payment.technicalDuplicateOf && (Number(payment.companyId) || 1) > 0) score += 1_000
  return score
}

export function invoiceTechnicalSignature(invoice: Invoice) {
  const total = totals(invoice).total
  return JSON.stringify({
    companyId: visibleCompanyId(invoice),
    number: normalizeCode(invoice.number),
    type: invoice.type || 'Factura',
    date: invoice.date || '',
    dueDate: invoice.dueDate || '',
    currency: normalizeCode(invoice.currency || 'USD').toUpperCase(),
    client: {
      name: normalizeText(invoice.client?.name),
      taxId: normalizeCode(invoice.client?.taxId),
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

function uniqueBySignature<T>(rows: T[], signatureFor: (row: T) => string, scoreFor: (row: T) => number) {
  const selected = new Map<string, T>()
  for (const row of rows) {
    const signature = signatureFor(row)
    const current = selected.get(signature)
    if (!current || scoreFor(row) >= scoreFor(current)) selected.set(signature, row)
  }
  const winners = new Set(selected.values())
  return rows.filter(row => winners.has(row))
}

function groupedCount<T>(rows: T[], signature: (row: T) => string) {
  const groups = new Map<string, number>()
  for (const row of rows) {
    const key = signature(row)
    groups.set(key, (groups.get(key) || 0) + 1)
  }
  return Array.from(groups.values()).filter(count => count > 1).length
}

export function isOperationalInvoice(invoice: Invoice) {
  return (Number(invoice.companyId) || 1) > 0 && Boolean(invoice.number?.trim())
}

export function isVisiblePayment(payment: Payment) {
  return (Number(payment.companyId) || 1) > 0 && Boolean(payment.invoiceNumber?.trim())
}

export function uniqueOperationalInvoices(invoices: Invoice[]) {
  return uniqueBySignature(invoices.filter(isOperationalInvoice), invoiceTechnicalSignature, invoiceCanonicalScore)
}

export function uniqueOperationalPayments(payments: Payment[]) {
  return uniqueBySignature(payments.filter(isVisiblePayment), paymentTechnicalSignature, paymentCanonicalScore)
}

// La restauración automática queda neutralizada. No debe mover registros,
// cambiar companyId ni limpiar marcas técnicas sin una acción explícita del usuario.
export async function restoreArchivedTechnicalRecords(): Promise<RestoreArchivedResult> {
  return { invoices: 0, payments: 0 }
}

// Política de seguridad:
// Estas funciones NO ocultan, NO mueven y NO borran registros. Solo informan
// cuántos grupos duplicados existen para una futura pantalla manual de integridad.
export async function repairExactInvoiceDuplicates(invoices: Invoice[] = []): Promise<InvoiceDuplicateRepairResult> {
  const active = invoices.filter(isOperationalInvoice)
  return { scanned: invoices.length, groups: groupedCount(active, invoiceTechnicalSignature), hidden: 0 }
}

export async function repairExactPaymentDuplicates(payments: Payment[] = []): Promise<PaymentDuplicateRepairResult> {
  const active = payments.filter(isVisiblePayment)
  return { scanned: payments.length, groups: groupedCount(active, paymentTechnicalSignature), hidden: 0 }
}
