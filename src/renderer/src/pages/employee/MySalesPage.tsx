import { useState } from 'react'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { Loading, EmptyState, Modal } from '../../components/ui'
import { SessionSummaryView } from '../../components/SessionSummaryView'
import { formatBusinessDate, formatClock, formatDuration } from '../../lib/format'

export function MySalesPage(): JSX.Element {
  const sessions = useAsync(() => api.session.list({ limit: 60 }), [])
  const [openId, setOpenId] = useState<number | null>(null)
  const summary = useAsync(
    () => (openId ? api.session.summary({ sessionId: openId }) : Promise.resolve(null)),
    [openId]
  )

  if (sessions.loading && !sessions.data) return <Loading />
  const rows = sessions.data ?? []

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My Sales</h1>
          <p>Your performance is measured per session — not per calendar day.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No sessions yet" hint="Start a session from the POS to record sales" />
      ) : (
        <div className="panel">
          <div className="panel__body" style={{ padding: 0 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Business date</th>
                  <th>Window</th>
                  <th>Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setOpenId(s.id)}>
                    <td className="mono">#{s.id}</td>
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
        </div>
      )}

      {openId && (
        <Modal open title={`Session #${openId}`} onClose={() => setOpenId(null)} width={560}>
          {summary.loading || !summary.data ? <Loading /> : <SessionSummaryView summary={summary.data} />}
        </Modal>
      )}
    </div>
  )
}
