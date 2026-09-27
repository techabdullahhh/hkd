import { eq } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { PairedBluetoothDevice, PrinterInfo, PrinterSettings, PrinterState } from '@shared/types'
import type { PrinterAdapter, RenderedInvoice } from '../printer/types'
import { SystemPrinterAdapter } from '../printer/SystemPrinterAdapter'
import { EscposRawAdapter } from '../printer/EscposRawAdapter'
import { EscposBluetoothAdapter } from '../printer/EscposBluetoothAdapter'
import { EscposNetworkAdapter } from '../printer/EscposNetworkAdapter'
import { defaultModeForHost, isPrinterMode, modeAvailability, reconcileMode } from '../printer/modes'
import { BAUD_RATES, DEFAULT_BAUD } from '../printer/serialPort'
import { bindRfcomm, listPairedDevices } from '../printer/bluetooth'
import { formatTarget, parseTarget, scanForPrinters } from '../printer/networkPrinter'
import { audit } from './audit'
import { requireAdmin, requireAuth } from './context'
import { BRAND_LOGO_ID, clearImage, imageStamp, pickAndSetLogo, readImage } from './images'
import { toThermalLineArt, toThermalRaster, type ThermalRaster } from '../printer/thermalImage'
import { logoDotsForPaper } from '../printer/paper'
import { isChromeOsContainer } from '../platform'

const DEFAULTS: PrinterSettings = {
  mode: 'SYSTEM',
  selectedPrinter: null,
  networkAddress: null,
  baudRate: DEFAULT_BAUD,
  paperWidth: 80,
  autoPrint: true,
  copies: 1,
  printLogo: true
}

const KEY = 'printer.settings'

/**
 * Chrome OS gets raw ESC/POS out of the box. Its Linux container has no
 * print system at all, so the driver path cannot reach a printer there —
 * defaulting to it would mean every fresh Chromebook install fails its
 * first test print for a reason nobody could guess.
 */
function defaultsForHost(): PrinterSettings {
  return { ...DEFAULTS, mode: defaultModeForHost() }
}

export function getPrinterSettings(): PrinterSettings {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).get()
  if (!row) return defaultsForHost()
  try {
    const stored = JSON.parse(row.value) as Omit<Partial<PrinterSettings>, 'mode'> & {
      mode?: unknown
      /** Pre-1.0 field: a Bluetooth MAC. Superseded by a serial port name. */
      escposAddress?: unknown
    }
    const { escposAddress: _legacy, ...rest } = stored
    const merged = { ...defaultsForHost(), ...rest, mode: reconcileMode(stored.mode) }
    // A hand-edited or copied-in settings row must not be able to put an
    // impossible baud rate on the serial port.
    if (!(BAUD_RATES as readonly number[]).includes(merged.baudRate)) merged.baudRate = DEFAULT_BAUD
    return merged
  } catch {
    return defaultsForHost()
  }
}

function savePrinterSettings(next: PrinterSettings, actorId?: number): void {
  const value = JSON.stringify(next)
  db.insert(schema.appSettings)
    .values({ key: KEY, value, updatedBy: actorId ?? null, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy: actorId ?? null, updatedAt: Date.now() } })
    .run()
}

export function getAdapter(settings = getPrinterSettings()): PrinterAdapter {
  // Every ESC/POS mode prints the identical bytes, so they share one logo
  // source; only the transport below differs.
  const logo = (paperWidth: 58 | 80): ThermalRaster | null =>
    settings.printLogo ? renderLogoRaster(logoDotsForPaper(paperWidth)) : null

  switch (settings.mode) {
    case 'ESCPOS_RAW':
      return new EscposRawAdapter(logo)
    case 'ESCPOS_BLUETOOTH':
      return new EscposBluetoothAdapter(logo, settings.baudRate)
    case 'ESCPOS_NETWORK':
      return new EscposNetworkAdapter(logo, settings.networkAddress)
    default:
      return new SystemPrinterAdapter()
  }
}

export async function listPrinters(): Promise<PrinterInfo[]> {
  requireAuth()
  try {
    return await getAdapter().listPrinters()
  } catch {
    return []
  }
}

export async function probePrinter(): Promise<{ reachable: boolean; message: string }> {
  requireAuth()
  const settings = getPrinterSettings()
  try {
    return await getAdapter(settings).probe(settings.selectedPrinter)
  } catch (e) {
    return { reachable: false, message: e instanceof Error ? e.message : 'Printer check failed.' }
  }
}

