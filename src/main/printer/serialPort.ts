/**
 * Talking to a printer over a serial port — which is how Bluetooth works.
 *
 * A Bluetooth thermal printer does not speak some special Bluetooth protocol.
 * It advertises the **Serial Port Profile** (SPP, RFCOMM), and every operating
 * system presents a paired SPP device as an ordinary serial port:
 *
 *   Windows   COM5                    (created when the printer is paired)
 *   Linux     /dev/rfcomm0            (created by `rfcomm bind`)
 *   macOS     /dev/cu.PrinterName     (created when the printer is paired)
 *
 * Write ESC/POS bytes to that port and they arrive at the print head. That is
 * the entire protocol, and it is why this needs no native module: no
 * `node-bluetooth`, no `serialport`, no second ABI rebuild to keep in step
 * with Electron. The same code path also serves genuinely wired serial
 * printers (`/dev/ttyUSB0`, `/dev/ttyACM0`), which are the same thing with a
 * cable.
 *
 * Baud rate matters for a real UART and is meaningless for RFCOMM, where the
 * link speed is negotiated by Bluetooth itself. Setting it anyway is harmless,
 * so one code path covers both rather than two that differ subtly.
 */

import { execFile } from 'child_process'
import { accessSync, closeSync, constants, existsSync, openSync, readdirSync, writeSync } from 'fs'
import { promisify } from 'util'
import type { PrinterInfo } from '@shared/types'

const run = promisify(execFile)

/** Serial ports a receipt printer plausibly appears on, most likely first. */
const LINUX_CANDIDATES = [
  // Bluetooth SPP, bound by `rfcomm bind` — see bluetooth.ts
  '/dev/rfcomm0',
  '/dev/rfcomm1',
  '/dev/rfcomm2',
  '/dev/rfcomm3',
  // USB-serial adapters and printers with a CDC-ACM interface
  '/dev/ttyACM0',
  '/dev/ttyACM1',
  '/dev/ttyUSB0',
  '/dev/ttyUSB1',
  '/dev/ttyUSB2'
]

/** Baud rates worth offering. 9600 is the near-universal default. */
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const
export const DEFAULT_BAUD = 9600

/** True for a name this module can write to, as opposed to a print queue. */
export function isSerialPort(name: string | null | undefined): boolean {
  if (!name) return false
  return /^COM\d+$/i.test(name) || /^\/dev\/(rfcomm|ttyACM|ttyUSB|tty\.|cu\.)/.test(name)
}

/** True when the port is a Bluetooth link rather than a cable. */
export function isBluetoothPort(name: string | null | undefined): boolean {
  if (!name) return false
  return /^\/dev\/rfcomm\d+$/.test(name) || /^\/dev\/(tty|cu)\./.test(name)
}

export interface SerialPortInfo {
  path: string
  label: string
  /** Best-effort: is this port a Bluetooth link? */
  bluetooth: boolean
  /** False when the port exists but this user may not write to it. */
  writable: boolean
}

/* ------------------------------- discovery ------------------------------- */

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  if (process.platform === 'win32') return listWindowsComPorts()
  if (process.platform === 'darwin') return listDarwinPorts()
  return listLinuxPorts()
}

function probeWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function listLinuxPorts(): SerialPortInfo[] {
  return LINUX_CANDIDATES.filter(existsSync).map((path) => ({
    path,
    label: path.startsWith('/dev/rfcomm')
      ? `Bluetooth printer (${path})`
      : `Serial printer (${path})`,
    bluetooth: path.startsWith('/dev/rfcomm'),
    writable: probeWritable(path)
  }))
}

/**
 * Ports every Mac has whether anything is paired or not.
 *
 * These are not printers and never will be. Offering them is worse than
 * offering nothing: the app reports "Ready — Bluetooth on
 * /dev/cu.wlan-debug", which reads as a found printer, and the receipt then
 * vanishes into Apple's wireless-debug interface. Caught by running the app
 * and reading what it claimed to have found.
 */
