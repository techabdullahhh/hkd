import { create } from 'zustand'
import { useEffect } from 'react'

export type ToastKind = 'info' | 'success' | 'error' | 'warn'
export interface Toast {
  id: number
  kind: ToastKind
  title: string
  detail?: string
}

interface ToastStore {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let seq = 1

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = seq++
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' ? 7000 : 4200)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}))

export const toast = {
  success: (title: string, detail?: string) => useToasts.getState().push({ kind: 'success', title, detail }),
  error: (title: string, detail?: string) => useToasts.getState().push({ kind: 'error', title, detail }),
  info: (title: string, detail?: string) => useToasts.getState().push({ kind: 'info', title, detail }),
  warn: (title: string, detail?: string) => useToasts.getState().push({ kind: 'warn', title, detail })
}

export function Toaster(): JSX.Element {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastRow({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }): JSX.Element {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onDismiss])
  return (
    <div className={`toast toast--${t.kind}`} role="status" onClick={onDismiss}>
      <span className="toast__bar" />
      <div className="stack gap-1">
        <strong>{t.title}</strong>
        {t.detail && <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>{t.detail}</span>}
      </div>
    </div>
  )
}
