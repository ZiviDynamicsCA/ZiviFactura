import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Calculator, Copy, DollarSign, FilePlus2, MoreHorizontal, ReceiptText, RefreshCw, Settings, Wallet, WalletCards, X } from 'lucide-react'
import { bcvAverageRate, fetchLiveRates, getCachedRates, refreshRatesIfDue, type LiveRates } from './rates'
import './quick-tools.css'
import './quick-mobile-fixes.css'

type WorkspaceKey = 'billing' | 'receivables' | 'payments' | 'income' | 'stats'
type CalcCurrency = 'USD' | 'VES' | 'EUR' | 'BCV_AVERAGE' | 'USDT'

const workspaceOrder: WorkspaceKey[] = ['billing', 'receivables', 'payments', 'income', 'stats']
const calcCurrencies: CalcCurrency[] = ['USD', 'VES', 'EUR', 'BCV_AVERAGE', 'USDT']
const keypad = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '-', '0', ',', '%', '+', '⌫', '(', ')', '=']

function normalizeExpression(raw: string) {
  return raw.replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '')
}

function evaluateExpression(raw: string): number | null {
  const source = normalizeExpression(raw)
  if (!source) return null
  let index = 0

  const peek = () => source[index]
  const consume = () => source[index++]

  function parseNumber() {
    const start = index
    let dots = 0
    while (index < source.length && /[0-9.]/.test(peek())) {
      if (peek() === '.') dots += 1
      if (dots > 1) throw new Error('Número inválido')
      index += 1
    }
    if (start === index) throw new Error('Número esperado')
    const value = Number(source.slice(start, index))
    if (!Number.isFinite(value)) throw new Error('Número inválido')
    return value
  }

  function parseFactor(): number {
    if (peek() === '+') { consume(); return parseFactor() }
    if (peek() === '-') { consume(); return -parseFactor() }
    let value: number
    if (peek() === '(') {
      consume()
      value = parseExpressionLevel()
      if (consume() !== ')') throw new Error('Paréntesis incompleto')
    } else value = parseNumber()
    while (peek() === '%') { consume(); value /= 100 }
    return value
  }

  function parseTerm(): number {
    let value = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = consume()
      const right = parseFactor()
      value = op === '*' ? value * right : right === 0 ? NaN : value / right
    }
    return value
  }

  function parseExpressionLevel(): number {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = consume()
      const right = parseTerm()
      value = op === '+' ? value + right : value - right
    }
    return value
  }

  try {
    const result = parseExpressionLevel()
    if (index !== source.length || !Number.isFinite(result)) return null
    return result
  } catch {
    return null
  }
}

