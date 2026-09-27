/**
 * Finding a paired Bluetooth printer, and getting a writable port for it.
 *
 * Pairing itself is deliberately *not* done here. Every operating system has
 * its own pairing UI that handles PINs, and a printer is paired once in its
 * life; reimplementing that badly would be worse than sending the user to the
 * settings panel they already know. What this module does is the part that is
 * awkward by hand:
 *
 *  - **Windows / macOS**: nothing. Pairing an SPP printer creates the serial
 *    port automatically (`COM5`, `/dev/cu.Printer`), so `serialPort.ts` finds
 *    it with no help. This module only lists paired devices so the UI can say
 *    "this printer is paired but has no port yet".
 *
 *  - **Linux**: pairing creates no port. The RFCOMM channel has to be bound to
 *    a device node explicitly — `rfcomm bind 0 AA:BB:CC:DD:EE:FF 1` — which is
 *    what `bindRfcomm` does. Without that step a perfectly paired printer is
 *    invisible, which is the single most confusing thing about Bluetooth
 *    printing on Linux.
 *
 * ## Chrome OS cannot do this at all
 *
 * The Crostini container has no Bluetooth adapter. Chrome OS keeps the adapter
 * on the host side and passes USB devices — not Bluetooth — into the
 * container, so there is no `hci0`, `bluetoothd` is not running, and
 * `bluetoothctl` reports no controller. Nothing in this file can work there,
 * and no amount of code changes that: it is a boundary of the platform, not a
 * missing feature of this app. `bluetoothAvailability()` detects it so the UI
 * can say so plainly instead of presenting an option that silently fails.
 *
 * On a Chromebook the wireless option that *does* work is a network printer —
 * see networkPrinter.ts. The container has full network access.
 */

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { isChromeOsContainer } from '../platform'

const run = promisify(execFile)

export interface PairedDevice {
  address: string
  name: string
}

export type BluetoothAvailability =
  | { available: true }
  | { available: false; reason: string; fatal: boolean }

/**
 * Whether Bluetooth printing is possible on this machine at all.
 *
 * `fatal` distinguishes "this platform will never support it" from "it is not
 * set up yet", because the advice differs completely: one is a fix, the other
 * is a different plan.
 */
export function bluetoothAvailability(): BluetoothAvailability {
  if (isChromeOsContainer()) {
    return {
      available: false,
      fatal: true,
      reason:
        'Chrome OS does not give its Linux container access to Bluetooth — there is no adapter inside it, so a Bluetooth printer cannot be reached from here. ' +
        'Use the printer over USB, or use a network (Wi-Fi/LAN) printer instead.'
    }
  }
  if (process.platform === 'linux' && !existsSync('/sys/class/bluetooth')) {
    return {
      available: false,
      fatal: false,
      reason: 'No Bluetooth adapter found on this computer. Install BlueZ (sudo apt install bluez) or plug in a Bluetooth adapter.'
    }
  }
  return { available: true }
}

/* ------------------------------- discovery ------------------------------- */

/** Paired devices, as the OS already knows them. Empty when unsupported. */
export async function listPairedDevices(): Promise<PairedDevice[]> {
  if (!bluetoothAvailability().available) return []
  try {
    if (process.platform === 'linux') return await listPairedLinux()
    if (process.platform === 'win32') return await listPairedWindows()
    if (process.platform === 'darwin') return await listPairedDarwin()
  } catch {
    /* Bluetooth tooling missing or refusing — treated as "nothing paired" */
  }
  return []
}

/**
 * `bluetoothctl devices Paired` is the documented way and works on BlueZ 5.65+.
 * Older BlueZ has no `Paired` filter, so fall back to the unfiltered list.
 */
async function listPairedLinux(): Promise<PairedDevice[]> {
  const parse = (out: string): PairedDevice[] =>
    out
      .split('\n')
      .map((l) => /^Device\s+([0-9A-F:]{17})\s+(.*)$/i.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ address: m[1].toUpperCase(), name: m[2].trim() }))

  try {
    const { stdout } = await run('bluetoothctl', ['devices', 'Paired'], { timeout: 10_000 })
    const devices = parse(stdout)
    if (devices.length > 0) return devices
  } catch {
    /* fall through to the older syntax */
  }
  const { stdout } = await run('bluetoothctl', ['devices'], { timeout: 10_000 })
  return parse(stdout)
}

