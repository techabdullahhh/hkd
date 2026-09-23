import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { PrinterInfo } from '@shared/types'
import type { PrinterAdapter, PrintOptions, PrintResult, RenderedInvoice } from './types'
import type { ThermalRaster } from './thermalImage'
import { buildEscPos } from './escpos'
import { SystemPrinterAdapter } from './SystemPrinterAdapter'
import { pickReceiptPrinter } from './paper'
import { isDeviceNode, usbNodesAsPrinters, writeToDeviceNode } from './usbDevice'

const run = promisify(execFile)

/**
 * Direct ESC/POS to a USB (or any) receipt printer — no driver layout.
 *
 * The bytes go to the printer *through the operating system's print queue*,
 * but flagged RAW, which tells the spooler to pass them to the device
 * untouched. That is the trick that makes this work without a serial port,
 * a Bluetooth address or a native USB library:
 *
 *  - On **Windows**, `winspool.drv` accepts a RAW document on any installed
 *    queue. It is reached through a small PowerShell script that P/Invokes
 *    OpenPrinter / StartDocPrinter("RAW") / WritePrinter — the standard
 *    "RawPrinterHelper" pattern, present on every Windows 10/11 machine with
 *    nothing to install. The printer can be installed with its own driver
 *    or with Windows' built-in "Generic / Text Only" driver; either works,
 *    because the driver is never asked to lay anything out.
 *  - On **macOS / Linux**, `lp -o raw` does the same through CUPS.
 *  - On **Chrome OS** (and any Linux box with no CUPS), the printer's own
 *    device node — `/dev/usb/lp0` — is written to directly. The Crostini
 *    container has no print spooler at all, so this is the only path that
 *    works there, and it is the most reliable one anywhere on Linux.
 *
 * So the printer is chosen from the very same list as System mode. Plug the
 * USB cable in, install the printer once, pick it — done.
 *
 * What this mode gives that the driver path cannot promise: the printer's
 * own font at its native column count, a dot-for-dot logo, and the cutter
 * firing after every receipt with no blank paper fed.
 */
export class EscposRawAdapter implements PrinterAdapter {
  readonly mode = 'ESCPOS_RAW' as const
  private readonly queues = new SystemPrinterAdapter()

  constructor(private readonly logoFor: (paperWidth: 58 | 80) => ThermalRaster | null) {}

  /**
   * CUPS queues *and* raw USB device nodes, so both appear in the ordinary
   * printer picker and everything downstream treats them the same way.
   */
  async listPrinters(): Promise<PrinterInfo[]> {
    const [queues, nodes] = await Promise.all([this.queues.listPrinters(), Promise.resolve(usbNodesAsPrinters())])
    return [...nodes, ...queues]
  }

  async probe(deviceName?: string | null): Promise<{ reachable: boolean; message: string }> {
    if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') {
      return { reachable: false, message: `Raw ESC/POS printing is not supported on ${process.platform}.` }
    }

    const target = await this.resolve(deviceName)
    if (!target) {
      const nodes = usbNodesAsPrinters()
      return {
        reachable: false,
        message:
          nodes.length > 0
            ? 'A USB printer is connected but not selected. Choose it under Configuration.'
            : process.platform === 'linux'
              ? 'No printer found. On Chrome OS, share the printer with Linux first: Settings → About Chrome OS → Linux → Manage USB devices.'
              : 'No printer is installed on this computer.'
      }
    }

    if (isDeviceNode(target.name)) {
      const node = usbNodesAsPrinters().find((n) => n.name === target.name)
      if (!node) return { reachable: false, message: `${target.name} is not connected right now.` }
      if (node.status !== 0)
        return { reachable: false, message: `${target.name} is connected but not writable by this user. Run: sudo usermod -aG lp $USER` }
      return { reachable: true, message: `Ready — direct USB to ${target.name}.` }
    }

