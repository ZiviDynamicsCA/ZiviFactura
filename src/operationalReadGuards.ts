import { db } from './db'
import { uniqueOperationalInvoices, uniqueOperationalPayments } from './dataIntegrity'
import type { Invoice, Payment } from './types'

type DedupeFn<T> = (rows: T[]) => T[]

type Chainable = Record<string | symbol, unknown>

let installed = false

function shouldKeepRawRead() {
  const stack = new Error().stack || ''
  // Respaldo/exportación/rescate deben poder leer la base completa.
  return /exportBackup|importBackup|rescate|backup|toJSON/i.test(stack)
}

function wrapChain<T>(target: T, dedupe: DedupeFn<unknown>): T {
  if (!target || typeof target !== 'object') return target
  return new Proxy(target as Chainable, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      if (prop === 'toArray' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const rows = await value.apply(obj, args)
          if (shouldKeepRawRead() || !Array.isArray(rows)) return rows
          return dedupe(rows)
        }
      }
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const result = value.apply(obj, args)
          return result && typeof result === 'object' ? wrapChain(result, dedupe) : result
        }
      }
      return value
    },
  }) as T
}

function patchReadChains<T>(table: unknown, dedupe: DedupeFn<T>) {
  const target = table as Record<string, unknown>
  for (const method of ['orderBy', 'where', 'filter']) {
    const original = target[method]
    if (typeof original !== 'function') continue
    target[method] = function patchedReadChain(this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args)
      return wrapChain(result, dedupe as DedupeFn<unknown>)
    }
  }
}

export function installOperationalReadGuards() {
  if (installed) return
  installed = true

  patchReadChains<Invoice>(db.invoices, uniqueOperationalInvoices)
  patchReadChains<Payment>(db.payments, uniqueOperationalPayments)

  console.info('[ZiviFactura] Vista operativa protegida: duplicados técnicos se filtran en lectura, sin borrar ni mover datos.')
}
