import { useEffect, useMemo, useRef, useState } from 'react'
import { ArchiveRestore, Calculator, Check, Copy, Download, Edit3, FilePlus2, FileText, Home, Mail, Plus, ReceiptText, Save, Search, Send, Settings, Share2, Trash2, Upload, WifiOff } from 'lucide-react'
import { db, defaultCompany, ensureCompany, exportBackup, importBackup } from './db'
import { buildInvoicePdf, money, totals } from './pdf'
import { appliedForInvoice, balanceForInvoice } from './payments'
import { getActiveCompanyId } from './companyScope'
import { preparePublicDocumentShare, publishPublicDocument, shareDocumentMessage } from './publicShare'
import RatesView from './RatesView'
import { fetchLiveRates, formatRate, getCachedRates, getRateValue, invoiceEquivalentValues, rateSourceLabels, refreshRatesIfDue } from './rates'
import type { BackupData, Client, Company, ConversionTarget, Invoice, InvoiceItem, InvoiceStatus, Payment, PaymentDisplay, RateSnapshot, RateSource } from './types'
import './home.css'

type Mode = 'home' | 'editor' | 'rates' | 'settings'
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
type HomeStatusFilter = 'all' | InvoiceStatus

const labels: Record<InvoiceStatus, string> = { draft: 'Borrador', issued: 'Por cobrar', paid: 'Pagada', cancelled: 'Anulada' }
const homeStatusOrder: InvoiceStatus[] = ['issued', 'draft', 'paid', 'cancelled']
const homeStatusInfo: Record<InvoiceStatus, { title: string; hint: string }> = {
  issued: { title: 'Por cobrar', hint: 'Pendientes de cobro y saldos abiertos' },
  draft: { title: 'Borradores', hint: 'Documentos que todavía no has emitido' },
  paid: { title: 'Pagadas', hint: 'Documentos cobrados o con saldo cancelado' },
  cancelled: { title: 'Anuladas', hint: 'Documentos que ya no forman parte del cobro' },
}
const today = () => new Date().toISOString().slice(0, 10)
const uid = () => Math.random().toString(36).slice(2, 10)
const numberFor = (c: Company) => `${c.prefix || 'FAC'}-${String(c.nextInvoiceNumber || 1).padStart(6, '0')}`
const MAX_LOGO_BYTES = 10 * 1024 * 1024
const ALL_CONVERSION_TARGETS: ConversionTarget[] = ['VES', 'USD', 'EUR', 'USDT_BINANCE', 'USDT_AVERAGE']

function availablePaymentMethods(c: Company): PaymentDisplay[] {
  const methods: PaymentDisplay[] = []
  if (c.mobilePaymentBank || c.mobilePaymentPhone || c.mobilePaymentId) methods.push('mobile')
  if (c.bankName || c.bankAccountType || c.bankAccountNumber || c.bankAccountHolder) methods.push('bank')
  if (c.binanceId) methods.push('binance')
  if (c.paymentNotes) methods.push('notes')
  return methods
}

function blank(c: Company): Invoice {
  const now = new Date().toISOString()
  return {
    companyId: c.id,
    number: numberFor(c), type: 'Factura', status: 'draft', date: today(), dueDate: '', city: c.city || '',
    client: { name: '', taxId: '', phone: '', email: '', address: '' },
    items: [{ id: uid(), description: '', quantity: 1, unitPrice: 0 }], discount: 0,
    taxRate: c.defaultTaxRate || 0, paymentMethod: '', notes: '', currency: c.currency || 'USD',
    rateSource: 'none', showRateConversions: false, conversionTargets: [], paymentMethodsVisible: availablePaymentMethods(c),
    createdAt: now, updatedAt: now,
  }
}

function groupedMoney(rows: Array<{ currency: string; amount: number }>) {
  const grouped = new Map<string, number>()
  rows.forEach(row => grouped.set(row.currency, (grouped.get(row.currency) || 0) + row.amount))
  return [...grouped.entries()].map(([currency, value]) => money(value, currency)).join(' · ') || '0,00'
}

function pendingByCurrency(invoices: Invoice[], payments: Payment[]) {
  return groupedMoney(invoices
    .filter(invoice => invoice.status === 'issued')
    .map(invoice => ({ currency: invoice.currency, amount: balanceForInvoice(invoice, payments) }))
    .filter(row => row.amount > 0.005))
}

function collectedByCurrency(invoices: Invoice[], payments: Payment[]) {
  const rows = payments.map(payment => ({ currency: payment.invoiceCurrency, amount: Number(payment.amountApplied) || 0 }))
  const withLedger = new Set(payments.map(payment => payment.invoiceNumber))
  invoices.filter(invoice => invoice.status === 'paid' && !withLedger.has(invoice.number)).forEach(invoice => {
    rows.push({ currency: invoice.currency, amount: totals(invoice).total })
  })
  return groupedMoney(rows)
}

function currencyForRate(source: RateSource) {
  if (source === 'bcv_eur') return 'EUR'
  if (source === 'binance' || source === 'usdt_average') return 'USDT'
  return 'USD'
}

