export { formatMoney, toRupees, toPaisa, CURRENCY_SYMBOL } from '@shared/money'
export {
  formatClock,
  formatDateTime,
  formatDuration,
  formatBusinessDate,
  businessDateKey
} from '@shared/time'

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function liveDuration(fromMs: number, toMs = Date.now()): string {
  const total = Math.max(0, Math.floor((toMs - fromMs) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? '')
    .join('')
    .toUpperCase()
}
