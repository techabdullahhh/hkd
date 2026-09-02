import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../store/auth'
import { useOps } from '../store/ops'
import { liveDuration, formatBusinessDate, initials } from '../lib/format'
import { Money } from '../components/ui'

interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}

const ADMIN_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/pos', label: 'POS', icon: '▤' },
  { to: '/orders', label: 'Orders', icon: '≣' },
  { to: '/employees', label: 'Employees', icon: '⚇' },
  { to: '/sessions', label: 'Sessions', icon: '◔' },
  { to: '/menu', label: 'Menu', icon: '✦' },
  { to: '/deals', label: 'Deals', icon: '❖' },
  { to: '/invoices', label: 'Invoices', icon: '❰❱' },
  { to: '/reports', label: 'Reports', icon: '▩' },
  { to: '/printer', label: 'Printer', icon: '⎙' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
  { to: '/audit', label: 'Audit Log', icon: '☰' }
]

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/pos', label: 'POS', icon: '▤' },
  { to: '/my-session', label: 'My Session', icon: '◔' },
  { to: '/my-sales', label: 'My Sales', icon: '▩' },
  { to: '/my-invoices', label: 'My Invoices', icon: '❰❱' }
]

export function AppShell(): JSX.Element {
  const { user, logout } = useAuth()
  const { businessDay, refresh } = useOps()
  const navigate = useNavigate()
  const [tick, setTick] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  const isAdmin = user?.role === 'ADMIN'
  const nav = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV

  useEffect(() => {
    void refresh()
    const i = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(i)
  }, [refresh])
  void tick

  return (
    <div className="shell">
      <aside className="shell__nav">
        <div className="brand">
          <span className="brand__mark">HKD</span>
          <span className="brand__name">
            HASHMI KA DERA
            <span className="brand__ur urdu">ہاشمی کا ڈیرہ</span>
          </span>
        </div>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav__item ${isActive ? 'is-active' : ''}`}>
              <span className="nav__icon" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="nav__foot">
          <BusinessDayPill businessDate={businessDay?.businessDate ?? null} />
        </div>
      </aside>

      <div className="shell__main">
        <header className="topbar">
          <SessionStrip />
          <div className="row gap-2">
            <button
              className="btn btn--icon"
              onClick={() => refresh()}
              title="Refresh session &amp; business date"
              aria-label="Refresh session and business date"
            >
              ⟳
            </button>
            <div className="usermenu">
              <button className="usermenu__btn" onClick={() => setMenuOpen((v) => !v)}>
                <span className="avatar">{initials(user?.fullName ?? '?')}</span>
                <span className="stack" style={{ alignItems: 'flex-start', lineHeight: 1.15 }}>
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{user?.fullName}</strong>
                  <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
                    {user?.role === 'ADMIN' ? 'Administrator' : 'Employee'}
                  </span>
                </span>
                <span className="muted">▾</span>
              </button>
              {menuOpen && (
                <>
                  <div className="usermenu__scrim" onClick={() => setMenuOpen(false)} />
                  <div className="usermenu__pop">
                    <button
                      className="usermenu__row"
                      onClick={() => {
                        setMenuOpen(false)
                        navigate('/change-password')
                      }}
                    >
                      Change password
                    </button>
                    <button
                      className="usermenu__row usermenu__row--danger"
                      onClick={async () => {
                        setMenuOpen(false)
                        await logout()
                        navigate('/login')
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function BusinessDayPill({ businessDate }: { businessDate: string | null }): JSX.Element {
  const label = businessDate ?? new Date().toISOString().slice(0, 10)
  return (
    <div className="bday-pill" title="Reporting day — the restaurant is always open">
      <span className="dot dot--live" />
      <div className="stack">
        <span className="eyebrow">Business Date</span>
        <strong>{formatBusinessDate(label)}</strong>
      </div>
    </div>
  )
}

function SessionStrip(): JSX.Element {
  const { session } = useOps()
  const [, force] = useState(0)
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 60_000)
    return () => clearInterval(i)
  }, [])

  if (!session)
    return (
      <div className="sess-strip sess-strip--none">
        <span className="dot" />
        No active session — start one from POS or My Session
      </div>
    )
  return (
    <div className="sess-strip">
      <span className="dot dot--live" />
      <span className="sess-strip__name">{session.userFullName}</span>
      <span className="sep">·</span>
      <span className="muted">on since</span>
      <span className="mono">{new Date(session.openedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      <span className="sep">·</span>
      <span className="mono">{liveDuration(session.openedAt)}</span>
      <SessionLiveTotals sessionId={session.id} />
    </div>
  )
}

function SessionLiveTotals({ sessionId }: { sessionId: number }): JSX.Element {
  const [data, setData] = useState<{ orders: number; net: number } | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const s = await api.session.summary({ sessionId })
        if (alive) setData({ orders: s.orderCount, net: s.netSales })
      } catch {
        /* ignore */
      }
    }
    load()
    const i = setInterval(load, 25_000)
    return () => {
      alive = false
      clearInterval(i)
    }
  }, [sessionId])
  if (!data) return <></>
  return (
    <>
      <span className="sep">·</span>
      <span className="mono">{data.orders} orders</span>
      <span className="sep">·</span>
      <Money minor={data.net} />
    </>
  )
}
