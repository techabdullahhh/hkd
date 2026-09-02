import { useState } from 'react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { Loading, EmptyState, Modal } from '../components/ui'
import { SessionSummaryView } from '../components/SessionSummaryView'
import { formatBusinessDate, formatClock, formatDuration, liveDuration } from '../lib/format'

export function SessionsPage(): JSX.Element {
  const [bday, setBday] = useState<string | undefined>()
  const meta = useAsync(() => api.businessDay.list({ limit: 90 }), [])
  const active = useAsync(() => api.session.activeAll(), [])
  const list = useAsync(() => api.session.list({ businessDate: bday, limit: 200 }), [bday])
  const [openId, setOpenId] = useState<number | null>(null)
  const summary = useAsync(() => (openId ? api.session.summary({ sessionId: openId }) : Promise.resolve(null)), [openId])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p>Employee sessions are the foundation of sales reporting. A session spans midnight without splitting.</p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="panel__head">
          <h3>Active now ({active.data?.length ?? 0})</h3>
          <button className="btn btn--sm" onClick={active.reload}>
            Refresh
          </button>
        </div>
        <div className="panel__body">
          {active.loading ? (
            <Loading />
          ) : !active.data || active.data.length === 0 ? (
            <EmptyState title="Nobody is on the floor" />
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Employee</th>
                  <th>Business date</th>
                  <th>Started</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {active.data.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setOpenId(s.id)}>
                    <td className="mono">#{s.id}</td>
                    <td>{s.userFullName}</td>
                    <td>{s.businessDate}</td>
                    <td className="muted">{formatClock(s.openedAt)}</td>
                    <td className="muted">{liveDuration(s.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="page-toolbar">
        <select className="select" onChange={(e) => setBday(e.target.value || undefined)}>
          <option value="">All business dates</option>
          {(meta.data ?? []).map((b) => (
            <option key={b.businessDate} value={b.businessDate}>
              {b.businessDate}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">
        <div className="panel__body" style={{ padding: 0 }}>
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data || list.data.length === 0 ? (
            <EmptyState title="No sessions" />
          ) : (
            <div className="list-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Employee</th>
                    <th>Business date</th>
                    <th>Window</th>
                    <th>Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => setOpenId(s.id)}>
                      <td className="mono">#{s.id}</td>
                      <td>{s.userFullName}</td>
                      <td>{formatBusinessDate(s.businessDate)}</td>
                      <td className="muted">
                        {formatClock(s.openedAt)} → {s.closedAt ? formatClock(s.closedAt) : 'now'}
                      </td>
                      <td className="muted">{formatDuration(s.openedAt, s.closedAt ?? Date.now())}</td>
                      <td>
                        <span className={`chip ${s.status === 'OPEN' ? 'chip--ok' : ''}`}>{s.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {openId && (
        <Modal open title={`Session #${openId}`} onClose={() => setOpenId(null)} width={560}>
          {summary.loading || !summary.data ? <Loading /> : <SessionSummaryView summary={summary.data} />}
        </Modal>
      )}
    </div>
  )
}
