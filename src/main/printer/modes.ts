/**
 * Which printing modes this particular machine can actually use.
 *
 * Every mode in the app works somewhere, and two of them cannot work on Chrome
 * OS at all — for reasons that are properties of the platform rather than bugs
 * to be fixed. Offering all four everywhere would mean an employee can pick a
 * mode that fails silently, and the failure looks identical to a printer that
 * is switched off.
 *
 * So availability is computed, the UI disables what cannot work and shows why,
 * and stored settings naming an impossible mode are migrated to one that works.
 */

import type { ModeAvailability, PrinterMode } from '@shared/types'
import { isChromeOsContainer } from '../platform'
import { bluetoothAvailability } from './bluetooth'

export const ALL_MODES: PrinterMode[] = ['SYSTEM', 'ESCPOS_RAW', 'ESCPOS_BLUETOOTH', 'ESCPOS_NETWORK']

export function isPrinterMode(value: unknown): value is PrinterMode {
  return typeof value === 'string' && (ALL_MODES as string[]).includes(value)
}

export function modeAvailability(): ModeAvailability[] {
  const chromeOs = isChromeOsContainer()
  const bt = bluetoothAvailability()

  return [
    {
      mode: 'SYSTEM',
      available: !chromeOs,
      reason: chromeOs
        ? 'The Chrome OS Linux container has no print system, so there is no driver to print through. Use Direct ESC/POS over USB, or a network printer.'
        : ''
    },
    { mode: 'ESCPOS_RAW', available: true, reason: '' },
    {
      mode: 'ESCPOS_BLUETOOTH',
      available: bt.available,
      reason: bt.available ? '' : bt.reason
    },
    { mode: 'ESCPOS_NETWORK', available: true, reason: '' }
  ]
}

export function isModeAvailable(mode: PrinterMode): boolean {
  return modeAvailability().find((m) => m.mode === mode)?.available ?? false
}

/**
 * The best mode for a machine nobody has configured yet.
 *
 * Wired USB first wherever it can work: it is the most reliable transport and
 * needs no address, no pairing and no network. On Chrome OS that is also the
 * only mode that needs nothing bought, which is why it stays the default there
 * even though a network printer is the easier one to live with.
 */
export function defaultModeForHost(): PrinterMode {
  return isChromeOsContainer() ? 'ESCPOS_RAW' : 'SYSTEM'
}

/**
 * Bring a stored mode forward to one that works here.
 *
 * Two kinds of legacy exist. Installs from before raw mode named
 * `ESCPOS_BLUETOOTH` when the Bluetooth adapter did not yet exist — that mode
 * is real now, so the stored intent is honoured rather than rewritten. And any
 * mode at all may become impossible when a database is copied to a different
 * machine, most sharply a Windows install restored onto a Chromebook.
 */
export function reconcileMode(stored: unknown): PrinterMode {
  const mode = isPrinterMode(stored) ? stored : defaultModeForHost()
  if (isModeAvailable(mode)) return mode
  // Whatever was chosen cannot work here. Raw is the safest destination: it is
  // the only mode available on every platform that needs no configuration.
  return 'ESCPOS_RAW'
}
