import { useEffect, useState } from 'react'
import type { PrinterMode, PrinterState } from '@shared/types'
import { api } from '../lib/api'
import { useAsync, run } from '../lib/useAsync'
import { Loading, EmptyState } from '../components/ui'
import { confirmDialog } from '../components/confirm'

/**
 * How each mode is described to the person choosing it.
 *
 * Deliberately phrased around the cable or the lack of one, because that is
 * what an admin standing next to the printer actually knows. The trade-off each
 * one carries is in the hint rather than hidden in documentation — picking the
 * wrong transport is the single most common way this app fails to print.
 */
const MODE_OPTIONS: { value: PrinterMode; label: string; hint: string }[] = [
  {
    value: 'SYSTEM',
    label: 'Through the printer’s driver',
    hint: 'The receipt is laid out by this app and printed the way any program prints. If the printer feeds a long blank strip after each receipt, or prints tiny, use one of the direct options instead.'
  },
  {
    value: 'ESCPOS_RAW',
    label: 'Direct ESC/POS — wired USB (most reliable)',
    hint: 'The printer does its own layout and cuts after every receipt. The best option whenever a cable is possible: nothing to pair, no address, no network to drop.'
  },
  {
    value: 'ESCPOS_BLUETOOTH',
    label: 'Direct ESC/POS — Bluetooth',
    hint: 'For a printer paired over Bluetooth. Same receipt as the wired option. Pair the printer in the operating system first; it then appears as a serial port below.'
  },
  {
    value: 'ESCPOS_NETWORK',
    label: 'Direct ESC/POS — network (Wi-Fi or LAN)',
    hint: 'For a printer with Wi-Fi or an Ethernet socket, addressed directly on port 9100. Needs no pairing and no drivers — give the printer a fixed address on the router so it cannot move.'
  }
]

/** Serial speeds offered. Ignored over Bluetooth; it matters on a real cable. */
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200]

