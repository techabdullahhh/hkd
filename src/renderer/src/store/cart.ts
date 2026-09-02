import { create } from 'zustand'
import type { Deal, Order, Product, ProductPrice } from '@shared/types'

export interface CartLine {
  key: string
  kind: 'PRODUCT' | 'DEAL'
  refId: number
  productPriceId?: number
  name: string
  nameUrdu: string | null
  variantLabel: string | null
  unitPriceMinor: number
  quantity: number
  note: string
}

interface CartState {
  lines: CartLine[]
  orderNote: string
  customerName: string
  discountMinor: number
  discountReason: string
  /** fixed service charge from Admin settings, applied to every order */
  serviceChargeMinor: number
  resumingHeldId: number | null

  setServiceCharge: (minor: number) => void
  addProduct: (p: Product, price: ProductPrice) => void
  addDeal: (d: Deal) => void
  setQty: (key: string, qty: number) => void
  bump: (key: string, delta: number) => void
  setNote: (key: string, note: string) => void
  remove: (key: string) => void
  clear: () => void
  setOrderNote: (v: string) => void
  setCustomerName: (v: string) => void
  setDiscount: (minor: number, reason: string) => void
  loadHeld: (o: Order) => void

  subtotal: () => number
  /** amount of service charge that applies right now (0 when the cart is empty) */
  serviceCharge: () => number
  total: () => number
  count: () => number
}

const lineKey = (kind: string, refId: number, priceId?: number) => `${kind}:${refId}:${priceId ?? 0}`

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  orderNote: '',
  customerName: '',
  discountMinor: 0,
  discountReason: '',
  serviceChargeMinor: 0,
  resumingHeldId: null,

  setServiceCharge: (minor) => set({ serviceChargeMinor: Math.max(0, Math.round(minor)) }),

  addProduct: (p, price) => {
    const key = lineKey('PRODUCT', p.id, price.id)
    set((s) => {
      const existing = s.lines.find((l) => l.key === key)
      if (existing) {
        return { lines: s.lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l)) }
      }
      return {
        lines: [
          ...s.lines,
          {
            key,
            kind: 'PRODUCT',
            refId: p.id,
            productPriceId: price.id,
            name: p.name,
            nameUrdu: p.nameUrdu,
            variantLabel: price.variant === 'STANDARD' ? null : price.label,
            unitPriceMinor: price.priceMinor,
            quantity: 1,
            note: ''
          }
        ]
      }
    })
  },

  addDeal: (d) => {
    const key = lineKey('DEAL', d.id)
    set((s) => {
      const existing = s.lines.find((l) => l.key === key)
      if (existing) return { lines: s.lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l)) }
      return {
        lines: [
          ...s.lines,
          {
            key,
            kind: 'DEAL',
            refId: d.id,
            name: d.name,
            nameUrdu: d.nameUrdu,
            variantLabel: 'Deal',
            unitPriceMinor: d.priceMinor,
            quantity: 1,
            note: ''
          }
        ]
      }
    })
  },

  setQty: (key, qty) =>
    set((s) => ({
      lines: qty <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity: qty } : l))
    })),

  bump: (key, delta) => {
    const line = get().lines.find((l) => l.key === key)
    if (!line) return
    get().setQty(key, line.quantity + delta)
  },

  setNote: (key, note) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, note } : l)) })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
  clear: () =>
    set({ lines: [], orderNote: '', customerName: '', discountMinor: 0, discountReason: '', resumingHeldId: null }),

  setOrderNote: (v) => set({ orderNote: v }),
  setCustomerName: (v) => set({ customerName: v }),
  setDiscount: (minor, reason) => set({ discountMinor: Math.max(0, Math.round(minor)), discountReason: reason }),

  loadHeld: (o) => {
    set({
      resumingHeldId: o.id,
      orderNote: o.orderNote ?? '',
      customerName: o.customerName ?? '',
      discountMinor: 0,
      discountReason: '',
      lines: o.lines.map((l) => ({
        key: lineKey(l.kind, l.refId ?? 0, l.productPriceId ?? undefined),
        kind: l.kind,
        refId: l.refId ?? 0,
        productPriceId: l.productPriceId ?? undefined,
        name: l.name,
        nameUrdu: l.nameUrdu,
        variantLabel: l.variantLabel,
        unitPriceMinor: l.unitPriceMinor,
        quantity: l.quantity,
        note: l.note ?? ''
      }))
    })
  },

  subtotal: () => get().lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0),
  serviceCharge: () => (get().lines.length === 0 ? 0 : get().serviceChargeMinor),
  total: () =>
    Math.max(0, get().subtotal() - get().discountMinor) + get().serviceCharge(),
  count: () => get().lines.reduce((s, l) => s + l.quantity, 0)
}))
