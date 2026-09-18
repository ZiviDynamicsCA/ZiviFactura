import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { invoiceEquivalentValues } from './rates'
import type { Company, ConversionTarget, Invoice, PaymentDisplay } from './types'

export function money(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function totals(invoice: Invoice) {
  const subtotal = invoice.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const discount = Math.min(Math.max(invoice.discount || 0, 0), subtotal)
  const taxable = subtotal - discount
  const tax = taxable * (Math.max(invoice.taxRate || 0, 0) / 100)
  return { subtotal, discount, tax, total: taxable + tax }
}

const statusLabel = (status: Invoice['status']) => ({ draft: 'BORRADOR', issued: 'POR COBRAR', paid: 'PAGADA', cancelled: 'ANULADA' }[status])
const plain = (value?: number, suffix = '') => Number.isFinite(value) ? `${Number(value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}` : 'N/D'
const ALL_CONVERSIONS: ConversionTarget[] = ['VES', 'USD', 'EUR', 'USDT_BINANCE', 'USDT_AVERAGE']

type CopyRow = { label: string; value: string }
type CopyGroup = { title: string; rows: CopyRow[] }

function encodeCopyPayload(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function copyPageUrl(payload: unknown) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://zivi-factura.vercel.app'
  const ownerUid = typeof window !== 'undefined' ? localStorage.getItem('zivifactura.firebase.uid') || undefined : undefined
  const enriched = payload && typeof payload === 'object' ? { ...(payload as Record<string, unknown>), ownerUid } : payload
  return `${origin}/copiar.html#${encodeCopyPayload(enriched)}`
}

function availablePaymentMethods(company: Company): PaymentDisplay[] {
  const methods: PaymentDisplay[] = []
  if (company.mobilePaymentBank || company.mobilePaymentPhone || company.mobilePaymentId) methods.push('mobile')
  if (company.bankName || company.bankAccountType || company.bankAccountNumber || company.bankAccountHolder) methods.push('bank')
  if (company.binanceId) methods.push('binance')
  if (company.paymentNotes) methods.push('notes')
  return methods
}

export function buildInvoicePdf(invoice: Invoice, company: Company) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const { subtotal, discount, tax, total } = totals(invoice)
  const equivalents = invoiceEquivalentValues(invoice, total)
  const blue = [37, 99, 235] as [number, number, number]
  const navy = [11, 22, 51] as [number, number, number]
  const cyan = [6, 182, 212] as [number, number, number]
  const ink = [24, 36, 57] as [number, number, number]
  const muted = [104, 117, 138] as [number, number, number]
  const soft = [245, 248, 253] as [number, number, number]
  const line = [225, 232, 243] as [number, number, number]
  const pageW = 595

  doc.setFillColor(...navy)
  doc.roundedRect(28, 24, pageW - 56, 118, 14, 14, 'F')
  doc.setFillColor(...blue)
  doc.roundedRect(28, 24, 7, 118, 4, 4, 'F')
  doc.setFillColor(...cyan)
  doc.circle(535, 37, 4, 'F')

  if (company.logoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(43, 40, 80, 70, 10, 10, 'F')
      doc.addImage(company.logoDataUrl, 'PNG', 50, 47, 66, 56, undefined, 'FAST')
    } catch { /* ignore invalid logo */ }
  }

  const companyX = company.logoDataUrl ? 140 : 46
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text(company.name || 'Mi empresa', companyX, 58)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const companyLines = [company.taxId && `RIF/RUC: ${company.taxId}`, company.phone, company.email, company.address, company.city].filter(Boolean)
  companyLines.slice(0, 4).forEach((value, index) => doc.text(String(value), companyX, 76 + index * 11))

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(invoice.type.toUpperCase(), 548, 54, { align: 'right' })
  doc.setFontSize(10)
  doc.text(invoice.number, 548, 72, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`Fecha: ${invoice.date}`, 548, 89, { align: 'right' })
  if (invoice.dueDate) doc.text(`Vence: ${invoice.dueDate}`, 548, 102, { align: 'right' })

  const badgeText = statusLabel(invoice.status)
  const badgeWidth = Math.max(72, doc.getTextWidth(badgeText) + 22)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(548 - badgeWidth, 113, badgeWidth, 20, 10, 10, 'F')
  doc.setTextColor(...navy)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text(badgeText, 548 - badgeWidth / 2, 126.5, { align: 'center' })

  doc.setFillColor(...soft)
  doc.roundedRect(28, 160, pageW - 56, 92, 12, 12, 'F')
  doc.setTextColor(...blue)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('FACTURADO A', 44, 181)
  doc.setTextColor(...ink)
  doc.setFontSize(13)
  doc.text(invoice.client.name || 'Cliente', 44, 201)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...muted)
  const clientLines = [invoice.client.taxId && `RIF/RUC/C.I.: ${invoice.client.taxId}`, invoice.client.phone, invoice.client.email, invoice.client.address].filter(Boolean)
  clientLines.slice(0, 3).forEach((value, index) => doc.text(String(value), 44, 218 + index * 12))

  doc.setTextColor(...blue)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('RESUMEN', 382, 181)
  doc.setTextColor(...ink)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  doc.text('Moneda', 382, 201)
  doc.text(invoice.currency, 548, 201, { align: 'right' })
  doc.text('Forma de pago', 382, 218)
  doc.text(invoice.paymentMethod || 'No indicada', 548, 218, { align: 'right', maxWidth: 125 })
  if (invoice.rateValue) {
    doc.text('Tasa aplicada', 382, 235)
    doc.text(`${plain(invoice.rateValue)} Bs`, 548, 235, { align: 'right' })
  }

  autoTable(doc, {
    startY: 274,
    margin: { left: 28, right: 28 },
    head: [['Cantidad', 'Descripción', 'Precio unitario', 'Total']],
    body: invoice.items.map((item) => [
      item.quantity.toLocaleString('es-VE', { maximumFractionDigits: 2 }),
      item.description,
      money(item.unitPrice, invoice.currency),
      money(item.quantity * item.unitPrice, invoice.currency),
    ]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 10, right: 8, bottom: 10, left: 8 }, textColor: ink, lineColor: line, lineWidth: { bottom: 0.6 } },
    headStyles: { fillColor: blue, textColor: [255, 255, 255], fontStyle: 'bold', lineWidth: 0 },
    alternateRowStyles: { fillColor: [249, 251, 255] },
    columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 254 }, 2: { cellWidth: 105, halign: 'right' }, 3: { cellWidth: 100, halign: 'right', fontStyle: 'bold' } },
  })

  const tableEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  const summaryY = tableEnd + 24
  const summaryX = 344
  const summaryW = 223

  doc.setFillColor(...soft)
  doc.roundedRect(summaryX, summaryY, summaryW, 112, 12, 12, 'F')
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  const rows = [
    ['Subtotal', money(subtotal, invoice.currency)],
    ['Descuento', `- ${money(discount, invoice.currency)}`],
    [`IVA / Impuesto ${invoice.taxRate}%`, money(tax, invoice.currency)],
  ]
  rows.forEach(([label, value], index) => {
    const y = summaryY + 24 + index * 20
    doc.setFont('helvetica', 'normal')
    doc.text(label, summaryX + 14, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...ink)
    doc.text(value, summaryX + summaryW - 14, y, { align: 'right' })
    doc.setTextColor(...muted)
  })
  doc.setDrawColor(...line)
  doc.line(summaryX + 14, summaryY + 76, summaryX + summaryW - 14, summaryY + 76)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...blue)
  doc.text('TOTAL', summaryX + 14, summaryY + 98)
  doc.text(money(total, invoice.currency), summaryX + summaryW - 14, summaryY + 98, { align: 'right' })

  if (invoice.notes) {
    const notesY = summaryY + 16
    doc.setTextColor(...blue)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('OBSERVACIONES', 28, notesY)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...muted)
    doc.setFontSize(8.3)
    doc.text(doc.splitTextToSize(invoice.notes, 280), 28, notesY + 16)
  }

  let nextBlockY = Math.max(summaryY + 138, 520)
  if (invoice.rateValue && equivalents) {
    const selectedTargets = invoice.conversionTargets !== undefined
      ? invoice.conversionTargets
      : invoice.showRateConversions ? ALL_CONVERSIONS : ['VES']
    const allValues: Array<{ key: ConversionTarget; label: string; value?: number; display: string }> = [
      { key: 'VES', label: 'Bolívares', value: equivalents.ves, display: money(equivalents.ves, 'VES') },
      { key: 'USD', label: 'USD BCV', value: equivalents.USD, display: equivalents.USD != null ? money(equivalents.USD, 'USD') : 'N/D' },
      { key: 'EUR', label: 'EUR BCV', value: equivalents.EUR, display: equivalents.EUR != null ? money(equivalents.EUR, 'EUR') : 'N/D' },
      { key: 'USDT_BINANCE', label: 'USDT Binance', value: equivalents.USDT_BINANCE, display: equivalents.USDT_BINANCE != null ? `${plain(equivalents.USDT_BINANCE)} USDT` : 'N/D' },
      { key: 'USDT_AVERAGE', label: 'USDT promedio', value: equivalents.USDT_AVERAGE, display: equivalents.USDT_AVERAGE != null ? `${plain(equivalents.USDT_AVERAGE)} USDT` : 'N/D' },
    ]
    const values = allValues.filter(item => selectedTargets.includes(item.key) && item.value != null)
    const valueRows = Math.ceil(values.length / 2)
    const rateBoxH = Math.max(68, 58 + valueRows * 18 + (invoice.rateCapturedAt ? 12 : 0))
    doc.setFillColor(244, 248, 255)
    doc.roundedRect(28, nextBlockY, 539, rateBoxH, 12, 12, 'F')
    doc.setFillColor(...blue)
    doc.roundedRect(28, nextBlockY, 6, rateBoxH, 3, 3, 'F')
    doc.setTextColor(...blue)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(values.length ? 'TASA Y EQUIVALENTES DE PAGO' : 'TASA APLICADA', 44, nextBlockY + 20)
    doc.setTextColor(...ink)
    doc.setFontSize(8.5)
    doc.text(invoice.rateLabel || 'Tasa aplicada', 44, nextBlockY + 39)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...muted)
    doc.text(`1 unidad = ${plain(invoice.rateValue)} Bs`, 210, nextBlockY + 39)
    values.forEach((item, index) => {
      const col = index % 2
      const row = Math.floor(index / 2)
      const x = 44 + col * 254
      const y = nextBlockY + 62 + row * 18
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.text(item.label, x, y)
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...ink); doc.text(item.display, x + 112, y)
    })
    if (invoice.rateCapturedAt) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...muted)
      doc.text(`Tasa capturada: ${new Date(invoice.rateCapturedAt).toLocaleString('es-VE')}`, 551, nextBlockY + rateBoxH - 8, { align: 'right' })
    }
    nextBlockY += rateBoxH + 16
  }

  const mobile = [company.mobilePaymentBank, company.mobilePaymentPhone, company.mobilePaymentId].filter(Boolean)
  const bank = [company.bankName, company.bankAccountType, company.bankAccountNumber, company.bankAccountHolder].filter(Boolean)
  const binance = [company.binanceId].filter(Boolean)
  const selectedPaymentMethods = invoice.paymentMethodsVisible !== undefined ? invoice.paymentMethodsVisible : availablePaymentMethods(company)
  const showMobile = selectedPaymentMethods.includes('mobile') && mobile.length > 0
  const showBank = selectedPaymentMethods.includes('bank') && bank.length > 0
  const showBinance = selectedPaymentMethods.includes('binance') && binance.length > 0
  const showNotes = selectedPaymentMethods.includes('notes') && Boolean(company.paymentNotes)
  const columns = [
    showMobile ? { title: 'PAGO MÓVIL', lines: [company.mobilePaymentBank && `Banco: ${company.mobilePaymentBank}`, company.mobilePaymentPhone && `Tel: ${company.mobilePaymentPhone}`, company.mobilePaymentId && `C.I./RIF: ${company.mobilePaymentId}`].filter(Boolean) as string[] } : null,
    showBank ? { title: 'CUENTA BANCARIA', lines: [company.bankName && `Banco: ${company.bankName}`, company.bankAccountType, company.bankAccountNumber, company.bankAccountHolder && `Titular: ${company.bankAccountHolder}`].filter(Boolean) as string[] } : null,
    showBinance ? { title: 'BINANCE / DIGITAL', lines: [company.binanceId && `Pay ID / correo: ${company.binanceId}`].filter(Boolean) as string[] } : null,
  ].filter((item): item is { title: string; lines: string[] } => Boolean(item))
  const hasPaymentData = columns.length > 0 || showNotes
  const copyGroups: CopyGroup[] = [
    showMobile ? {
      title: 'Pago móvil',
      rows: [
        company.mobilePaymentBank ? { label: 'Banco', value: company.mobilePaymentBank } : null,
        company.mobilePaymentPhone ? { label: 'Teléfono', value: company.mobilePaymentPhone } : null,
        company.mobilePaymentId ? { label: 'C.I./RIF', value: company.mobilePaymentId } : null,
      ].filter((item): item is CopyRow => Boolean(item)),
    } : null,
    showBank ? {
      title: 'Cuenta bancaria',
      rows: [
        company.bankName ? { label: 'Banco', value: company.bankName } : null,
        company.bankAccountType ? { label: 'Tipo de cuenta', value: company.bankAccountType } : null,
        company.bankAccountNumber ? { label: 'Número de cuenta', value: company.bankAccountNumber } : null,
        company.bankAccountHolder ? { label: 'Titular', value: company.bankAccountHolder } : null,
      ].filter((item): item is CopyRow => Boolean(item)),
    } : null,
    showBinance ? {
      title: 'Binance / digital',
      rows: company.binanceId ? [{ label: 'Pay ID / correo', value: company.binanceId }] : [],
    } : null,
    showNotes && company.paymentNotes ? {
      title: 'Instrucciones adicionales',
      rows: [{ label: 'Instrucciones', value: company.paymentNotes }],
    } : null,
  ].filter((item): item is CopyGroup => Boolean(item))

  const selectedCopyTargets = invoice.conversionTargets !== undefined
    ? invoice.conversionTargets
    : invoice.showRateConversions ? ALL_CONVERSIONS : ['VES']
  const copyEquivalents: CopyRow[] = equivalents ? [
    selectedCopyTargets.includes('VES') ? { label: 'Bolívares', value: money(equivalents.ves, 'VES') } : null,
    selectedCopyTargets.includes('USD') && equivalents.USD != null ? { label: 'USD BCV', value: money(equivalents.USD, 'USD') } : null,
    selectedCopyTargets.includes('EUR') && equivalents.EUR != null ? { label: 'EUR BCV', value: money(equivalents.EUR, 'EUR') } : null,
    selectedCopyTargets.includes('USDT_BINANCE') && equivalents.USDT_BINANCE != null ? { label: 'USDT Binance', value: `${plain(equivalents.USDT_BINANCE)} USDT` } : null,
    selectedCopyTargets.includes('USDT_AVERAGE') && equivalents.USDT_AVERAGE != null ? { label: 'USDT promedio', value: `${plain(equivalents.USDT_AVERAGE)} USDT` } : null,
  ].filter((item): item is CopyRow => Boolean(item)) : []

  const publishedDocumentUrl = typeof window !== 'undefined'
    && invoice.publicShareId
    && !invoice.publicShareId.startsWith('local-')
      ? `${window.location.origin}/documento.html?id=${encodeURIComponent(invoice.publicShareId)}`
      : ''

  const copyUrl = hasPaymentData ? (publishedDocumentUrl || copyPageUrl({
    version: 1,
    company: company.name || 'Empresa',
    invoice: invoice.number,
    client: invoice.client.name || 'Cliente',
    total: money(total, invoice.currency),
    invoiceCurrency: invoice.currency,
    invoiceTotal: total,
    expectedVes: equivalents?.ves,
    rateValue: invoice.rateValue,
    rate: invoice.rateValue ? {
      label: invoice.rateLabel || 'Tasa aplicada',
      value: `${plain(invoice.rateValue)} Bs`,
    } : undefined,
    equivalents: copyEquivalents,
    groups: copyGroups,
  })) : ''

  if (hasPaymentData) {
    const basePaymentH = showNotes ? (columns.length ? 118 : 82) : 94
    const ctaH = 86
    const paymentH = basePaymentH + ctaH
    let paymentY = nextBlockY
    if (paymentY + paymentH > 760) {
      doc.addPage()
      paymentY = 42
    }

    doc.setFillColor(248, 250, 255)
    doc.roundedRect(28, paymentY, 539, paymentH, 14, 14, 'F')
    doc.setFillColor(...navy)
    doc.roundedRect(28, paymentY, 6, paymentH, 3, 3, 'F')
    doc.setTextColor(...blue)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('DATOS PARA PAGAR', 44, paymentY + 20)

    if (columns.length) {
      const contentWidth = 507
      const colWidth = contentWidth / columns.length
      columns.forEach((column, index) => {
        const x = 44 + index * colWidth
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...navy); doc.text(column.title, x, paymentY + 40)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...muted)
        column.lines.slice(0, 4).forEach((value, lineIndex) => doc.text(doc.splitTextToSize(String(value), Math.max(135, colWidth - 16)), x, paymentY + 54 + lineIndex * 11))
      })
    }
    if (showNotes && company.paymentNotes) {
      const noteY = columns.length ? paymentY + 83 : paymentY + 40
      if (columns.length) { doc.setDrawColor(...line); doc.line(44, noteY, 551, noteY) }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.3); doc.setTextColor(...muted); doc.text(doc.splitTextToSize(company.paymentNotes, 500), 44, noteY + 15)
    }

    const ctaY = paymentY + basePaymentH + 2
    doc.setFillColor(234, 243, 255)
    doc.roundedRect(44, ctaY, 507, 70, 12, 12, 'F')
    doc.setFillColor(...blue)
    doc.circle(66, ctaY + 21, 11, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('✓', 66, ctaY + 24.5, { align: 'center' })

    doc.setTextColor(...navy)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.2)
    doc.text('COPIA LOS DATOS Y PAGA SIN ERRORES', 84, ctaY + 18)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...muted)
    doc.setFontSize(7.2)
    const helper = 'Abre una vista segura para copiar monto, teléfono, C.I./RIF, cuenta o Binance con un toque.'
    doc.text(doc.splitTextToSize(helper, 270), 84, ctaY + 32)

    const copyButtonX = 372
    const copyButtonY = ctaY + 14
    const copyButtonW = 163
    const copyButtonH = 42
    doc.setFillColor(...blue)
    doc.roundedRect(copyButtonX, copyButtonY, copyButtonW, copyButtonH, 10, 10, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('ABRIR Y COPIAR DATOS', copyButtonX + copyButtonW / 2, copyButtonY + 18, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.6)
    doc.text('Toca aquí desde tu teléfono', copyButtonX + copyButtonW / 2, copyButtonY + 31, { align: 'center' })
    doc.link(copyButtonX, copyButtonY, copyButtonW, copyButtonH, { url: copyUrl })
  }

  doc.setDrawColor(...line)
  doc.line(28, 781, 567, 781)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(...muted)
  const footerPrefix = 'Generado con ZiviFactura · Zivi Dynamics C.A. · RIF J-508175123 · '
  doc.text(footerPrefix, 28, 802)
  const linkX = 28 + doc.getTextWidth(footerPrefix)
  doc.setTextColor(...blue)
  doc.textWithLink('zividynamics.com', linkX, 802, { url: 'https://zividynamics.com' })
  return doc
}

export function pdfFile(invoice: Invoice, company: Company) {
  const doc = buildInvoicePdf(invoice, company)
  const blob = doc.output('blob')
  return new File([blob], `${invoice.number}.pdf`, { type: 'application/pdf' })
}