function parseInputNumber(raw: string) {
  const value = normalizeExpression(raw).replace(/[^0-9.-]/g, '')
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function locale(value: number, digits = 2) {
  return Number(value).toLocaleString('es-VE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function plain(value: number, digits = 2) {
  return Number(value).toLocaleString('es-VE', { useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function currencyButtonLabel(currency: CalcCurrency) {
  if (currency === 'BCV_AVERAGE') return 'BCV prom.'
  return currency
}

function formatValue(value: number, currency: CalcCurrency) {
  if (!Number.isFinite(value)) return 'N/D'
  if (currency === 'VES') return `Bs ${locale(value)}`
  if (currency === 'BCV_AVERAGE') return `${locale(value)} BCV prom.`
  return `${locale(value)} ${currency}`
}

async function copyNumber(value: number) {
  const text = plain(value)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function rateForCurrency(currency: CalcCurrency, rates: LiveRates | null) {
  if (currency === 'VES') return 1
  if (currency === 'USD') return Number(rates?.usdBcv) || 0
  if (currency === 'EUR') return Number(rates?.eurBcv) || 0
  if (currency === 'BCV_AVERAGE') return bcvAverageRate(rates)
  return Number(rates?.usdtAverage || rates?.binanceBuy) || 0
}

function rateName(currency: CalcCurrency) {
  if (currency === 'USD') return 'BCV dólar'
  if (currency === 'EUR') return 'BCV euro'
  if (currency === 'BCV_AVERAGE') return 'Promedio BCV USD/EUR'
  if (currency === 'USDT') return 'USDT promedio'
  return 'VES'
}

function convert(value: number, from: CalcCurrency, to: CalcCurrency, rates: LiveRates | null) {
  if (!Number.isFinite(value)) return null
  if (from === to) return value
  const fromRate = rateForCurrency(from, rates)
  const toRate = rateForCurrency(to, rates)
  if (!fromRate || !toRate) return null
  const ves = from === 'VES' ? value : value * fromRate
  return to === 'VES' ? ves : ves / toRate
}

function detectInvoiceCurrency(): CalcCurrency {
  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('.editorGrid select, .editorMain select'))
  const currencySelect = selects.find(select => {
    const values = Array.from(select.options).map(option => option.value)
    return values.includes('USD') && values.includes('VES') && values.includes('EUR')
  })
  const value = currencySelect?.value as CalcCurrency | undefined
  return value && calcCurrencies.includes(value) ? value : 'USD'
}

function setReactInputValue(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, String(Number(value.toFixed(6))))
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function clickWorkspace(workspace: WorkspaceKey) {
  const nav = document.querySelector('.workspaceNav')
  if (!nav) return
  const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'))
  const index = workspaceOrder.indexOf(workspace)
  buttons[index]?.click()
}

function clickAppMode(label: 'Inicio' | 'Tasas' | 'Configuración') {
  clickWorkspace('billing')
  window.setTimeout(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.top nav button'))
    buttons.find(button => button.textContent?.includes(label))?.click()
  }, 40)
}

function clickNewDocument() {
  clickWorkspace('billing')
  window.setTimeout(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>('.top > .primary, .heroButton, .documentBoardIntro .primary'))
    candidates.find(button => /nueva|nuevo|crear/i.test(button.textContent || ''))?.click()
  }, 60)
}

export default function QuickTools() {
  const [available, setAvailable] = useState(false)
  const [inEditor, setInEditor] = useState(false)
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKey>('billing')
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [expression, setExpression] = useState('')
  const [currency, setCurrency] = useState<CalcCurrency>('USD')
  const [rates, setRates] = useState<LiveRates | null>(getCachedRates())
  const [loadingRates, setLoadingRates] = useState(false)
  const [contextTitle, setContextTitle] = useState('Calculadora rápida')
  const [contextInput, setContextInput] = useState<HTMLInputElement | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)

  const result = useMemo(() => evaluateExpression(expression), [expression])
  const isPriceCalculator = Boolean(contextInput)
  const previewCurrency: CalcCurrency = currency === 'VES' ? 'USD' : 'VES'
  const previewValue = result == null ? null : convert(result, currency, previewCurrency, rates)
  const valueToApply = isPriceCalculator ? previewValue : result
  const primaryLabel = previewCurrency === 'VES' ? 'Conversión que se aplicará en precio unitario' : 'Conversión que se aplicará en precio unitario'
  const sourceRate = rateForCurrency(currency, rates)
  const primaryMeta = result != null
    ? previewValue == null
      ? 'Actualiza las tasas para poder mostrar y aplicar la conversión.'
      : isPriceCalculator
        ? `Monto escrito: ${formatValue(result, currency)} · ${rateName(currency)} ${currency === 'VES' ? '' : sourceRate ? `${locale(sourceRate)} Bs` : 'no disponible'}`
        : `Base: ${formatValue(result, currency)} · ${rateName(currency)} ${currency === 'VES' ? '' : sourceRate ? `${locale(sourceRate)} Bs` : 'no disponible'}`
    : ''

  const equivalents = useMemo(() => {
    if (result == null) return [] as Array<{ currency: CalcCurrency; value: number }>
    return calcCurrencies
      .map(target => {
        const value = convert(result, currency, target, rates)
        return value == null ? null : { currency: target, value }
      })
      .filter(Boolean) as Array<{ currency: CalcCurrency; value: number }>
  }, [result, currency, rates])

  useEffect(() => {
    const sync = () => {
      const nav = document.querySelector('.workspaceNav')
      const editor = document.querySelector('.editorGrid')
      const nextAvailable = Boolean(nav)
      const nextInEditor = Boolean(editor)
      setAvailable(nextAvailable)
      setInEditor(nextInEditor)
      document.body.classList.toggle('quick-nav-active', nextAvailable)
      document.body.classList.toggle('quick-editor-active', nextInEditor)

      if (nav) {
        const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'))
        const index = buttons.findIndex(button => button.classList.contains('active'))
        if (index >= 0 && workspaceOrder[index]) setActiveWorkspace(workspaceOrder[index])
      }

      document.querySelectorAll<HTMLElement>('.priceField').forEach(field => {
        if (field.querySelector('.inlineCalcButton')) return
        const input = field.querySelector<HTMLInputElement>('input')
        if (!input) return
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'inlineCalcButton'
        button.title = 'Convertir precio sin salir de la factura'
        button.setAttribute('aria-label', 'Abrir calculadora para convertir este precio')
        button.textContent = '🧮'
        button.addEventListener('click', event => {
          event.preventDefault()
          event.stopPropagation()
          const parsed = parseInputNumber(input.value)
          setContextInput(input)
          setContextTitle('Calculadora de precio')
          setCurrency(detectInvoiceCurrency())
          setExpression(parsed > 0 ? String(parsed).replace('.', ',') : '')
          setMoreOpen(false)
          setCalculatorOpen(true)
        })
        field.appendChild(button)
      })
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    observerRef.current = observer
    return () => {
      observer.disconnect()
      observerRef.current = null
      document.body.classList.remove('quick-nav-active', 'quick-editor-active')
    }
  }, [])

  useEffect(() => {
    if (!calculatorOpen) return
    void refreshRatesIfDue().then(next => { if (next) setRates(next) })
  }, [calculatorOpen])

  async function refreshRates() {
    setLoadingRates(true)
    try {
      const next = await fetchLiveRates(true)
      setRates(next)
    } finally {
      setLoadingRates(false)
    }
  }

  function openGlobalCalculator() {
    setContextInput(null)
    setContextTitle('Calculadora y tasas')
    setExpression('')
    setCurrency('USD')
    setMoreOpen(false)
    setCalculatorOpen(true)
  }

  function navigate(workspace: WorkspaceKey) {
    closeSheets()
    clickWorkspace(workspace)
    if (workspace === 'billing') window.setTimeout(() => clickAppMode('Inicio'), 10)
    window.setTimeout(() => setActiveWorkspace(workspace), 80)
  }

  function append(value: string) {
    setExpression(current => `${current}${value}`)
  }

  function closeSheets() {
    setCalculatorOpen(false)
    setMoreOpen(false)
    setContextInput(null)
  }

  function applyResult() {
    if (valueToApply == null || !contextInput) return
    setReactInputValue(contextInput, valueToApply)
    closeSheets()
  }

  if (!available && !calculatorOpen) return null

  const rateRows = [
    { label: 'BCV dólar', value: Number(rates?.usdBcv) || 0 },
    { label: 'BCV euro', value: Number(rates?.eurBcv) || 0 },
    { label: 'Promedio BCV USD/EUR', value: bcvAverageRate(rates) },
    { label: 'USDT Binance', value: Number(rates?.binanceBuy) || 0 },
    { label: 'USDT promedio', value: Number(rates?.usdtAverage) || 0 },
  ].filter(row => row.value > 0)

  return <>
    {(calculatorOpen || moreOpen) && <button className="quickBackdrop" aria-label="Cerrar panel rápido" onClick={closeSheets}/>} 

    {calculatorOpen && <section className="quickCalculatorSheet" aria-label="Calculadora rápida">
      <div className="quickSheetHandle"/>
      <header className="quickSheetHead">
        <div><span>HERRAMIENTA RÁPIDA</span><h2>{contextTitle}</h2><p>{isPriceCalculator ? 'Escribe con el teclado interno, revisa la conversión y aplícala directamente al precio unitario.' : 'Calcula, convierte con tasas actuales y copia resultados.'}</p></div>
        <button type="button" onClick={closeSheets} aria-label="Cerrar calculadora"><X size={20}/></button>
      </header>

      <div className="quickCalcWorkspace">
        <div className="quickCalcMain">
          <label className="quickExpression">
            <span>Operación</span>
            <input readOnly inputMode="none" aria-readonly="true" value={expression} onFocus={event => event.currentTarget.blur()} onPointerDown={event => event.preventDefault()} placeholder="Usa los botones de la calculadora"/>
          </label>
          <div className="quickResult"><span>{isPriceCalculator ? primaryLabel : (previewCurrency === 'VES' ? 'Equivalente en bolívares' : 'Equivalente en dólares')}</span><strong>{previewValue == null ? '—' : formatValue(previewValue, previewCurrency)}</strong><button type="button" disabled={previewValue == null} onClick={() => previewValue != null && void copyNumber(previewValue)}><Copy size={16}/>Copiar</button>{primaryMeta && <small className="quickResultMeta">{primaryMeta}</small>}</div>
          {isPriceCalculator && result != null && <div className="quickSourceResult"><span>Monto escrito / resultado original</span><strong>{formatValue(result, currency)}</strong></div>}
          <div className="quickCurrencyRow"><span>Moneda del cálculo</span><div>{calcCurrencies.map(item => <button type="button" className={currency === item ? 'active' : ''} key={item} onClick={() => setCurrency(item)}>{currencyButtonLabel(item)}</button>)}</div></div>
          <div className="quickKeypad">
            {keypad.map(key => <button type="button" key={key} className={['÷', '×', '-', '+', '='].includes(key) ? 'operator' : ''} onClick={() => {
              if (key === '⌫') return setExpression(current => current.slice(0, -1))
              if (key === '=') return result != null ? setExpression(String(Number(result.toFixed(8))).replace('.', ',')) : undefined
              append(key)
            }}>{key}</button>)}
          </div>
          {isPriceCalculator && <button type="button" className="quickApply" disabled={valueToApply == null} onClick={applyResult}><Calculator size={18}/>Usar conversión como precio unitario</button>}
        </div>

        <aside className="quickRates">
          <div className="quickRatesHead"><div><span>TASAS ACTUALES</span><strong>Consulta y copia</strong></div><button type="button" disabled={loadingRates} onClick={() => void refreshRates()} title="Actualizar tasas"><RefreshCw size={17} className={loadingRates ? 'spin' : ''}/></button></div>
          <div className="quickRateList">{rateRows.length ? rateRows.map(row => <button type="button" key={row.label} onClick={() => void copyNumber(row.value)}><span>{row.label}</span><strong>{locale(row.value)} Bs</strong><Copy size={14}/></button>) : <p>No hay tasas disponibles. Pulsa actualizar.</p>}</div>
          {result != null && <div className="quickEquivalentBlock"><span>EQUIVALENTES DEL RESULTADO</span>{equivalents.filter(item => item.currency !== currency).map(item => <button type="button" key={item.currency} onClick={() => void copyNumber(item.value)}><span>{currencyButtonLabel(item.currency)}</span><strong>{formatValue(item.value, item.currency)}</strong><Copy size={14}/></button>)}</div>}
        </aside>
      </div>
    </section>}

    {!inEditor && moreOpen && <section className="quickMoreSheet">
      <div className="quickSheetHandle"/>
      <header><div><span>MÁS HERRAMIENTAS</span><h2>Administración y configuración</h2></div><button type="button" onClick={closeSheets} aria-label="Cerrar"><X size={19}/></button></header>
      <div className="quickMoreGrid">
        <button type="button" onClick={() => { setMoreOpen(false); navigate('stats') }}><BarChart3/><span><strong>Estadísticas</strong><small>Distribución y métodos de pago</small></span></button>
        <button type="button" onClick={() => { setMoreOpen(false); clickAppMode('Configuración') }}><Settings/><span><strong>Configuración</strong><small>Datos del negocio y cobro</small></span></button>
        <button type="button" onClick={() => { setMoreOpen(false); clickAppMode('Tasas') }}><Calculator/><span><strong>Panel de tasas</strong><small>Vista completa de BCV y USDT</small></span></button>
        <button type="button" onClick={() => { setMoreOpen(false); document.querySelector<HTMLButtonElement>('.businessSwitcher button')?.click() }}><FilePlus2/><span><strong>Agregar negocio</strong><small>Otra empresa o emprendimiento</small></span></button>
      </div>
    </section>}

    {!inEditor && <nav className="quickDock" aria-label="Navegación principal">
      <button type="button" className={activeWorkspace === 'billing' && !calculatorOpen && !moreOpen ? 'active' : ''} onClick={() => navigate('billing')}><ReceiptText/><span>Inicio</span></button>
      <button type="button" className={activeWorkspace === 'receivables' && !calculatorOpen && !moreOpen ? 'active' : ''} onClick={() => navigate('receivables')}><DollarSign/><span>Por cobrar</span></button>
      <button type="button" className={activeWorkspace === 'payments' && !calculatorOpen && !moreOpen ? 'active' : ''} onClick={() => navigate('payments')}><WalletCards/><span>Cobros</span></button>
      <button type="button" className="quickDockCreate" onClick={clickNewDocument}><FilePlus2/><span>Nueva</span></button>
      <button type="button" className={activeWorkspace === 'income' && !calculatorOpen && !moreOpen ? 'active' : ''} onClick={() => navigate('income')}><Wallet/><span>Ingresos</span></button>
      <button type="button" className={calculatorOpen ? 'active tool' : 'tool'} onClick={openGlobalCalculator}><Calculator/><span>Tasas</span></button>
      <button type="button" className={moreOpen ? 'active' : ''} onClick={() => { setCalculatorOpen(false); setContextInput(null); setMoreOpen(value => !value) }}><MoreHorizontal/><span>Más</span></button>
    </nav>}
  </>
}
