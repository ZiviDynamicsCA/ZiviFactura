import type { Invoice, RateSnapshot, RateSource } from './types'

const RATE_CACHE_KEY = 'zivifactura.rates.current.v1'
const RATE_SLOT_KEY = 'zivifactura.rates.refresh-slots.v1'

export interface LiveRates extends RateSnapshot {
  attribution?: string
}

export function bcvAverageRate(rates?: RateSnapshot | null) {
  const usd = Number(rates?.usdBcv) || 0
  const eur = Number(rates?.eurBcv) || 0
  if (!usd || !eur) return 0
  return (usd + eur) / 2
}

export const rateSourceLabels: Record<RateSource, string> = {
  none: 'Sin tasa de conversión',
  bcv_usd: 'BCV dólar',
  bcv_eur: 'BCV euro',
  bcv_average: 'Promedio BCV USD/EUR',
  binance: 'USDT Binance',
  usdt_average: 'Promedio USDT',
  custom: 'Tasa personalizada',
}

export function getRateValue(source: RateSource, rates?: RateSnapshot | null, custom?: number) {
  if (source === 'custom') return Number(custom) || 0
  if (!rates) return 0
  if (source === 'bcv_usd') return Number(rates.usdBcv) || 0
  if (source === 'bcv_eur') return Number(rates.eurBcv) || 0
  if (source === 'bcv_average') return bcvAverageRate(rates)
  if (source === 'binance') return Number(rates.binanceBuy) || 0
  if (source === 'usdt_average') return Number(rates.usdtAverage) || 0
  return 0
}

export function getCachedRates(): LiveRates | null {
  try {
    const raw = localStorage.getItem(RATE_CACHE_KEY)
    return raw ? JSON.parse(raw) as LiveRates : null
  } catch {
    return null
  }
}

function saveRates(rates: LiveRates) {
  localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(rates))
}

function localDay(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function slotName(date = new Date()) {
  const hour = date.getHours()
  if (hour >= 19) return '19'
  if (hour >= 17) return '17'
  return 'pre'
}

function slotKey(date = new Date()) {
  return `${localDay(date)}:${slotName(date)}`
}

function slotWasFetched(key: string) {
  try {
    const slots = JSON.parse(localStorage.getItem(RATE_SLOT_KEY) || '[]') as string[]
    return slots.includes(key)
  } catch {
    return false
  }
}

function markSlotFetched(key: string) {
  let slots: string[] = []
  try { slots = JSON.parse(localStorage.getItem(RATE_SLOT_KEY) || '[]') as string[] } catch { /* ignore */ }
  const next = [...new Set([...slots.filter(item => item.slice(0, 10) >= key.slice(0, 10)), key])].slice(-8)
  localStorage.setItem(RATE_SLOT_KEY, JSON.stringify(next))
}

function cacheIsFromToday(cached?: LiveRates | null) {
  if (!cached?.capturedAt) return false
  const captured = new Date(cached.capturedAt)
  return !Number.isNaN(captured.getTime()) && localDay(captured) === localDay()
}

export async function fetchLiveRates(force = false): Promise<LiveRates> {
  const currentSlot = slotKey()
  const cached = getCachedRates()
  const preAfternoon = slotName() === 'pre'
  if (!force && cached && ((preAfternoon && cacheIsFromToday(cached)) || (!preAfternoon && slotWasFetched(currentSlot)))) return cached

  const response = await fetch('/api/rates', { headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => ({})) as {
    success?: boolean
    error?: string
    data?: LiveRates
    meta?: { attribution?: string }
  }
  if (!response.ok || !payload.success || !payload.data) {
    if (cached) return cached
    throw new Error(payload.error || 'No se pudieron actualizar las tasas.')
  }
  const rates: LiveRates = { ...payload.data, attribution: payload.meta?.attribution }
  saveRates(rates)
  if (!preAfternoon) markSlotFetched(currentSlot)
  return rates
}

export async function refreshRatesIfDue() {
  try {
    return await fetchLiveRates(false)
  } catch {
    return getCachedRates()
  }
}

export function formatRate(value?: number, digits = 2) {
  if (!Number.isFinite(value) || !value) return 'No disponible'
  return `${Number(value).toLocaleString('es-VE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} Bs`
}

export function pivotConversions(ves: number, rates?: RateSnapshot | null) {
  const safe = Math.max(0, Number(ves) || 0)
  const bcvAverage = bcvAverageRate(rates)
  return {
    VES: safe,
    USD: rates?.usdBcv ? safe / rates.usdBcv : undefined,
    EUR: rates?.eurBcv ? safe / rates.eurBcv : undefined,
    BCV_AVERAGE: bcvAverage ? safe / bcvAverage : undefined,
    USDT_BINANCE: rates?.binanceBuy ? safe / rates.binanceBuy : undefined,
    USDT_AVERAGE: rates?.usdtAverage ? safe / rates.usdtAverage : undefined,
  }
}

export function amountToVes(amount: number, source: RateSource | 'ves', rates?: RateSnapshot | null, customRate = 0) {
  const safe = Math.max(0, Number(amount) || 0)
  if (source === 'ves') return safe
  return safe * getRateValue(source, rates, customRate)
}

export function invoicePaymentVes(invoice: Invoice, total: number) {
  const rate = Number(invoice.rateValue) || 0
  if (!rate) return invoice.currency === 'VES' ? total : undefined
  if (invoice.currency === 'VES') return total
  return total * rate
}

export function invoiceEquivalentValues(invoice: Invoice, total: number) {
  const ves = invoicePaymentVes(invoice, total)
  if (!Number.isFinite(ves)) return null
  return { ves: Number(ves), ...pivotConversions(Number(ves), invoice.rateSnapshot) }
}
