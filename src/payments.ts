import { db } from './db'
import { isVisiblePayment } from './dataIntegrity'
import { totals } from './pdf'
import { getRateValue } from './rates'
import type { Invoice, Payment, PaymentMethodKey, RateSnapshot } from './types'

export const paymentMethodLabels: Record<PaymentMethodKey, string> = {
  mobile: 'Pago móvil',
  transfer: 'Transferencia',
  binance: 'Binance / USDT',
  cash: 'Efectivo',
  zelle: 'Zelle',
  card: 'Tarjeta / POS',
  other: 'Otro',
}

export const paymentMethodOptions = (Object.keys(paymentMethodLabels) as PaymentMethodKey[]).map(key => ({ key, label: paymentMethodLabels[key] }))

export function paymentKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function currentRateForCurrency(currency: string, rates?: RateSnapshot | null) {
  const code = currency.toUpperCase()
  if (code === 'VES') return 1
  if (!rates) return 0
  if (code === 'USD') return Number(rates.usdBcv) || 0
  if (code === 'EUR') return Number(rates.eurBcv) || 0
  if (code === 'USDT') return Number(rates.binanceBuy || rates.usdtAverage) || 0
  return 0
}

export function suggestedPaymentRate(invoice: Invoice, rates?: RateSnapshot | null) {
  if (invoice.currency.toUpperCase() === 'VES') return 1
  return Number(invoice.rateValue) || currentRateForCurrency(invoice.currency, rates)
}

// Cuentas por cobrar se valorizan con la referencia ACTUAL, sin alterar la factura histórica.
// Si el documento definió una referencia (BCV, Binance, promedio), se respeta esa referencia
// pero con su cotización vigente. Las tasas personalizadas permanecen fijas.
export function currentReceivableRate(invoice: Invoice, rates?: RateSnapshot | null) {
  if (invoice.currency.toUpperCase() === 'VES') return 1
  const source = invoice.rateSource
  if (source === 'custom') return Number(invoice.rateValue) || 0
  if (source && source !== 'none') {
    const live = getRateValue(source, rates)
    if (live) return live
  }
  return currentRateForCurrency(invoice.currency, rates)
}

export function paymentAmountVes(amountApplied: number, invoiceCurrency: string, rateValue: number) {
  const amount = Math.max(0, Number(amountApplied) || 0)
  return invoiceCurrency.toUpperCase() === 'VES' ? amount : amount * Math.max(0, Number(rateValue) || 0)
}

export function visiblePayments(payments: Payment[]) {
  return payments.filter(isVisiblePayment)
}

export function appliedForInvoice(invoiceNumber: string, payments: Payment[]) {
  return visiblePayments(payments).filter(payment => payment.invoiceNumber === invoiceNumber).reduce((sum, payment) => sum + (Number(payment.amountApplied) || 0), 0)
}

export function balanceForInvoice(invoice: Invoice, payments: Payment[]) {
  return Math.max(0, totals(invoice).total - appliedForInvoice(invoice.number, payments))
}

export function receivableBalanceVes(invoice: Invoice, payments: Payment[], rates?: RateSnapshot | null) {
  const balance = balanceForInvoice(invoice, payments)
  const rate = currentReceivableRate(invoice, rates)
  if (!balance || !rate) return 0
  return balance * rate
}

export async function reconcileInvoiceStatus(invoice: Invoice) {
  if (!invoice.id || invoice.status === 'cancelled' || invoice.status === 'draft') return
  const companyId = Number(invoice.companyId) || 1
  const payments = (await db.payments.where('invoiceNumber').equals(invoice.number).toArray())
    .filter(payment => (Number(payment.companyId) || 1) === companyId && isVisiblePayment(payment))
  const applied = appliedForInvoice(invoice.number, payments)
  const total = totals(invoice).total
  const nextStatus = applied + 0.005 >= total ? 'paid' : 'issued'
  if (invoice.status !== nextStatus) await db.invoices.update(invoice.id, { status: nextStatus, updatedAt: new Date().toISOString() })
}

export function legacyPaymentMethod(invoice: Invoice): PaymentMethodKey {
  const raw = (invoice.paymentMethod || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (raw.includes('pago movil') || raw.includes('pagomovil')) return 'mobile'
  if (raw.includes('transfer')) return 'transfer'
  if (raw.includes('binance') || raw.includes('usdt') || raw.includes('crypto')) return 'binance'
  if (raw.includes('efectivo') || raw.includes('cash')) return 'cash'
  if (raw.includes('zelle')) return 'zelle'
  if (raw.includes('tarjeta') || raw.includes('pos') || raw.includes('debito') || raw.includes('credito')) return 'card'
  return 'other'
}
