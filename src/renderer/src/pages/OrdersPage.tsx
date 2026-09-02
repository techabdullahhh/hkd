import { useState } from 'react'
import type { BusinessDay, Order, PaymentMethod } from '@shared/types'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { Loading, EmptyState, Money } from '../components/ui'
import { OrderDetailModal } from '../components/OrderDetailModal'
import { formatDateTime } from '../lib/format'

export function OrdersPage(): JSX.Element {
  const [filters, setFilters] = useState<{ businessDate?: string; status?: string; paymentMethod?: string; search?: string }>({})
  const [page, setPage] = useState(1)
  const meta = useAsync(
    () => Promise.all([api.businessDay.list({ limit: 90 }), api.settings.paymentMethods({ includeInactive: true })]),
    []
  )
  const list = useAsync(() => api.orders.list({ ...filters, page, pageSize: 30 }), [JSON.stringify(filters), page])
  const [selected, setSelected] = useState<Order | null>(null)

  const bdays: BusinessDay[] = meta.data?.[0] ?? []
  const methods: PaymentMethod[] = meta.data?.[1] ?? []

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p>Every order, filterable by business date, session, payment and status.</p>
        </div>
      </div>

      <div className="page-toolbar">
        <input
          className="input"
          placeholder="Search invoice / order # / customer"
          style={{ width: 260 }}
          onChange={(e) => {
            setPage(1)
            setFilters((f) => ({ ...f, search: e.target.value || undefined }))
          }}
        />
        <select
          className="select"
          onChange={(e) => {
            setPage(1)
            setFilters((f) => ({ ...f, businessDate: e.target.value || undefined }))
          }}
        >
          <option value="">All business dates</option>
          {bdays.map((b) => (
            <option key={b.businessDate} value={b.businessDate}>
              {b.businessDate}
            </option>
          ))}
        </select>
        <select
          className="select"
          onChange={(e) => {
            setPage(1)
            setFilters((f) => ({ ...f, status: e.target.value || undefined }))
          }}
        >
          <option value="">Any status</option>
          {['COMPLETED', 'HELD', 'CANCELLED', 'REFUNDED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="select"
          onChange={(e) => {
            setPage(1)
            setFilters((f) => ({ ...f, paymentMethod: e.target.value || undefined }))
          }}
        >
          <option value="">Any payment</option>
          {methods.map((m) => (
            <option key={m.code} value={m.code}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">
        <div className="panel__body" style={{ padding: 0 }}>
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data || list.data.rows.length === 0 ? (
            <EmptyState title="No orders match" />
          ) : (
            <div className="list-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Invoice</th>
                    <th>Employee</th>
                    <th>Session</th>
                    <th>Business date</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((o) => (
                    <tr key={o.id} className="clickable" onClick={() => setSelected(o)}>
                      <td className="mono">{o.orderNumber}</td>
                      <td className="mono muted">{o.invoice?.invoiceNumber ?? '—'}</td>
                      <td>{o.userFullName}</td>
                      <td className="mono muted">{o.sessionId ? `#${o.sessionId}` : '—'}</td>
                      <td className="muted">{o.businessDate ?? '—'}</td>
                      <td className="muted">{formatDateTime(o.createdAt)}</td>
                      <td>
                        <span
                          className={`chip ${
                            o.status === 'COMPLETED'
                              ? 'chip--ok'
                              : o.status === 'CANCELLED'
                                ? 'chip--danger'
                                : o.status === 'REFUNDED'
                                  ? 'chip--warn'
                                  : 'chip--info'
                          }`}
                        >
                          {o.status}
                        </span>
                      </td>
                      <td className="num">
                        <Money minor={o.totalMinor} plain />
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
              {list.data.total} orders · page {page} of {Math.ceil(list.data.total / list.data.pageSize)}
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
        <OrderDetailModal
          order={selected}
          onClose={() => setSelected(null)}
          onChanged={(o) => {
            setSelected(o)
            list.reload()
          }}
        />
      )}
    </div>
  )
}
