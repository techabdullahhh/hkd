import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { Loading, Money, Stat, EmptyState } from '../components/ui'
import { formatMoney, formatBusinessDate, liveDuration, relativeTime } from '../lib/format'

export function DashboardPage(): JSX.Element {
  const { reload, ...s } = useAsync(() => api.dashboard.stats(), [])

  if (s.loading && !s.data) return <Loading label="Building dashboard…" />
  if (s.error) return <EmptyState title="Could not load dashboard" hint={s.error} />
  const d = s.data!

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            Business date {formatBusinessDate(d.businessDay.businessDate)} · {d.businessDay.openSessionCount} session
            {d.businessDay.openSessionCount === 1 ? '' : 's'} on the floor
          </p>
        </div>
        <div className="row gap-2">
          <button className="btn btn--sm" onClick={reload}>
            Refresh
          </button>
        </div>
      </div>

      <div className="grid-cards" style={{ marginBottom: 'var(--s-4)' }}>
        <Stat label="Revenue (day)" value={formatMoney(d.revenueMinor)} tone="accent" sub={`${d.orderCount} orders`} />
        <Stat label="Invoices" value={d.invoiceCount} />
        <Stat label="Cancelled" value={d.cancelledCount} tone={d.cancelledCount ? 'danger' : undefined} />
        <Stat
          label="Refunds"
          value={d.refundCount}
          tone={d.refundCount ? 'danger' : undefined}
          sub={formatMoney(d.refundTotalMinor)}
        />
        <Stat label="Active sessions" value={d.activeSessions.length} />
      </div>

      <div className="cols cols--2">
        <div className="panel">
          <div className="panel__head">
            <h3>Active employee sessions</h3>
          </div>
          <div className="panel__body">
            {d.activeSessions.length === 0 ? (
              <EmptyState title="No one is on the floor" hint="Sessions appear here when employees clock in" />
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>On since</th>
                    <th className="num">Orders</th>
                    <th className="num">Net sales</th>
                  </tr>
                </thead>
                <tbody>
                  {d.activeSessions.map((a) => (
                    <tr key={a.sessionId}>
                      <td>{a.userFullName}</td>
                      <td className="muted">{liveDuration(a.openedAt)}</td>
                      <td className="num">{a.orderCount}</td>
                      <td className="num">
                        <Money minor={a.salesMinor} plain />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h3>Top products today</h3>
          </div>
          <div className="panel__body">
            {d.topProducts.length === 0 ? (
              <EmptyState title="No sales yet" />
            ) : (
              <div className="stack gap-2">
                {d.topProducts.map((p, i) => {
                  const max = d.topProducts[0].quantity || 1
                  return (
                    <div key={i} className="stack gap-1">
                      <div className="row between" style={{ fontSize: 'var(--text-sm)' }}>
                        <span>{p.name}</span>
                        <span className="mono muted">
                          {p.quantity} · {formatMoney(p.revenueMinor)}
                        </span>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(p.quantity / max) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h3>Sales by employee (today)</h3>
          </div>
          <div className="panel__body">
            {d.salesByEmployee.length === 0 ? (
              <EmptyState title="No sales yet" />
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="num">Orders</th>
                    <th className="num">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {d.salesByEmployee.map((e, i) => (
                    <tr key={i}>
                      <td>{e.userFullName}</td>
                      <td className="num">{e.orderCount}</td>
                      <td className="num">
                        <Money minor={e.salesMinor} plain />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h3>System health</h3>
          </div>
          <div className="panel__body stack gap-3">
            <div className="health-row">
              <span className={`dot ${d.printer.reachable ? 'dot--live' : ''}`} />
              <span>
                Printer: <strong>{d.printer.reachable ? 'Ready' : 'Not ready'}</strong> — {d.printer.message}
              </span>
            </div>
            <div className="kv-list">
              <div className="kv">
                <span>Database size</span>
                <span>{(d.systemHealth.dbSizeBytes / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <div className="kv">
                <span>Last backup</span>
                <span>{d.systemHealth.lastBackupAt ? relativeTime(d.systemHealth.lastBackupAt) : 'never'}</span>
              </div>
              <div className="kv">
                <span>App version</span>
                <span className="mono">{d.systemHealth.appVersion}</span>
              </div>
              <div className="kv">
                <span>Uptime</span>
                <span>{liveDuration(Date.now() - d.systemHealth.uptimeMs)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel__head">
            <h3>Recent sessions</h3>
          </div>
          <div className="panel__body">
            <table className="grid">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Employee</th>
                  <th>Business date</th>
                  <th className="num">Orders</th>
                  <th className="num">Net sales</th>
                </tr>
              </thead>
              <tbody>
                {d.salesBySession.map((x) => (
                  <tr key={x.sessionId}>
                    <td className="mono">#{x.sessionId}</td>
                    <td>{x.userFullName}</td>
                    <td className="muted">{x.businessDate}</td>
                    <td className="num">{x.orderCount}</td>
                    <td className="num">
                      <Money minor={x.salesMinor} plain />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
