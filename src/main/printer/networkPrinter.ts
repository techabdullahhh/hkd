/**
 * Talking to a receipt printer over the network.
 *
 * Thermal printers with Wi-Fi or Ethernet almost universally listen on TCP
 * **port 9100** — "JetDirect", or raw socket printing. There is no protocol on
 * top: open the socket, write ESC/POS, close it. That makes this the simplest
 * transport in the app, and the only *wireless* one that works everywhere.
 *
 * ## Why this matters on Chrome OS
 *
 * The Crostini container gets no Bluetooth adapter and no print spooler, but it
 * does get full network access. So on a Chromebook this is the only wireless
 * route to a printer that can work at all — and it needs nothing shared, no
 * permissions, no `usermod`, and no root. A network printer is the
 * recommendation for that machine.
 *
 * The socket is opened per receipt rather than held open. A held connection is
 * faster by a few milliseconds and much worse in a restaurant: these printers
 * accept exactly one connection at a time, and a dropped Wi-Fi link leaves a
 * pooled socket that looks alive and silently swallows receipts until someone
 * notices the paper is not moving.
 */

import { Socket } from 'net'
import { networkInterfaces } from 'os'
import type { PrinterInfo } from '@shared/types'

export const DEFAULT_PORT = 9100
const CONNECT_TIMEOUT_MS = 4_000
const WRITE_TIMEOUT_MS = 20_000
/** Kept short: it multiplies by 254 addresses when scanning a subnet. */
const SCAN_TIMEOUT_MS = 350
const SCAN_BATCH = 32

/** A network target, written `host` or `host:port`. */
export interface NetworkTarget {
  host: string
  port: number
}

/** True for a printer "name" that is really a network address. */
export function isNetworkTarget(name: string | null | undefined): boolean {
  return !!name && parseTarget(name) !== null
}

/**
 * Parse `192.168.1.50`, `192.168.1.50:9100` or `printer.local:9100`.
 * Returns null rather than throwing so callers can treat a queue name, a
 * device node and an address uniformly.
 */
export function parseTarget(raw: string | null | undefined): NetworkTarget | null {
  if (!raw) return null
  const text = raw.trim()
  if (text.length === 0 || text.startsWith('/')) return null

  const m = /^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/.exec(text)
  if (!m) return null
  const host = m[1]
  // A bare hostname is ambiguous with a print queue name, so require either a
  // port or something that looks like an address.
  const hasPort = m[2] !== undefined
  const looksNumeric = /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  const looksHostname = host.includes('.')
  if (!hasPort && !looksNumeric && !looksHostname) return null

  if (looksNumeric && host.split('.').some((o) => Number(o) > 255)) return null

  const port = hasPort ? Number(m[2]) : DEFAULT_PORT
  if (port < 1 || port > 65535) return null
  return { host, port }
}

export function formatTarget(t: NetworkTarget): string {
  return t.port === DEFAULT_PORT ? t.host : `${t.host}:${t.port}`
}

/* -------------------------------- writing -------------------------------- */

/**
 * Write the payload and wait for it to reach the wire.
 *
 * `end()` is used rather than `destroy()`: the printer needs the FIN to know
 * the job is complete, and destroying the socket early truncates the last
 * packet — which shows up as a receipt missing its cut.
 */
export function writeToNetworkPrinter(target: NetworkTarget, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    let settled = false

    const fail = (message: string): void => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(message))
    }
    const done = (): void => {
      if (settled) return
      settled = true
      resolve()
    }

    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.once('timeout', () =>
      fail(
        `${formatTarget(target)} did not respond. Check the printer is switched on and on the same Wi-Fi network, and that the address is right.`
      )
    )
    socket.once('error', (e) => fail(describeNetworkFailure(e, target)))
    socket.once('close', done)

    socket.connect(target.port, target.host, () => {
      // Connected: the remaining risk is a printer that accepts and stalls.
      socket.setTimeout(WRITE_TIMEOUT_MS)
      socket.end(payload)
    })
  })
}

/** Is something listening? Used by probe and by the subnet scan. */
export function checkReachable(target: NetworkTarget, timeoutMs = CONNECT_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(target.port, target.host, () => finish(true))
  })
}

function describeNetworkFailure(e: unknown, target: NetworkTarget): string {
  const code = (e as NodeJS.ErrnoException)?.code
  const where = formatTarget(target)
  switch (code) {
    case 'ECONNREFUSED':
      return `${where} refused the connection. Something is at that address but it is not accepting print jobs on port ${target.port} — check the printer's network settings.`
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `${where} cannot be reached from this computer. The printer is on a different network, or this machine is offline.`
    case 'ETIMEDOUT':
      return `${where} did not respond in time. Check the printer is switched on and connected to Wi-Fi.`
    case 'ENOTFOUND':
      return `"${target.host}" is not a name this network can resolve. Use the printer's IP address instead — it is usually on a self-test slip printed by holding the feed button while switching it on.`
    case 'ECONNRESET':
      return `${where} closed the connection mid-job. These printers accept one connection at a time, so something else may be printing to it.`
    default:
      return e instanceof Error ? `${where}: ${e.message}` : `Could not print to ${where}.`
  }
}

/* ------------------------------- discovery -------------------------------- */

/** This machine's IPv4 /24 subnets, which is where the printer will be. */
export function localSubnets(): string[] {
  const prefixes = new Set<string>()
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      // /24 only. Scanning anything larger is not something to do on a whim.
      if (a.netmask !== '255.255.255.0') continue
      prefixes.add(a.address.split('.').slice(0, 3).join('.'))
    }
  }
  return [...prefixes]
}

/**
 * Look for printers by trying port 9100 across the local /24.
 *
 * This is an explicit, user-initiated action, never automatic: it opens 254
 * connections, which is a reasonable thing to do when someone presses "Find
 * network printers" and an unreasonable thing to do on a timer. Batched so the
 * whole subnet takes a couple of seconds rather than opening 254 sockets at
 * once, which some consumer routers treat as a port scan and rate-limit.
 */
export async function scanForPrinters(port = DEFAULT_PORT): Promise<NetworkTarget[]> {
  const found: NetworkTarget[] = []
  for (const prefix of localSubnets()) {
    const hosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`)
    for (let i = 0; i < hosts.length; i += SCAN_BATCH) {
      const batch = hosts.slice(i, i + SCAN_BATCH)
      const results = await Promise.all(
        batch.map(async (host) => ((await checkReachable({ host, port }, SCAN_TIMEOUT_MS)) ? host : null))
      )
      for (const host of results) if (host) found.push({ host, port })
    }
  }
  return found
}

/** Present a configured address as a printer, so the picker is uniform. */
export function networkTargetAsPrinter(target: NetworkTarget, reachable: boolean): PrinterInfo {
  return {
    name: formatTarget(target),
    displayName: `Network printer (${formatTarget(target)})`,
    description: 'Wi-Fi / Ethernet, raw port 9100',
    status: reachable ? 0 : 1,
    isDefault: true
  }
}
