import { useEffect, useState } from 'react'
import type { AppSettings, PaymentMethod } from '@shared/types'
import { api } from '../lib/api'
import { useAsync, run } from '../lib/useAsync'
import { Loading, EmptyState, Field } from '../components/ui'
import { confirmDialog } from '../components/confirm'
import { toast } from '../store/toast'
import { relativeTime } from '../lib/format'

export function SettingsPage(): JSX.Element {
  const loaded = useAsync(() => api.settings.get(), [])
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loaded.data && !draft) setDraft(loaded.data)
  }, [loaded.data, draft])

  if (!draft) return <Loading />
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]): void => setDraft({ ...draft, [k]: v })

  const save = async (): Promise<void> => {
    setBusy(true)
    const r = await run(() => api.settings.update(draft), { success: 'Settings saved.' })
    setBusy(false)
    if (r) setDraft(r)
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Restaurant identity, invoice details, the reporting-day rollover, discount policy, payments and backups.</p>
        </div>
        <button className="btn btn--primary" onClick={save} disabled={busy}>
          Save changes
        </button>
      </div>

      <div className="cols cols--2">
        <div className="panel">
          <div className="panel__head">
            <h3>Restaurant &amp; invoice</h3>
          </div>
          <div className="panel__body form-grid">
            <div className="form-row">
              <Field label="Restaurant name (English)">
                <input className="input" value={draft.restaurantName} onChange={(e) => set('restaurantName', e.target.value)} />
              </Field>
              <Field label="Restaurant name (Urdu)">
                <input
                  className="input urdu"
                  value={draft.restaurantNameUrdu}
                  onChange={(e) => set('restaurantNameUrdu', e.target.value)}
                />
              </Field>
            </div>
            <div className="form-row">
              <Field label="Phone">
                <input className="input" value={draft.restaurantPhone} onChange={(e) => set('restaurantPhone', e.target.value)} />
              </Field>
              <Field label="Invoice prefix">
                <input className="input" value={draft.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value)} />
              </Field>
            </div>
            <Field label="Address">
              <input
                className="input"
                value={draft.restaurantAddress}
                onChange={(e) => set('restaurantAddress', e.target.value)}
              />
            </Field>
            <div className="form-row">
              <Field label="Invoice footer">
                <input className="input" value={draft.invoiceFooter} onChange={(e) => set('invoiceFooter', e.target.value)} />
              </Field>
              <Field label="Order prefix">
                <input className="input" value={draft.orderPrefix} onChange={(e) => set('orderPrefix', e.target.value)} />
              </Field>
            </div>
            <Field
              label="Service charge (PKR, per order)"
              hint="Added to every order as “Service Charges”. Existing invoices keep the amount that was applied to them."
            >
              <input
                className="input mono"
                type="number"
                min={0}
                step={1}
                style={{ maxWidth: 140 }}
                value={draft.serviceChargeMinor / 100}
                onChange={(e) => set('serviceChargeMinor', Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)))}
              />
            </Field>
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h3>Reporting day &amp; discounts</h3>
          </div>
          <div className="panel__body form-grid">
            <Field
              label="Reporting day rolls over at hour (0–23)"
              hint="18 = 6 PM, so a night's trade past midnight stays on one date. Set 0 for pure calendar dates."
            >
              <input
                className="input mono"
                type="number"
                min={0}
                max={23}
                style={{ maxWidth: 120 }}
                value={draft.businessDayStartHour}
                onChange={(e) => set('businessDayStartHour', Number(e.target.value))}
              />
            </Field>
            <div className="auth__note" style={{ fontSize: 'var(--text-xs)' }}>
              This only controls which calendar date sales are REPORTED under (a 6 PM rollover keeps a night's trade on one date). It never affects logins, the POS, or employee sessions, and never rewrites history.
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.allowEmployeeDiscount}
                onChange={(e) => set('allowEmployeeDiscount', e.target.checked)}
              />
              Allow employees to apply discounts
            </label>
            <Field label="Max employee discount %">
              <input
                className="input mono"
                type="number"
                min={0}
                max={100}
                value={draft.maxEmployeeDiscountPercent}
                onChange={(e) => set('maxEmployeeDiscountPercent', Number(e.target.value))}
              />
            </Field>
          </div>
        </div>

        <PaymentMethodsPanel />
        <MenuPhotographyPanel />
        <BackupPanel />
      </div>
    </div>
  )
}