const DARWIN_SYSTEM_PORTS = /^cu\.(Bluetooth-Incoming-Port|debug-console|wlan-debug|iap-.*|modem|SOC)$/i

/**
 * macOS names a paired SPP device after the device itself, so the port list is
 * read from /dev rather than guessed. `cu.*` is used rather than `tty.*`
 * because opening `tty.*` blocks waiting for carrier detect.
 */
function listDarwinPorts(): SerialPortInfo[] {
  let entries: string[] = []
  try {
    entries = readdirSync('/dev')
  } catch {
    return []
  }
  return entries
    .filter((e) => e.startsWith('cu.'))
    .filter((e) => !DARWIN_SYSTEM_PORTS.test(e))
    .map((e) => {
      const path = `/dev/${e}`
      return {
        path,
        label: `${e.replace(/^cu\./, '')} (${path})`,
        bluetooth: true,
        writable: probeWritable(path)
      }
    })
}

/**
 * Windows creates a COM port for a paired SPP printer, and the friendly name
 * says which is which — "Standard Serial over Bluetooth link (COM5)". The
 * enumeration is done through CIM because it needs nothing installed.
 */
async function listWindowsComPorts(): Promise<SerialPortInfo[]> {
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_LIST_PORTS_PS],
      { windowsHide: true, timeout: 20_000 }
    )
    const rows = JSON.parse(stdout.trim() || '[]') as { Name?: string; DeviceID?: string }[]
    const list = Array.isArray(rows) ? rows : [rows]
    const ports: SerialPortInfo[] = []
    for (const row of list) {
      const name = row?.Name ?? ''
      const m = /\((COM\d+)\)/i.exec(name)
      if (!m) continue
      const bluetooth = /bluetooth/i.test(name) || /^BTHENUM/i.test(row?.DeviceID ?? '')
      ports.push({ path: m[1].toUpperCase(), label: name, bluetooth, writable: true })
    }
    // Bluetooth links first — that is what this mode is for.
    return ports.sort((a, b) => Number(b.bluetooth) - Number(a.bluetooth))
  } catch {
    return []
  }
}

const WINDOWS_LIST_PORTS_PS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_PnPEntity |
  Where-Object { $_.Name -match '\(COM\d+\)' } |
  Select-Object Name, DeviceID |
  ConvertTo-Json -Compress
