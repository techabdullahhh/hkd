/**
 * Money helpers.
 *
 * All monetary values in this application are stored and passed around as
 * INTEGER minor units (paisa). PKR 1,500.00 -> 150000. This avoids floating
 * point drift in financial records, which must remain exact and immutable.
 */

export const CURRENCY_CODE = 'PKR'
export const CURRENCY_SYMBOL = 'PKR'

/** Convert a rupee amount (possibly fractional) to integer paisa. */
export function toPaisa(rupees: number): number {
  return Math.round(rupees * 100)
}

/** Convert integer paisa to a rupee number. */
export function toRupees(paisa: number): number {
  return paisa / 100
}

/** Format integer paisa as "PKR 28,450" (or "PKR 28,450.50" when needed). */
export function formatMoney(paisa: number, opts: { withSymbol?: boolean } = {}): string {
  const withSymbol = opts.withSymbol ?? true
  const negative = paisa < 0
  const abs = Math.abs(paisa)
  const rupees = Math.floor(abs / 100)
  const rem = abs % 100
  const grouped = rupees.toLocaleString('en-PK')
  const body = rem === 0 ? grouped : `${grouped}.${rem < 10 ? '0' : ''}${rem}`
  const sign = negative ? '-' : ''
  return withSymbol ? `${sign}${CURRENCY_SYMBOL} ${body}` : `${sign}${body}`
}

/** Round a percentage discount applied to a base, in paisa. */
export function percentOf(basePaisa: number, percent: number): number {
  return Math.round((basePaisa * percent) / 100)
}