async function listPairedWindows(): Promise<PairedDevice[]> {
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PAIRED_PS],
    { windowsHide: true, timeout: 20_000 }
  )
  const rows = JSON.parse(stdout.trim() || '[]') as { Name?: string; InstanceId?: string }[]
  const list = Array.isArray(rows) ? rows : [rows]
  return list
    .filter((r) => r?.Name)
    .map((r) => ({
      // BTHENUM instance ids embed the MAC; it is informational here.
      address: (/([0-9A-F]{12})/i.exec(r.InstanceId ?? '')?.[1] ?? '').replace(/(..)(?=.)/g, '$1:').toUpperCase(),
      name: r.Name as string
    }))
}

const WINDOWS_PAIRED_PS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Get-PnpDevice -Class Bluetooth |
  Where-Object { $_.Status -eq 'OK' } |
  Select-Object Name, InstanceId |
  ConvertTo-Json -Compress
`

async function listPairedDarwin(): Promise<PairedDevice[]> {
  const { stdout } = await run('system_profiler', ['-json', 'SPBluetoothDataType'], { timeout: 25_000 })
  const parsed = JSON.parse(stdout) as Record<string, unknown[]>
  const root = (parsed?.SPBluetoothDataType?.[0] ?? {}) as Record<string, unknown>
  const groups = ['device_connected', 'device_not_connected', 'device_paired']
  const out: PairedDevice[] = []
  for (const group of groups) {
    const entries = root[group]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      for (const [name, info] of Object.entries(entry as Record<string, Record<string, string>>)) {
        out.push({ address: (info?.device_address ?? '').toUpperCase(), name })
      }
    }
  }
  return out
}

/* --------------------------------- binding -------------------------------- */

/** RFCOMM channel SPP printers use. Effectively universal for these devices. */
const DEFAULT_CHANNEL = 1

/**
 * Bind a paired printer to `/dev/rfcommN` so it can be written to.
 *
 * Needs root, which is the honest cost of Bluetooth printing on Linux, and
 * needs `rfcomm` from bluez-utils. The bind does not survive a reboot — see
 * `rfcommBindCommand` for the line to put in the user's notes.
 */
export async function bindRfcomm(address: string, node = 0, channel = DEFAULT_CHANNEL): Promise<string> {
  if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i.test(address)) {
    throw new Error(`"${address}" is not a Bluetooth address.`)
  }
  const path = `/dev/rfcomm${node}`
  if (existsSync(path)) return path
  try {
    await run('rfcomm', ['bind', String(node), address, String(channel)], { timeout: 15_000 })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    if (/ENOENT/.test(raw)) {
      throw new Error('The `rfcomm` command is not installed. Run: sudo apt install bluez')
    }
    if (/not permitted|Operation not permitted|denied/i.test(raw)) {
      throw new Error(`Binding the Bluetooth printer needs root. Run this in a terminal:\n\n    ${rfcommBindCommand(address, node, channel)}`)
    }
    throw new Error(`Could not bind ${address} to ${path}: ${raw.trim()}`)
  }
  return path
}

/** The exact command to run by hand, for the UI to show. */
export function rfcommBindCommand(address: string, node = 0, channel = DEFAULT_CHANNEL): string {
  return `sudo rfcomm bind ${node} ${address} ${channel}`
}

/**
 * Where to pair the printer, per platform. Shown in the UI rather than
 * guessed at, because this is the step people get stuck on.
 */
export function pairingInstructions(): string {
  if (isChromeOsContainer()) return bluetoothAvailability().available ? '' : (bluetoothAvailability() as { reason: string }).reason
  switch (process.platform) {
    case 'win32':
      return 'Pair the printer in Settings → Bluetooth & devices → Add device. Windows then creates a COM port for it, which appears in the list above.'
    case 'darwin':
      return 'Pair the printer in System Settings → Bluetooth. macOS then creates a /dev/cu.* port for it, which appears in the list above.'
    default:
      return 'Pair the printer with bluetoothctl (scan on, pair <address>, trust <address>), then bind it to a port with the command shown below.'
  }
}
