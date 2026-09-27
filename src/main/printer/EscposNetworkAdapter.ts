import type { PrinterInfo } from '@shared/types'
import type { PrinterAdapter, PrintOptions, PrintResult, RenderedInvoice } from './types'
import type { ThermalRaster } from './thermalImage'
import { buildEscPos } from './escpos'
import {
  checkReachable,
  formatTarget,
  isNetworkTarget,
  localSubnets,
  networkTargetAsPrinter,
  parseTarget,
  writeToNetworkPrinter
} from './networkPrinter'
import { isChromeOsContainer } from '../platform'

/**
 * ESC/POS to a Wi-Fi or Ethernet printer on raw port 9100.
 *
 * The same bytes as every other mode down a TCP socket. This is the transport
 * with the fewest moving parts in the whole app — no spooler, no driver, no
 * device node, no permissions, no pairing — which is why it is the one to reach
 * for when the others are blocked.
 *
 * On **Chrome OS it is the only wireless option that can work**: the Crostini
 * container has no Bluetooth adapter and no print system, but it does have
 * unrestricted network access.
 *
 * Unlike the other adapters this one cannot enumerate printers by asking the
 * operating system — nothing on the machine knows the printer exists. The
 * address is configuration, so `listPrinters` reports the configured target and
 * whether it answers, and finding an unknown printer is an explicit scan.
 */
export class EscposNetworkAdapter implements PrinterAdapter {
  readonly mode = 'ESCPOS_NETWORK' as const

  constructor(
    private readonly logoFor: (paperWidth: 58 | 80) => ThermalRaster | null,
    private readonly address: string | null
  ) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    const target = parseTarget(this.address)
    if (!target) return []
    return [networkTargetAsPrinter(target, await checkReachable(target))]
  }

  async probe(deviceName?: string | null): Promise<{ reachable: boolean; message: string }> {
    // Either the explicitly selected printer or the configured address; for
    // this mode they are the same kind of thing.
    const raw = isNetworkTarget(deviceName) ? deviceName : this.address
    const target = parseTarget(raw)

    if (!target) {
      const subnets = localSubnets()
      return {
        reachable: false,
        message:
          'No printer address set yet. Enter the printer’s IP address under Configuration — ' +
          'most thermal printers print it on a self-test slip if you hold the feed button while switching them on.' +
          (subnets.length > 0 ? ` This computer is on ${subnets.map((s) => `${s}.x`).join(', ')}, so the printer’s address should start the same way.` : '') +
          (isChromeOsContainer()
            ? ' On Chrome OS this is the recommended way to print wirelessly — Bluetooth is not available inside the Linux container.'
            : '')
      }
    }

    if (await checkReachable(target)) {
      return { reachable: true, message: `Ready — ${formatTarget(target)} is accepting print jobs.` }
    }
    return {
      reachable: false,
      message:
        `${formatTarget(target)} did not answer on port ${target.port}. Check the printer is switched on, connected to the same Wi-Fi network as this computer, ` +
        'and that the address has not changed — if the router assigns addresses automatically it can change after a restart, so give the printer a fixed address.'
    }
  }

  async print(doc: RenderedInvoice, opts: PrintOptions): Promise<PrintResult> {
    const raw = isNetworkTarget(opts.deviceName) ? opts.deviceName : this.address
    const target = parseTarget(raw)
    if (!target) {
      const probe = await this.probe(opts.deviceName)
      return { ok: false, message: probe.message, printerName: null }
    }

    const payload = buildEscPos(doc, { logo: this.logoFor(opts.paperWidth) })
    const copies = Math.max(1, opts.copies ?? 1)

    try {
      for (let i = 0; i < copies; i++) {
        await writeToNetworkPrinter(target, payload)
      }
      return {
        ok: true,
        message: `Sent ${payload.length.toLocaleString()} bytes to ${formatTarget(target)}.`,
        printerName: formatTarget(target)
      }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        printerName: formatTarget(target)
      }
    }
  }
}
