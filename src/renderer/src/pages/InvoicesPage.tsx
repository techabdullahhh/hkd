import { useState } from 'react'
import type { Invoice } from '@shared/types'
import { api } from '../lib/api'
import { useAsync, run } from '../lib/useAsync'
import { Loading, EmptyState, Money, Modal } from '../components/ui'
import { ReceiptPreview } from '../components/ReceiptPreview'
import { formatDateTime, formatMoney } from '../lib/format'

export function InvoicesPage({ scope }: { scope: 'mine' | 'all' }): JSX.Element {
  const [filters, setFilters] = useState<{ status?: string; search?: string }>({})
  const [page, setPage] = useState(1)
  const list = useAsync(() => api.invoices.list({ ...filters, page, pageSize: 30 }), [JSON.stringify(filters), page])
  const [selected, setSelected] = useState<Invoice | null>(null)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{scope === 'mine' ? 'My Invoices' : 'Invoices'}</h1>
          <p>Every invoice has a permanent number and an immutable snapshot. Reprint any time.</p>
        </div>
        <button
          className="btn btn--sm"
          onClick={() =>
            run(() => api.invoices.testPrint(), { success: 'Test print sent.' })
          }
        >
          Print test invoice
        </button>
      </div>

      <div className="page-toolbar">
        <input
          className="input"
          placeholder="Search invoice / order # / employee"
          style={{ width: 280 }}
          onChange={(e) => {
            setPage(1)
            setFilters((f) => ({ ...f, search: e.target.value || undefined }))
          }}
        />
        <select
          className="select"
          onChange={(e) => {
            setPage(1)
            setFilters((f) => ({ ...f, status: e.target.value || undefined }))
          }}
        >
          <option value="">Any print status</option>
          {['PRINTED', 'NOT_PRINTED', 'FAILED'].map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">
        <div className="panel__body" style={{ padding: 0 }}>
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data || list.data.rows.length === 0 ? (
            <EmptyState title="No invoices" />
          ) : (
            <div className="list-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Order</th>
                    <th>Employee</th>
                    <th>Issued</th>
                    <th>Payment</th>
                    <th>Print</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((inv) => (
                    <tr key={inv.id} className="clickable" onClick={() => setSelected(inv)}>
                      <td className="mono">{inv.invoiceNumber}</td>
                      <td className="mono muted">{inv.orderNumber}</td>
                      <td>{inv.userFullName}</td>
                      <td className="muted">{formatDateTime(inv.issuedAt)}</td>
                      <td>{inv.paymentMethodLabel}</td>
                      <td>
                        <span
                          className={`chip ${
                            inv.printStatus === 'PRINTED'
                              ? 'chip--ok'
                              : inv.printStatus === 'FAILED'
                                ? 'chip--danger'
                                : 'chip--warn'
                          }`}
                        >
                          {inv.printStatus.replace('_', ' ')}
                          {inv.printCount > 0 && ` ×${inv.printCount}`}
                        </span>
                      </td>
                      <td className="num">
                        <Money minor={inv.totalMinor} plain />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {list.data && list.data.total > list.data.pageSize && (
          <div className="panel__head" style={{ borderTop: '1px solid var(--line-1)', borderBottom: 'none' }}>
            <span className="muted">
              {list.data.total} invoices · page {page}
            </span>
            <div className="row gap-2">
              <button className="btn" title="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹ Prev
              </button>
              <button
                className="btn"
                title="Next page"
                disabled={page >= Math.ceil(list.data.total / list.data.pageSize)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next ›
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <InvoiceModal
          invoice={selected}
          onClose={() => setSelected(null)}
          onChanged={(inv) => {
            setSelected(inv)
            list.reload()
          }}
        />
      )}
    </div>
  )
}

function InvoiceModal({
  invoice,
  onClose,
  onChanged
}: {
  invoice: Invoice
  onClose: () => void
  onChanged: (i: Invoice) => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const s = invoice.snapshot

  const doPrint = async (reprint: boolean): Promise<void> => {
    setBusy(true)
    const r = await run(
      () =>
        reprint
          ? api.invoices.reprint({ invoiceId: invoice.id, reason: 'Manual reprint' })
          : api.invoices.print({ invoiceId: invoice.id }),
      { success: reprint ? 'Reprint sent.' : 'Print sent.' }
    )
    setBusy(false)
    if (r) onChanged(r)
  }

  const cols = s.paperWidth === 58 ? 32 : 42
  const line = (l: string, r: string): string => l + ' '.repeat(Math.max(1, cols - l.length - r.length)) + r
  const center = (x: string): string => (x.length >= cols ? x : ' '.repeat(Math.floor((cols - x.length) / 2)) + x)
  const text: string[] = []
  if (s.restaurantNameUrdu) text.push(center(s.restaurantNameUrdu))
  text.push(center(s.restaurantName.toUpperCase()))
  if (s.restaurantAddress) text.push(center(s.restaurantAddress))
  if (s.restaurantPhone) text.push(center('Tel: ' + s.restaurantPhone))
  text.push('-'.repeat(cols))
  text.push(line('Invoice', s.invoiceNumber))
  text.push(line('Order', s.orderNumber))
  text.push(line('Date', formatDateTime(s.issuedAt)))
  text.push(line('Served by', s.employeeName))
  if (s.businessDate) text.push(line('Business date', s.businessDate))
  text.push('-'.repeat(cols))
  for (const it of s.lines) {
    text.push(it.name + (it.variantLabel ? ` (${it.variantLabel})` : ''))
    text.push(line(`  ${it.quantity} x ${formatMoney(it.unitPriceMinor, { withSymbol: false })}`, formatMoney(it.lineTotalMinor, { withSymbol: false })))
  }
  text.push('-'.repeat(cols))
  text.push(line('Subtotal', formatMoney(s.subtotalMinor, { withSymbol: false })))
  if (s.discountMinor > 0) text.push(line('Discount', '-' + formatMoney(s.discountMinor, { withSymbol: false })))
  if ((s.serviceChargeMinor ?? 0) > 0)
    text.push(line('Service Charges', formatMoney(s.serviceChargeMinor, { withSymbol: false })))
  text.push(line('TOTAL PKR', formatMoney(s.totalMinor, { withSymbol: false })))
  text.push(line('Payment', s.paymentMethodLabel))
  if (s.tenderedMinor != null) {
    text.push(line('Tendered', formatMoney(s.tenderedMinor, { withSymbol: false })))
    text.push(line('Change', formatMoney(s.changeMinor ?? 0, { withSymbol: false })))
  }
  text.push('-'.repeat(cols))
  text.push(center(s.footerText))

  return (
    <Modal
      open
      title={invoice.invoiceNumber}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={() => doPrint(false)} disabled={busy}>
            Print
          </button>
          <button className="btn btn--primary" onClick={() => doPrint(true)} disabled={busy}>
            Reprint
          </button>
        </>
      }
    >
      <div className="row between" style={{ marginBottom: 'var(--s-2)' }}>
        <span
          className={`chip ${
            invoice.printStatus === 'PRINTED' ? 'chip--ok' : invoice.printStatus === 'FAILED' ? 'chip--danger' : 'chip--warn'
          }`}
        >
          {invoice.printStatus.replace('_', ' ')} · printed ×{invoice.printCount}
        </span>
        <span className="muted mono">{s.paperWidth}mm</span>
      </div>
      {invoice.lastPrintError && <div className="auth__error" style={{ marginBottom: 'var(--s-2)' }}>{invoice.lastPrintError}</div>}
      <ReceiptPreview text={text.join('\n')} />
    </Modal>
  )
}
