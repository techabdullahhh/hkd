import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { formatMoney } from '../lib/format'

/* ------------------------------- Money -------------------------------- */

export function Money({ minor, plain, sign }: { minor: number; plain?: boolean; sign?: boolean }): JSX.Element {
  const cls = sign ? (minor < 0 ? 'money-neg' : minor > 0 ? 'money-pos' : '') : ''
  return <span className={`mono tnum ${cls}`}>{formatMoney(minor, { withSymbol: !plain })}</span>
}

/* ------------------------------ Spinner ------------------------------- */

export function Loading({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="row center gap-2" style={{ padding: 'var(--s-6)', color: 'var(--ink-3)' }}>
      <span className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state__mark" aria-hidden>
        ✻
      </div>
      <strong>{title}</strong>
      {hint && <span className="muted">{hint}</span>}
      {action}
    </div>
  )
}

/* ------------------------------- Modal -------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 460,
  dismissable = true
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: number
  dismissable?: boolean
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose()
    }
    window.addEventListener('keydown', h)
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, dismissable])

  if (!open) return null
  return createPortal(
    <div className="modal-scrim" onMouseDown={() => dismissable && onClose()}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h3>{title}</h3>
          {dismissable && (
            <button className="btn btn--icon" onClick={onClose} aria-label="Close this dialog" title="Close (Esc)">
              ✕
            </button>
          )}
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/* --------------------------- Field helpers ---------------------------- */

export function Field({
  label,
  children,
  hint,
  error
}: {
  label: string
  children: ReactNode
  hint?: string
  error?: string
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>{error}</span>
      ) : hint ? (
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/* ------------------------------ StatCard ----------------------------- */

export function Stat({
  label,
  value,
  sub,
  tone
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'accent' | 'ok' | 'danger'
}): JSX.Element {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <span className="eyebrow">{label}</span>
      <span className="stat__value mono tnum">{value}</span>
      {sub != null && <span className="stat__sub muted">{sub}</span>}
    </div>
  )
}

