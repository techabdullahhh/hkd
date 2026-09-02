/**
 * Domain types shared between the main process (SQLite services) and the
 * renderer (React UI). These are DTO shapes returned across IPC — not the
 * raw Drizzle row types.
 */

export type Role = 'ADMIN' | 'EMPLOYEE'

export type UserStatus = 'PENDING' | 'ACTIVE' | 'DISABLED' | 'ARCHIVED'

export interface User {
  id: number
  username: string
  fullName: string
  role: Role
  status: UserStatus
  mustChangePassword: boolean
  createdAt: number
  approvedAt: number | null
  lastLoginAt: number | null
}

export interface AuthUser extends User {
  /** opaque token persisted by the renderer for session restore */
  token: string
}

export type SessionStatus = 'OPEN' | 'CLOSED'

export interface WorkSession {
  id: number
  userId: number
  userFullName: string
  /** the reporting day the session STARTED in — a label only; the session
   *  is unbounded and spans midnight until the employee ends it */
  businessDate: string
  status: SessionStatus
  openedAt: number
  closedAt: number | null
  openingNote: string | null
  closingNote: string | null
}

export interface SessionSummary {
  session: WorkSession
  durationMs: number
  orderCount: number
  invoiceCount: number
  grossSales: number
  discountTotal: number
  serviceChargeTotal: number
  refundTotal: number
  netSales: number
  paymentBreakdown: { method: string; label: string; amount: number; count: number }[]
  cancelledCount: number
}

/**
 * A reporting-day bucket. There is NO open/close lifecycle — the restaurant
 * is always operational. This only groups sales for reporting and never
 * affects sessions or POS access.
 */
export interface BusinessDay {
  id: number
  businessDate: string
  firstActivityAt: number
  orderCount: number
  invoiceCount: number
  netMinor: number
  openSessionCount: number
}

export interface Category {
  id: number
  name: string
  nameUrdu: string | null
  sortOrder: number
  isActive: boolean
  productCount?: number
}

export type PriceVariant = 'STANDARD' | 'HALF' | 'FULL'

export interface ProductPrice {
  id: number
  productId: number
  variant: PriceVariant
  label: string
  priceMinor: number
  isActive: boolean
}

export interface Product {
  id: number
  categoryId: number
  categoryName: string
  name: string
  nameUrdu: string | null
  description: string | null
  /** `hkd-img://` URL served from the database, or null when unset. */
  imageUrl: string | null
  sortOrder: number
  isActive: boolean
  isPopular: boolean
  isAvailable: boolean
  isArchived: boolean
  prices: ProductPrice[]
  createdAt: number
}

export interface DealItem {
  id: number
  dealId: number
  productId: number | null
  productName: string
  variant: PriceVariant
  quantity: number
  note: string | null
}

export interface Deal {
  id: number
  name: string
  nameUrdu: string | null
  description: string | null
  /** `hkd-img://` URL served from the database, or null when unset. */
  imageUrl: string | null
  priceMinor: number
  categoryId: number | null
  isActive: boolean
  isAvailable: boolean
  isArchived: boolean
  sortOrder: number
  items: DealItem[]
  createdAt: number
}

export type OrderStatus = 'HELD' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED'

export type OrderLineKind = 'PRODUCT' | 'DEAL'

export interface OrderLine {
  id: number
  orderId: number
  kind: OrderLineKind
  refId: number | null
  productPriceId: number | null
  name: string
  nameUrdu: string | null
  variantLabel: string | null
  quantity: number
  unitPriceMinor: number
  lineDiscountMinor: number
  lineTotalMinor: number
  note: string | null
  /** for deals: the resolved component lines, informational only */
  components?: { name: string; quantity: number; variantLabel: string | null }[]
}

export type PaymentMethodCode = string

export interface Payment {
  id: number
  orderId: number
  method: PaymentMethodCode
  methodLabel: string
  amountMinor: number
  tenderedMinor: number | null
  changeMinor: number | null
  reference: string | null
  createdAt: number
  isRefund: boolean
}

export interface Order {
  id: number
  orderNumber: string
  status: OrderStatus
  userId: number
  userFullName: string
  sessionId: number | null
  businessDayId: number | null
  businessDate: string | null
  subtotalMinor: number
  discountMinor: number
  discountReason: string | null
  serviceChargeMinor: number
  totalMinor: number
  orderNote: string | null
  customerName: string | null
  createdAt: number
  completedAt: number | null
  cancelledAt: number | null
  cancelReason: string | null
  lines: OrderLine[]
  payments: Payment[]
  invoice: Invoice | null
}

