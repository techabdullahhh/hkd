import type { Order } from '@shared/types'
import { api } from '../../lib/api'
import { useAsync, run } from '../../lib/useAsync'
import { useCart } from '../../store/cart'
import { Modal, Loading, EmptyState, Money } from '../../components/ui'
import { confirmDialog } from '../../components/confirm'
import { relativeTime } from '../../lib/format'

export function HeldOrdersModal({
  onClose,
  onResumed,
  onChanged
}: {
  onClose: () => void
  onResumed: () => void
  onChanged: () => void
}): JSX.Element {
  const held = useAsync(() => api.pos.heldOrders(), [])
  const cart = useCart()

  const resume = (o: Order): void => {
    cart.loadHeld(o)
    onResumed()
  }

  const discard = async (o: Order): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Discard held order?',
      message: `Order ${o.orderNumber} will be cancelled. This is recorded in the audit log.`,
      confirmLabel: 'Discard',
      danger: true
    })
    if (!ok) return
    await run(() => api.pos.deleteHeld({ orderId: o.id, reason: 'Discarded from held list' }), {
      success: 'Held order discarded.'
    })
    held.reload()
    onChanged()
  }

  return (
    <Modal open title="Held orders" onClose={onClose} width={560}>
      {held.loading ? (
        <Loading />
      ) : !held.data || held.data.length === 0 ? (
        <EmptyState title="No held orders" hint="Orders you hold from the cart appear here" />
      ) : (
        <div className="stack gap-2">
          {held.data.map((o) => (
            <div key={o.id} className="panel">
              <div className="panel__body row between">
                <div className="stack gap-1">
                  <strong className="mono">{o.orderNumber}</strong>
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {o.lines.length} items · {o.customerName || 'no name'} · held {relativeTime(o.createdAt)}
                  </span>
                </div>
                <div className="row gap-2">
                  <Money minor={o.subtotalMinor} />
                  <button className="btn btn--sm btn--danger" onClick={() => discard(o)}>
                    Discard
                  </button>
                  <button className="btn btn--sm btn--primary" onClick={() => resume(o)}>
                    Resume
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