export async function getPrinterState(): Promise<PrinterState> {
  requireAuth()
  const settings = getPrinterSettings()
  let availablePrinters: PrinterInfo[] = []
  try {
    availablePrinters = await getAdapter(settings).listPrinters()
  } catch {
    availablePrinters = []
  }
  const probe = await probePrinter()
  return {
    settings,
    availablePrinters,
    reachable: probe.reachable,
    message: probe.message,
    modes: modeAvailability(),
    platform: isChromeOsContainer() ? 'chromeos' : process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  }
}

export async function updatePrinterSettings(patch: Partial<PrinterSettings>): Promise<PrinterState> {
  const admin = requireAdmin()
  const current = getPrinterSettings()
  const next: PrinterSettings = { ...current, ...patch }

  if (next.paperWidth !== 58 && next.paperWidth !== 80)
    throw new AppError('VALIDATION', 'Paper width must be 58 or 80 mm.')
  if (!isPrinterMode(next.mode)) throw new AppError('VALIDATION', 'Invalid printer mode.')
  if (!Number.isInteger(next.copies) || next.copies < 1 || next.copies > 5)
    throw new AppError('VALIDATION', 'Copies must be between 1 and 5.')
  if (!(BAUD_RATES as readonly number[]).includes(next.baudRate))
    throw new AppError('VALIDATION', `Speed must be one of ${BAUD_RATES.join(', ')}.`)

  /*
   * Refusing a mode this machine cannot use is the whole point of tracking
   * availability — the alternative is a setting that saves cleanly and then
   * fails at the counter with a message about the printer being off.
   */
  const availability = modeAvailability().find((m) => m.mode === next.mode)
  if (availability && !availability.available) {
    throw new AppError('VALIDATION', availability.reason)
  }

  // A network printer with no address cannot print, and the failure would
  // surface as a mystery at the till rather than here.
  if (next.networkAddress != null) {
    const trimmed = next.networkAddress.trim()
    next.networkAddress = trimmed.length === 0 ? null : trimmed
    if (next.networkAddress && !parseTarget(next.networkAddress)) {
      throw new AppError('VALIDATION', `"${next.networkAddress}" is not a printer address. Use the printer's IP address, for example 192.168.1.50.`)
    }
  }
  if (next.mode === 'ESCPOS_NETWORK' && !next.networkAddress) {
    throw new AppError('VALIDATION', 'Enter the network printer’s IP address before switching to network printing.')
  }
  next.printLogo = !!next.printLogo

  savePrinterSettings(next, admin.id)
  audit({
    action: 'PRINTER_SETTINGS_CHANGED',
    summary: `Printer set to ${MODE_LABELS[next.mode]}, ${next.paperWidth}mm, printer "${next.mode === 'ESCPOS_NETWORK' ? (next.networkAddress ?? 'unset') : (next.selectedPrinter ?? 'auto')}"`,
    entityType: 'printer'
  })
  return getPrinterState()
}

/** For the audit trail, so a change reads the same as the UI that made it. */
const MODE_LABELS: Record<PrinterSettings['mode'], string> = {
  SYSTEM: 'system driver',
  ESCPOS_RAW: 'direct ESC/POS (wired)',
  ESCPOS_BLUETOOTH: 'direct ESC/POS over Bluetooth',
  ESCPOS_NETWORK: 'direct ESC/POS over the network'
}

/* ------------------------- Bluetooth and network -------------------------- */

/**
 * Bluetooth devices the operating system has already paired.
 *
 * Pairing stays in the OS — it needs PIN prompts and is done once per printer —
 * so this is read-only. Its value is telling the admin that the printer *is*
 * paired, which on Linux is the step that produces no port and therefore looks
 * like nothing happened.
 */
export async function listPairedBluetooth(): Promise<PairedBluetoothDevice[]> {
  requireAuth()
  try {
    return await listPairedDevices()
  } catch {
    return []
  }
}

/**
 * Create `/dev/rfcommN` for a paired printer (Linux only).
 *
 * Admin-only and audited: it changes how the machine talks to hardware, and it
 * is the one Bluetooth step that is not just reading state.
 */
export async function bindBluetoothPrinter(input: { address: string }): Promise<{ path: string }> {
  requireAdmin()
  const path = await bindRfcomm(input.address)
  audit({
    action: 'PRINTER_SETTINGS_CHANGED',
    summary: `Bound Bluetooth printer ${input.address} to ${path}`,
    entityType: 'printer'
  })
  return { path }
}

