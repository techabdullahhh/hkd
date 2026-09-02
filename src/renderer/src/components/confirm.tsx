import { create } from 'zustand'
import { useState } from 'react'
import { Modal } from './ui'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** if set, the user must type this exact phrase to enable Confirm */
  typeToConfirm?: string
}

interface ConfirmStore {
  open: boolean
  opts: ConfirmOptions | null
  resolve: ((ok: boolean) => void) | null
  ask: (o: ConfirmOptions) => Promise<boolean>
  close: (ok: boolean) => void
}

const useStore = create<ConfirmStore>((set, get) => ({
  open: false,
  opts: null,
  resolve: null,
  ask: (o) =>
    new Promise<boolean>((resolve) => {
      set({ open: true, opts: o, resolve })
    }),
  close: (ok) => {
    get().resolve?.(ok)
    set({ open: false, opts: null, resolve: null })
  }
}))

export const confirmDialog = (o: ConfirmOptions): Promise<boolean> => useStore.getState().ask(o)

export function ConfirmHost(): JSX.Element | null {
  const { open, opts, close } = useStore()
  const [typed, setTyped] = useState('')
  if (!open || !opts) return null
  const needsType = !!opts.typeToConfirm
  const canConfirm = !needsType || typed === opts.typeToConfirm
  return (
    <Modal
      open={open}
      title={opts.title}
      onClose={() => {
        setTyped('')
        close(false)
      }}
      width={430}
      footer={
        <>
          <button
            className="btn btn--ghost"
            onClick={() => {
              setTyped('')
              close(false)
            }}
          >
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={`btn ${opts.danger ? 'btn--danger' : 'btn--primary'}`}
            disabled={!canConfirm}
            onClick={() => {
              setTyped('')
              close(true)
            }}
          >
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-md)', lineHeight: 1.5 }}>{opts.message}</p>
      {needsType && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <input
            className="input"
            autoFocus
            placeholder={`Type "${opts.typeToConfirm}" to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      )}
    </Modal>
  )
}
