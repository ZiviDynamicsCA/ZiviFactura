import { db } from './db'
import type { Client } from './types'

const normalizeText = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ')

const normalizeTaxId = (value = '') => normalizeText(value).replace(/[^a-z0-9]/g, '')
const normalizeEmail = (value = '') => value.trim().toLowerCase()
const normalizePhone = (value = '') => value.replace(/\D/g, '')

function sameClient(a: Client, b: Client) {
  if ((Number(a.companyId) || 1) !== (Number(b.companyId) || 1)) return false

  const aTax = normalizeTaxId(a.taxId)
  const bTax = normalizeTaxId(b.taxId)
  if (aTax && bTax) return aTax === bTax

  const aEmail = normalizeEmail(a.email)
  const bEmail = normalizeEmail(b.email)
  if (aEmail && bEmail && aEmail === bEmail) return true

  const aPhone = normalizePhone(a.phone)
  const bPhone = normalizePhone(b.phone)
  if (aPhone.length >= 7 && bPhone.length >= 7 && aPhone === bPhone) return true

  const aName = normalizeText(a.name)
  const bName = normalizeText(b.name)
  if (!aName || aName !== bName) return false

  // Same normalized name is considered the same client unless both rows
  // contain a conflicting strong identifier.
  if (aTax && bTax && aTax !== bTax) return false
  if (aEmail && bEmail && aEmail !== bEmail) return false
  if (aPhone.length >= 7 && bPhone.length >= 7 && aPhone !== bPhone) return false
  return true
}

function completeness(client: Client) {
  return [client.taxId, client.phone, client.email, client.address]
    .reduce((score, value) => score + (value?.trim() ? 1 : 0), 0)
}

function prefer(current: string, incoming: string) {
  const a = current?.trim() || ''
  const b = incoming?.trim() || ''
  if (!a) return b
  if (!b) return a
  return b.length > a.length ? b : a
}

function mergeClient(keep: Client, duplicate: Client): Client {
  return {
    ...keep,
    name: prefer(keep.name, duplicate.name),
    taxId: prefer(keep.taxId, duplicate.taxId),
    phone: prefer(keep.phone, duplicate.phone),
    email: prefer(keep.email, duplicate.email),
    address: prefer(keep.address, duplicate.address),
    createdAt: [keep.createdAt, duplicate.createdAt].filter(Boolean).sort()[0] || keep.createdAt,
  }
}

let running = false
let timer: number | undefined

export async function dedupeStoredClients() {
  if (running) return 0
  running = true
  try {
    const rows = (await db.clients.toArray())
      .filter((client): client is Client & { id: number } => typeof client.id === 'number')
      .sort((a, b) => {
        const companyDiff = (Number(a.companyId) || 1) - (Number(b.companyId) || 1)
        if (companyDiff) return companyDiff
        const scoreDiff = completeness(b) - completeness(a)
        if (scoreDiff) return scoreDiff
        return a.id - b.id
      })

    const canonical: Array<Client & { id: number }> = []
    const duplicateToCanonical = new Map<number, number>()
    const merged = new Map<number, Client & { id: number }>()

    for (const row of rows) {
      const existing = canonical.find(candidate => sameClient(candidate, row))
      if (!existing) {
        canonical.push({ ...row })
        continue
      }
      const combined = mergeClient(existing, row) as Client & { id: number }
      Object.assign(existing, combined)
      merged.set(existing.id, existing)
      duplicateToCanonical.set(row.id, existing.id)
    }

    if (!duplicateToCanonical.size) return 0

    await db.transaction('rw', db.clients, db.invoices, async () => {
      if (merged.size) await db.clients.bulkPut([...merged.values()])

      const invoices = await db.invoices.toArray()
      const affected = invoices.filter(invoice => invoice.id && invoice.clientId && duplicateToCanonical.has(invoice.clientId))
      for (const invoice of affected) {
        const canonicalId = duplicateToCanonical.get(invoice.clientId!)
        if (canonicalId && invoice.id) await db.invoices.update(invoice.id, { clientId: canonicalId })
      }

      await db.clients.bulkDelete([...duplicateToCanonical.keys()])
    })

    return duplicateToCanonical.size
  } finally {
    running = false
  }
}

export function startClientDedupWatcher() {
  const schedule = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => { void dedupeStoredClients() }, 800)
  }
  db.clients.hook('creating', schedule)
  db.clients.hook('updating', schedule)
}
