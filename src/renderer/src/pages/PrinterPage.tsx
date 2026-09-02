import { useState } from 'react'
import { api } from '../lib/api'
import { useAsync, run } from '../lib/useAsync'
import { Loading, EmptyState } from '../components/ui'
import { confirmDialog } from '../components/confirm'

export function PrinterPage(): JSX.Element {
  const state = useAsync(() => api.printer.state(), [])
  const [busy, setBusy] = useState(false)

  if (state.loading && !state.data) return <Loading />
  if (!state.data) return <EmptyState title="Printer status unavailable" hint={state.error ?? undefined} />
  const s = state.data

  const update = async (patch: Partial<typeof s.settings>): Promise<void> => {
    setBusy(true)
    const r = await run(() => api.printer.updateSettings(patch), {})
    setBusy(false)
    if (r) state.reload()
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Printer</h1>
          <p>Bluetooth thermal printers paired with the operating system appear here automatically.</p>
        </div>
        <button className="btn btn--sm" onClick={state.reload}>
          Refresh printers
        </button>
      </div>

      <div className="cols cols--2">
        <div className="panel">
          <div className="panel__head">
            <h3>Status</h3>
            <span className={`chip ${s.reachable ? 'chip--ok' : 'chip--danger'}`}>
              <span className={`dot ${s.reachable ? 'dot--live' : ''}`} />
              {s.reachable ? 'Ready' : 'Not ready'}
            </span>
          </div>
          <div className="panel__body stack gap-3">
            <p className={s.reachable ? 'muted' : 'auth__error'} style={{ fontSize: 'var(--text-sm)' }}>
              {s.message}
            </p>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(() => api.invoices.testPrint(), { success: 'Test print sent.' })}
            >
              Print test invoice
            </button>
            <button className="btn btn--sm" onClick={() => run(() => api.printer.probe(), {}).then(state.reload)}>
              Re-check connection
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h3>Configuration</h3>
          </div>
          <div className="panel__body form-grid">
            <div className="field">
              <label>Printer mode</label>
              <select className="select" value={s.settings.mode} onChange={(e) => update({ mode: e.target.value as any })}>
                <option value="SYSTEM">System printer (recommended)</option>
                <option value="ESCPOS_BLUETOOTH">Direct ESC/POS Bluetooth (advanced)</option>
              </select>
            </div>

            {s.settings.mode === 'SYSTEM' ? (
              <div className="field">
                <label>Selected printer</label>
                <select
                  className="select"
                  value={s.settings.selectedPrinter ?? ''}
                  onChange={(e) => update({ selectedPrinter: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {s.availablePrinters.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName} {p.isDefault ? '(system default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="field">
                <label>Bluetooth serial address / port</label>
                <input
                  className="input mono"
                  defaultValue={s.settings.escposAddress ?? ''}
                  placeholder="e.g. COM5  or  /dev/tty.PRINTER"
                  onBlur={(e) => update({ escposAddress: e.target.value || null })}
                />
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                  Direct mode needs a hardware adapter to be completed for your exact printer model — see the README.
                </span>
              </div>
            )}

            <div className="form-row">
              <div className="field">
                <label>Paper width</label>
                <select
                  className="select"
                  value={s.settings.paperWidth}
                  onChange={(e) => update({ paperWidth: Number(e.target.value) as 58 | 80 })}
                >
                  <option value={58}>58 mm</option>
                  <option value={80}>80 mm</option>
                </select>
              </div>
              <div className="field">
                <label>Copies per invoice</label>
                <input
                  className="input mono"
                  type="number"
                  min={1}
                  max={5}
                  value={s.settings.copies}
                  onChange={(e) => update({ copies: Math.max(1, Math.min(5, Number(e.target.value))) })}
                />
              </div>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={s.settings.autoPrint}
                onChange={(e) => update({ autoPrint: e.target.checked })}
              />
              Print invoice automatically after payment
            </label>
          </div>
        </div>

        <LogoPanel paperWidth={s.settings.paperWidth} />

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel__head">
            <h3>Detected printers ({s.availablePrinters.length})</h3>
          </div>
          <div className="panel__body">
            {s.availablePrinters.length === 0 ? (
              <EmptyState
                title="No printers found"
                hint="Pair the Bluetooth thermal printer through the operating system settings, then Refresh."
              />
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Default</th>
                  </tr>
                </thead>
                <tbody>
                  {s.availablePrinters.map((p) => (
                    <tr key={p.name}>
                      <td className="mono">{p.displayName}</td>
                      <td className="muted">{p.description || '—'}</td>
                      <td className="mono">{p.status}</td>
                      <td>{p.isDefault ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


/**
 * The invoice logo.
 *
 * The preview deliberately shows the converted 1-bit line art rather than the
 * colour original: a thermal head has no greys, so this is the only honest
 * preview of what comes out of the printer.
 */
function LogoPanel({ paperWidth }: { paperWidth: 58 | 80 }): JSX.Element {
  const logo = useAsync(() => api.printer.logo(), [paperWidth])
  const [busy, setBusy] = useState(false)
  const l = logo.data

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    await fn()
    setBusy(false)
    logo.reload()
  }

  return (
    // Full width: this panel exists so the logo can actually be inspected,
    // and a thumbnail too small to read would defeat that.
    <div className="panel" style={{ gridColumn: '1 / -1' }}>
      <div className="panel__head">
        <h3>Invoice logo</h3>
        {l && <span className="muted mono">{l.widthDots} dots</span>}
      </div>
      <div className="panel__body">
        <div className="logo-panel">
          <div className="logo-panel__preview">
            {l?.previewDataUrl ? (
              <img src={l.previewDataUrl} alt="The logo as it will be printed" />
            ) : (
              <div className="logo-panel__none">No logo</div>
            )}
          </div>
          <div className="logo-panel__side">
            <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0, lineHeight: 1.6 }}>
              Printed at the top of every invoice. A thermal head can only burn or not burn each dot, so the
              logo is converted to line art at the {paperWidth} mm head&rsquo;s {l?.widthDots ?? 576} dots —
              this preview is exactly what the paper will show.
              {l?.inkPercent != null && <> Roughly <strong>{l.inkPercent}%</strong> of dots are burnt.</>}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={!!l?.enabled}
                disabled={busy || !l}
                onChange={(e) =>
                  act(() =>
                    run(() => api.printer.updateSettings({ printLogo: e.target.checked }), {
                      success: e.target.checked ? 'Logo will be printed.' : 'Logo turned off.'
                    })
                  )
                }
              />
              Print the logo on invoices
            </label>
            <div className="row gap-2 wrap">
              <button
                className="btn btn--lg"
                disabled={busy}
                onClick={() => act(() => run(() => api.printer.logoChoose(), { success: 'Logo updated.' }))}
              >
                {l?.hasLogo ? 'Replace logo…' : 'Upload logo…'}
              </button>
              {l?.hasLogo && (
                <button
                  className="btn btn--lg btn--danger"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: 'Remove the invoice logo?',
                        message: 'Invoices will print with the restaurant name only. You can upload it again later.',
                        danger: true
                      })
                    )
                      act(() => run(() => api.printer.logoRemove(), { success: 'Logo removed.' }))
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
