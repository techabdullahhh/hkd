import { Fragment, useState } from 'react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { Loading, EmptyState } from '../components/ui'
import { formatDateTime } from '../lib/format'

export function AuditPage(): JSX.Element {
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const list = useAsync(
    () => api.audit.list({ search: search || undefined, action: action || undefined, page, pageSize: 60 }),
    [search, action, page]
  )
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Audit Log</h1>
          <p>Every significant action — who, what, when. Entries are append-only and cannot be edited or deleted.</p>
        </div>
      </div>

      <div className="page-toolbar">
        <input
          className="input"
          placeholder="Search summary / entity"
          style={{ width: 260 }}
          onChange={(e) => {
            setPage(1)
            setSearch(e.target.value)
          }}
        />
        <select
          className="select"
          onChange={(e) => {
            setPage(1)
            setAction(e.target.value)
          }}
        >
          <option value="">All actions</option>
          {[
            'AUTH_LOGIN',
            'PRICE_CHANGED',
            'PRODUCT_ARCHIVED',
            'USER_CREATED',
            'USER_DISABLED',
            'INVOICE_REPRINTED',
            'ORDER_CANCELLED',
            'ORDER_REFUNDED',
            'SESSION_STARTED',
            'SESSION_ENDED',
            'BUSINESS_DAY_OPENED',
            'BUSINESS_DAY_CLOSED',
            'PRINTER_SETTINGS_CHANGED',
            'SETTINGS_CHANGED',
            'BACKUP_CREATED',
            'BACKUP_RESTORE'
          ].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="panel">
        <div className="panel__body" style={{ padding: 0 }}>
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data || list.data.rows.length === 0 ? (
            <EmptyState title="No audit entries" />
          ) : (
            <div className="list-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Summary</th>
                    <th>Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((e) => (
                    <Fragment key={e.id}>
                      <tr
                        className={e.detailsJson ? 'clickable' : ''}
                        onClick={() => e.detailsJson && setExpanded(expanded === e.id ? null : e.id)}
                      >
                        <td className="muted mono" style={{ fontSize: 'var(--text-xs)' }}>
                          {formatDateTime(e.at)}
                        </td>
                        <td>{e.actorName}</td>
                        <td>
                          <span className="chip">{e.action}</span>
                        </td>
                        <td>{e.summary}</td>
                        <td className="muted mono" style={{ fontSize: 'var(--text-xs)' }}>
                          {e.entityType ? `${e.entityType}${e.entityId ? ` #${e.entityId}` : ''}` : '—'}
                        </td>
                      </tr>
                      {expanded === e.id && e.detailsJson && (
                        <tr>
                          <td colSpan={5}>
                            <pre className="inv-preview" style={{ background: 'var(--bg-0)', color: 'var(--ink-2)' }}>
                              {JSON.stringify(JSON.parse(e.detailsJson), null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {list.data && list.data.total > list.data.pageSize && (
          <div className="panel__head" style={{ borderBottom: 'none', borderTop: '1px solid var(--line-1)' }}>
            <span className="muted">
              {list.data.total} entries · page {page}
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
    </div>
  )
}
