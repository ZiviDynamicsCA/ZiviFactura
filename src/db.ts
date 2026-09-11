import Dexie, { type EntityTable } from 'dexie'
import type { BackupData, Client, Company, Invoice, Payment, Product } from './types'

export function makeSyncId(prefix = 'rec') {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}_${random}`
}

function ensureSyncId<T extends { syncId?: string }>(row: T, prefix: string): T {
  return { ...row, syncId: row.syncId || makeSyncId(prefix) }
}

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
  return ensureSyncId({ ...row, companyId, logicalKey: invoiceLogicalKeyFor({ companyId, number: row.number || '' }) }, 'inv')
}

function normalizeClient(row: Client): Client {
  return ensureSyncId({ ...row, companyId: Number(row.companyId) || 1 }, 'cli')
}

function normalizeProduct(row: Product): Product {
  return ensureSyncId({ ...row, companyId: Number(row.companyId) || 1 }, 'prd')
}

function normalizePayment(row: Payment): Payment {
  const now = new Date().toISOString()
  const companyId = Number(row.companyId) || 1
  return ensureSyncId({
    ...row,
    companyId,
    key: row.key || `${companyId}:${row.invoiceNumber || 'sin-factura'}:${row.date || row.createdAt || now}`,
  }, 'pay')
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

    // v7 añade identificadores globales estables para sincronizar entre dispositivos.
    // El número de factura queda como dato visible, nunca como identidad única del registro.
    this.version(7).stores({
      company: 'id, syncId, name',
      clients: '++id, syncId, companyId, name, taxId, phone, email',
      products: '++id, syncId, companyId, name, price',
      invoices: '++id, syncId, companyId, logicalKey, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, syncId, key, companyId, invoiceNumber, date, method, updatedAt'
    }).upgrade(async tx => {
      await tx.table('company').toCollection().modify(row => { if (!row.syncId) row.syncId = `company_${row.id || 1}` })
      await tx.table('clients').toCollection().modify(row => {
        if (!row.companyId) row.companyId = 1
        if (!row.syncId) row.syncId = makeSyncId('cli')
      })
      await tx.table('products').toCollection().modify(row => {
        if (!row.companyId) row.companyId = 1
        if (!row.syncId) row.syncId = makeSyncId('prd')
      })
      await tx.table('invoices').toCollection().modify(row => {
        const companyId = Number(row.companyId) || 1
        row.companyId = companyId
        row.logicalKey = invoiceLogicalKeyFor({ companyId, number: row.number || '' })
        if (!row.syncId) row.syncId = makeSyncId('inv')
      })
      await tx.table('payments').toCollection().modify(row => {
        if (!row.companyId) row.companyId = 1
        if (!row.key) row.key = `${row.companyId}:${row.invoiceNumber || 'sin-factura'}:${row.date || row.createdAt || Date.now()}`
        if (!row.syncId) row.syncId = makeSyncId('pay')
      })
    })
  }
}

export const db = new InvoiceDB()

// Keep searchable and sync keys synchronized for every future local write.
db.company.hook('creating', (_primaryKey, row) => {
  row.syncId = row.syncId || `company_${row.id || 1}`
})

db.invoices.hook('creating', (_primaryKey, row) => {
  row.companyId = Number(row.companyId) || 1
  row.logicalKey = invoiceLogicalKeyFor(row)
  row.syncId = row.syncId || makeSyncId('inv')
})

db.invoices.hook('updating', (mods, _primaryKey, row) => {
  const changes = mods as Partial<Invoice>
  const companyId = Number(changes.companyId ?? row.companyId) || 1
  const number = String(changes.number ?? row.number ?? '')
  return {
    ...changes,
    companyId,
    syncId: changes.syncId ?? row.syncId ?? makeSyncId('inv'),
    logicalKey: invoiceLogicalKeyFor({ companyId, number }),
  }
})

db.clients.hook('creating', (_primaryKey, row) => {
  row.companyId = Number(row.companyId) || 1
  row.syncId = row.syncId || makeSyncId('cli')
})

db.clients.hook('updating', (mods, _primaryKey, row) => {
  const changes = mods as Partial<Client>
  return { ...changes, companyId: Number(changes.companyId ?? row.companyId) || 1, syncId: changes.syncId ?? row.syncId ?? makeSyncId('cli') }
})

db.products.hook('creating', (_primaryKey, row) => {
  row.companyId = Number(row.companyId) || 1
  row.syncId = row.syncId || makeSyncId('prd')
})

db.products.hook('updating', (mods, _primaryKey, row) => {
  const changes = mods as Partial<Product>
  return { ...changes, companyId: Number(changes.companyId ?? row.companyId) || 1, syncId: changes.syncId ?? row.syncId ?? makeSyncId('prd') }
})

db.payments.hook('creating', (_primaryKey, row) => {
  row.companyId = Number(row.companyId) || 1
  row.key = row.key || `${row.companyId}:${row.invoiceNumber || 'sin-factura'}:${row.date || row.createdAt || Date.now()}`
  row.syncId = row.syncId || makeSyncId('pay')
})

db.payments.hook('updating', (mods, _primaryKey, row) => {
  const changes = mods as Partial<Payment>
  return {
    ...changes,
    companyId: Number(changes.companyId ?? row.companyId) || 1,
    key: changes.key ?? row.key ?? `${Number(changes.companyId ?? row.companyId) || 1}:${changes.invoiceNumber ?? row.invoiceNumber ?? 'sin-factura'}:${changes.date ?? row.date ?? Date.now()}`,
    syncId: changes.syncId ?? row.syncId ?? makeSyncId('pay'),
  }
})

export const defaultCompany: Company = {
  id: 1,
  syncId: 'company_1',
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
  else if (!existing.syncId) await db.company.update(1, { syncId: 'company_1' })
}

export async function createCompany(name = 'Nuevo negocio') {
  const rows = await db.company.toArray()
  const id = Math.max(0, ...rows.map(row => Number(row.id) || 0)) + 1
  const company: Company = { ...defaultCompany, id, syncId: `company_${id}`, name, nextInvoiceNumber: 1 }
  await db.company.put(company)
  return company
}

export async function exportBackup(): Promise<BackupData> {
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    company: await db.company.toArray(),
    clients: await db.clients.toArray(),
    products: await db.products.toArray(),
    invoices: await db.invoices.toArray(),
    payments: await db.payments.toArray(),
  }
}

async function putWithoutDestroying<T extends { id?: number; syncId?: string; updatedAt?: string; createdAt?: string }>(table: Dexie.Table<T, number>, row: T) {
  const incoming = { ...row }
  if (!incoming.syncId) incoming.syncId = makeSyncId('imp')

  const currentBySync = await table.where('syncId').equals(incoming.syncId).first().catch(() => undefined)
  if (currentBySync?.id) {
    const incomingTime = Date.parse(incoming.updatedAt || incoming.createdAt || '') || 0
    const currentTime = Date.parse(currentBySync.updatedAt || currentBySync.createdAt || '') || 0
    if (incomingTime >= currentTime) await table.put({ ...currentBySync, ...incoming, id: currentBySync.id })
    return
  }

  if (incoming.id == null) {
    await table.add(incoming)
    return
  }

  const currentById = await table.get(incoming.id)
  if (!currentById) {
    await table.put(incoming)
    return
  }

  // Primary keys are local to each device. If an imported id already exists,
  // keep both records and let syncId preserve the global identity.
  const copy = { ...incoming }
  delete copy.id
  await table.add(copy)
}

export async function importBackup(data: BackupData) {
  if (!data || ![1, 2, 3, 4].includes(data.version) || !Array.isArray(data.invoices)) {
    throw new Error('El archivo de respaldo no es compatible.')
  }
  await db.transaction('rw', db.company, db.clients, db.products, db.invoices, db.payments, async () => {
    if (data.company?.length) {
      for (const row of data.company) await db.company.put({ ...defaultCompany, ...row, id: Number(row.id) || 1, syncId: row.syncId || `company_${Number(row.id) || 1}` })
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