/**
 * Sweep the local network for printers listening on port 9100.
 *
 * Explicitly user-initiated — it opens a connection to every address on the
 * subnet, which is fine on a button press and wrong on a timer.
 */
export async function findNetworkPrinters(): Promise<{ address: string }[]> {
  requireAuth()
  const found = await scanForPrinters()
  return found.map((t) => ({ address: formatTarget(t) }))
}

/**
 * Attempt a print. Returns a plain result — callers decide how to record it.
 * NEVER throws for an ordinary printer failure; that is expected and handled.
 */
export async function attemptPrint(doc: RenderedInvoice): Promise<{ ok: boolean; message: string; printerName?: string | null }> {
  const settings = getPrinterSettings()
  const adapter = getAdapter(settings)
  try {
    return await adapter.print(doc, {
      deviceName: settings.selectedPrinter,
      copies: settings.copies,
      paperWidth: settings.paperWidth
    })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Unexpected printing error.', printerName: settings.selectedPrinter }
  }
}


/* -------------------------------- logo ---------------------------------- */

/**
 * Converting the logo costs a few milliseconds and the result only changes
 * when the logo or the paper width does, so memoise on both.
 */
let logoCache: { key: string; dataUrl: string; inkRatio: number } | null = null

function renderLogo(dots: number): { dataUrl: string; inkRatio: number } | null {
  const stamp = imageStamp('BRAND', BRAND_LOGO_ID)
  if (stamp == null) return null
  const key = `${stamp}:${dots}`
  if (logoCache?.key === key) return logoCache

  const src = readImage('BRAND', BRAND_LOGO_ID)
  if (!src) return null
  const art = toThermalLineArt(src.bytes, dots)
  if (!art) return null
  logoCache = { key, dataUrl: art.dataUrl, inkRatio: art.inkRatio }
  return logoCache
}

/** Same image, packed for `GS v 0`, for the ESC/POS path. */
let rasterCache: { key: string; raster: ThermalRaster } | null = null

function renderLogoRaster(dots: number): ThermalRaster | null {
  const stamp = imageStamp('BRAND', BRAND_LOGO_ID)
  if (stamp == null) return null
  const key = `${stamp}:${dots}`
  if (rasterCache?.key === key) return rasterCache.raster
  const src = readImage('BRAND', BRAND_LOGO_ID)
  if (!src) return null
  const raster = toThermalRaster(src.bytes, dots)
  if (!raster) return null
  rasterCache = { key, raster }
  return raster
}

/**
 * The logo to place at the top of a printed invoice, already reduced to
 * 1-bit line art at the head's dot width. Null when there is no logo or the
 * admin has turned it off — the receipt then just starts with the name.
 */
export function getInvoiceLogo(paperWidth: 58 | 80): string | null {
  const settings = getPrinterSettings()
  if (!settings.printLogo) return null
  return renderLogo(logoDotsForPaper(paperWidth))?.dataUrl ?? null
}

/**
 * What Printer settings shows: the logo exactly as it will be printed, not
 * the colour original — so nobody is surprised by the receipt.
 */
export function getLogoState(): {
  hasLogo: boolean
  enabled: boolean
  previewDataUrl: string | null
  widthDots: number
  inkPercent: number | null
} {
  requireAuth()
  const settings = getPrinterSettings()
  const dots = logoDotsForPaper(settings.paperWidth)
  const art = renderLogo(dots)
  return {
    hasLogo: imageStamp('BRAND', BRAND_LOGO_ID) != null,
    enabled: settings.printLogo,
    previewDataUrl: art?.dataUrl ?? null,
    widthDots: dots,
    inkPercent: art ? Math.round(art.inkRatio * 1000) / 10 : null
  }
}

export async function chooseLogo(): Promise<ReturnType<typeof getLogoState>> {
  requireAdmin()
  const { replaced } = await pickAndSetLogo()
  if (replaced) {
    logoCache = null
    rasterCache = null
    audit({ action: 'PRINTER_LOGO_CHANGED', summary: 'Replaced the invoice logo', entityType: 'printer' })
  }
  return getLogoState()
}

export function removeLogo(): ReturnType<typeof getLogoState> {
  requireAdmin()
  clearImage('BRAND', BRAND_LOGO_ID)
  logoCache = null
  rasterCache = null
  audit({ action: 'PRINTER_LOGO_REMOVED', summary: 'Removed the invoice logo', entityType: 'printer' })
  return getLogoState()
}
