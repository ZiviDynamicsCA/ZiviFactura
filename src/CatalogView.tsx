import { useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, CheckCircle2, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { db } from './db'
import { getActiveCompanyId } from './companyScope'
import { money } from './pdf'
import type { Company, Product } from './types'
import './modular-workspace.css'

type Draft = {
  id?: number
  name: string
  description: string
  price: string
  category: string
  sku: string
  unit: string
  itemType: 'service' | 'product'
  active: boolean
}

const emptyDraft = (): Draft => ({
  name: '', description: '', price: '', category: '', sku: '', unit: 'und', itemType: 'service', active: true,
})

function parseNumber(raw: string) {
  let value = raw.trim().replace(/\s/g, '').replace(/[^0-9,.-]/g, '')
  const comma = value.lastIndexOf(',')
  const dot = value.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '')
  else if (comma >= 0) value = value.replace(',', '.')
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function CatalogView() {
  const companyId = getActiveCompanyId()
  const [rows, setRows] = useState<Product[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [message, setMessage] = useState('')

  async function load() {
    const [all, companyRow] = await Promise.all([db.products.orderBy('name').toArray(), db.company.get(companyId)])
    setRows(all.filter(row => (row.companyId || 1) === companyId))
    setCompany(companyRow || null)
  }

  useEffect(() => { void load() }, [companyId])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(row => [row.name, row.description, row.category, row.sku, row.itemType].join(' ').toLowerCase().includes(term))
  }, [rows, query])

  const activeCount = rows.filter(row => row.active !== false).length
  const serviceCount = rows.filter(row => (row.itemType || 'service') === 'service').length
  const currency = company?.currency || 'USD'

  function edit(row: Product) {
    setEditing({
      id: row.id,
      name: row.name,
      description: row.description || '',
      price: String(row.price || ''),
      category: row.category || '',
      sku: row.sku || '',
      unit: row.unit || 'und',
      itemType: row.itemType || 'service',
      active: row.active !== false,
    })
    setMessage('')
  }

  async function save() {
    if (!editing?.name.trim()) return setMessage('Escribe el nombre del servicio o producto.')
    const timestamp = new Date().toISOString()
    const record: Product = {
      id: editing.id,
      companyId,
      name: editing.name.trim(),
      description: editing.description.trim(),
      price: Math.max(0, parseNumber(editing.price)),
      category: editing.category.trim(),
      sku: editing.sku.trim(),
      unit: editing.unit.trim() || 'und',
      itemType: editing.itemType,
      active: editing.active,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    if (editing.id) {
      const current = await db.products.get(editing.id)
      await db.products.put({ ...current, ...record, createdAt: current?.createdAt || timestamp } as Product)
      setMessage('Catálogo actualizado.')
    } else {
      delete record.id
      await db.products.add(record)
      setMessage('Servicio agregado al catálogo.')
    }
    setEditing(null)
    await load()
  }

  async function remove(row: Product) {
    if (!row.id || !confirm(`¿Eliminar “${row.name}” del catálogo?`)) return
    await db.products.delete(row.id)
    setMessage('Elemento eliminado del catálogo.')
    await load()
  }

  async function toggle(row: Product) {
    if (!row.id) return
    await db.products.update(row.id, { active: row.active === false, updatedAt: new Date().toISOString() })
    await load()
  }

  return <main className="modulePage">
    <section className="moduleHero">
      <div><span>ZIVIFACTURA · CATÁLOGO</span><h1>Servicios y productos listos para cotizar.</h1><p>Centraliza precios, descripciones y categorías del negocio activo. Los registros se guardan en la misma base que ya sincroniza productos con Firebase.</p></div>
      <button className="modulePrimary" onClick={() => setEditing(emptyDraft())}><Plus size={18}/>Agregar</button>
    </section>

    <section className="moduleMetrics">
      <article><BriefcaseBusiness/><span>Servicios</span><strong>{serviceCount}</strong></article>
      <article><Package/><span>Total catálogo</span><strong>{rows.length}</strong></article>
      <article><CheckCircle2/><span>Activos</span><strong>{activeCount}</strong></article>
    </section>

    <section className="moduleCard">
      <div className="moduleCardHead"><div><span>CATÁLOGO DEL NEGOCIO</span><h2>Precios y conceptos frecuentes</h2></div><label className="moduleSearch"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar servicio, categoría o código"/></label></div>
      {filtered.length ? <div className="catalogGrid">{filtered.map(row => <article className={`catalogItem ${row.active === false ? 'inactive' : ''}`} key={row.id || row.syncId || row.name}>
        <div className="catalogType">{(row.itemType || 'service') === 'service' ? 'SERVICIO' : 'PRODUCTO'}{row.category ? ` · ${row.category}` : ''}</div>
        <h3>{row.name}</h3>
        <p>{row.description || 'Sin descripción adicional.'}</p>
        <div className="catalogMeta"><strong>{money(Number(row.price) || 0, currency)}</strong><span>{row.sku || 'Sin código'} · {row.unit || 'und'}</span></div>
        <div className="catalogActions"><button onClick={() => edit(row)}><Pencil size={15}/>Editar</button><button onClick={() => void toggle(row)}>{row.active === false ? 'Activar' : 'Pausar'}</button><button className="danger" onClick={() => void remove(row)}><Trash2 size={15}/></button></div>
      </article>)}</div> : <div className="moduleEmpty">No hay elementos que coincidan con la búsqueda. Agrega el primer servicio del negocio.</div>}
      {message && <div className="moduleMessage">{message}</div>}
    </section>

    {editing && <div className="moduleOverlay" role="dialog" aria-modal="true" aria-label="Editar catálogo"><section className="moduleModal">
      <header><div><span>{editing.id ? 'EDITAR' : 'NUEVO'}</span><h2>{editing.id ? 'Actualizar elemento' : 'Agregar al catálogo'}</h2></div><button className="iconButton" onClick={() => setEditing(null)}><X size={20}/></button></header>
      <div className="moduleFormGrid">
        <label className="wide"><span>Nombre *</span><input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })}/></label>
        <label><span>Tipo</span><select value={editing.itemType} onChange={event => setEditing({ ...editing, itemType: event.target.value as Draft['itemType'] })}><option value="service">Servicio</option><option value="product">Producto</option></select></label>
        <label><span>Precio referencial ({currency})</span><input inputMode="decimal" value={editing.price} onChange={event => setEditing({ ...editing, price: event.target.value })} placeholder="0,00"/></label>
        <label><span>Categoría</span><input value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value })} placeholder="Web, NFC, mantenimiento..."/></label>
        <label><span>Código / SKU</span><input value={editing.sku} onChange={event => setEditing({ ...editing, sku: event.target.value })}/></label>
        <label><span>Unidad</span><input value={editing.unit} onChange={event => setEditing({ ...editing, unit: event.target.value })} placeholder="und, servicio, hora"/></label>
        <label className="moduleCheck"><input type="checkbox" checked={editing.active} onChange={event => setEditing({ ...editing, active: event.target.checked })}/><span>Disponible para usar</span></label>
        <label className="wide"><span>Descripción</span><textarea rows={4} value={editing.description} onChange={event => setEditing({ ...editing, description: event.target.value })}/></label>
      </div>
      <footer><button className="moduleSecondary" onClick={() => setEditing(null)}>Cancelar</button><button className="modulePrimary" onClick={() => void save()}>Guardar</button></footer>
    </section></div>}
  </main>
}
