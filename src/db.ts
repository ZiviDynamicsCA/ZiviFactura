import Dexie, { type EntityTable } from 'dexie'
import type { BackupData, Client, Company, Invoice, Payment, Product } from './types'

export function normalizeInvoiceNumber(value = '') {
  const compact = value.trim().toLowerCase().replace(/\s+/g, '')
  const match = compact.match(/^([^0-9]*)([0-9]+)$/)
  if (!match) return compact.replace(/[^a-z0-9]/g, '')
  const prefix = match[1].replace(/[^a-z0-9]/g, '')
  const sequence = String(Number(match[2]))
  return `${prefix}:${sequence}`
}

export function invoiceLogicalKeyFor(row: Pick<Invoice, 'number'> & Partial<Pick<Invoice, 'companyId'>>) {
  const companyId = Number(row.companyId) || 1
  const normalized = normalizeInvoiceNumber(row.number)
  return `${companyId}:${normalized || 'sin-numero'}`
}

const invoiceRecordTime = (row?: Partial<Invoice> | null) => Date.parse(row?.updatedAt || row?.createdAt || '') || 0

function canonicalizeInvoices(rows: Invoice[]) {
  const canonical = new Map<string, Invoice>()
  for (const row of rows) {
    const companyId = Number(row.companyId) || 1
    const logicalKey = invoiceLogicalKeyFor({ companyId, number: row.number || '' })
    const normalized: Invoice = { ...row, companyId, logicalKey }
    const previous = canonical.get(logicalKey)
    if (!previous || invoiceRecordTime(normalized) >= invoiceRecordTime(previous)) canonical.set(logicalKey, normalized)
  }
  return [...canonical.values()]
}

class InvoiceDB extends Dexie {
  company!: EntityTable<Company, 'id'>
  clients!: EntityTable<Client, 'id'>
  products!: EntityTable<Product, 'id'>
  invoices!: EntityTable<Invoice, 'id'>
  payments!: EntityTable<Payment, 'id'>

  constructor() {
    super('FacturaLocalDB')
    this.version(1).stores({
      company: 'id',
      clients: '++id, name, taxId, phone, email',
      products: '++id, name, price',
      invoices: '++id, number, status, date, client.name, updatedAt'
    })
    this.version(2).stores({
      company: 'id',
      clients: '++id, name, taxId, phone, email',
      products: '++id, name, price',
      invoices: '++id, number, status, date, client.name, updatedAt',
      payments: '++id, &key, invoiceNumber, date, method, updatedAt'
    })
    this.version(3).stores({
      company: 'id, name',
      clients: '++id, companyId, name, taxId, phone, email',
      products: '++id, companyId, name, price',
      invoices: '++id, companyId, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, &key, companyId, invoiceNumber, date, method, updatedAt'
    }).upgrade(async tx => {
      await tx.table('clients').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('products').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('invoices').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('payments').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
    })

    // v4 repairs every existing browser database before the unique index is introduced.
    this.version(4).stores({
      company: 'id, name',
      clients: '++id, companyId, name, taxId, phone, email',
      products: '++id, companyId, name, price',
      invoices: '++id, companyId, logicalKey, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, &key, companyId, invoiceNumber, date, method, updatedAt'
    }).upgrade(async tx => {
      const table = tx.table('invoices')
      const rows = await table.toArray() as Invoice[]
      const groups = new Map<string, Invoice[]>()

      for (const row of rows) {
        const companyId = Number(row.companyId) || 1
        const logicalKey = invoiceLogicalKeyFor({ companyId, number: row.number || '' })
        const group = groups.get(logicalKey) || []
        group.push({ ...row, companyId, logicalKey })
        groups.set(logicalKey, group)
      }

      const keep: Invoice[] = []
      const removeIds: number[] = []
      for (const group of groups.values()) {
        const ordered = [...group].sort((a, b) => invoiceRecordTime(b) - invoiceRecordTime(a) || Number(a.id || 0) - Number(b.id || 0))
        const winner = ordered[0]
        if (winner) keep.push(winner)
        for (const duplicate of ordered.slice(1)) if (typeof duplicate.id === 'number') removeIds.push(duplicate.id)
      }

      if (removeIds.length) await table.bulkDelete(removeIds)
      if (keep.length) await table.bulkPut(keep)
    })

    // v5 makes duplication impossible for the same company + invoice number.
    this.version(5).stores({
      company: 'id, name',
      clients: '++id, companyId, name, taxId, phone, email',
      products: '++id, companyId, name, price',
      invoices: '++id, companyId, &logicalKey, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, &key, companyId, invoiceNumber, date, method, updatedAt'
    })
  }
}

export const db = new InvoiceDB()

// Keep the unique key synchronized for every future local write.
db.invoices.hook('creating', (_primaryKey, row) => {
  row.companyId = Number(row.companyId) || 1
  row.logicalKey = invoiceLogicalKeyFor(row)
})

db.invoices.hook('updating', (mods, _primaryKey, row) => {
  const changes = mods as Partial<Invoice>
  const companyId = Number(changes.companyId ?? row.companyId) || 1
  const number = String(changes.number ?? row.number ?? '')
  return { ...changes, companyId, logicalKey: invoiceLogicalKeyFor({ companyId, number }) }
})

export const defaultCompany: Company = {
  id: 1,
  name: 'Mi empresa',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  currency: 'USD',
  defaultTaxRate: 0,
  nextInvoiceNumber: 1,
  prefix: 'FAC',
  mobilePaymentBank: '',
  mobilePaymentPhone: '',
  mobilePaymentId: '',
  bankName: '',
  bankAccountType: '',
  bankAccountNumber: '',
  bankAccountHolder: '',
  binanceId: '',
  paymentNotes: '',
}

export async function ensureCompany() {
  const existing = await db.company.get(1)
  if (!existing) await db.company.put(defaultCompany)
}

export async function createCompany(name = 'Nuevo negocio') {
  const rows = await db.company.toArray()
  const id = Math.max(0, ...rows.map(row => Number(row.id) || 0)) + 1
  const company: Company = { ...defaultCompany, id, name, nextInvoiceNumber: 1 }
  await db.company.put(company)
  return company
}

export async function exportBackup(): Promise<BackupData> {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    company: await db.company.toArray(),
    clients: await db.clients.toArray(),
    products: await db.products.toArray(),
    invoices: await db.invoices.toArray(),
    payments: await db.payments.toArray(),
  }
}

export async function importBackup(data: BackupData) {
  if (!data || ![1, 2, 3].includes(data.version) || !Array.isArray(data.invoices)) {
    throw new Error('El archivo de respaldo no es compatible.')
  }
  await db.transaction('rw', db.company, db.clients, db.products, db.invoices, db.payments, async () => {
    await Promise.all([db.company.clear(), db.clients.clear(), db.products.clear(), db.invoices.clear(), db.payments.clear()])
    if (data.company?.length) await db.company.bulkPut(data.company)
    if (data.clients?.length) await db.clients.bulkPut(data.clients.map(row => ({ ...row, companyId: row.companyId || 1 })))
    if (data.products?.length) await db.products.bulkPut(data.products.map(row => ({ ...row, companyId: row.companyId || 1 })))
    if (data.invoices?.length) await db.invoices.bulkPut(canonicalizeInvoices(data.invoices))
    if (data.payments?.length) await db.payments.bulkPut(data.payments.map(row => ({ ...row, companyId: row.companyId || 1 })))
  })
  await ensureCompany()
}
