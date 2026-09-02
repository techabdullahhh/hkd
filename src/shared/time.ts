/**
 * Pure time helpers for the restaurant BUSINESS DAY concept.
 *
 * A restaurant business day is NOT a calendar day. It typically runs
 * 6:00 PM -> 6:00 AM, so it crosses midnight. Calendar midnight must
 * never be used to bucket sales, and it must never reset an employee
 * session.
 *
 * The single source of truth here is `businessDateKey`: given any instant
 * and the configured "day start hour", it returns the YYYY-MM-DD label of
 * the business day that instant belongs to.
 *
 * These functions are intentionally dependency-free so they can be unit
 * tested in isolation and reused by both the main and renderer processes.
 */

export interface BusinessDayConfig {
  /** Local hour (0-23) at which a new business day begins. Default 18 (6 PM). */
  startHour: number
  /** Length of the operating window in hours. Default 12 (6 PM -> 6 AM). */
  lengthHours: number
}

export const DEFAULT_BUSINESS_DAY: BusinessDayConfig = {
  startHour: 18,
  lengthHours: 12
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Format a Date as a local YYYY-MM-DD string (no timezone shift). */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The business-day label for an instant.
 *
 * Implementation: shift the instant back by `startHour` hours, then take
 * the calendar date. Every instant from 6:00 PM Sep 1 through 5:59:59 AM
 * Sep 2 maps to "2026-09-01" when startHour = 18.
 */
export function businessDateKey(
  at: Date | number,
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY
): string {
  const ts = typeof at === 'number' ? at : at.getTime()
  const shifted = new Date(ts - config.startHour * 60 * 60 * 1000)
  return dateKey(shifted)
}

/**
 * The instant a given business day opens (its scheduled start).
 * `businessDate` is a YYYY-MM-DD label.
 */
export function businessDayStart(
  businessDate: string,
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY
): Date {
  const [y, m, d] = businessDate.split('-').map(Number)
  return new Date(y, m - 1, d, config.startHour, 0, 0, 0)
}

/** The instant a given business day is scheduled to end. */
export function businessDayEnd(
  businessDate: string,
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY
): Date {
  const start = businessDayStart(businessDate, config)
  return new Date(start.getTime() + config.lengthHours * 60 * 60 * 1000)
}

/** Whether an instant falls inside the scheduled window of a business day. */
export function isWithinBusinessDay(
  at: Date | number,
  businessDate: string,
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY
): boolean {
  const ts = typeof at === 'number' ? at : at.getTime()
  return (
    ts >= businessDayStart(businessDate, config).getTime() &&
    ts < businessDayEnd(businessDate, config).getTime()
  )
}

/** Human-friendly duration between two instants, e.g. "6h 32m". */
export function formatDuration(fromMs: number, toMs: number): string {
  const totalMinutes = Math.max(0, Math.round((toMs - fromMs) / 60000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  return `${h}h ${pad(m)}m`
}

/** Local time like "6:00 PM". */
export function formatClock(at: Date | number): string {
  const d = typeof at === 'number' ? new Date(at) : at
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${pad(m)} ${ampm}`
}

/** Local date + time like "01 Sep 2026, 6:00 PM". */
export function formatDateTime(at: Date | number): string {
  const d = typeof at === 'number' ? new Date(at) : at
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ]
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}, ${formatClock(d)}`
}

/** Pretty label for a business-day key, e.g. "Mon 01 Sep 2026". */
export function formatBusinessDate(businessDate: string): string {
  const [y, m, d] = businessDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ]
  return `${days[date.getDay()]} ${pad(d)} ${months[m - 1]} ${y}`
}