`

/** Present the ports as printers so they slot into the ordinary picker. */
export async function serialPortsAsPrinters(): Promise<PrinterInfo[]> {
  const ports = await listSerialPorts()
  return ports.map((p, i) => ({
    name: p.path,
    displayName: `${p.label}${p.writable ? '' : ' — needs permission'}`,
    description: p.bluetooth ? 'Bluetooth (serial port profile)' : 'Wired serial',
    // status 0 = ready, matching the convention used elsewhere.
    status: p.writable ? 0 : 1,
    isDefault: i === 0
  }))
}

/* -------------------------------- writing -------------------------------- */

/**
 * Configure line discipline before writing, on POSIX.
 *
 * Without this the port keeps whatever settings it had, which for a fresh
 * USB-serial adapter means echo and newline translation are on — and a
 * receipt printed through newline translation comes out with the raster
 * corrupted, because ESC/POS image data contains bytes that look like line
 * endings. `raw` turns all of that off. `clocal` stops the open() blocking
 * on a carrier-detect line that a printer never asserts.
 *
 * Failure is ignored on purpose: `/dev/rfcomm0` accepts these settings but
 * does not need them, and on some kernels stty reports an error anyway.
 */
async function configurePosixPort(path: string, baud: number): Promise<void> {
  const flag = process.platform === 'darwin' ? '-f' : '-F'
  try {
    await run('stty', [flag, path, String(baud), 'raw', 'clocal', '-echo', '-crtscts'], { timeout: 5_000 })
  } catch {
    /* the port may not be a real UART; the write below is what matters */
  }
}

export async function writeToSerialPort(path: string, payload: Buffer, baud = DEFAULT_BAUD): Promise<void> {
  if (process.platform === 'win32') return writeToWindowsComPort(path, payload, baud)

  await configurePosixPort(path, baud)

  let fd: number | null = null
  try {
    fd = openSync(path, 'w')
    let written = 0
    while (written < payload.length) {
      written += writeSync(fd, payload, written, payload.length - written)
    }
  } catch (e) {
    throw describeSerialFailure(e, path)
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* already written, or already throwing */
      }
    }
  }
}

/**
 * Windows has no `stty` and Node cannot set baud on a COM port, so the write
 * goes through .NET's SerialPort, which can. PowerShell 5.1 ships with every
 * Windows 10/11 install, so again nothing needs installing.
 *
 * WriteTimeout matters: a Bluetooth printer that has drifted out of range
 * accepts the open and then never drains its buffer, which would otherwise
 * hang the print silently.
 */
async function writeToWindowsComPort(port: string, payload: Buffer, baud: number): Promise<void> {
  const base64 = payload.toString('base64')
  try {
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_WRITE_PS],
      {
        windowsHide: true,
        timeout: 45_000,
        env: { ...process.env, HKD_PORT: port, HKD_BAUD: String(baud), HKD_PAYLOAD: base64 }
      }
    )
  } catch (e) {
    throw describeSerialFailure(e, port)
  }
}

/**
 * The payload arrives base64 in an environment variable rather than on the
 * command line: a receipt with a logo raster is tens of kilobytes, well past
 * the ~32 KB command-line limit, and the bytes are binary.
 */
const WINDOWS_WRITE_PS = String.raw`
$ErrorActionPreference = 'Stop'
$bytes = [System.Convert]::FromBase64String($env:HKD_PAYLOAD)
$sp = New-Object System.IO.Ports.SerialPort($env:HKD_PORT, [int]$env:HKD_BAUD, 'None', 8, 'One')
$sp.WriteTimeout = 20000
$sp.Handshake = 'None'
$sp.DtrEnable = $true
$sp.RtsEnable = $true
$sp.Open()
try {
  $sp.Write($bytes, 0, $bytes.Length)
  # Let the last packet leave before the port closes, or the tail is lost.
  Start-Sleep -Milliseconds 400
} finally {
  $sp.Close()
}
`

/** Turn the handful of errors that actually happen into instructions. */
function describeSerialFailure(e: unknown, path: string): Error {
  const code = (e as NodeJS.ErrnoException)?.code
  const raw = e instanceof Error ? e.message : String(e)

  if (code === 'EACCES' || code === 'EPERM' || /access to the port.*is denied/i.test(raw)) {
    return new Error(
      process.platform === 'linux'
        ? `${path} exists but this user may not write to it. Run this once, then sign out and back in:\n\n    sudo usermod -aG dialout $USER`
        : `${path} is in use by another program, or this user may not open it. Close anything else using the printer and try again.`
    )
  }
  if (code === 'ENOENT' || /does not exist|could not be found/i.test(raw)) {
    return new Error(
      isBluetoothPort(path)
        ? `${path} is not there. The printer is not paired, or the Bluetooth link has dropped — re-pair it and check it is switched on.`
        : `${path} is not there. Check the cable.`
    )
  }
  if (code === 'EIO' || code === 'ENXIO' || code === 'ENODEV') {
    return new Error(`${path} stopped responding. The Bluetooth link has dropped — switch the printer off and on, then re-check.`)
  }
  if (/WriteTimeout|timed out/i.test(raw)) {
    return new Error(
      `${path} accepted the connection but did not take the data. The printer is usually out of range, asleep, or out of paper.`
    )
  }
  return new Error(raw.trim() || `Could not write to ${path}.`)
}