export type PrintStatus = 'NOT_PRINTED' | 'PRINTED' | 'FAILED' | 'PENDING'

export interface InvoiceLine {
  id: number
  invoiceId: number
  name: string
  nameUrdu: string | null
  variantLabel: string | null
  quantity: number
  unitPriceMinor: number
  lineTotalMinor: number
}

export interface Invoice {
  id: number
  invoiceNumber: string
  orderId: number
  orderNumber: string
  userId: number
  userFullName: string
  sessionId: number | null
  businessDayId: number | null
  businessDate: string | null
  issuedAt: number
  subtotalMinor: number
  discountMinor: number
  serviceChargeMinor: number
  totalMinor: number
  paymentMethod: string
  paymentMethodLabel: string
  printStatus: PrintStatus
  printCount: number
  lastPrintedAt: number | null
  lastPrintError: string | null
  lines: InvoiceLine[]
  snapshot: InvoiceSnapshot
}

/** Immutable frozen copy of everything the invoice needs to reprint forever. */
export interface InvoiceSnapshot {
  restaurantName: string
  restaurantNameUrdu: string
  restaurantPhone: string
  restaurantAddress: string
  footerText: string
  paperWidth: 58 | 80
  invoiceNumber: string
  orderNumber: string
  employeeName: string
  sessionId: number | null
  businessDate: string | null
  issuedAt: number
  lines: {
    name: string
    nameUrdu: string | null
    variantLabel: string | null
    quantity: number
    unitPriceMinor: number
    lineTotalMinor: number
  }[]
  subtotalMinor: number
  discountMinor: number
  discountReason: string | null
  serviceChargeMinor: number
  totalMinor: number
  paymentMethodLabel: string
  tenderedMinor: number | null
  changeMinor: number | null
}

export interface PaymentMethod {
  id: number
  code: string
  label: string
  requiresReference: boolean
  allowsChange: boolean
  isActive: boolean
  sortOrder: number
}

export interface PrinterInfo {
  name: string
  displayName: string
  description: string
  status: number
  isDefault: boolean
}

export interface PrinterSettings {
  mode: 'SYSTEM' | 'ESCPOS_BLUETOOTH'
  selectedPrinter: string | null
  paperWidth: 58 | 80
  escposAddress: string | null
  autoPrint: boolean
  copies: number
  /** Print the restaurant logo at the top of every invoice. */
  printLogo: boolean
}

export interface PrinterState {
  settings: PrinterSettings
  availablePrinters: PrinterInfo[]
  reachable: boolean
  message: string
}

export interface AppSettings {
  restaurantName: string
  restaurantNameUrdu: string
  restaurantPhone: string
  restaurantAddress: string
  invoiceFooter: string
  /** Fixed service charge added to every order, in paisa (PKR 30 = 3000). */
  serviceChargeMinor: number
  businessDayStartHour: number
  businessDayLengthHours: number
  allowEmployeeDiscount: boolean
  maxEmployeeDiscountPercent: number
  invoicePrefix: string
  orderPrefix: string
}

export interface AuditLogEntry {
  id: number
  at: number
  actorId: number | null
  actorName: string
  action: string
  entityType: string | null
  entityId: string | null
  summary: string
  detailsJson: string | null
}

export interface DashboardStats {
  /** today's reporting day — always present; the restaurant is always open */
  businessDay: BusinessDay
  revenueMinor: number
  orderCount: number
  invoiceCount: number
  cancelledCount: number
  refundCount: number
  refundTotalMinor: number
  activeSessions: {
    sessionId: number
    userFullName: string
    openedAt: number
    orderCount: number
    salesMinor: number
  }[]
  topProducts: { name: string; quantity: number; revenueMinor: number }[]
  salesByEmployee: { userFullName: string; orderCount: number; salesMinor: number }[]
  salesBySession: { sessionId: number; userFullName: string; businessDate: string; salesMinor: number; orderCount: number }[]
  printer: { reachable: boolean; message: string; selectedPrinter: string | null }
  systemHealth: {
    dbSizeBytes: number
    dbPath: string
    lastBackupAt: number | null
    appVersion: string
    uptimeMs: number
  }
}

export interface Paginated<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export interface ApiError {
  code: string
  message: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }
