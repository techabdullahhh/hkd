import { useEffect, useMemo, useState } from 'react'
import type { PaymentMethod } from '@shared/types'
import type { CheckoutResult } from '@shared/ipc'
import { api } from '../../lib/api'
import { useCart } from '../../store/cart'
import { toast } from '../../store/toast'
import { Modal, Money } from '../../components/ui'
import { formatMoney, toPaisa, toRupees } from '../../lib/format'
import { run } from '../../lib/useAsync'

export function PaymentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }): JSX.Element {
  const cart = useCart()
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [methodCode, setMethodCode] = useState<string>('')
  const [tenderStr, setTenderStr] = useState('')
  const [reference, setReference] = useState('')
  const [autoPrint, setAutoPrint] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CheckoutResult | null>(null)

  const total = cart.total()

  useEffect(() => {
    api.settings.paymentMethods().then((m) => {
      setMethods(m)
      setMethodCode(m[0]?.code ?? '')
    })
  }, [])

  const method = methods.find((m) => m.code === methodCode)
  const tendered = tenderStr ? toPaisa(parseFloat(tenderStr)) : method?.allowsChange ? total : total
  const change = method?.allowsChange ? Math.max(0, tendered - total) : 0
  const shortfall = method?.allowsChange && tendered < total

  const key = (k: string): void => {
    if (k === '⌫') setTenderStr((s) => s.slice(0, -1))
    else if (k === 'C') setTenderStr('')
    else if (k === '.') setTenderStr((s) => (s.includes('.') ? s : s + '.'))
    else setTenderStr((s) => (s === '0' ? k : s + k))
  }

  const submit = async (): Promise<void> => {
    if (!method) return
    if (method.requiresReference && !reference.trim()) {
      toast.error(`${method.label} needs a reference.`)
      return
    }
    if (shortfall) {
      toast.error('Amount tendered is less than the total due.')
      return
    }
    setBusy(true)
    const r = await run(() =>
      api.pos.checkout({
        lines: cart.lines.map((l) => ({
          kind: l.kind,
          refId: l.refId,
          productPriceId: l.productPriceId,
          quantity: l.quantity,
          note: l.note || undefined
        })),
        orderNote: cart.orderNote || undefined,
        customerName: cart.customerName || undefined,
        discountMinor: cart.discountMinor || undefined,
        discountReason: cart.discountReason || undefined,
        payment: {
          method: method.code,
          tenderedMinor: method.allowsChange ? tendered : undefined,
          reference: reference.trim() || undefined
        },
        fromHeldOrderId: cart.resumingHeldId ?? undefined,
        autoPrint
      })
    )
    setBusy(false)
    if (r) {
      setResult(r)
      if (r.printed) toast.success('Invoice printed.', r.printMessage)
      else if (autoPrint) toast.warn('Invoice saved but not printed.', r.printMessage)
      cart.clear()
    }
  }

  const quickTenders = useMemo(() => {
    const t = toRupees(total)
    const bumps = [t, Math.ceil(t / 100) * 100, Math.ceil(t / 500) * 500, Math.ceil(t / 1000) * 1000]
    return [...new Set(bumps)].filter((x) => x >= t).slice(0, 4)
  }, [total])

  if (result) {
    return (
      <Modal
        open
        title="Payment complete"
        onClose={() => {
          onDone()
        }}
        width={520}
        dismissable={false}
        footer={
          <>
            <button
              className="btn"
              onClick={async () => {
                const inv = await run(() => api.invoices.reprint({ invoiceId: result.invoice.id }), {
                  success: 'Reprint sent.'
                })
                if (inv) setResult({ ...result, invoice: inv })
              }}
            >
              {result.printed ? 'Reprint' : 'Retry print'}
            </button>
            <button className="btn btn--primary" onClick={onDone}>
              New order
            </button>
          </>
        }
      >
        <div className="row between" style={{ marginBottom: 'var(--s-3)' }}>
          <div className="stack gap-1">
            <span className="eyebrow">Invoice</span>
            <strong className="mono" style={{ fontSize: 'var(--text-lg)' }}>
              {result.invoice.invoiceNumber}
            </strong>
          </div>
          <span
            className={`chip ${result.invoice.printStatus === 'PRINTED' ? 'chip--ok' : result.invoice.printStatus === 'FAILED' ? 'chip--danger' : 'chip--warn'}`}
          >
            {result.invoice.printStatus.replace('_', ' ')}
          </span>
        </div>
        {!result.printed && (
          <div className="auth__error" style={{ marginBottom: 'var(--s-3)' }}>
            {result.printMessage.replace(/\.?\s*$/, '.')} The invoice is safely stored — retry printing above or from
            the Invoices screen.
          </div>
        )}
        <div className="inv-preview">{result.invoice.snapshot ? renderText(result.invoice) : '—'}</div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      title="Take payment"
      onClose={onClose}
      width={560}
      footer={
        <>
          <label className="check" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} />
            Print invoice now
          </label>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary btn--lg" onClick={submit} disabled={busy || !method}>
            {busy ? 'Processing…' : `Charge ${formatMoney(total)}`}
          </button>
        </>
      }
    >
      <div className="cols cols--2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="stack gap-3">
          <div className="field">
            <label>Payment method</label>
            <div className="row gap-2 wrap">
              {methods.map((m) => (
                <button
                  key={m.code}
                  className={`tag-btn ${methodCode === m.code ? 'is-active' : ''}`}
                  onClick={() => setMethodCode(m.code)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {method?.allowsChange && (
            <>
              <div className="field">
                <label>Amount tendered</label>
                <input
                  className="input mono"
                  value={tenderStr}
                  onChange={(e) => setTenderStr(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder={toRupees(total).toString()}
                />
              </div>
              <div className="row gap-2 wrap">
                {quickTenders.map((q) => (
                  <button key={q} className="tag-btn" onClick={() => setTenderStr(String(q))}>
                    {formatMoney(toPaisa(q), { withSymbol: false })}
                  </button>
                ))}
              </div>
            </>
          )}

          {method?.requiresReference && (
            <div className="field">
              <label>Reference</label>
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
        </div>

        <div className="stack gap-3">
          {method?.allowsChange && (
            <div className="keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
                <button key={k} onClick={() => key(k)}>
                  {k}
                </button>
              ))}
            </div>
          )}
          <div className="panel">
            <div className="panel__body kv-list">
              <div className="kv">
                <span>Subtotal</span>
                <span>{formatMoney(cart.subtotal())}</span>
              </div>
              {cart.discountMinor > 0 && (
                <div className="kv">
                  <span>Discount</span>
                  <span>-{formatMoney(cart.discountMinor)}</span>
                </div>
              )}
              {cart.serviceCharge() > 0 && (
                <div className="kv">
                  <span>Service Charges</span>
                  <span>{formatMoney(cart.serviceCharge())}</span>
                </div>
              )}
              <div className="kv" style={{ fontSize: 'var(--text-lg)' }}>
                <span>Total</span>
                <span>
                  <Money minor={total} />
                </span>
              </div>
              {method?.allowsChange && (
                <>
                  <div className="kv">
                    <span>Tendered</span>
                    <span>{formatMoney(tendered)}</span>
                  </div>
                  <div className="kv">
                    <span>Change</span>
                    <span className={shortfall ? 'money-neg' : 'money-pos'}>
                      {shortfall ? 'Short ' + formatMoney(total - tendered) : formatMoney(change)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function renderText(invoice: CheckoutResult['invoice']): string {
  const s = invoice.snapshot
  const cols = s.paperWidth === 58 ? 32 : 42
  const line = (l: string, r: string) => l + ' '.repeat(Math.max(1, cols - l.length - r.length)) + r
  const out: string[] = []
  if (s.restaurantNameUrdu) out.push(center(s.restaurantNameUrdu, cols))
  out.push(center(s.restaurantName.toUpperCase(), cols))
  if (s.restaurantPhone) out.push(center('Tel: ' + s.restaurantPhone, cols))
  out.push('-'.repeat(cols))
  out.push(line('Invoice', s.invoiceNumber))
  out.push(line('Order', s.orderNumber))
  out.push(line('Served by', s.employeeName))
  out.push('-'.repeat(cols))
  for (const it of s.lines) {
    out.push(it.name + (it.variantLabel ? ` (${it.variantLabel})` : ''))
    out.push(line(`  ${it.quantity} x ${formatMoney(it.unitPriceMinor, { withSymbol: false })}`, formatMoney(it.lineTotalMinor, { withSymbol: false })))
  }
  out.push('-'.repeat(cols))
  out.push(line('Subtotal', formatMoney(s.subtotalMinor, { withSymbol: false })))
  if (s.discountMinor > 0) out.push(line('Discount', '-' + formatMoney(s.discountMinor, { withSymbol: false })))
  if ((s.serviceChargeMinor ?? 0) > 0)
    out.push(line('Service Charges', formatMoney(s.serviceChargeMinor, { withSymbol: false })))
  out.push(line('TOTAL PKR', formatMoney(s.totalMinor, { withSymbol: false })))
  out.push(line('Payment', s.paymentMethodLabel))
  if (s.tenderedMinor != null) {
    out.push(line('Tendered', formatMoney(s.tenderedMinor, { withSymbol: false })))
    out.push(line('Change', formatMoney(s.changeMinor ?? 0, { withSymbol: false })))
  }
  out.push('-'.repeat(cols))
  out.push(center(s.footerText, cols))
  return out.join('\n')
}
function center(s: string, cols: number): string {
  if (s.length >= cols) return s
  return ' '.repeat(Math.floor((cols - s.length) / 2)) + s
}