export default function App() {
  const [mode, setMode] = useState<Mode>('home')
  const [company, setCompany] = useState<Company>(defaultCompany)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)

  const notify = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 3200) }

  async function refresh() {
    await ensureCompany()
    const companyId = getActiveCompanyId()
    const [c, allInv, allPay, allClients] = await Promise.all([
      db.company.get(companyId), db.invoices.orderBy('updatedAt').reverse().toArray(), db.payments.orderBy('date').reverse().toArray(), db.clients.orderBy('name').toArray()
    ])
    const active = c || await db.company.get(1)
    setCompany(active ? { ...defaultCompany, ...active } : defaultCompany)
    setInvoices(allInv.filter(row => (row.companyId || 1) === companyId))
    setPayments(allPay.filter(row => (row.companyId || 1) === companyId))
    setClients(allClients.filter(row => (row.companyId || 1) === companyId))
  }

  useEffect(() => {
    refresh()
    void refreshRatesIfDue()
    const on = () => setOnline(true), off = () => setOnline(false)
    const beforeInstall = (e: Event) => { e.preventDefault(); setInstallPrompt(e as InstallPrompt) }
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('beforeinstallprompt', beforeInstall)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('beforeinstallprompt', beforeInstall) }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter(i => [i.number, i.client.name, i.client.taxId, labels[i.status], i.status, i.date].join(' ').toLowerCase().includes(q))
  }, [invoices, search])

  const startNew = () => { setEditing(blank(company)); setMode('editor') }
  const startNewWithRate = (source: RateSource, rates: RateSnapshot) => {
    const invoice = blank(company)
    const value = getRateValue(source, rates)
    setEditing({
      ...invoice,
      currency: currencyForRate(source),
      rateSource: source,
      rateLabel: rateSourceLabels[source],
      rateValue: value,
      rateCapturedAt: rates.capturedAt,
      rateSnapshot: { ...rates },
      showRateConversions: true,
      conversionTargets: ['VES'],
    })
    setMode('editor')
  }
  const edit = (i: Invoice) => { setEditing(structuredClone(i)); setMode('editor') }
  const duplicate = (i: Invoice) => {
    const now = new Date().toISOString()
    setEditing({ ...structuredClone(i), id: undefined, companyId: company.id, publicShareId: undefined, number: numberFor(company), status: 'draft', date: today(), createdAt: now, updatedAt: now, items: i.items.map(x => ({ ...x, id: uid() })) })
    setMode('editor')
  }
  const remove = async (i: Invoice) => {
    if (!i.id || !confirm(`¿Eliminar ${i.number}?`)) return
    await db.invoices.delete(i.id); await refresh(); notify('Documento eliminado.')
  }
  const changeStatus = async (i: Invoice, status: InvoiceStatus) => {
    if (!i.id) return
    await db.invoices.update(i.id, { status, updatedAt: new Date().toISOString() })
    await refresh()
    notify(status === 'paid' ? `${i.number} marcada como pagada.` : `${i.number} actualizada.`)
  }

  return <div className="app">
    <header className="top">
      <button className="brand" onClick={() => setMode('home')}><span><ReceiptText size={22}/></span><div><strong>ZiviFactura</strong><small>{company.name || 'Mi empresa'}</small></div></button>
      <nav>
        <button className={mode === 'home' ? 'active' : ''} onClick={() => setMode('home')}><Home size={18}/>Inicio</button>
        <button className={mode === 'rates' ? 'active' : ''} onClick={() => setMode('rates')}><Calculator size={18}/>Tasas</button>
        <button className={mode === 'settings' ? 'active' : ''} onClick={() => setMode('settings')}><Settings size={18}/>Configuración</button>
      </nav>
      <button className="primary" onClick={startNew}><Plus size={18}/>Nueva factura</button>
    </header>

    <main className="page">
      {!online && <div className="offline"><WifiOff size={16}/>Estás sin conexión. Puedes seguir trabajando porque los datos se guardan en este dispositivo.</div>}
      {mode === 'home' && <HomeView invoices={filtered} all={invoices} payments={payments} search={search} setSearch={setSearch} onNew={startNew} onEdit={edit} onDuplicate={duplicate} onDelete={remove} onStatusChange={changeStatus}/>} 
      {mode === 'rates' && <RatesView onCreateInvoiceWithRate={startNewWithRate} notify={notify}/>} 
      {mode === 'editor' && editing && <Editor invoice={editing} company={company} clients={clients} notify={notify} onBack={() => setMode('home')} onSaved={async s => { setEditing(s); await refresh(); notify(`${s.number} guardada.`) }}/>} 
      {mode === 'settings' && <SettingsView company={company} installPrompt={installPrompt} notify={notify} onChanged={refresh} onInstalled={() => setInstallPrompt(null)}/>} 
      <footer className="appFooter"><span>ZiviFactura · Zivi Dynamics C.A.</span><span><a href="/privacidad.html">Privacidad</a> · <a href="/terminos.html">Términos</a> · <a href="/cookies.html">Cookies</a></span></footer>
    </main>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

