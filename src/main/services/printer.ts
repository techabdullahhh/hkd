import { eq } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { PrinterInfo, PrinterSettings, PrinterState } from '@shared/types'
import type { PrinterAdapter, RenderedInvoice } from '../printer/types'
import { SystemPrinterAdapter } from '../printer/SystemPrinterAdapter'
import { EscposRawAdapter } from '../printer/EscposRawAdapter'
import { audit } from './audit'
import { requireAdmin, requireAuth } from './context'
import { BRAND_LOGO_ID, clearImage, imageStamp, pickAndSetLogo, readImage } from './images'
import { toThermalLineArt, toThermalRaster, type ThermalRaster } from '../printer/thermalImage'
import { logoDotsForPaper } from '../printer/paper'
import { isChromeOsContainer } from '../platform'

const DEFAULTS: PrinterSettings = {
  mode: 'SYSTEM',
  selectedPrinter: null,
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
  return isChromeOsContainer() ? { ...DEFAULTS, mode: 'ESCPOS_RAW' } : { ...DEFAULTS }
}

export function getPrinterSettings(): PrinterSettings {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).get()
  if (!row) return defaultsForHost()
  try {
    const stored = JSON.parse(row.value) as Omit<Partial<PrinterSettings>, 'mode'> & { mode?: string; escposAddress?: unknown }
    // An install configured before raw mode existed may still say
    // ESCPOS_BLUETOOTH; that adapter never worked, so raw is its successor.
    const legacy = stored.mode as string | undefined
    const mode: PrinterSettings['mode'] =
      legacy === 'ESCPOS_RAW' || legacy === 'ESCPOS_BLUETOOTH' || (!legacy && isChromeOsContainer())
        ? 'ESCPOS_RAW'
        : 'SYSTEM'
    const { escposAddress: _legacy, ...rest } = stored
    return { ...defaultsForHost(), ...rest, mode }
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
  return settings.mode === 'ESCPOS_RAW'
    ? new EscposRawAdapter((paperWidth) => (settings.printLogo ? renderLogoRaster(logoDotsForPaper(paperWidth)) : null))
    : new SystemPrinterAdapter()
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
    platform: isChromeOsContainer() ? 'chromeos' : process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  }
}

export async function updatePrinterSettings(patch: Partial<PrinterSettings>): Promise<PrinterState> {
  const admin = requireAdmin()
  const current = getPrinterSettings()
  const next: PrinterSettings = { ...current, ...patch }

  if (next.paperWidth !== 58 && next.paperWidth !== 80)
    throw new AppError('VALIDATION', 'Paper width must be 58 or 80 mm.')
  if (next.mode !== 'SYSTEM' && next.mode !== 'ESCPOS_RAW')
    throw new AppError('VALIDATION', 'Invalid printer mode.')
  if (!Number.isInteger(next.copies) || next.copies < 1 || next.copies > 5)
    throw new AppError('VALIDATION', 'Copies must be between 1 and 5.')
  next.printLogo = !!next.printLogo

  savePrinterSettings(next, admin.id)
  audit({
    action: 'PRINTER_SETTINGS_CHANGED',
    summary: `Printer set to ${next.mode === 'ESCPOS_RAW' ? 'direct ESC/POS' : 'system driver'}, ${next.paperWidth}mm, printer "${next.selectedPrinter ?? 'auto'}"`,
    entityType: 'printer'
  })
  return getPrinterState()
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
