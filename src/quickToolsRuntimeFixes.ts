function normalizeCopiedAmount(value: string) {
  return value
    .replace(/^Bs\s*/i, '')
    .replace(/\s*(USD|EUR|USDT)$/i, '')
    .trim()
}

async function copyText(value: string) {
  const text = normalizeCopiedAmount(value)
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

function patchPriceCalculator() {
  const sheet = document.querySelector<HTMLElement>('.quickCalculatorSheet')
  if (!sheet || !sheet.querySelector('.quickApply')) return

  const resultBox = sheet.querySelector<HTMLElement>('.quickResult')
  const label = resultBox?.querySelector<HTMLElement>('span')
  const value = resultBox?.querySelector<HTMLElement>('strong')
  const copyButton = resultBox?.querySelector<HTMLButtonElement>('button')
  const currencyRows = Array.from(sheet.querySelectorAll<HTMLElement>('.quickEquivalentBlock button'))
  const vesRow = currencyRows.find(row => row.querySelector('span')?.textContent?.trim() === 'VES')
  const vesValue = vesRow?.querySelector('strong')?.textContent?.trim()

  if (!label || !value || !vesValue) return

  label.textContent = 'Equivalente en bolívares'
  value.textContent = vesValue
  resultBox?.classList.add('priceConversionPreview')
  copyButton?.setAttribute('data-zivi-ves-preview', vesValue)
}

function installRuntimeFixes() {
  patchPriceCalculator()

  const observer = new MutationObserver(() => patchPriceCalculator())
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null
    const button = target?.closest<HTMLButtonElement>('.quickCalculatorSheet .quickResult button[data-zivi-ves-preview]')
    if (!button) return

    const value = button.getAttribute('data-zivi-ves-preview')
    if (!value) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    void copyText(value)
  }, true)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installRuntimeFixes, { once: true })
} else {
  installRuntimeFixes()
}

export {}
