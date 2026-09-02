import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { api } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { useCart } from '../../store/cart'
import { Modal } from '../../components/ui'
import { toast } from '../../store/toast'
import { formatMoney, toPaisa } from '../../lib/format'

export function DiscountModal({ onClose }: { onClose: () => void }): JSX.Element {
  const cart = useCart()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [mode, setMode] = useState<'amount' | 'percent'>('amount')
  const [value, setValue] = useState(cart.discountMinor ? String(cart.discountMinor / 100) : '')
  const [reason, setReason] = useState(cart.discountReason)

  useEffect(() => {
    api.settings.get().then(setSettings)
  }, [])

  const subtotal = cart.subtotal()
  const computed =
    mode === 'amount' ? toPaisa(parseFloat(value || '0')) : Math.round((subtotal * parseFloat(value || '0')) / 100)
  const pct = subtotal ? (computed / subtotal) * 100 : 0

  const blocked = !isAdmin && (!settings?.allowEmployeeDiscount || pct > (settings?.maxEmployeeDiscountPercent ?? 0))

  const apply = (): void => {
    if (computed <= 0) {
      cart.setDiscount(0, '')
      onClose()
      return
    }
    if (computed > subtotal) {
      toast.error('Discount cannot exceed the subtotal.')
      return
    }
    if (blocked) {
      toast.error('You are not authorised to apply a discount that large.')
      return
    }
    if (reason.trim().length < 3) {
      toast.error('Please give a reason for the discount.')
      return
    }
    cart.setDiscount(computed, reason.trim())
    onClose()
  }

  return (
    <Modal
      open
      title="Order discount"
      onClose={onClose}
      width={420}
      footer={
        <>
          {cart.discountMinor > 0 && (
            <button
              className="btn btn--ghost"
              style={{ marginRight: 'auto' }}
              onClick={() => {
                cart.setDiscount(0, '')
                onClose()
              }}
            >
              Remove discount
            </button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={apply} disabled={blocked}>
            Apply
          </button>
        </>
      }
    >
      {!isAdmin && !settings?.allowEmployeeDiscount && (
        <div className="auth__error" style={{ marginBottom: 'var(--s-3)' }}>
          Employee discounts are turned off. Ask an administrator.
        </div>
      )}
      {!isAdmin && settings?.allowEmployeeDiscount && (
        <div className="auth__note" style={{ marginBottom: 'var(--s-3)' }}>
          You may discount up to {settings.maxEmployeeDiscountPercent}% of the subtotal.
        </div>
      )}
      <div className="row gap-2" style={{ marginBottom: 'var(--s-3)' }}>
        <button className={`tag-btn ${mode === 'amount' ? 'is-active' : ''}`} onClick={() => setMode('amount')}>
          Amount (Rs.)
        </button>
        <button className={`tag-btn ${mode === 'percent' ? 'is-active' : ''}`} onClick={() => setMode('percent')}>
          Percent (%)
        </button>
      </div>
      <div className="field">
        <label>{mode === 'amount' ? 'Discount amount' : 'Discount percent'}</label>
        <input className="input mono" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} autoFocus />
      </div>
      <div className="field" style={{ marginTop: 'var(--s-3)' }}>
        <label>Reason</label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. staff meal, regular customer" />
      </div>
      <div className="kv-list" style={{ marginTop: 'var(--s-4)' }}>
        <div className="kv">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal)}</span>
        </div>
        <div className="kv">
          <span>Discount</span>
          <span className={blocked ? 'money-neg' : ''}>
            -{formatMoney(computed)} ({pct.toFixed(1)}%)
          </span>
        </div>
        {cart.serviceChargeMinor > 0 && (
          <div className="kv">
            <span>Service Charges</span>
            <span>+{formatMoney(cart.serviceChargeMinor)}</span>
          </div>
        )}
        <div className="kv" style={{ fontSize: 'var(--text-lg)' }}>
          <span>New total</span>
          <span>{formatMoney(Math.max(0, subtotal - computed) + cart.serviceChargeMinor)}</span>
        </div>
      </div>
    </Modal>
  )
}
