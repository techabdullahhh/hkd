import { useState } from 'react'
import type { Order } from '@shared/types'
import { api } from '../lib/api'
import { run } from '../lib/useAsync'
import { Modal, Money } from './ui'
import { confirmDialog } from './confirm'
import { useAuth } from '../store/auth'
import { formatDateTime, formatMoney } from '../lib/format'

export function OrderDetailModal({
  order,
  onClose,
  onChanged
}: {
  order: Order
  onClose: () => void
  onChanged: (o: Order) => void
}): JSX.Element {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [busy, setBusy] = useState(false)

  const cancel = async (): Promise<void> => {
    const reason = window.prompt('Reason for cancelling this order?')
    if (!reason || reason.trim().length < 3) return
    const ok = await confirmDialog({
      title: 'Cancel order?',
      message: `${order.orderNumber} will be marked cancelled. If it was paid, a full refund is recorded. The invoice stays on the permanent record.`,
      danger: true,
      confirmLabel: 'Cancel order'
    })
    if (!ok) return
    setBusy(true)
    const r = await run(() => api.orders.cancel({ orderId: order.id, reason: reason.trim() }), {
      success: 'Order cancelled.'
    })
    setBusy(false)
    if (r) onChanged(r)
  }

  const refund = async (): Promise<void> => {
    const amtStr = window.prompt(`Refund amount in PKR (max ${formatMoney(order.totalMinor, { withSymbol: false })})`)
    if (!amtStr) return
    const reason = window.prompt('Reason for the refund?')
    if (!reason || reason.trim().length < 3) return
    const minor = Math.round(parseFloat(amtStr) * 100)
    if (!minor || minor <= 0) return
    setBusy(true)
    const r = await run(() => api.orders.refund({ orderId: order.id, amountMinor: minor, reason: reason.trim() }), {
      success: 'Refund recorded.'
    })
    setBusy(false)
    if (r) onChanged(r)
  }

  return (
    <Modal
      open
      title={order.orderNumber}
      onClose={onClose}
      width={560}
      footer={
        isAdmin ? (
          <>
            {order.status === 'COMPLETED' && (
              <button className="btn btn--ghost" onClick={refund} disabled={busy}>
                Refund
              </button>
            )}
            {(order.status === 'COMPLETED' || order.status === 'HELD') && (
              <button className="btn btn--danger" onClick={cancel} disabled={busy}>
                Cancel order
              </button>
            )}
            <button className="btn btn--primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <button className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      <div className="row between wrap gap-2" style={{ marginBottom: 'var(--s-3)' }}>
        <span
          className={`chip ${
            order.status === 'COMPLETED'
              ? 'chip--ok'
              : order.status === 'CANCELLED'
                ? 'chip--danger'
                : order.status === 'REFUNDED'
                  ? 'chip--warn'
                  : 'chip--info'
          }`}
        >
          {order.status}
        </span>
        <span className="muted mono">{formatDateTime(order.createdAt)}</span>
      </div>

      <div className="kv-list" style={{ marginBottom: 'var(--s-3)' }}>
        <div className="kv">
          <span>Employee</span>
          <span>{order.userFullName}</span>
        </div>
        <div className="kv">
          <span>Session</span>
          <span className="mono">{order.sessionId ? `#${order.sessionId}` : '—'}</span>
        </div>
        <div className="kv">
          <span>Business date</span>
          <span>{order.businessDate ?? '—'}</span>
        </div>
        {order.customerName && (
          <div className="kv">
            <span>Customer</span>
            <span>{order.customerName}</span>
          </div>
        )}
        {order.orderNote && (
          <div className="kv">
            <span>Note</span>
            <span>{order.orderNote}</span>
          </div>
        )}
        {order.invoice && (
          <div className="kv">
            <span>Invoice</span>
            <span className="mono">
              {order.invoice.invoiceNumber} · {order.invoice.printStatus.replace('_', ' ')} (×{order.invoice.printCount})
            </span>
          </div>
        )}
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Unit</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.name}
                {l.variantLabel && <span className="muted"> · {l.variantLabel}</span>}
                {l.note && <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>“{l.note}”</div>}
              </td>
              <td className="num">{l.quantity}</td>
              <td className="num">{formatMoney(l.unitPriceMinor, { withSymbol: false })}</td>
              <td className="num">{formatMoney(l.lineTotalMinor, { withSymbol: false })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="kv-list" style={{ marginTop: 'var(--s-3)' }}>
        <div className="kv">
          <span>Subtotal</span>
          <span>{formatMoney(order.subtotalMinor)}</span>
        </div>
        {order.discountMinor > 0 && (
          <div className="kv">
            <span>Discount {order.discountReason && `(${order.discountReason})`}</span>
            <span>-{formatMoney(order.discountMinor)}</span>
          </div>
        )}
        {order.serviceChargeMinor > 0 && (
          <div className="kv">
            <span>Service Charges</span>
            <span>{formatMoney(order.serviceChargeMinor)}</span>
          </div>
        )}
        <div className="kv" style={{ fontSize: 'var(--text-lg)' }}>
          <span>Total</span>
          <span>
            <Money minor={order.totalMinor} />
          </span>
        </div>
        {order.payments.map((p) => (
          <div className="kv" key={p.id}>
            <span>{p.isRefund ? 'Refund' : 'Paid'} · {p.methodLabel}</span>
            <span className={p.isRefund ? 'money-neg' : ''}>
              {p.isRefund ? '-' : ''}
              {formatMoney(p.amountMinor)}
            </span>
          </div>
        ))}
        {order.cancelReason && (
          <div className="kv">
            <span>Cancellation</span>
            <span>{order.cancelReason}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
