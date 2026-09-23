/**
 * Talking to a USB receipt printer on Linux — including Chrome OS.
 *
 * On Windows the print spooler is always there, so raw ESC/POS goes through
 * a queue. Linux cannot assume that, and Chrome OS especially cannot: the
 * Crostini container ships with no CUPS at all, and the printers configured
 * in Chrome OS itself are invisible inside it. `lp` simply does not exist.
 *
 * What *is* there, the moment the printer is shared into the container, is
 * the kernel's USB printer device node — `/dev/usb/lp0`. Writing ESC/POS
 * bytes to that file is the whole protocol. No spooler, no driver, no
 * configuration: the bytes land on the printer. For a receipt printer this
 * is both the simplest and the most reliable path on Linux, so the app
 * offers those nodes alongside any CUPS queues and prefers them.
 *
 * The one catch is permissions. The node is root:lp mode 0660 and the
 * default Crostini user is not in `lp`, so the first write fails with
 * EACCES — which says nothing useful on its own. That case is detected and
 * turned into the exact command that fixes it.
 */

import { accessSync, constants, existsSync, openSync, closeSync, writeSync } from 'fs'
import type { PrinterInfo } from '@shared/types'

/** Device nodes the kernel creates for USB printers, most likely first. */
const CANDIDATE_NODES = [
  '/dev/usb/lp0',
  '/dev/usb/lp1',
  '/dev/usb/lp2',
  '/dev/usblp0',
  '/dev/usblp1',
  '/dev/lp0',
  '/dev/lp1'
]

/** A printer "name" that is really a device path rather than a queue name. */
export function isDeviceNode(name: string | null | undefined): boolean {
  return !!name && name.startsWith('/dev/')
}

export interface UsbPrinterNode {
  path: string
  /** False when the node exists but this user may not write to it. */
  writable: boolean
}

/** Every USB printer node present on this machine, whether writable or not. */
export function findUsbPrinterNodes(): UsbPrinterNode[] {
  if (process.platform !== 'linux') return []
  const found: UsbPrinterNode[] = []
  for (const path of CANDIDATE_NODES) {
    if (!existsSync(path)) continue
    let writable = true
    try {
      accessSync(path, constants.W_OK)
    } catch {
      writable = false
    }
    found.push({ path, writable })
  }
  return found
}

/** Present the nodes as printers so they appear in the ordinary picker. */
export function usbNodesAsPrinters(): PrinterInfo[] {
  return findUsbPrinterNodes().map((n, i) => ({
    name: n.path,
    displayName: `USB receipt printer (${n.path})${n.writable ? '' : ' — needs permission'}`,
    description: 'Direct USB connection',
    // status 0 = ready, matching the convention the rest of the app uses.
    status: n.writable ? 0 : 1,
    isDefault: i === 0
  }))
}

/** The fix for the one failure mode that is otherwise inscrutable. */
export const PERMISSION_HINT =
  'The printer is connected but this user may not write to it. Run this once in the Linux terminal, ' +
  'then sign out of Chrome OS and back in:\n\n    sudo usermod -aG lp $USER'

/**
 * Write the payload to a device node. Deliberately synchronous and
 * unbuffered: a receipt is a few kilobytes, and a partial write to a
 * printer is worse than a slow one.
 */
export function writeToDeviceNode(path: string, payload: Buffer): void {
  let fd: number | null = null
  try {
    fd = openSync(path, 'w')
    let written = 0
    while (written < payload.length) {
      written += writeSync(fd, payload, written, payload.length - written)
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`${PERMISSION_HINT}\n\n(${path}: permission denied)`)
    }
    if (code === 'ENOENT') {
      throw new Error(
        `${path} is not there any more. On Chrome OS the printer must be shared with Linux: ` +
          'Settings → About Chrome OS → Linux → Manage USB devices, and switch the printer on.'
      )
    }
    if (code === 'ENODEV' || code === 'EIO') {
      throw new Error(`${path} stopped responding. Check the printer is switched on, then re-plug the USB cable.`)
    }
    throw e
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* the write already succeeded or already threw */
      }
    }
  }
}