    const base = await this.queues.probe(target.name)
    if (!base.reachable) return base
    return { reachable: true, message: base.message.replace(/is ready\.$/, 'is ready (direct ESC/POS).') }
  }

  /** The printer this adapter will use: an explicit choice, else the best guess. */
  private async resolve(deviceName?: string | null): Promise<PrinterInfo | null> {
    const all = await this.listPrinters()
    if (deviceName) return all.find((p) => p.name === deviceName) ?? null
    return pickReceiptPrinter(all)
  }

  async print(doc: RenderedInvoice, opts: PrintOptions): Promise<PrintResult> {
    const printer = await this.resolve(opts.deviceName)
    if (!printer) {
      return {
        ok: false,
        message: opts.deviceName
          ? `Printer "${opts.deviceName}" is not installed right now.`
          : 'No printer is installed on this computer.',
        printerName: opts.deviceName ?? null
      }
    }

    const payload = buildEscPos(doc, { logo: this.logoFor(opts.paperWidth) })
    const copies = Math.max(1, opts.copies ?? 1)

    // A device node needs no spooler, no temp file and no child process.
    if (isDeviceNode(printer.name)) {
      try {
        for (let i = 0; i < copies; i++) writeToDeviceNode(printer.name, payload)
        return {
          ok: true,
          message: `Sent ${payload.length.toLocaleString()} bytes straight to ${printer.name}.`,
          printerName: printer.name
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e), printerName: printer.name }
      }
    }

    const dir = mkdtempSync(join(tmpdir(), 'hkd-print-'))
    try {
      const file = join(dir, 'receipt.bin')
      writeFileSync(file, payload)
      for (let i = 0; i < copies; i++) {
        await sendRaw(printer.name, file, dir)
      }
      return {
        ok: true,
        message: `Sent ${payload.length.toLocaleString()} bytes to ${printer.displayName} (ESC/POS).`,
        printerName: printer.name
      }
    } catch (e) {
      return {
        ok: false,
        message: describeFailure(e, printer.displayName),
        printerName: printer.name
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

function describeFailure(e: unknown, printerName: string): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (/OpenPrinter failed: 1801/.test(raw)) return `Windows does not know a printer called "${printerName}". Refresh the printer list and pick it again.`
  if (/StartDocPrinter failed|WritePrinter failed/.test(raw))
    return `"${printerName}" did not accept the job. Check that it is plugged in, switched on and has paper. (${raw.trim()})`
  if (/ENOENT/.test(raw) && /lp\b/.test(raw))
    return (
      'This Linux system has no `lp` command (Chrome OS has none by default). ' +
      'Connect the printer by USB and pick its /dev/usb/lp0 entry instead, or install CUPS with: sudo apt install cups-client'
    )
  if (/ENOENT/.test(raw)) return `The print helper is missing on this computer (${raw.trim()}).`
  return raw.trim() || 'Unknown printing error.'
}

/* -------------------------------- transport ------------------------------- */

async function sendRaw(printerName: string, file: string, scratchDir: string): Promise<void> {
  if (process.platform === 'win32') {
    const script = join(scratchDir, 'rawprint.ps1')
    writeFileSync(script, WINDOWS_RAW_PRINT_PS1, 'utf8')
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Printer', printerName, '-File', file],
      { windowsHide: true, timeout: 30_000 }
    )
    return
  }
  // CUPS: -o raw hands the bytes to the device unfiltered.
  await run('lp', ['-d', printerName, '-o', 'raw', file], { timeout: 30_000 })
}

/**
 * The classic RawPrinterHelper, as PowerShell so nothing needs installing.
 * Compiles a tiny C# helper on the fly (Windows PowerShell 5.1 does this out
 * of the box) and writes the file to the named queue as a RAW document.
 */
const WINDOWS_RAW_PRINT_PS1 = String.raw`
param([Parameter(Mandatory=$true)][string]$Printer, [Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.Runtime.InteropServices;
public static class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr h, int level, ref DOCINFOW di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);

  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFOW { pDocName = "HKD receipt", pOutputFile = null, pDataType = "RAW" };
      if (StartDocPrinter(h, 1, ref di) == 0)
        throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, bytes, bytes.Length, out written) || written != bytes.Length)
          throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $code -Language CSharp
[RawPrint]::Send($Printer, [System.IO.File]::ReadAllBytes($File))
`
