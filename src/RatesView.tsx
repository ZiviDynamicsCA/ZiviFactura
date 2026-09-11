import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Calculator, Check, Copy, RefreshCw, TrendingUp } from 'lucide-react'
import type { RateSnapshot, RateSource } from './types'
import { amountToVes, bcvAverageRate, fetchLiveRates, formatRate, getCachedRates, getRateValue, pivotConversions, refreshRatesIfDue } from './rates'
import './rates.css'

type Props = {
  onCreateInvoiceWithRate: (source: RateSource, rates: RateSnapshot) => void
  notify: (message: string) => void
}

const formatNumber = (value?: number, currency?: string) => {
  if (!Number.isFinite(value)) return 'No disponible'
  if (currency) {
    try { return new Intl.NumberFormat('es-VE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)) } catch { /* ignore */ }
  }
  return Number(value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const clipboardNumber = (value?: number) => Number.isFinite(value)
  ? Number(value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : ''

export default function RatesView({ onCreateInvoiceWithRate, notify }: Props) {
  const [rates, setRates] = useState<RateSnapshot | null>(getCachedRates())
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState('10')
  const [source, setSource] = useState<RateSource | 'ves'>('bcv_usd')
  const [customRate, setCustomRate] = useState('1')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    void refreshRatesIfDue().then(next => { if (next) setRates(next) })
  }, [])

  async function refresh(force = true) {
    setLoading(true)
    try {
      const next = await fetchLiveRates(force)
      setRates(next)
      notify('Tasas actualizadas.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudieron actualizar las tasas.')
    } finally {
      setLoading(false)
    }
  }

  async function copyAmount(key: string, value?: number, label = 'Monto') {
    if (!Number.isFinite(value)) return notify(`${label} no disponible.`)
    const text = clipboardNumber(value)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
      }
      setCopied(key)
      window.setTimeout(() => setCopied(current => current === key ? '' : current), 1500)
      notify(`${label} copiado: ${text}`)
    } catch {
      notify('No se pudo copiar automáticamente. Mantén pulsado el monto para copiarlo.')
    }
  }

  const amountNumber = Number(String(amount).replace(/\./g, '').replace(',', '.')) || 0
  const customNumber = Number(String(customRate).replace(/\./g, '').replace(',', '.')) || 0
  const ves = useMemo(() => amountToVes(amountNumber, source, rates, customNumber), [amountNumber, source, rates, customNumber])
  const converted = useMemo(() => pivotConversions(ves, rates), [ves, rates])
  const updated = rates?.capturedAt ? new Date(rates.capturedAt).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin actualización'
  const bcvAverage = bcvAverageRate(rates)

  const cards: Array<{ key: RateSource; title: string; value?: number; note: string }> = [
    { key: 'bcv_usd', title: 'BCV dólar', value: rates?.usdBcv, note: 'Referencia oficial' },
    { key: 'bcv_eur', title: 'BCV euro', value: rates?.eurBcv, note: 'Referencia oficial' },
    { key: 'bcv_average', title: 'Promedio BCV USD/EUR', value: bcvAverage, note: 'Promedio simple de ambas tasas' },
    { key: 'binance', title: 'USDT Binance', value: rates?.binanceBuy, note: 'P2P · compra' },
    { key: 'usdt_average', title: 'USDT promedio', value: rates?.usdtAverage, note: 'Promedio P2P' },
  ]

  const results = [
    { key: 'ves', label: 'Bolívares', value: converted.VES, display: formatNumber(converted.VES, 'VES') },
    { key: 'usd', label: 'BCV dólar', value: converted.USD, display: formatNumber(converted.USD, 'USD') },
    { key: 'eur', label: 'BCV euro', value: converted.EUR, display: formatNumber(converted.EUR, 'EUR') },
    { key: 'bcv-average', label: 'Promedio BCV USD/EUR', value: converted.BCV_AVERAGE, display: `${formatNumber(converted.BCV_AVERAGE)} prom.` },
    { key: 'binance', label: 'USDT Binance', value: converted.USDT_BINANCE, display: `${formatNumber(converted.USDT_BINANCE)} USDT` },
    { key: 'average', label: 'USDT promedio', value: converted.USDT_AVERAGE, display: `${formatNumber(converted.USDT_AVERAGE)} USDT` },
  ]

  return <div className="ratesPage">
    <section className="ratesHero">
      <div><span>TASAS · VENEZUELA</span><h1>Convierte, compara y factura con la tasa que realmente usarás.</h1><p>Las referencias se actualizan automáticamente en las ventanas de la tarde y puedes forzar una actualización cuando lo necesites.</p></div>
      <button className="primary" disabled={loading} onClick={() => refresh(true)}><RefreshCw size={18} className={loading ? 'spin' : ''}/>{loading ? 'Actualizando…' : 'Actualizar ahora'}</button>
    </section>

    <div className="ratesMeta"><span>Última consulta: <strong>{updated}</strong></span>{Number.isFinite(rates?.brechaPct) && <span>Brecha P2P/BCV: <strong>{Number(rates?.brechaPct).toFixed(2)}%</strong></span>}<span>Fuentes: <strong>BCV · usdt.com.ve · respaldo DolarApi</strong></span></div>

    <section className="rateCards">{cards.map(card => <article className="rateCard" key={card.key}>
      <div className="rateIcon"><TrendingUp size={18}/></div><div className="rateCardTop"><span>{card.title}</span><small>{card.note}</small></div>
      <div className="rateValueRow"><strong>{formatRate(card.value)}</strong><button className="copyValue" disabled={!card.value} title={`Copiar ${card.title}`} aria-label={`Copiar ${card.title}`} onClick={() => copyAmount(`rate-${card.key}`, card.value, card.title)}>{copied === `rate-${card.key}` ? <Check size={17}/> : <Copy size={17}/>}</button></div>
      <button className="secondary" disabled={!card.value || !rates} onClick={() => rates && onCreateInvoiceWithRate(card.key, rates)}>Usar en factura</button>
    </article>)}</section>

    <section className="calculatorCard card">
      <div className="calculatorHead"><div><span>CALCULADORA DE CAMBIO</span><h2>Convierte cualquier monto entre VES, USD, EUR, promedio BCV y USDT.</h2></div><Calculator size={28}/></div>
      <div className="calcGrid">
        <label className="field"><span>Monto</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00"/></label>
        <label className="field"><span>Moneda / tasa de origen</span><select value={source} onChange={e => setSource(e.target.value as RateSource | 'ves')}>
          <option value="ves">Bolívares (VES)</option><option value="bcv_usd">USD · BCV dólar</option><option value="bcv_eur">EUR · BCV euro</option><option value="bcv_average">Promedio · BCV USD/EUR</option><option value="binance">USDT · Binance</option><option value="usdt_average">USDT · Promedio</option><option value="custom">Tasa personalizada</option>
        </select></label>
        {source === 'custom' && <label className="field"><span>Tasa personalizada (Bs por unidad)</span><input inputMode="decimal" value={customRate} onChange={e => setCustomRate(e.target.value)}/></label>}
      </div>
      <div className="conversionFlow"><div><span>Equivalente base</span><div className="copyLine"><strong>{formatNumber(ves, 'VES')}</strong><button className="copyValue" title="Copiar equivalente en bolívares" aria-label="Copiar equivalente en bolívares" onClick={() => copyAmount('base-ves', ves, 'Equivalente')}>{copied === 'base-ves' ? <Check size={17}/> : <Copy size={17}/>}</button></div></div><ArrowRightLeft size={22}/><div><span>Tasa usada</span><div className="copyLine"><strong>{source === 'ves' ? '1,00 Bs' : formatRate(source === 'custom' ? customNumber : getRateValue(source, rates))}</strong><button className="copyValue" disabled={source !== 'ves' && !getRateValue(source, rates, customNumber)} title="Copiar tasa usada" aria-label="Copiar tasa usada" onClick={() => copyAmount('used-rate', source === 'ves' ? 1 : getRateValue(source, rates, customNumber), 'Tasa')}>{copied === 'used-rate' ? <Check size={17}/> : <Copy size={17}/>}</button></div></div></div>
      <div className="conversionResults">
        {results.map(result => <div key={result.key}><span>{result.label}</span><div className="resultValue"><strong>{result.display}</strong><button className="copyValue dark" disabled={!Number.isFinite(result.value)} title={`Copiar ${result.label}`} aria-label={`Copiar ${result.label}`} onClick={() => copyAmount(`result-${result.key}`, result.value, result.label)}>{copied === `result-${result.key}` ? <Check size={16}/> : <Copy size={16}/>}</button></div></div>)}
      </div>
      <p className="ratesFootnote">Las tasas P2P son referenciales y pueden variar según monto, anunciante y método de pago. El promedio BCV USD/EUR es un promedio simple entre ambas referencias oficiales y sirve como apoyo administrativo, no como sustituto de la tasa fiscal aplicable. Para documentos fiscales, valida la tasa aplicable según la normativa vigente.</p>
    </section>
  </div>
}