function HomeView({ invoices, all, payments, search, setSearch, onNew, onEdit, onDuplicate, onDelete, onStatusChange }: {
  invoices: Invoice[]; all: Invoice[]; payments: Payment[]; search: string; setSearch: (v: string) => void;
  onNew: () => void; onEdit: (i: Invoice) => void; onDuplicate: (i: Invoice) => void; onDelete: (i: Invoice) => void; onStatusChange: (i: Invoice, status: InvoiceStatus) => void
}) {
  const [statusFilter, setStatusFilter] = useState<HomeStatusFilter>('all')
  const pending = pendingByCurrency(all, payments)
  const paid = collectedByCurrency(all, payments)
  const counts = useMemo(() => ({
    all: all.length,
    issued: all.filter(item => item.status === 'issued').length,
    draft: all.filter(item => item.status === 'draft').length,
    paid: all.filter(item => item.status === 'paid').length,
    cancelled: all.filter(item => item.status === 'cancelled').length,
  }), [all])
  const statusesToShow = statusFilter === 'all' ? homeStatusOrder : [statusFilter]
  const grouped = statusesToShow.map(status => ({ status, rows: invoices.filter(item => item.status === status) }))
  const totalVisible = grouped.reduce((sum, group) => sum + group.rows.length, 0)
  const tabs: Array<{ key: HomeStatusFilter; label: string; count: number }> = [
    { key: 'all', label: 'Resumen', count: counts.all },
    { key: 'issued', label: 'Por cobrar', count: counts.issued },
    { key: 'draft', label: 'Borradores', count: counts.draft },
    { key: 'paid', label: 'Pagadas', count: counts.paid },
    { key: 'cancelled', label: 'Anuladas', count: counts.cancelled },
  ]

  const invoiceRow = (i: Invoice) => {
    const applied = appliedForInvoice(i.number, payments)
    const balance = balanceForInvoice(i, payments)
    const visibleAmount = i.status === 'issued' ? balance : totals(i).total
    return <article className="row" key={i.id || i.number}>
      <button className="doc" onClick={() => onEdit(i)}><span className="fileIcon"><FileText size={19}/></span><span><strong>{i.number}</strong><small>{i.client.name || 'Sin cliente'} · {i.date}{applied > 0 ? ` · Abonado ${money(applied, i.currency)}` : i.rateLabel ? ` · ${i.rateLabel}` : ''}</small></span></button>
      <span className={`status ${i.status}`}>{labels[i.status]}</span><strong className="amount">{i.status === 'issued' ? `Saldo ${money(visibleAmount, i.currency)}` : money(visibleAmount, i.currency)}</strong>
      <div className="actions">{i.status === 'issued' && <button title="Marcar como pagada" onClick={() => onStatusChange(i, 'paid')}><Check size={17}/></button>}<button title="Editar" onClick={() => onEdit(i)}><Edit3 size={17}/></button><button title="Duplicar" onClick={() => onDuplicate(i)}><Copy size={17}/></button><button title="Eliminar" className="danger" onClick={() => onDelete(i)}><Trash2 size={17}/></button></div>
    </article>
  }

  return <>
    <section className="hero"><div><span>ZIVI FACTURA · CONTROL ADMINISTRATIVO</span><h1>Presupuesta, factura y cobra con una imagen profesional.</h1><p>Crea documentos, controla cuentas por cobrar y trabaja con tasas BCV, euro y USDT desde el mismo sistema.</p></div><button className="heroButton" onClick={onNew}><FilePlus2 size={20}/>Crear documento</button></section>
    <section className="metrics"><Metric label="Documentos" value={String(all.length)}/><Metric label="Por cobrar · saldo real" value={pending}/><Metric label="Cobrado · movimientos" value={paid}/></section>
    <section className="card documentBoard">
      <div className="documentBoardIntro"><div><h2>Facturas y documentos</h2><p>Ahora están separados por estado para que identifiques primero lo que requiere atención y no se mezclen borradores, cuentas pendientes y documentos ya pagados.</p></div><button className="primary" onClick={onNew}><Plus size={18}/>Nuevo</button></div>
      <div className="documentTabs" role="tablist" aria-label="Estado de documentos">{tabs.map(tab => <button key={tab.key} type="button" className={statusFilter === tab.key ? 'active' : ''} onClick={() => setStatusFilter(tab.key)}><span>{tab.label}</span><b>{tab.count}</b></button>)}</div>
      <div className="documentFilterNote"><ReceiptText size={15}/><span>{statusFilter === 'all' ? 'En Resumen se muestran primero Por cobrar y Borradores; Pagadas y Anuladas quedan en bloques separados.' : `${tabs.find(tab => tab.key === statusFilter)?.label}: ${tabs.find(tab => tab.key === statusFilter)?.count || 0} documento(s) en este negocio.`}</span></div>
      <label className="search"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por cliente, número, fecha o estado…"/></label>
      {totalVisible ? <div className="documentGroups">{grouped.map(group => {
        if (!group.rows.length) return null
        const info = homeStatusInfo[group.status]
        return <section className={`documentGroup ${group.status}`} key={group.status}>
          <div className="documentGroupHead"><div className="documentGroupTitle"><span className="documentGroupMark"/><div><strong>{info.title}</strong><small>{info.hint}</small></div></div><span className="documentGroupCount">{group.rows.length} {group.rows.length === 1 ? 'documento' : 'documentos'}</span></div>
          <div className="list">{group.rows.map(invoiceRow)}</div>
        </section>
      })}</div> : <div className="empty"><ReceiptText size={34}/><h3>{search ? 'Sin resultados en esta sección' : 'No hay documentos aquí'}</h3><p>{search ? 'Prueba otro término o cambia el estado seleccionado.' : statusFilter === 'all' ? 'Crea tu primer documento para comenzar.' : `No tienes documentos en ${tabs.find(tab => tab.key === statusFilter)?.label.toLowerCase()}.`}</p>{!search && statusFilter === 'all' && <button className="primary" onClick={onNew}>Crear factura</button>}</div>}
    </section>
  </>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }

function Editor({ invoice: initial, company, clients, notify, onBack, onSaved }: { invoice: Invoice; company: Company; clients: Client[]; notify: (m: string) => void; onBack: () => void; onSaved: (i: Invoice) => void }) {
  const [invoice, setInvoice] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [rates, setRates] = useState<RateSnapshot | null>(initial.rateSnapshot || getCachedRates())
  const sum = totals(invoice)
  const equivalents = invoiceEquivalentValues(invoice, sum.total)
  const selectedConversions = invoice.conversionTargets ?? (invoice.showRateConversions ? ALL_CONVERSION_TARGETS : [])
  const availablePayments = availablePaymentMethods(company)
  const selectedPayments = invoice.paymentMethodsVisible ?? availablePayments
  useEffect(() => setInvoice(initial), [initial])
  useEffect(() => { if (!rates) void refreshRatesIfDue().then(next => next && setRates(next)) }, [rates])
  const set = <K extends keyof Invoice>(k: K, v: Invoice[K]) => setInvoice(p => ({ ...p, [k]: v }))
  const setClient = (k: keyof Invoice['client'], v: string) => setInvoice(p => ({ ...p, client: { ...p.client, [k]: v } }))
  const setItem = (id: string, patch: Partial<InvoiceItem>) => setInvoice(p => ({ ...p, items: p.items.map(x => x.id === id ? { ...x, ...patch } : x) }))

  const conversionValue = (target: ConversionTarget) => {
    if (!equivalents) return undefined
    if (target === 'VES') return equivalents.ves
    return equivalents[target]
  }
  const toggleConversion = (target: ConversionTarget) => {
    const next = selectedConversions.includes(target) ? selectedConversions.filter(item => item !== target) : [...selectedConversions, target]
    setInvoice(p => ({ ...p, conversionTargets: next, showRateConversions: next.length > 0 }))
  }
  const setAllConversions = (all: boolean) => setInvoice(p => ({ ...p, conversionTargets: all ? ALL_CONVERSION_TARGETS.filter(target => target === 'VES' || conversionValue(target) != null) : [], showRateConversions: all }))
  const togglePayment = (method: PaymentDisplay) => {
    const next = selectedPayments.includes(method) ? selectedPayments.filter(item => item !== method) : [...selectedPayments, method]
    setInvoice(p => ({ ...p, paymentMethodsVisible: next }))
  }

  async function applyRate(source: RateSource) {
    if (source === 'none') {
      setInvoice(p => ({ ...p, rateSource: 'none', rateLabel: undefined, rateValue: undefined, rateCapturedAt: undefined, rateSnapshot: undefined, showRateConversions: false, conversionTargets: [] }))
      return
    }
    if (source === 'custom') {
      setInvoice(p => ({ ...p, rateSource: 'custom', rateLabel: rateSourceLabels.custom, rateValue: p.rateValue || 1, rateCapturedAt: new Date().toISOString(), rateSnapshot: rates || undefined, conversionTargets: p.conversionTargets?.length ? p.conversionTargets : ['VES'], showRateConversions: true }))
      return
    }
    let current = rates
    if (!current) {
      try { current = await fetchLiveRates(false); setRates(current) } catch { return notify('No se pudo obtener la tasa actual. Intenta nuevamente desde Tasas.') }
    }
    const value = getRateValue(source, current)
    if (!value) return notify(`${rateSourceLabels[source]} no está disponible en este momento.`)
    setInvoice(p => ({ ...p, rateSource: source, rateLabel: rateSourceLabels[source], rateValue: value, rateCapturedAt: current?.capturedAt, rateSnapshot: current ? { ...current } : undefined, showRateConversions: true, conversionTargets: p.conversionTargets?.length ? p.conversionTargets : ['VES'] }))
  }

  async function refreshRateForInvoice() {
    if (!invoice.rateSource || invoice.rateSource === 'none' || invoice.rateSource === 'custom') return
    try {
      const current = await fetchLiveRates(true)
      setRates(current)
      const value = getRateValue(invoice.rateSource, current)
      if (!value) return notify('La tasa seleccionada no está disponible.')
      setInvoice(p => ({ ...p, rateValue: value, rateCapturedAt: current.capturedAt, rateSnapshot: { ...current } }))
      notify('Tasa de esta factura actualizada. Se congelará al guardar.')
    } catch { notify('No se pudo actualizar la tasa.') }
  }

  async function save(status?: InvoiceStatus) {
    if (!invoice.client.name.trim()) return notify('Escribe el nombre del cliente.')
    const validItems = invoice.items.filter(x => x.description.trim())
    if (!validItems.length) return notify('Agrega al menos un producto o servicio.')
    setSaving(true)
    try {
      let existing: Client | undefined
      if (invoice.client.taxId) existing = clients.find(c => c.taxId === invoice.client.taxId.trim())
      if (!existing) existing = clients.find(c => c.name.toLowerCase() === invoice.client.name.trim().toLowerCase())
      const clientPayload: Client = { ...invoice.client, companyId: company.id, id: existing?.id, createdAt: existing?.createdAt || new Date().toISOString() }
      const clientId = existing?.id ? (await db.clients.put(clientPayload), existing.id) : Number(await db.clients.add(clientPayload))
      const payload: Invoice = { ...invoice, companyId: company.id, clientId, status: status ?? invoice.status, items: validItems, updatedAt: new Date().toISOString() }
      let id = invoice.id
      if (id) await db.invoices.put(payload)
      else { id = Number(await db.invoices.add(payload)); await db.company.update(company.id, { nextInvoiceNumber: (company.nextInvoiceNumber || 1) + 1 }) }
      const saved = { ...payload, id }
      setInvoice(saved)
      onSaved(saved)
      if (saved.publicShareId) void publishPublicDocument(saved, company).catch(() => undefined)
    } finally { setSaving(false) }
  }

  function prepareInstantLink() {
    if (!invoice.id) throw new Error('Guarda el documento antes de compartirlo.')
    const shared = preparePublicDocumentShare(invoice, company)
    const source = { ...invoice, publicShareId: shared.id }
    setInvoice(source)

    // Cloud publication is intentionally background-only. The URL already carries
    // a self-contained fallback copy of the document, so Android sharing never
    // waits for Firestore and never loses the original tap/user activation.
    void publishPublicDocument(source, company, shared)
      .catch(error => console.warn('[ZiviFactura] publicación en segundo plano:', error))

    return shared
  }

  const download = () => {
    let source = invoice
    let publicUrl = ''
    if (invoice.id) {
      try {
        const shared = prepareInstantLink()
        source = { ...invoice, publicShareId: shared.id }
        publicUrl = shared.url
      } catch (error) {
        notify(error instanceof Error ? error.message : 'No se pudo preparar el enlace del PDF.')
      }
    }
    buildInvoicePdf(source, company, publicUrl).save(`${invoice.number}.pdf`)
  }

  async function copyTextSafe(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
      }
    } catch { /* use legacy fallback below */ }
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.pointerEvents = 'none'
    document.body.appendChild(area)
    area.focus()
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    if (!copied) throw new Error('No se pudo copiar automáticamente. Mantén pulsado el enlace para copiarlo.')
  }

  const share = async () => {
    if (!invoice.client.name.trim()) return notify('Completa el cliente antes de compartir.')
    try {
      const shared = prepareInstantLink()
      const message = shareDocumentMessage(invoice, shared.url, shared.total)

      if (navigator.share) {
        try {
          await navigator.share({
            title: `${invoice.type} ${invoice.number}`,
            text: message,
            url: shared.url,
          })
          return
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return
        }
      }

      await copyTextSafe(message)
      notify('Enlace copiado. Ya puedes enviarlo al cliente.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo compartir el enlace.')
    }
  }

  const whatsapp = () => {
    if (!invoice.client.name.trim()) return notify('Completa el cliente antes de compartir.')
    try {
      const shared = prepareInstantLink()
      const message = shareDocumentMessage(invoice, shared.url, shared.total)
      const phone = invoice.client.phone.replace(/\D/g, '')
      const target = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`

      // Navigation happens synchronously in the same tap; no about:blank bridge.
      window.location.href = target
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo preparar WhatsApp.')
    }
  }

  const email = () => {
    if (!invoice.client.email.trim()) return notify('Agrega el correo del cliente antes de preparar el correo.')
    try {
      const shared = prepareInstantLink()
      const message = shareDocumentMessage(invoice, shared.url, shared.total)
      window.location.href = `mailto:${invoice.client.email}?subject=${encodeURIComponent(`${invoice.type} ${invoice.number}`)}&body=${encodeURIComponent(`${message}\n\nSaludos.`)}`
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo preparar el correo.')
    }
  }

  const conversionOptions: Array<{ key: ConversionTarget; label: string }> = [
    { key: 'VES', label: 'Bolívares (VES)' },
    { key: 'USD', label: 'Dólar BCV' },
    { key: 'EUR', label: 'Euro BCV' },
    { key: 'USDT_BINANCE', label: 'USDT Binance' },
    { key: 'USDT_AVERAGE', label: 'USDT promedio' },
  ]
  const paymentOptions: Array<{ key: PaymentDisplay; label: string }> = [
    { key: 'mobile', label: 'Pago móvil' },
    { key: 'bank', label: 'Cuenta bancaria' },
    { key: 'binance', label: 'Binance / digital' },
    { key: 'notes', label: 'Instrucciones adicionales' },
  ].filter(option => availablePayments.includes(option.key))

  return <div className="editorGrid">
    <section className="editorMain">
      <div className="editorHead"><button className="back" onClick={onBack}>← Volver</button><div><span>DOCUMENTO</span><h1>{invoice.number}</h1></div><span className={`status ${invoice.status}`}>{labels[invoice.status]}</span></div>
      <section className="card formCard"><h2>1. Datos del documento</h2><div className="grid4">
        <Field label="Tipo"><select value={invoice.type} onChange={e => set('type', e.target.value as Invoice['type'])}><option>Factura</option><option>Proforma</option><option>Presupuesto</option></select></Field>
        <Field label="Número"><input value={invoice.number} onChange={e => set('number', e.target.value)}/></Field>
        <Field label="Fecha"><input type="date" value={invoice.date} onChange={e => set('date', e.target.value)}/></Field>
        <Field label="Estado"><select value={invoice.status} onChange={e => set('status', e.target.value as InvoiceStatus)}><option value="draft">Borrador</option><option value="issued">Por cobrar</option><option value="paid">Pagada</option><option value="cancelled">Anulada</option></select></Field>
      </div></section>
      <section className="card formCard"><h2>2. Cliente</h2>{clients.length > 0 && <Field label="Cliente guardado"><select defaultValue="" onChange={e => { const c = clients.find(x => String(x.id) === e.target.value); if (c) setInvoice(p => ({ ...p, clientId: c.id, client: { name: c.name, taxId: c.taxId, phone: c.phone, email: c.email, address: c.address } })) }}><option value="">Seleccionar…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <div className="grid2"><Field label="Nombre / razón social"><input value={invoice.client.name} onChange={e => setClient('name', e.target.value)}/></Field><Field label="RIF / RUC / C.I."><input value={invoice.client.taxId} onChange={e => setClient('taxId', e.target.value)}/></Field><Field label="Teléfono"><input value={invoice.client.phone} onChange={e => setClient('phone', e.target.value)} placeholder="Incluye código de país"/></Field><Field label="Correo"><input type="email" value={invoice.client.email} onChange={e => setClient('email', e.target.value)}/></Field><Field label="Dirección" wide><input value={invoice.client.address} onChange={e => setClient('address', e.target.value)}/></Field></div>
      </section>
      <section className="card formCard"><h2>3. Productos o servicios</h2><p className="sectionHint">Cantidad y precio unitario están separados para evitar errores al facturar desde el teléfono.</p><div className="items"><div className="itemLabels"><span>Descripción</span><span>Cantidad</span><span>Precio unitario</span><span>Total</span><span></span></div>{invoice.items.map(item => <div className="item" key={item.id}>
        <label className="itemField descriptionField"><span>Descripción</span><input value={item.description} onChange={e => setItem(item.id, { description: e.target.value })} placeholder="Producto o servicio"/></label>
        <label className="itemField quantityField"><span>Cantidad</span><NumericInput label="Cantidad" value={item.quantity} onChange={value => setItem(item.id, { quantity: value })}/></label>
        <label className="itemField priceField"><span>Precio unitario</span><NumericInput label="Precio unitario" value={item.unitPrice} onChange={value => setItem(item.id, { unitPrice: value })}/></label>
        <div className="itemTotal"><span>Total</span><strong>{money(item.quantity * item.unitPrice, invoice.currency)}</strong></div>
        <button className="danger icon itemDelete" title="Eliminar línea" disabled={invoice.items.length === 1} onClick={() => set('items', invoice.items.filter(x => x.id !== item.id))}><Trash2 size={17}/></button>
      </div>)}</div><button className="secondary add" onClick={() => set('items', [...invoice.items, { id: uid(), description: '', quantity: 1, unitPrice: 0 }])}><Plus size={18}/>Agregar línea</button></section>
      <section className="card formCard"><h2>4. Pago, tasa y notas</h2><div className="grid2"><Field label="Forma de pago"><input value={invoice.paymentMethod} onChange={e => set('paymentMethod', e.target.value)} placeholder="Efectivo, transferencia, pago móvil…"/></Field><Field label="Moneda del documento"><select value={invoice.currency} onChange={e => set('currency', e.target.value)}><option>USD</option><option>EUR</option><option>VES</option><option>USDT</option><option>COP</option></select></Field><Field label="Descuento"><NumericInput label="Descuento" value={invoice.discount} onChange={value => set('discount', value)}/></Field><Field label="IVA / impuesto %"><NumericInput label="IVA / impuesto" value={invoice.taxRate} onChange={value => set('taxRate', value)}/></Field><Field label="Observaciones" wide><textarea rows={3} value={invoice.notes} onChange={e => set('notes', e.target.value)}/></Field></div>
        <div className="rateControls"><div className="rateControlsHead"><div><strong>Tasa de cobro / conversión</strong><small>La tasa queda congelada al guardar el documento.</small></div>{invoice.rateSource && invoice.rateSource !== 'none' && invoice.rateSource !== 'custom' && <button className="secondary" onClick={refreshRateForInvoice}>Actualizar tasa</button>}</div>
          <div className="grid2"><Field label="Referencia"><select value={invoice.rateSource || 'none'} onChange={e => void applyRate(e.target.value as RateSource)}><option value="none">Sin tasa de conversión</option><option value="bcv_usd">BCV dólar</option><option value="bcv_eur">BCV euro</option><option value="binance">Binance P2P / USDT</option><option value="usdt_average">Promedio USDT P2P</option><option value="custom">Tasa personalizada</option></select></Field>{invoice.rateSource === 'custom' && <Field label="Tasa personalizada (Bs por unidad)"><NumericInput label="Tasa personalizada" value={invoice.rateValue || 0} onChange={value => setInvoice(p => ({ ...p, rateValue: value, rateCapturedAt: new Date().toISOString() }))}/></Field>}</div>
          {invoice.rateSource && invoice.rateSource !== 'none' && <div className="ratePreview"><div><span>Tasa aplicada</span><strong>{invoice.rateLabel || rateSourceLabels[invoice.rateSource]} · {formatRate(invoice.rateValue)}</strong></div>{equivalents?.ves != null && <div><span>Equivalente base</span><strong>{money(equivalents.ves, 'VES')}</strong></div>}{invoice.rateCapturedAt && <div><span>Capturada</span><strong>{new Date(invoice.rateCapturedAt).toLocaleString('es-VE')}</strong></div>}</div>}
          {invoice.rateSource && invoice.rateSource !== 'none' && <div className="pdfChoiceBlock"><div className="pdfChoiceHead"><div><strong>Equivalentes visibles en el PDF</strong><small>Marca solo las monedas que quieres que vea este cliente.</small></div><div className="miniActions"><button type="button" onClick={() => setAllConversions(true)}>Todos</button><button type="button" onClick={() => setAllConversions(false)}>Ninguno</button></div></div><div className="choiceGrid">{conversionOptions.map(option => { const unavailable = option.key !== 'VES' && conversionValue(option.key) == null; return <label className={`choiceChip ${unavailable ? 'disabled' : ''}`} key={option.key}><input type="checkbox" disabled={unavailable} checked={selectedConversions.includes(option.key)} onChange={() => toggleConversion(option.key)}/><span><strong>{option.label}</strong><small>{unavailable ? 'No disponible' : conversionValue(option.key) != null ? (option.key.startsWith('USDT') ? `${Number(conversionValue(option.key)).toLocaleString('es-VE', { maximumFractionDigits: 2 })} USDT` : money(Number(conversionValue(option.key)), option.key)) : ''}</small></span></label>})}</div></div>}
        </div>
        <div className="pdfChoiceBlock paymentChoices"><div className="pdfChoiceHead"><div><strong>Métodos de pago visibles</strong><small>Estos datos aparecerán tanto en el PDF como en el enlace que recibe el cliente.</small></div>{paymentOptions.length > 0 && <div className="miniActions"><button type="button" onClick={() => setInvoice(p => ({ ...p, paymentMethodsVisible: [...availablePayments] }))}>Todos</button><button type="button" onClick={() => setInvoice(p => ({ ...p, paymentMethodsVisible: [] }))}>Ninguno</button></div>}</div>{paymentOptions.length > 0 ? <div className="choiceGrid paymentGrid">{paymentOptions.map(option => <label className="choiceChip" key={option.key}><input type="checkbox" checked={selectedPayments.includes(option.key)} onChange={() => togglePayment(option.key)}/><span><strong>{option.label}</strong><small>{option.key === 'mobile' ? company.mobilePaymentBank || 'Configurado' : option.key === 'bank' ? company.bankName || 'Configurado' : option.key === 'binance' ? 'Pay ID / digital' : 'Texto adicional'}</small></span></label>)}</div> : <p className="emptyChoice">No hay métodos configurados. Agrégalos en Configuración → Datos de cobro.</p>}</div>
      </section>
    </section>
    <aside className="summary card"><span>RESUMEN</span><Line label="Subtotal" value={money(sum.subtotal, invoice.currency)}/><Line label="Descuento" value={`- ${money(sum.discount, invoice.currency)}`}/><Line label={`Impuesto ${invoice.taxRate}%`} value={money(sum.tax, invoice.currency)}/><div className="total"><span>Total</span><strong>{money(sum.total, invoice.currency)}</strong></div>{invoice.rateValue && equivalents?.ves != null && <Line label={invoice.rateLabel || 'Equivalente'} value={money(equivalents.ves, 'VES')}/>} {invoice.id ? <button className="primary full" disabled={saving} onClick={() => save()}><Save size={18}/>{saving ? 'Guardando…' : 'Guardar cambios'}</button> : <button className="primary full" disabled={saving} onClick={() => save('issued')}><Check size={18}/>{saving ? 'Guardando…' : 'Guardar y emitir'}</button>}{invoice.status === 'issued' && <button className="secondary full" disabled={saving} onClick={() => save('paid')}><Check size={18}/>Marcar como pagada</button>}<button className="secondary full" disabled={saving} onClick={() => save('draft')}><Save size={18}/>Guardar borrador</button><hr/><button className="secondary full" onClick={share}><Share2 size={18}/>Compartir enlace</button><button className="secondary full whatsapp" onClick={whatsapp}><Send size={18}/>Enviar link por WhatsApp</button><button className="secondary full" onClick={() => void email()}><Mail size={18}/>Preparar correo con link</button><button className="ghost full" onClick={download}><Download size={18}/>Descargar PDF</button><small>El enlace abre una página donde el cliente revisa el documento, copia los datos, paga, sube el voucher y puede descargar su PDF.</small></aside>
  </div>
}

function parseFlexibleNumber(raw: string) {
  let value = raw.trim().replace(/\s/g, '').replace(/[^0-9,.-]/g, '')
  if (!value) return NaN
  const lastComma = value.lastIndexOf(',')
  const lastDot = value.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) { const decimal = lastComma > lastDot ? ',' : '.'; value = value.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.') }
  else if (lastComma >= 0) { const parts = value.split(','); value = parts.length > 2 ? parts.join('') : `${parts[0]}.${parts[1] ?? ''}` }
  else if (lastDot >= 0) { const parts = value.split('.'); if (parts.length > 2 || (parts[1]?.length === 3 && parts[0].length >= 1)) value = parts.join('') }
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : NaN
}

function NumericInput({ value, onChange, min = 0, step = '0.01', label = 'Valor numérico' }: { value: number; onChange: (value: number) => void; min?: number; step?: string; label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { if (document.activeElement !== inputRef.current) setDraft(String(value)) }, [value])
  const commit = (raw: string) => { const parsed = parseFlexibleNumber(raw); const next = raw.trim() === '' || !Number.isFinite(parsed) ? min : Math.max(min, parsed); onChange(next); setDraft(String(next)) }
  return <input ref={inputRef} type="text" inputMode="decimal" value={draft} onFocus={() => { if (parseFlexibleNumber(draft) === 0) setDraft('') }} onPaste={e => { e.preventDefault(); const pasted = e.clipboardData.getData('text'); setDraft(pasted); const parsed = parseFlexibleNumber(pasted); if (Number.isFinite(parsed)) onChange(Math.max(min, parsed)) }} onChange={e => { const raw = e.target.value; setDraft(raw); if (raw.trim() === '') return; const parsed = parseFlexibleNumber(raw); if (Number.isFinite(parsed)) onChange(Math.max(min, parsed)) }} onBlur={() => commit(draft)} aria-label={label} placeholder={label} data-step={step}/>
}

function Line({ label, value }: { label: string; value: string }) { return <div className="line"><span>{label}</span><strong>{value}</strong></div> }
function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label> }

function SettingsView({ company, installPrompt, notify, onChanged, onInstalled }: { company: Company; installPrompt: InstallPrompt | null; notify: (m: string) => void; onChanged: () => void; onInstalled: () => void }) {
  const [form, setForm] = useState<Company>({ ...defaultCompany, ...company })
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => setForm({ ...defaultCompany, ...company }), [company])
  async function save() { await db.company.put({ ...defaultCompany, ...form, id: company.id, nextInvoiceNumber: Math.max(1, Number(form.nextInvoiceNumber) || 1), defaultTaxRate: Math.max(0, Number(form.defaultTaxRate) || 0) }); await onChanged(); notify('Configuración del negocio guardada.') }
  function logo(file?: File) { if (!file) return; if (!file.type.startsWith('image/')) return notify('Selecciona un archivo de imagen válido.'); if (file.size > MAX_LOGO_BYTES) return notify('Usa un logo de hasta 10 MB.'); const r = new FileReader(); r.onload = () => { setForm(p => ({ ...p, logoDataUrl: String(r.result) })); notify('Logo cargado.') }; r.readAsDataURL(file) }
  async function backup() { const data = await exportBackup(); const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `zivifactura-backup-${today()}.json`; a.click(); URL.revokeObjectURL(u); notify('Respaldo exportado.') }
  async function restore(file?: File) { if (!file) return; try { const data = JSON.parse(await file.text()) as BackupData; if (!confirm('Esto reemplazará los datos locales actuales. ¿Continuar?')) return; await importBackup(data); await onChanged(); notify('Respaldo restaurado.') } catch { notify('El archivo de respaldo no es válido.') } }
  async function install() { if (!installPrompt) return notify('Usa “Agregar a pantalla de inicio” desde el menú del navegador.'); await installPrompt.prompt(); await installPrompt.userChoice; onInstalled() }
  async function persist() { if (!navigator.storage?.persist) return notify('Este navegador no ofrece esta función.'); notify(await navigator.storage.persist() ? 'Almacenamiento persistente activado.' : 'El navegador no concedió persistencia.') }

  return <div className="settingsGrid"><section className="card formCard"><div className="cardHead"><div><h1>Configuración de {company.name || 'negocio'}</h1><p>Cada negocio conserva su identidad, numeración y datos de cobro por separado.</p></div></div><div className="logoRow"><div className="logoPreview">{form.logoDataUrl ? <img src={form.logoDataUrl} alt="Logo"/> : <ReceiptText size={30}/>}</div><label className="secondary file"><Upload size={18}/>Subir logo<input type="file" accept="image/*" onChange={e => logo(e.target.files?.[0])}/></label><small>PNG, JPG o imagen compatible · máximo 10 MB</small></div><div className="grid2"><Field label="Empresa / negocio"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="RIF / RUC"><input value={form.taxId} onChange={e => setForm({ ...form, taxId: e.target.value })}/></Field><Field label="Teléfono"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></Field><Field label="Correo"><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></Field><Field label="Dirección" wide><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}/></Field><Field label="Ciudad"><input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/></Field><Field label="Moneda"><select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}><option>USD</option><option>EUR</option><option>VES</option><option>USDT</option><option>COP</option></select></Field><Field label="Impuesto predeterminado %"><NumericInput label="Impuesto predeterminado" value={form.defaultTaxRate} onChange={value => setForm({ ...form, defaultTaxRate: value })}/></Field><Field label="Prefijo"><input value={form.prefix} onChange={e => setForm({ ...form, prefix: e.target.value.toUpperCase().slice(0, 8) })}/></Field><Field label="Próximo número"><NumericInput label="Próximo número" value={form.nextInvoiceNumber} min={1} step="1" onChange={value => setForm({ ...form, nextInvoiceNumber: Math.round(value) })}/></Field></div>
      <div className="settingsSection"><div className="sectionTitle"><span>DATOS DE COBRO</span><h2>Información para recibir pagos</h2><p>Completa únicamente los métodos que utiliza este negocio. El cliente los verá en su enlace de pago y en el PDF.</p></div>
        <div className="paymentGroup"><h3>Pago móvil</h3><div className="grid2"><Field label="Banco"><input value={form.mobilePaymentBank || ''} onChange={e => setForm({ ...form, mobilePaymentBank: e.target.value })} placeholder="Ej. Banesco"/></Field><Field label="Teléfono"><input value={form.mobilePaymentPhone || ''} onChange={e => setForm({ ...form, mobilePaymentPhone: e.target.value })} placeholder="0412..."/></Field><Field label="Cédula / RIF" wide><input value={form.mobilePaymentId || ''} onChange={e => setForm({ ...form, mobilePaymentId: e.target.value })}/></Field></div></div>
        <div className="paymentGroup"><h3>Cuenta bancaria</h3><div className="grid2"><Field label="Banco"><input value={form.bankName || ''} onChange={e => setForm({ ...form, bankName: e.target.value })}/></Field><Field label="Tipo de cuenta"><input value={form.bankAccountType || ''} onChange={e => setForm({ ...form, bankAccountType: e.target.value })} placeholder="Corriente / Ahorro"/></Field><Field label="Número de cuenta" wide><input value={form.bankAccountNumber || ''} onChange={e => setForm({ ...form, bankAccountNumber: e.target.value })}/></Field><Field label="Titular" wide><input value={form.bankAccountHolder || ''} onChange={e => setForm({ ...form, bankAccountHolder: e.target.value })}/></Field></div></div>
        <div className="paymentGroup"><h3>Binance / pagos digitales</h3><div className="grid2"><Field label="Binance Pay ID / correo" wide><input value={form.binanceId || ''} onChange={e => setForm({ ...form, binanceId: e.target.value })} placeholder="Pay ID, correo o identificador"/></Field><Field label="Instrucciones adicionales" wide><textarea rows={3} value={form.paymentNotes || ''} onChange={e => setForm({ ...form, paymentNotes: e.target.value })} placeholder="Zelle, USDT, referencia, instrucciones para el cliente…"/></Field></div></div>
      </div><button className="primary saveSettings" onClick={save}><Save size={18}/>Guardar configuración</button></section>
    <aside className="tools"><section className="card tool"><ArchiveRestore/><h2>Copia de seguridad</h2><p>Exporta todos tus negocios, facturas, clientes y cobros a un archivo JSON.</p><button className="secondary full" onClick={backup}><Download size={18}/>Exportar respaldo</button><button className="secondary full" onClick={() => fileRef.current?.click()}><ArchiveRestore size={18}/>Restaurar respaldo</button><input ref={fileRef} hidden type="file" accept="application/json" onChange={e => restore(e.target.files?.[0])}/></section><section className="card tool"><Download/><h2>Instalar PWA</h2><p>Agrega la aplicación a la pantalla de inicio y úsala como una app.</p><button className="primary full" onClick={install}><Download size={18}/>Instalar</button></section><section className="card tool"><Save/><h2>Conservar datos</h2><p>Solicita prioridad para que el navegador no elimine el almacenamiento local automáticamente.</p><button className="secondary full" onClick={persist}><Check size={18}/>Solicitar persistencia</button></section></aside>
  </div>
}