/**
 * Attribution for the photography that ships with the app. Every bundled
 * photo is freely licensed, and several of those licences require credit —
 * so the credits live in the product rather than in a file nobody opens.
 * Photos an admin uploads are their own and appear here as nothing.
 */
function MenuPhotographyPanel(): JSX.Element {
  const credits = useAsync(() => api.menu.imageCredits(), [])
  const rows = credits.data ?? []
  if (rows.length === 0) return <></>
  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Menu photography</h3>
        <span className="muted">{rows.length} bundled photos</span>
      </div>
      <div className="panel__body">
        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--s-3)' }}>
          Bundled photos are freely licensed and credited below. Replace any of them from Menu or Deals —
          your own photo is stored in this restaurant&rsquo;s database and travels with backups.
        </p>
        <div className="list-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Item</th>
                <th>Photograph</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {c.credit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function PaymentMethodsPanel(): JSX.Element {
  const list = useAsync(() => api.settings.paymentMethods({ includeInactive: true }), [])
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')

  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Payment methods</h3>
      </div>
      <div className="panel__body">
        {list.loading ? (
          <Loading />
        ) : (
          <div className="stack gap-2" style={{ marginBottom: 'var(--s-3)' }}>
            {(list.data ?? []).map((m: PaymentMethod) => (
              <div key={m.id} className="row between">
                <div className="row gap-2">
                  <span className="mono">{m.code}</span>
                  <span>{m.label}</span>
                  {m.requiresReference && <span className="chip">ref</span>}
                  {m.allowsChange && <span className="chip">change</span>}
                </div>
                <button
                  className={`btn btn--sm ${m.isActive ? 'is-on' : ''}`}
                  title={m.isActive ? `Turn ${m.label} off — it will disappear from the POS` : `Turn ${m.label} back on`}
                  onClick={() =>
                    run(() => api.settings.paymentMethodUpdate({ id: m.id, isActive: !m.isActive }), {}).then(list.reload)
                  }
                >
                  {m.isActive ? '✓ Active' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="form-row">
          <input className="input mono" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <input className="input" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button
          className="btn btn--block"
          style={{ marginTop: 'var(--s-2)' }}
          onClick={async () => {
            if (!code || !label) return toast.error('Code and label are required.')
            const r = await run(() => api.settings.paymentMethodCreate({ code, label }), { success: 'Payment method added.' })
            if (r) {
              setCode('')
              setLabel('')
              list.reload()
            }
          }}
        >
          Add payment method
        </button>
      </div>
    </div>
  )
}

function BackupPanel(): JSX.Element {
  const list = useAsync(() => api.backup.list(), [])
  const [busy, setBusy] = useState(false)

  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Backup &amp; restore</h3>
        <div className="row gap-2">
          <button
            className="btn btn--sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await run(() => api.backup.create({}), { success: 'Backup created.' })
              setBusy(false)
              list.reload()
            }}
          >
            Create backup
          </button>
          <button
            className="btn btn--sm"
            onClick={() => run(() => api.backup.exportJson(), { success: 'JSON export written.' })}
          >
            Export JSON
          </button>
        </div>
      </div>
      <div className="panel__body">
        {list.loading ? (
          <Loading />
        ) : !list.data || list.data.length === 0 ? (
          <EmptyState title="No backups yet" hint="Backups are stored in the app data folder" />
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.path}>
                  <td className="mono" style={{ fontSize: 'var(--text-xs)' }}>
                    {b.name}
                  </td>
                  <td className="muted">{(b.sizeBytes / 1024).toFixed(0)} KB</td>
                  <td className="muted">{relativeTime(b.createdAt)}</td>
                  <td className="num">
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: 'Restore this backup?',
                          message:
                            'This replaces the entire current database. A safety copy of the current data is made first, but all changes since this backup will be gone.',
                          danger: true,
                          confirmLabel: 'Restore',
                          typeToConfirm: 'RESTORE'
                        })
                        if (!ok) return
                        await run(() => api.backup.restore({ path: b.path, confirm: 'RESTORE' }), {
                          success: 'Database restored. Please sign in again.'
                        })
                        setTimeout(() => window.location.reload(), 1200)
                      }}
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
