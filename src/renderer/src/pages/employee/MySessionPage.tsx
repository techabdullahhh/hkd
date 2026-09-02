import { useEffect, useState } from 'react'
import type { SessionSummary } from '@shared/types'
import { api } from '../../lib/api'
import { useAsync, run } from '../../lib/useAsync'
import { useOps } from '../../store/ops'
import { Loading, Modal, Money } from '../../components/ui'
import { SessionSummaryView } from '../../components/SessionSummaryView'
import { confirmDialog } from '../../components/confirm'
import { formatClock, liveDuration } from '../../lib/format'

export function MySessionPage(): JSX.Element {
  const { session, refresh } = useOps()
  const [, tick] = useState(0)
  const [summaryOpen, setSummaryOpen] = useState<SessionSummary | null>(null)

  useEffect(() => {
    void refresh()
    const i = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(i)
  }, [refresh])

  const live = useAsync(
    () => (session ? api.session.summary({ sessionId: session.id }) : Promise.resolve(null)),
    [session?.id]
  )

  const endSession = async (): Promise<void> => {
    if (!session) return
    const ok = await confirmDialog({
      title: 'End your session?',
      message:
        'You will not be able to take more orders until you start a new session. Your session summary will be saved permanently.',
      confirmLabel: 'End session'
    })
    if (!ok) return
    const s = await run(() => api.session.close({ sessionId: session.id }), { success: 'Session ended.' })
    if (s) {
      setSummaryOpen(s)
      await refresh()
    }
  }

  if (!session) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>My Session</h1>
            <p>Start a session to begin taking orders.</p>
          </div>
        </div>
        <div className="panel">
          <div className="panel__body center stack gap-3" style={{ padding: 'var(--s-7)' }}>
            <div className="empty-state__mark">◔</div>
            <h3>You have no active session</h3>
            <p className="muted" style={{ maxWidth: 380, textAlign: 'center' }}>
              Start a session whenever you begin your shift. It stays open — across midnight and into the next
              calendar day — until you end it yourself.
            </p>
            <button
              className="btn btn--primary btn--lg"
              onClick={() => run(() => api.session.open({}), { success: 'Session started.' }).then(refresh)}
            >
              Start session
            </button>
          </div>
        </div>
        {summaryOpen && (
          <Modal open title="Session summary" onClose={() => setSummaryOpen(null)} width={560}>
            <SessionSummaryView summary={summaryOpen} />
          </Modal>
        )}
      </div>
    )
  }

  const sum = live.data

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My Session</h1>
          <p>Started under business date {session.businessDate} — this session never resets at midnight; it runs until you end it.</p>
        </div>
        <button className="btn btn--danger" onClick={endSession}>
          End session
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="panel__head">
          <h3>Current session</h3>
          <span className="chip chip--ok">
            <span className="dot dot--live" /> Live
          </span>
        </div>
        <div className="panel__body">
          <div className="grid-cards">
            <div className="stat stat--accent">
              <span className="eyebrow">{session.userFullName}</span>
              <span className="stat__value">{liveDuration(session.openedAt)}</span>
              <span className="stat__sub muted">since {formatClock(session.openedAt)}</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Orders</span>
              <span className="stat__value">{sum?.orderCount ?? '—'}</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Invoices</span>
              <span className="stat__value">{sum?.invoiceCount ?? '—'}</span>
            </div>
            <div className="stat stat--ok">
              <span className="eyebrow">Net sales</span>
              <span className="stat__value">
                {sum ? <Money minor={sum.netSales} plain /> : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {live.loading && !sum ? <Loading /> : sum && <SessionSummaryView summary={sum} />}

      {summaryOpen && (
        <Modal open title="Session ended — summary" onClose={() => setSummaryOpen(null)} width={560} dismissable>
          <SessionSummaryView summary={summaryOpen} />
        </Modal>
      )}
    </div>
  )
}
