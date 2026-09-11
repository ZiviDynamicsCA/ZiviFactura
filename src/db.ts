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

function normalizeInvoice(row: Invoice): Invoice {
  const companyId = Number(row.companyId) || 1
  return { ...row, companyId, logicalKey: invoiceLogicalKeyFor({ companyId, number: row.number || '' }) }
}

function normalizeClient(row: Client): Client {
  return { ...row, companyId: Number(row.companyId) || 1 }
}

function normalizeProduct(row: Product): Product {
  return { ...row, companyId: Number(row.companyId) || 1 }
}

function normalizePayment(row: Payment): Payment {
  const now = new Date().toISOString()
  const companyId = Number(row.companyId) || 1
  return {
    ...row,
    companyId,
    key: row.key || `${companyId}:${row.invoiceNumber || 'sin-factura'}:${row.date || now}:${row.createdAt || now}`,
  }
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
      payments: '++id, key, invoiceNumber, date, method, updatedAt'
    })
    this.version(3).stores({
      company: 'id, name',
      clients: '++id, companyId, name, taxId, phone, email',
      products: '++id, companyId, name, price',
      invoices: '++id, companyId, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, key, companyId, invoiceNumber, date, method, updatedAt'
    }).upgrade(async tx => {
      await tx.table('clients').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('products').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('invoices').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('payments').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
    })

    // v4 no elimina ni deduplica documentos. Solo normaliza campos de alcance.
    this.version(4).stores({
      company: 'id, name',
      clients: '++id, companyId, name, taxId, phone, email',
      products: '++id, companyId, name, price',
      invoices: '++id, companyId, logicalKey, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, key, companyId, invoiceNumber, date, method, updatedAt'
    }).upgrade(async tx => {
      await tx.table('clients').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('products').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('invoices').toCollection().modify(row => {
        const companyId = Number(row.companyId) || 1
        row.companyId = companyId
        row.logicalKey = invoiceLogicalKeyFor({ companyId, number: row.number || '' })
      })
      await tx.table('payments').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
    })

    // v5 conserva todos los documentos aunque compartan número. No hay índice único en facturas.
    this.version(5).stores({
      company: 'id, name',
      clients: '++id, companyId, name, taxId, phone, email',
      products: '++id, companyId, name, price',
      invoices: '++id, companyId, logicalKey, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, key, companyId, invoiceNumber, date, method, updatedAt'
    })

    // v6 retira cualquier índice único previo y refuerza la política de no pérdida de datos.
    this.version(6).stores({
      company: 'id, name',
      clients: '++id, companyId, name, taxId, phone, email',
      products: '++id, companyId, name, price',
      invoices: '++id, companyId, logicalKey, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, key, companyId, invoiceNumber, date, method, updatedAt'
    }).upgrade(async tx => {
      await tx.table('clients').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('products').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('invoices').toCollection().modify(row => {
        const companyId = Number(row.companyId) || 1
        row.companyId = companyId
        row.logicalKey = invoiceLogicalKeyFor({ companyId, number: row.number || '' })
      })
      await tx.table('payments').toCollection().modify(row => {
        if (!row.companyId) row.companyId = 1
        if (!row.key) row.key = `${row.companyId}:${row.invoiceNumber || 'sin-factura'}:${row.date || row.createdAt || Date.now()}`
      })
    })
  }
}

export const db = new InvoiceDB()

// Keep the searchable key synchronized for every future local write.
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

async function putWithoutDestroying(table: Dexie.Table<any, any>, row: any) {
  if (row?.id == null) {
    await table.add(row)
    return
  }
  const current = await table.get(row.id)
  if (!current) {
    await table.put(row)
    return
  }
  // Never overwrite an existing local record during import. Keep both copies.
  const copy = { ...row }
  delete copy.id
  await table.add(copy)
}

export async function importBackup(data: BackupData) {
  if (!data || ![1, 2, 3].includes(data.version) || !Array.isArray(data.invoices)) {
    throw new Error('El archivo de respaldo no es compatible.')
  }
  await db.transaction('rw', db.company, db.clients, db.products, db.invoices, db.payments, async () => {
    if (data.company?.length) {
      for (const row of data.company) await db.company.put({ ...defaultCompany, ...row, id: Number(row.id) || 1 })
    }
    if (data.clients?.length) {
      for (const row of data.clients) await putWithoutDestroying(db.clients, normalizeClient(row))
    }
    if (data.products?.length) {
      for (const row of data.products) await putWithoutDestroying(db.products, normalizeProduct(row))
    }
    if (data.invoices?.length) {
      for (const row of data.invoices) await putWithoutDestroying(db.invoices, normalizeInvoice(row))
    }
    if (data.payments?.length) {
      for (const row of data.payments) await putWithoutDestroying(db.payments, normalizePayment(row))
    }
  })
  await ensureCompany()
}