export function PrinterPage(): JSX.Element {
  const state = useAsync(() => api.printer.state(), [])
  const [busy, setBusy] = useState(false)
  /*
   * The mode the admin has *selected*, which is not always the mode that is
   * saved. Network printing cannot be saved until an address exists, so
   * selecting it has to reveal the address field before it can be applied —
   * otherwise the dropdown silently snaps back and there is no way to reach the
   * field that would make it valid. Found by driving the real page.
   */
  const [pendingMode, setPendingMode] = useState<PrinterMode | null>(null)

  if (state.loading && !state.data) return <Loading />
  if (!state.data) return <EmptyState title="Printer status unavailable" hint={state.error ?? undefined} />
  const s = state.data

  const update = async (patch: Partial<typeof s.settings>): Promise<void> => {
    setBusy(true)
    const r = await run(() => api.printer.updateSettings(patch), {})
    setBusy(false)
    if (r) {
      setPendingMode(null)
      state.reload()
    }
  }

  const availability = (mode: PrinterMode): { available: boolean; reason: string } =>
    s.modes.find((m) => m.mode === mode) ?? { available: true, reason: '' }

  /** What the form is showing: the pending selection, else what is saved. */
  const uiMode = pendingMode ?? s.settings.mode
  const current = MODE_OPTIONS.find((m) => m.value === uiMode)
  const currentAvailability = availability(uiMode)
  /** Selected but not yet saved, because it still needs an address. */
  const awaitingAddress = uiMode === 'ESCPOS_NETWORK' && s.settings.mode !== 'ESCPOS_NETWORK'

  const chooseMode = (mode: PrinterMode): void => {
    setPendingMode(mode)
    // Apply straight away unless the mode needs configuration it lacks.
    if (mode !== 'ESCPOS_NETWORK' || s.settings.networkAddress) update({ mode })
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Printer</h1>
          <p>{headline(s)}</p>
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
            {/* Printer messages carry commands to run, so newlines must survive. */}
            <p
              className={s.reachable ? 'muted' : 'auth__error'}
              style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
            >
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
              <label>How the printer is connected</label>
              <select
                className="select"
                value={uiMode}
                disabled={busy}
                onChange={(e) => chooseMode(e.target.value as PrinterMode)}
              >
                {MODE_OPTIONS.map((m) => {
                  const a = availability(m.value)
                  return (
                    <option key={m.value} value={m.value} disabled={!a.available}>
                      {m.label}
                      {a.available ? '' : ' — not possible on this computer'}
                    </option>
                  )
                })}
              </select>
              <span className="muted" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.55 }}>
                {currentAvailability.available ? current?.hint : currentAvailability.reason}
              </span>
              {/* A mode that cannot work here is worth stating loudly, once. */}
              {!currentAvailability.available && (
                <span className="auth__error" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.55 }}>
                  This connection cannot be used on this computer — choose another, or invoices will not print.
                </span>
              )}
              {awaitingAddress && (
                <span className="auth__error" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.55 }}>
                  Enter the printer&rsquo;s address below and press Save to finish switching. Until then invoices
                  keep printing the way they do now.
                </span>
              )}
            </div>

            {uiMode === 'ESCPOS_NETWORK' ? (
              <NetworkAddressField
                value={s.settings.networkAddress}
                busy={busy}
                // Saving the address is also what completes a pending switch to
                // network printing, so both land in one call.
                onSave={(networkAddress) =>
                  update(awaitingAddress && networkAddress ? { networkAddress, mode: 'ESCPOS_NETWORK' } : { networkAddress })
                }
              />
            ) : (
              <div className="field">
                <label>Receipt printer</label>
                <select
                  className="select"
                  value={s.settings.selectedPrinter ?? ''}
                  disabled={busy}
                  onChange={(e) => update({ selectedPrinter: e.target.value || null })}
                >
                  <option value="">Automatic — the printer that looks like a receipt printer</option>
                  {s.availablePrinters.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName}
                      {p.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                {s.availablePrinters.length === 0 && (
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {emptyPrinterHint(s)}
                  </span>
                )}
              </div>
            )}

            {uiMode === 'ESCPOS_BLUETOOTH' && (
              <div className="field">
                <label>Speed</label>
                <select
                  className="select"
                  value={s.settings.baudRate}
                  disabled={busy}
                  onChange={(e) => update({ baudRate: Number(e.target.value) })}
                >
                  {BAUD_RATES.map((b) => (
                    <option key={b} value={b}>
                      {b.toLocaleString()} baud{b === 9600 ? ' (standard)' : ''}
                    </option>
                  ))}
                </select>
                <span className="muted" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.55 }}>
                  Bluetooth negotiates its own speed, so this makes no difference over Bluetooth. It only
                  matters for a printer on a serial cable — leave it at 9,600 unless the printer’s manual says
                  otherwise.
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

        {uiMode === 'ESCPOS_BLUETOOTH' && (
          <BluetoothPanel available={currentAvailability.available} onChanged={state.reload} />
        )}

        <LogoPanel paperWidth={s.settings.paperWidth} />

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel__head">
            <h3>Detected printers ({s.availablePrinters.length})</h3>
          </div>
          <div className="panel__body">
            {s.availablePrinters.length === 0 ? (
              <EmptyState title="No printers found" hint={emptyPrinterHint(s)} />
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Connection</th>
                    <th>Status</th>
                    <th>Default</th>
                  </tr>
                </thead>
                <tbody>
                  {s.availablePrinters.map((p) => (
                    <tr key={p.name}>
                      <td className="mono">{p.displayName}</td>
                      <td className="muted">{p.description || '—'}</td>
                      <td>{p.status === 0 ? 'Ready' : <span className="muted">Not ready ({p.status})</span>}</td>
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

/** The one-line explanation under the page title, which depends on the host. */
function headline(s: PrinterState): JSX.Element {
  if (s.platform === 'chromeos') {
    return (
      <>
        On Chrome OS a <strong>USB</strong> printer must first be shared with Linux:{' '}
        <strong>Settings → About Chrome OS → Linux → Manage USB devices</strong>. It then appears below as{' '}
        <span className="mono">/dev/usb/lp0</span>. Bluetooth is not available inside the Linux container at
        all — for a wireless printer, use <strong>network</strong> printing.
      </>
    )
  }
  return (
    <>
      Connect the receipt printer by USB, pair it over Bluetooth, or put it on the network — then choose how it
      is connected below.
    </>
  )
}

function emptyPrinterHint(s: PrinterState): string {
  if (s.settings.mode === 'ESCPOS_BLUETOOTH') {
    return 'No Bluetooth or serial port found. Pair the printer in the operating system’s Bluetooth settings, then press Refresh printers.'
  }
  if (s.platform === 'chromeos') {
    return 'Nothing connected yet. Share the printer with Linux in Chrome OS settings (Settings → About Chrome OS → Linux → Manage USB devices), then press Refresh printers.'
  }
  return 'Nothing installed yet. Connect the USB cable, install the printer’s driver, then press Refresh printers.'
}

/**
 * The network printer's address.
 *
 * Held in local state and saved explicitly rather than on every keystroke:
 * saving each character would validate half-typed addresses and reject them,
 * which makes the field feel broken while it is being filled in.
 */
function NetworkAddressField({
  value,
  busy,
  onSave
}: {
  value: string | null
  busy: boolean
  onSave: (v: string | null) => void
}): JSX.Element {
  const [text, setText] = useState(value ?? '')
  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState<string[] | null>(null)

  // Keep in step when the value changes elsewhere (a scan result, a reload).
  useEffect(() => setText(value ?? ''), [value])

  const dirty = text.trim() !== (value ?? '')

  const scan = async (): Promise<void> => {
    setScanning(true)
    setFound(null)
    const r = await run(() => api.printer.findNetwork(), {})
    setScanning(false)
    if (r) setFound(r.map((x) => x.address))
  }

  return (
    <div className="field">
      <label>Printer address</label>
      <div className="row gap-2 wrap">
        <input
          className="input mono"
          style={{ flex: '1 1 12rem' }}
          placeholder="192.168.1.50"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) onSave(text.trim() || null)
          }}
        />
        <button className="btn" disabled={busy || !dirty} onClick={() => onSave(text.trim() || null)}>
          Save
        </button>
        <button className="btn btn--sm" disabled={scanning || busy} onClick={scan}>
          {scanning ? 'Searching…' : 'Find printers'}
        </button>
      </div>
      <span className="muted" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.55 }}>
        The printer’s IP address — port 9100 unless you add one, as in{' '}
        <span className="mono">192.168.1.50:9100</span>. Most thermal printers print their address on a
        self-test slip if you hold the feed button while switching them on.
      </span>
      {found != null && (
        <span className="muted" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
          {found.length === 0 ? (
            <>
              Nothing found on this network. Check the printer is switched on and joined to the same Wi-Fi, then
              search again — or type the address in by hand.
            </>
          ) : (
            <>
              Found:{' '}
              {found.map((addr) => (
                <button
                  key={addr}
                  className="btn btn--sm mono"
                  style={{ marginRight: '0.35rem' }}
                  onClick={() => onSave(addr)}
                >
                  Use {addr}
                </button>
              ))}
            </>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * Pairing lives in the operating system, so this panel does not try to pair.
 * It exists for the step that has no UI anywhere else: on Linux a paired
 * printer produces no serial port until it is bound to one, so a correctly
 * paired printer looks like nothing happened. The button does that binding.
 */
function BluetoothPanel({ available, onChanged }: { available: boolean; onChanged: () => void }): JSX.Element {
  const paired = useAsync(() => api.printer.pairedBluetooth(), [])
  const [busy, setBusy] = useState(false)
  const isLinux = window.hkd?.platform === 'linux'

  const bind = async (address: string): Promise<void> => {
    setBusy(true)
    const r = await run(() => api.printer.bindBluetooth({ address }), {
      success: 'Bluetooth printer connected to a port.'
    })
    setBusy(false)
    if (r) {
      paired.reload()
      onChanged()
    }
  }

  return (
    <div className="panel" style={{ gridColumn: '1 / -1' }}>
      <div className="panel__head">
        <h3>Bluetooth printer</h3>
        <button className="btn btn--sm" onClick={paired.reload}>
          Re-scan paired devices
        </button>
      </div>
      <div className="panel__body stack gap-3">
        {!available ? (
          <p className="auth__error" style={{ fontSize: 'var(--text-sm)', margin: 0, lineHeight: 1.6 }}>
            Bluetooth is not available on this computer, so nothing here can be used.
          </p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0, lineHeight: 1.6 }}>
              Pair the printer in the operating system first — this app deliberately does not handle pairing,
              because the PIN prompt belongs there and it is done once per printer.
              {isLinux && (
                <>
                  {' '}
                  On Linux, pairing alone is not enough: the printer also has to be bound to a port, which is
                  what <strong>Connect</strong> does below. That binding is lost when the computer restarts.
                </>
              )}
            </p>

            {paired.loading && !paired.data ? (
              <Loading />
            ) : !paired.data || paired.data.length === 0 ? (
              <EmptyState
                title="No paired Bluetooth devices"
                hint="Pair the printer in the operating system’s Bluetooth settings, then press Re-scan paired devices."
              />
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Address</th>
                    {isLinux && <th />}
                  </tr>
                </thead>
                <tbody>
                  {paired.data.map((d) => (
                    <tr key={`${d.address}:${d.name}`}>
                      <td>{d.name}</td>
                      <td className="mono muted">{d.address || '—'}</td>
                      {isLinux && (
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn--sm" disabled={busy || !d.address} onClick={() => bind(d.address)}>
                            Connect
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
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
