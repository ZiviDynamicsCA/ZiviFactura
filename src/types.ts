export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled'
export type InvoiceType = 'Factura' | 'Proforma' | 'Presupuesto'
export type RateSource = 'none' | 'bcv_usd' | 'bcv_eur' | 'binance' | 'usdt_average' | 'custom'
export type ConversionTarget = 'VES' | 'USD' | 'EUR' | 'USDT_BINANCE' | 'USDT_AVERAGE'
export type PaymentDisplay = 'mobile' | 'bank' | 'binance' | 'notes'
export type PaymentMethodKey = 'mobile' | 'transfer' | 'binance' | 'cash' | 'zelle' | 'card' | 'other'

export interface RateSnapshot {
  usdBcv?: number
  eurBcv?: number
  binanceBuy?: number
  binanceSell?: number
  bybitBuy?: number
  bybitSell?: number
  usdtAverage?: number
  brechaPct?: number
  capturedAt: string
  sourceCapturedAt?: string
}

export interface Company {
  id: number
  name: string
  taxId: string
  phone: string
  email: string
  address: string
  city: string
  currency: string
  defaultTaxRate: number
  nextInvoiceNumber: number
  prefix: string
  logoDataUrl?: string
  mobilePaymentBank?: string
  mobilePaymentPhone?: string
  mobilePaymentId?: string
  bankName?: string
  bankAccountType?: string
  bankAccountNumber?: string
  bankAccountHolder?: string
  binanceId?: string
  paymentNotes?: string
}

export interface Client {
  id?: number
  companyId?: number
  name: string
  taxId: string
  phone: string
  email: string
  address: string
  createdAt: string
}

export interface Product {
  id?: number
  companyId?: number
  name: string
  price: number
  description?: string
  createdAt: string
}

export interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
}

export interface Invoice {
  id?: number
  companyId?: number
  logicalKey?: string
  publicShareId?: string
  number: string
  type: InvoiceType
  status: InvoiceStatus
  date: string
  dueDate: string
  city: string
  clientId?: number
  client: Omit<Client, 'id' | 'createdAt' | 'companyId'>
  items: InvoiceItem[]
  discount: number
  taxRate: number
  paymentMethod: string
  notes: string
  currency: string
  rateSource?: RateSource
  rateLabel?: string
  rateValue?: number
  rateCapturedAt?: string
  rateSnapshot?: RateSnapshot
  showRateConversions?: boolean
  conversionTargets?: ConversionTarget[]
  paymentMethodsVisible?: PaymentDisplay[]
  createdAt: string
  updatedAt: string
}

export interface Payment {
  id?: number
  companyId?: number
  key: string
  invoiceNumber: string
  invoiceCurrency: string
  amountApplied: number
  method: PaymentMethodKey
  date: string
  reference?: string
  notes?: string
  rateValue: number
  amountVes: number
  rateCapturedAt?: string
  rateSnapshot?: RateSnapshot
  proofSubmissionId?: string
  createdAt: string
  updatedAt: string
}

export interface BackupData {
  version: 1 | 2 | 3
  exportedAt: string
  company: Company[]
  clients: Client[]
  products: Product[]
  invoices: Invoice[]
  payments?: Payment[]
}
