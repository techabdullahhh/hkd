import { useState } from 'react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { Loading, EmptyState, Money } from '../components/ui'
import { businessDateKey, formatMoney, formatDuration } from '../lib/format'

type Tab =
  | 'businessDay'
  | 'dateRange'
  | 'employees'
  | 'sessions'
  | 'products'
  | 'categories'
  | 'deals'
  | 'payments'
  | 'cancellations'
  | 'refunds'

const TABS: { key: Tab; label: string }[] = [
  { key: 'businessDay', label: 'Business date' },
  { key: 'dateRange', label: 'Daily / range' },
  { key: 'employees', label: 'Employees' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'products', label: 'Products' },
  { key: 'categories', label: 'Categories' },
  { key: 'deals', label: 'Deals' },
  { key: 'payments', label: 'Payment methods' },
  { key: 'cancellations', label: 'Cancelled orders' },
  { key: 'refunds', label: 'Refunds' }
]

export function ReportsPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('businessDay')
  const today = businessDateKey(Date.now())
  const weekAgo = businessDateKey(Date.now() - 6 * 864e5)
  const [from, setFrom] = useState(weekAgo)
  const [to, setTo] = useState(today)
  const [bday, setBday] = useState<string>(today)
  const bdays = useAsync(() => api.businessDay.list({ limit: 120 }), [])

  const report = useAsync(() => {
    switch (tab) {
      case 'businessDay':
        return bday ? api.reports.businessDay({ businessDate: bday }) : Promise.resolve(null)
      case 'dateRange':
        return api.reports.dateRange({ from, to })
      case 'employees':
        return api.reports.employees({ from, to })
      case 'sessions':
        return api.reports.sessions({ from, to })
      case 'products':
        return api.reports.products({ from, to })
      case 'categories':
        return api.reports.categories({ from, to })
      case 'deals':
        return api.reports.deals({ from, to })
      case 'payments':
        return api.reports.payments({ from, to })
      case 'cancellations':
        return api.reports.cancellations({ from, to })
      case 'refunds':
        return api.reports.refunds({ from, to })
    }
  }, [tab, from, to, bday])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>
            Business-date and range reports bucket sales by the reporting-day label. Employee &amp; session reports
            are session-based and are never split by midnight.
          </p>
        </div>
      </div>

      <div className="page-toolbar">
        {TABS.map((t) => (
          <button key={t.key} className={`tag-btn ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="page-toolbar">
        {tab === 'businessDay' ? (
          <select className="select" value={bday} onChange={(e) => setBday(e.target.value)}>
            {(bdays.data ?? []).map((b) => (
              <option key={b.businessDate} value={b.businessDate}>
                {b.businessDate}
              </option>
            ))}
          </select>
        ) : (
          <>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <span className="muted">From</span>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <span className="muted">To</span>
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
        <button className="btn btn--sm" onClick={report.reload}>
          Run
        </button>
      </div>

      <div className="panel">
        <div className="panel__body">
          {report.loading && !report.data ? (
            <Loading />
          ) : !report.data ? (
            <EmptyState title="No data for this selection" />
          ) : (
            <ReportBody tab={tab} data={report.data} />
          )}
        </div>
      </div>
    </div>
  )
}

function money(n: number): JSX.Element {
  return <Money minor={n} plain />
}

function ReportBody({ tab, data }: { tab: Tab; data: any }): JSX.Element {
  if (tab === 'businessDay') {
    const t = data.totals
    return (
      <div className="stack gap-4">
        <div className="grid-cards">
          <S label="Gross" v={formatMoney(t.grossMinor)} />
          <S label="Discounts" v={formatMoney(t.discountMinor)} />
          <S label="Service charges" v={formatMoney(t.serviceChargeMinor)} />
          <S label="Refunds" v={formatMoney(t.refundMinor)} />
          <S label="Net" v={formatMoney(t.netMinor)} />
          <S label="Orders" v={t.orderCount} />
          <S label="Invoices" v={t.invoiceCount} />
          <S label="Cancelled" v={t.cancelledCount} />
        </div>
        <Section title="By session (this date's slice — whole-session totals shown for reference)">
          <Table
            head={['Session', 'Employee', 'Status', 'Orders (day)', 'Gross (day)', 'Net (day)', 'Session orders', 'Session net']}
            rows={data.sessions.map((s: any) => [
              `#${s.sessionId}`,
              s.employee,
              s.status,
              s.orderCount,
              money(s.grossMinor),
              money(s.netMinor),
              s.sessionOrderCount,
              money(s.sessionNetMinor)
            ])}
          />
        </Section>
        <Section title="Payment breakdown">
          <Table
            head={['Method', 'Count', 'Amount']}
            rows={data.paymentBreakdown.map((p: any) => [p.label, p.count, money(p.amountMinor)])}
          />
        </Section>
        <Section title="Top products">
          <Table
            head={['Product', 'Qty', 'Revenue']}
            rows={data.topProducts.map((p: any) => [p.name, p.quantity, money(p.revenueMinor)])}
          />
        </Section>
      </div>
    )
  }

  if (tab === 'dateRange') {
    return (
      <div className="stack gap-4">
        <div className="grid-cards">
          <S label="Gross" v={formatMoney(data.totals.grossMinor)} />
          <S label="Service charges" v={formatMoney(data.totals.serviceChargeMinor)} />
          <S label="Net" v={formatMoney(data.totals.netMinor)} />
          <S label="Orders" v={data.totals.orderCount} />
          <S label="Invoices" v={data.totals.invoiceCount} />
        </div>
        <Table
          head={['Business date', 'Orders', 'Gross', 'Discounts', 'Service', 'Refunds', 'Net', 'Cancelled']}
          rows={data.days.map((d: any) => [
            d.businessDate,
            d.orderCount,
            money(d.grossMinor),
            money(d.discountMinor),
            money(d.serviceChargeMinor),
            money(d.refundMinor),
            money(d.netMinor),
            d.cancelledCount
          ])}
        />
      </div>
    )
  }

  if (tab === 'employees') {
    return (
      <Table
        head={['Employee', 'Sessions', 'Orders', 'Invoices', 'Gross', 'Discounts', 'Service', 'Refunds', 'Net']}
        rows={data.employees.map((e: any) => [
          e.userFullName,
          e.sessionCount,
          e.orderCount,
          e.invoiceCount,
          money(e.grossMinor),
          money(e.discountMinor),
          money(e.serviceChargeMinor),
          money(e.refundMinor),
          money(e.netMinor)
        ])}
      />
    )
  }

  if (tab === 'sessions') {
    return (
      <Table
        head={['Session', 'Day', 'Employee', 'Duration', 'Orders', 'Invoices', 'Gross', 'Net']}
        rows={data.sessions.map((s: any) => [
          `#${s.sessionId}`,
          s.businessDate,
          s.employee,
          formatDuration(0, s.durationMs),
          s.orderCount,
          s.invoiceCount,
          money(s.grossMinor),
          money(s.netMinor)
        ])}
      />
    )
  }

  if (tab === 'products') {
    return (
      <Table
        head={['Product', 'Qty sold', 'Revenue']}
        rows={data.products.map((p: any) => [p.name, p.quantity, money(p.revenueMinor)])}
      />
    )
  }

  if (tab === 'categories') {
    return (
      <Table
        head={['Category', 'Qty', 'Revenue']}
        rows={data.categories.map((c: any) => [c.category, c.quantity, money(c.revenueMinor)])}
      />
    )
  }

  if (tab === 'deals') {
    return (
      <Table head={['Deal', 'Qty', 'Revenue']} rows={data.deals.map((d: any) => [d.name, d.quantity, money(d.revenueMinor)])} />
    )
  }

  if (tab === 'payments') {
    return (
      <Table
        head={['Method', 'Count', 'Net amount']}
        rows={data.methods.map((m: any) => [m.label, m.count, money(m.amountMinor)])}
      />
    )
  }

  if (tab === 'cancellations') {
    return (
      <div className="stack gap-3">
        <S label="Cancelled orders" v={data.count} />
        <Table
          head={['Order', 'Day', 'Amount', 'Reason']}
          rows={data.orders.map((o: any) => [o.orderNumber, o.businessDate, money(o.totalMinor), o.reason])}
        />
      </div>
    )
  }

  return (
    <div className="stack gap-3">
      <div className="row gap-3">
        <S label="Refunds" v={data.count} />
        <S label="Total refunded" v={formatMoney(data.totalMinor)} />
      </div>
      <Table
        head={['Order', 'Day', 'Amount', 'Method', 'Reason']}
        rows={data.refunds.map((r: any) => [r.orderNumber, r.businessDate, money(r.amountMinor), r.method, r.reason])}
      />
    </div>
  )
}

function S({ label, v }: { label: string; v: React.ReactNode }): JSX.Element {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <span className="stat__value mono tnum">{v}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <h4 style={{ marginBottom: 'var(--s-2)' }}>{title}</h4>
      {children}
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }): JSX.Element {
  if (rows.length === 0) return <EmptyState title="Nothing to show" />
  return (
    <div className="list-scroll">
      <table className="grid">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={i === 0 ? '' : 'num'}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? '' : 'num'}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
