import type { SessionSummary } from '@shared/types'
import { Money } from './ui'
import { formatDateTime, formatDuration, formatMoney } from '../lib/format'

export function SessionSummaryView({ summary }: { summary: SessionSummary }): JSX.Element {
  const s = summary
  return (
    <div className="stack gap-4">
      <div className="kv-list">
        <div className="kv">
          <span>Employee</span>
          <span>{s.session.userFullName}</span>
        </div>
        <div className="kv">
          <span>Business date</span>
          <span>{s.session.businessDate}</span>
        </div>
        <div className="kv">
          <span>Start</span>
          <span>{formatDateTime(s.session.openedAt)}</span>
        </div>
        <div className="kv">
          <span>End</span>
          <span>{s.session.closedAt ? formatDateTime(s.session.closedAt) : 'still open'}</span>
        </div>
        <div className="kv">
          <span>Duration</span>
          <span>{formatDuration(s.session.openedAt, s.session.closedAt ?? Date.now())}</span>
        </div>
      </div>

      <div className="grid-cards">
        <Stat label="Orders" value={s.orderCount} />
        <Stat label="Invoices" value={s.invoiceCount} />
        <Stat label="Cancelled" value={s.cancelledCount} />
        <Stat label="Gross sales" value={formatMoney(s.grossSales)} />
        <Stat label="Discounts" value={formatMoney(s.discountTotal)} />
        <Stat label="Service charges" value={formatMoney(s.serviceChargeTotal)} />
        <Stat label="Refunds" value={formatMoney(s.refundTotal)} />
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3>Net sales</h3>
          <strong style={{ fontSize: 'var(--text-xl)' }}>
            <Money minor={s.netSales} />
          </strong>
        </div>
        <div className="panel__body">
          <div className="kv-list">
            <div className="kv">
              <span>Gross</span>
              <span>{formatMoney(s.grossSales)}</span>
            </div>
            <div className="kv">
              <span>less Discounts</span>
              <span>-{formatMoney(s.discountTotal)}</span>
            </div>
            <div className="kv">
              <span>plus Service Charges</span>
              <span>+{formatMoney(s.serviceChargeTotal)}</span>
            </div>
            <div className="kv">
              <span>less Refunds</span>
              <span>-{formatMoney(s.refundTotal)}</span>
            </div>
            <div className="kv" style={{ fontSize: 'var(--text-lg)', borderTop: '1px solid var(--line-1)', paddingTop: 6 }}>
              <span>Net</span>
              <span>{formatMoney(s.netSales)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3>Payment breakdown</h3>
        </div>
        <div className="panel__body">
          {s.paymentBreakdown.length === 0 ? (
            <span className="muted">No payments recorded.</span>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Method</th>
                  <th className="num">Count</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {s.paymentBreakdown.map((p) => (
                  <tr key={p.method}>
                    <td>{p.label}</td>
                    <td className="num">{p.count}</td>
                    <td className="num">{formatMoney(p.amount, { withSymbol: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <span className="stat__value mono tnum">{value}</span>
    </div>
  )
}
