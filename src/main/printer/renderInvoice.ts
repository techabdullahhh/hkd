import type { InvoiceSnapshot } from '@shared/types'
import { formatMoney } from '@shared/money'
import { formatDateTime } from '@shared/time'
import type { RenderedInvoice } from './types'

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

/**
 * Render an immutable invoice snapshot to print-ready output.
 *
 * The HTML is deliberately plain and self-contained: monospace, fixed
 * millimetre width, no external assets, hairline rules — exactly what a
 * 58 mm / 80 mm thermal printer reproduces cleanly.
 */
export function renderInvoice(snap: InvoiceSnapshot, opts: { logoDataUrl?: string | null } = {}): RenderedInvoice {
  const width = snap.paperWidth
  const contentMm = width === 58 ? 48 : 72
  const cols = width === 58 ? 32 : 48

  /* ---------------- HTML ---------------- */
  const rows = snap.lines
    .map((l) => {
      const name = esc(l.name) + (l.variantLabel ? ` <span class="v">(${esc(l.variantLabel)})</span>` : '')
      const qtyPrice = `${l.quantity} × ${formatMoney(l.unitPriceMinor, { withSymbol: false })}`
      return `<tr class="item">
        <td class="n" colspan="2">${name}</td>
      </tr>
      <tr class="sub">
        <td class="q">${qtyPrice}</td>
        <td class="a">${formatMoney(l.lineTotalMinor, { withSymbol: false })}</td>
      </tr>`
    })
    .join('')

  const discountRow =
    snap.discountMinor > 0
      ? `<tr><td>Discount${snap.discountReason ? ` <span class="v">(${esc(snap.discountReason)})</span>` : ''}</td><td class="a">-${formatMoney(snap.discountMinor, { withSymbol: false })}</td></tr>`
      : ''

  const serviceChargeRow =
    (snap.serviceChargeMinor ?? 0) > 0
      ? `<tr><td>Service Charges</td><td class="a">${formatMoney(snap.serviceChargeMinor, { withSymbol: false })}</td></tr>`
      : ''

  const changeRows =
    snap.tenderedMinor != null
      ? `<tr><td>Tendered</td><td class="a">${formatMoney(snap.tenderedMinor, { withSymbol: false })}</td></tr>
         <tr><td>Change</td><td class="a">${formatMoney(snap.changeMinor ?? 0, { withSymbol: false })}</td></tr>`
      : ''

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${width}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html,body { margin:0; padding:0; }
    body { width:${width}mm; font-family: "Menlo","Consolas","Courier New",monospace; color:#000; background:#fff; }
    .rcpt { width:${contentMm}mm; margin:0 auto; padding:3mm 0 5mm; font-size:${width === 58 ? 10 : 11}px; line-height:1.35; }
    .center { text-align:center; }
    .name { font-size:${width === 58 ? 15 : 18}px; font-weight:700; letter-spacing:1px; }
    /* The logo is already 1-bit art at the head's exact dot width, so it must
       be laid out at that width and never resampled — smoothing would turn
       crisp strokes into greys the printer can only approximate. */
    .logo { display:block; width:100%; margin:0 auto 1.5mm; image-rendering:pixelated; }
    .name-ur { font-size:${width === 58 ? 15 : 19}px; font-family:"Noto Nastaliq Urdu","Urdu Typesetting",serif; direction:rtl; line-height:2; margin-bottom:1mm; }
    .muted { color:#000; }
    .rule { border-top:1px dashed #000; margin:2mm 0; }
    .rule.solid { border-top:1px solid #000; }
    table { width:100%; border-collapse:collapse; }
    td { vertical-align:top; padding:0; }
    td.a { text-align:right; white-space:nowrap; }
    tr.sub td { padding-bottom:1mm; }
    tr.sub td.q { color:#000; padding-left:2mm; }
    .v { font-style:italic; }
    .totals td { padding:0.4mm 0; }
    .grand td { font-size:${width === 58 ? 13 : 15}px; font-weight:700; padding-top:1mm; }
    .meta { display:flex; justify-content:space-between; }
    .footer { margin-top:3mm; text-align:center; }
    .kv { display:flex; justify-content:space-between; }
  </style></head><body><div class="rcpt">
    ${opts.logoDataUrl ? `<img class="logo" src="${opts.logoDataUrl}" alt="">` : ''}
    ${snap.restaurantNameUrdu ? `<div class="center name-ur">${esc(snap.restaurantNameUrdu)}</div>` : ''}
    <div class="center name">${esc(snap.restaurantName)}</div>
    ${snap.restaurantAddress ? `<div class="center muted">${esc(snap.restaurantAddress)}</div>` : ''}
    ${snap.restaurantPhone ? `<div class="center muted">Tel: ${esc(snap.restaurantPhone)}</div>` : ''}
    <div class="rule"></div>
    <div class="kv"><span>Invoice</span><span>${esc(snap.invoiceNumber)}</span></div>
    <div class="kv"><span>Order</span><span>${esc(snap.orderNumber)}</span></div>
    <div class="kv"><span>Date</span><span>${esc(formatDateTime(snap.issuedAt))}</span></div>
    <div class="kv"><span>Served by</span><span>${esc(snap.employeeName)}</span></div>
    ${snap.businessDate ? `<div class="kv"><span>Business date</span><span>${esc(snap.businessDate)}</span></div>` : ''}
    ${snap.sessionId != null ? `<div class="kv"><span>Session</span><span>#${snap.sessionId}</span></div>` : ''}
    <div class="rule"></div>
    <table>${rows}</table>
    <div class="rule"></div>
    <table class="totals">
      <tr><td>Subtotal</td><td class="a">${formatMoney(snap.subtotalMinor, { withSymbol: false })}</td></tr>
      ${discountRow}
      ${serviceChargeRow}
      <tr class="grand"><td>TOTAL (PKR)</td><td class="a">${formatMoney(snap.totalMinor, { withSymbol: false })}</td></tr>
      <tr><td>Payment</td><td class="a">${esc(snap.paymentMethodLabel)}</td></tr>
      ${changeRows}
    </table>
    <div class="rule solid"></div>
    <div class="footer">${esc(snap.footerText)}</div>
    <div class="footer muted">${esc(snap.invoiceNumber)}</div>
  </div></body></html>`

  /* ---------------- plain text ---------------- */
  const line = (left: string, right: string) => {
    const space = Math.max(1, cols - left.length - right.length)
    return left + ' '.repeat(space) + right
  }
  const centre = (s: string) => {
    if (s.length >= cols) return s
    const pad = Math.floor((cols - s.length) / 2)
    return ' '.repeat(pad) + s
  }
  const dash = '-'.repeat(cols)
  const tl: string[] = []
  tl.push(centre(snap.restaurantName.toUpperCase()))
  if (snap.restaurantAddress) tl.push(centre(snap.restaurantAddress))
  if (snap.restaurantPhone) tl.push(centre(`Tel: ${snap.restaurantPhone}`))
  tl.push(dash)
  tl.push(line('Invoice', snap.invoiceNumber))
  tl.push(line('Order', snap.orderNumber))
  tl.push(line('Date', formatDateTime(snap.issuedAt)))
  tl.push(line('Served by', snap.employeeName))
  if (snap.businessDate) tl.push(line("Business date", snap.businessDate))
  tl.push(dash)
  for (const l of snap.lines) {
    tl.push(l.name + (l.variantLabel ? ` (${l.variantLabel})` : ''))
    tl.push(
      line(
        `  ${l.quantity} x ${formatMoney(l.unitPriceMinor, { withSymbol: false })}`,
        formatMoney(l.lineTotalMinor, { withSymbol: false })
      )
    )
  }
  tl.push(dash)
  tl.push(line('Subtotal', formatMoney(snap.subtotalMinor, { withSymbol: false })))
  if (snap.discountMinor > 0) tl.push(line('Discount', `-${formatMoney(snap.discountMinor, { withSymbol: false })}`))
  if ((snap.serviceChargeMinor ?? 0) > 0)
    tl.push(line('Service Charges', formatMoney(snap.serviceChargeMinor, { withSymbol: false })))
  tl.push(line('TOTAL PKR', formatMoney(snap.totalMinor, { withSymbol: false })))
  tl.push(line('Payment', snap.paymentMethodLabel))
  if (snap.tenderedMinor != null) {
    tl.push(line('Tendered', formatMoney(snap.tenderedMinor, { withSymbol: false })))
    tl.push(line('Change', formatMoney(snap.changeMinor ?? 0, { withSymbol: false })))
  }
  tl.push(dash)
  tl.push(centre(snap.footerText))
  tl.push(centre(snap.invoiceNumber))
  tl.push('')
  tl.push('')

  return { html, text: tl.join('\n'), paperWidth: width }
}
