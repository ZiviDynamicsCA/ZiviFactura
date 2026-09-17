import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ClipboardList, FileDown, PackageCheck, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { db } from './db'
import { getActiveCompanyId } from './companyScope'
import { archiveDeliveryNote, createBlankDeliveryNote, loadDeliveryNotes, saveDeliveryNote, visibleDeliveryNotes, type DeliveryNote, type DeliveryNoteItem } from './deliveryNotes'
import type { Client, Company, Product } from './types'
import './modular-workspace.css'

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID().replace(/-/g, '')
  : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

export default function DeliveryNotesView() {
  const companyId = getActiveCompanyId()
  const [notes, setNotes] = useState<DeliveryNote[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [catalog, setCatalog] = useState<Product[]>([])
  const [editing, setEditing] = useState<DeliveryNote | null>(null)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const [allNotes, companyRow, allClients, allProducts] = await Promise.all([
      loadDeliveryNotes(companyId), db.company.get(companyId), db.clients.toArray(), db.products.toArray(),
    ])
    setNotes(allNotes)
    setCompany(companyRow || null)
    setClients(allClients.filter(row => (row.companyId || 1) === companyId))
    setCatalog(allProducts.filter(row => (row.companyId || 1) === companyId && row.active !== false))
  }

  useEffect(() => { void load() }, [companyId])

  const visible = useMemo(() => visibleDeliveryNotes(notes), [notes])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return visible
    return visible.filter(row => [row.number, row.clientName, row.reference, row.relatedInvoiceNumber, row.status].join(' ').toLowerCase().includes(term))
  }, [visible, query])

  const delivered = visible.filter(row => row.status === 'delivered').length
  const drafts = visible.filter(row => row.status === 'draft').length

  function newNote() {
    setEditing(createBlankDeliveryNote(companyId, notes))
    setMessage('')
  }

  function updateItem(id: string, patch: Partial<DeliveryNoteItem>) {
    if (!editing) return
    setEditing({ ...editing, items: editing.items.map(item => item.id === id ? { ...item, ...patch } : item) })
  }

  function addItem() {
    if (!editing) return
    setEditing({ ...editing, items: [...editing.items, { id: makeId(), description: '', quantity: 1, unit: 'und' }] })
  }

  function addCatalogItem(productId: number) {
    if (!editing || !productId) return
    const product = catalog.find(item => item.id === productId)
    if (!product) return
    setEditing({ ...editing, items: [...editing.items, { id: makeId(), description: product.name, quantity: 1, unit: product.unit || 'und' }] })
  }

  function chooseClient(clientId: number) {
    if (!editing || !clientId) return
    const client = clients.find(row => row.id === clientId)
    if (!client) return
    setEditing({ ...editing, clientName: client.name, clientTaxId: client.taxId, clientPhone: client.phone, address: client.address })
  }

  async function persist(status?: DeliveryNote['status']) {
    if (!editing?.clientName.trim()) return setMessage('Indica a quién se entrega.')
    const cleanItems = editing.items.filter(item => item.description.trim() && Number(item.quantity) > 0)
    if (!cleanItems.length) return setMessage('Agrega al menos un producto o servicio entregado.')
    setBusy(true)
    try {
      const saved = await saveDeliveryNote({ ...editing, status: status || editing.status, items: cleanItems })
      setEditing(null)
      setMessage(saved.status === 'delivered' ? `${saved.number} marcada como entregada.` : `${saved.number} guardada.`)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(note: DeliveryNote) {
    if (!confirm(`¿Archivar ${note.number}? La nota dejará de mostrarse, pero conservará su registro de sincronización.`)) return
    await archiveDeliveryNote(note)
    setMessage('Nota archivada.')
    await load()
  }

  function download(note: DeliveryNote) {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const width = pdf.internal.pageSize.getWidth()
    let y = 18
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.text(company?.name || 'ZiviFactura', 16, y)
    y += 7; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.text([company?.taxId || '', company?.phone || '', company?.email || ''].filter(Boolean).join(' · '), 16, y)
    y += 13; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text('NOTA DE ENTREGA', 16, y); pdf.text(note.number, width - 16, y, { align: 'right' })
    y += 8; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.text(`Fecha: ${note.date}`, 16, y); pdf.text(`Estado: ${note.status === 'delivered' ? 'Entregada' : note.status === 'cancelled' ? 'Anulada' : 'Borrador'}`, width - 16, y, { align: 'right' })
    y += 10; pdf.setFont('helvetica', 'bold'); pdf.text('Entregar a:', 16, y); pdf.setFont('helvetica', 'normal'); pdf.text(note.clientName, 39, y)
    if (note.clientTaxId) { y += 6; pdf.text(`Identificación: ${note.clientTaxId}`, 16, y) }
    if (note.address) { y += 6; pdf.text(`Dirección: ${note.address}`.slice(0, 115), 16, y) }
    if (note.reference) { y += 6; pdf.text(`Referencia: ${note.reference}`.slice(0, 115), 16, y) }
    y += 12; pdf.setFont('helvetica', 'bold'); pdf.text('Cant.', 16, y); pdf.text('Unidad', 35, y); pdf.text('Descripción', 60, y); y += 3; pdf.line(16, y, width - 16, y); y += 6
    pdf.setFont('helvetica', 'normal')
    note.items.forEach(item => {
      const lines = pdf.splitTextToSize(item.description, width - 82) as string[]
      pdf.text(String(item.quantity), 16, y); pdf.text(item.unit || 'und', 35, y); pdf.text(lines, 60, y)
      y += Math.max(7, lines.length * 5)
      if (y > 270) { pdf.addPage(); y = 20 }
    })
    if (note.notes) { y += 6; pdf.setFont('helvetica', 'bold'); pdf.text('Observaciones', 16, y); y += 6; pdf.setFont('helvetica', 'normal'); pdf.text(pdf.splitTextToSize(note.notes, width - 32), 16, y) }
    pdf.setFontSize(8); pdf.setTextColor(110); pdf.text('Generado con ZiviFactura · Zivi Dynamics C.A.', width / 2, 290, { align: 'center' })
    pdf.save(`${note.number}.pdf`)
  }

  return <main className="modulePage">
    <section className="moduleHero">
      <div><span>ZIVIFACTURA · OPERACIONES</span><h1>Notas de entrega separadas de la facturación.</h1><p>Documenta lo que realmente entregaste sin inflar ingresos ni cuentas por cobrar. Cada nota puede vincularse con una factura, presupuesto o referencia interna.</p></div>
      <button className="modulePrimary" onClick={newNote}><Plus size={18}/>Nueva nota</button>
    </section>

    <section className="moduleMetrics">
      <article><ClipboardList/><span>Notas activas</span><strong>{visible.length}</strong></article>
      <article><PackageCheck/><span>Entregadas</span><strong>{delivered}</strong></article>
      <article><Pencil/><span>Borradores</span><strong>{drafts}</strong></article>
    </section>

    <section className="moduleCard">
      <div className="moduleCardHead"><div><span>CONTROL DE ENTREGAS</span><h2>Historial del negocio</h2></div><label className="moduleSearch"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por cliente, nota o referencia"/></label></div>
      {filtered.length ? <div className="deliveryList">{filtered.map(note => <article key={note.syncId}>
        <div className="deliveryMain"><span>{note.number} · {note.date}</span><strong>{note.clientName}</strong><small>{note.items.length} concepto(s){note.reference ? ` · ${note.reference}` : ''}{note.relatedInvoiceNumber ? ` · ${note.relatedInvoiceNumber}` : ''}</small></div>
        <span className={`deliveryStatus ${note.status}`}>{note.status === 'delivered' ? 'Entregada' : note.status === 'cancelled' ? 'Anulada' : 'Borrador'}</span>
        <div className="deliveryActions"><button onClick={() => setEditing(structuredClone(note))}><Pencil size={15}/>Editar</button><button onClick={() => download(note)}><FileDown size={15}/>PDF</button>{note.status === 'draft' && <button className="success" onClick={() => { setEditing(structuredClone(note)); window.setTimeout(() => void persist('delivered'), 0) }}><CheckCircle2 size={15}/>Entregada</button>}<button className="danger" onClick={() => void remove(note)}><Trash2 size={15}/></button></div>
      </article>)}</div> : <div className="moduleEmpty">Todavía no hay notas de entrega en este negocio.</div>}
      {message && <div className="moduleMessage">{message}</div>}
    </section>

    {editing && <div className="moduleOverlay" role="dialog" aria-modal="true" aria-label="Nota de entrega"><section className="moduleModal deliveryModal">
      <header><div><span>NOTA DE ENTREGA</span><h2>{editing.number}</h2></div><button className="iconButton" onClick={() => setEditing(null)}><X size={20}/></button></header>
      <div className="moduleFormGrid">
        <label><span>Fecha</span><input type="date" value={editing.date} onChange={event => setEditing({ ...editing, date: event.target.value })}/></label>
        <label><span>Cliente guardado</span><select defaultValue="" onChange={event => chooseClient(Number(event.target.value))}><option value="">Seleccionar…</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="wide"><span>Entregar a *</span><input value={editing.clientName} onChange={event => setEditing({ ...editing, clientName: event.target.value })}/></label>
        <label><span>RIF / C.I.</span><input value={editing.clientTaxId || ''} onChange={event => setEditing({ ...editing, clientTaxId: event.target.value })}/></label>
        <label><span>Teléfono</span><input value={editing.clientPhone || ''} onChange={event => setEditing({ ...editing, clientPhone: event.target.value })}/></label>
        <label className="wide"><span>Dirección / lugar de entrega</span><input value={editing.address || ''} onChange={event => setEditing({ ...editing, address: event.target.value })}/></label>
        <label><span>Referencia</span><input value={editing.reference || ''} onChange={event => setEditing({ ...editing, reference: event.target.value })} placeholder="Orden, proyecto, pedido..."/></label>
        <label><span>Factura relacionada</span><input value={editing.relatedInvoiceNumber || ''} onChange={event => setEditing({ ...editing, relatedInvoiceNumber: event.target.value })} placeholder="FAC-000001"/></label>
      </div>

      <div className="deliveryItemsHead"><div><span>CONCEPTOS ENTREGADOS</span><strong>{editing.items.length} línea(s)</strong></div><div><select defaultValue="" onChange={event => { addCatalogItem(Number(event.target.value)); event.currentTarget.value = '' }}><option value="">Agregar desde catálogo…</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="moduleSecondary" onClick={addItem}><Plus size={15}/>Línea</button></div></div>
      <div className="deliveryEditorItems">{editing.items.map(item => <div key={item.id}>
        <input className="qty" type="number" min="0.01" step="0.01" value={item.quantity} onChange={event => updateItem(item.id, { quantity: Number(event.target.value) || 0 })}/>
        <input className="unit" value={item.unit} onChange={event => updateItem(item.id, { unit: event.target.value })}/>
        <input value={item.description} onChange={event => updateItem(item.id, { description: event.target.value })} placeholder="Descripción del producto o servicio"/>
        <button className="iconButton" onClick={() => setEditing({ ...editing, items: editing.items.filter(row => row.id !== item.id) })}><Trash2 size={16}/></button>
      </div>)}</div>
      <label className="moduleTextarea"><span>Observaciones</span><textarea rows={3} value={editing.notes || ''} onChange={event => setEditing({ ...editing, notes: event.target.value })}/></label>
      <footer><button className="moduleSecondary" onClick={() => setEditing(null)}>Cancelar</button><button className="moduleSecondary" disabled={busy} onClick={() => void persist('draft')}>Guardar borrador</button><button className="modulePrimary" disabled={busy} onClick={() => void persist('delivered')}><CheckCircle2 size={16}/>Guardar como entregada</button></footer>
    </section></div>}
  </main>
}
