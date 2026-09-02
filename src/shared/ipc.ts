/**
 * The IPC contract.
 *
 * `CHANNELS` is the flat manifest of every renderer→main call. The preload
 * turns it into a nested, typed `window.api` object. `Api` describes the
 * shape the renderer consumes. Every handler on the main side returns
 * `ApiResult<T>` so failures cross the boundary as data, never as thrown
 * strings shown to restaurant staff.
 */

import type {
  ApiResult,
  AppSettings,
  AuditLogEntry,
  AuthUser,
  BusinessDay,
  Category,
  DashboardStats,
  Deal,
  Invoice,
  Order,
  Paginated,
  PaymentMethod,
  PrinterInfo,
  PrinterSettings,
  PrinterState,
  Product,
  Role,
  SessionSummary,
  User,
  WorkSession
} from './types'

export const CHANNELS = [
  // auth
  'auth:signup',
  'auth:login',
  'auth:restore',
  'auth:logout',
  'auth:changePassword',
  'auth:me',
  // users (admin)
  'users:list',
  'users:create',
  'users:approve',
  'users:setStatus',
  'users:setRole',
  'users:resetPassword',
  'users:update',
  // business day
  // reporting-day dimension (NOT a restaurant open/close switch)
  'businessDay:current',
  'businessDay:list',
  // sessions
  'session:current',
  'session:open',
  'session:close',
  'session:summary',
  'session:list',
  'session:activeAll',
  // menu
  'menu:categories',
  'menu:categoryCreate',
  'menu:categoryUpdate',
  'menu:categoryReorder',
  'menu:products',
  'menu:productGet',
  'menu:productCreate',
  'menu:productUpdate',
  'menu:productArchive',
  'menu:productRestore',
  'menu:productReorder',
  'menu:priceCreate',
  'menu:priceUpdate',
  'menu:priceArchive',
  'menu:posMenu',
  'menu:imagePick',
  'menu:imageCredits',
  // deals
  'deals:list',
  'deals:get',
  'deals:create',
  'deals:update',
  'deals:archive',
  'deals:restore',
  // orders / POS
  'pos:holdOrder',
  'pos:heldOrders',
  'pos:resumeOrder',
  'pos:deleteHeld',
  'pos:checkout',
  'orders:list',
  'orders:get',
  'orders:cancel',
  'orders:refund',
  // invoices
  'invoices:list',
  'invoices:get',
  'invoices:print',
  'invoices:reprint',
  'invoices:testPrint',
  // printer
  'printer:state',
  'printer:list',
  'printer:updateSettings',
  'printer:logo',
  'printer:logoChoose',
  'printer:logoRemove',
  'printer:probe',
  // reports
  'reports:businessDay',
  'reports:dateRange',
  'reports:employees',
  'reports:sessions',
  'reports:products',
  'reports:categories',
  'reports:deals',
  'reports:payments',
  'reports:cancellations',
  'reports:refunds',
  // dashboard
  'dashboard:stats',
  // settings
  'settings:get',
  'settings:update',
  'settings:paymentMethods',
  'settings:paymentMethodCreate',
  'settings:paymentMethodUpdate',
  // audit
  'audit:list',
  // backup
  'backup:create',
  'backup:list',
  'backup:restore',
  'backup:exportJson'
] as const

export type Channel = (typeof CHANNELS)[number]

/* ------------------------------------------------------------------ */
/* Payload / response types                                            */
/* ------------------------------------------------------------------ */

export interface SignupInput {
  username: string
  fullName: string
  password: string
}
export interface LoginInput {
  username: string
  password: string
}
export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface OpenSessionInput {
  openingNote?: string
}
export interface CloseSessionInput {
  sessionId: number
  closingNote?: string
}

export interface CheckoutLineInput {
  kind: 'PRODUCT' | 'DEAL'
  refId: number
  productPriceId?: number
  quantity: number
  note?: string
}
export interface CheckoutInput {
  lines: CheckoutLineInput[]
  orderNote?: string
  customerName?: string
  discountMinor?: number
  discountReason?: string
  payment: {
    method: string
    tenderedMinor?: number
    reference?: string
  }
  fromHeldOrderId?: number
  autoPrint?: boolean
}
export interface CheckoutResult {
  order: Order
  invoice: Invoice
  printed: boolean
  printMessage: string
}

export interface HoldOrderInput {
  lines: CheckoutLineInput[]
  orderNote?: string
  customerName?: string
  heldOrderId?: number
}

export interface OrderListQuery {
  page?: number
  pageSize?: number
  businessDate?: string
  sessionId?: number
  userId?: number
  paymentMethod?: string
  status?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}

export interface DateRangeQuery {
  from: string
  to: string
}

export interface Api {
  auth: {
    signup(i: SignupInput): Promise<ApiResult<{ user: User }>>
    login(i: LoginInput): Promise<ApiResult<AuthUser>>
    restore(i: { token: string }): Promise<ApiResult<AuthUser>>
    logout(): Promise<ApiResult<null>>
    changePassword(i: ChangePasswordInput): Promise<ApiResult<{ token: string }>>
    me(): Promise<ApiResult<AuthUser | null>>
  }
  users: {
    list(i?: { includeArchived?: boolean }): Promise<ApiResult<User[]>>
    create(i: SignupInput & { role: Role }): Promise<ApiResult<User>>
    approve(i: { userId: number; role: Role }): Promise<ApiResult<User>>
    setStatus(i: { userId: number; status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED' }): Promise<ApiResult<User>>
    setRole(i: { userId: number; role: Role }): Promise<ApiResult<User>>
    resetPassword(i: { userId: number; newPassword: string }): Promise<ApiResult<null>>
    update(i: { userId: number; fullName?: string }): Promise<ApiResult<User>>
  }
  businessDay: {
    /** today's reporting day — always available, never gated */
    current(): Promise<ApiResult<BusinessDay>>
    /** recent reporting days that have had activity, for report filters */
    list(i?: { limit?: number }): Promise<ApiResult<BusinessDay[]>>
  }
  session: {
    current(): Promise<ApiResult<WorkSession | null>>
    open(i: OpenSessionInput): Promise<ApiResult<WorkSession>>
    close(i: CloseSessionInput): Promise<ApiResult<SessionSummary>>
    summary(i: { sessionId: number }): Promise<ApiResult<SessionSummary>>
    list(i?: { userId?: number; businessDate?: string; limit?: number }): Promise<ApiResult<WorkSession[]>>
    activeAll(): Promise<ApiResult<WorkSession[]>>
  }
  menu: {
    categories(i?: { includeInactive?: boolean }): Promise<ApiResult<Category[]>>
    categoryCreate(i: { name: string; nameUrdu?: string }): Promise<ApiResult<Category>>
    categoryUpdate(i: { id: number; name?: string; nameUrdu?: string; isActive?: boolean }): Promise<ApiResult<Category>>
    categoryReorder(i: { orderedIds: number[] }): Promise<ApiResult<null>>
    products(i?: { categoryId?: number; includeArchived?: boolean; search?: string }): Promise<ApiResult<Product[]>>
    productGet(i: { id: number }): Promise<ApiResult<Product>>
    productCreate(i: ProductWriteInput): Promise<ApiResult<Product>>
    productUpdate(i: ProductWriteInput & { id: number }): Promise<ApiResult<Product>>
    productArchive(i: { id: number; reason?: string }): Promise<ApiResult<Product>>
    productRestore(i: { id: number }): Promise<ApiResult<Product>>
    productReorder(i: { categoryId: number; orderedIds: number[] }): Promise<ApiResult<null>>
    priceCreate(i: { productId: number; variant: string; label: string; priceMinor: number }): Promise<ApiResult<Product>>
    priceUpdate(i: { id: number; label?: string; priceMinor?: number; reason?: string }): Promise<ApiResult<Product>>
    priceArchive(i: { id: number }): Promise<ApiResult<Product>>
    posMenu(): Promise<ApiResult<{ categories: Category[]; products: Product[]; deals: Deal[] }>>
    /**
     * Opens the OS file picker, downscales the chosen photo and holds it in
     * main until the product/deal is saved. Returns null if the admin
     * cancelled. The preview is a data URL for the editor only — tiles use
     * the `hkd-img://` URL on the saved row.
     */
    imagePick(): Promise<ApiResult<{ stagedImageId: string; previewDataUrl: string; byteSize: number } | null>>
    imageCredits(): Promise<ApiResult<{ name: string; credit: string }[]>>
  }
  deals: {
    list(i?: { includeArchived?: boolean }): Promise<ApiResult<Deal[]>>
    get(i: { id: number }): Promise<ApiResult<Deal>>
    create(i: DealWriteInput): Promise<ApiResult<Deal>>
    update(i: DealWriteInput & { id: number }): Promise<ApiResult<Deal>>
    archive(i: { id: number }): Promise<ApiResult<Deal>>
    restore(i: { id: number }): Promise<ApiResult<Deal>>
  }
  pos: {
    holdOrder(i: HoldOrderInput): Promise<ApiResult<Order>>
    heldOrders(): Promise<ApiResult<Order[]>>
    resumeOrder(i: { orderId: number }): Promise<ApiResult<Order>>
    deleteHeld(i: { orderId: number; reason?: string }): Promise<ApiResult<null>>
    checkout(i: CheckoutInput): Promise<ApiResult<CheckoutResult>>
  }
  orders: {
    list(i: OrderListQuery): Promise<ApiResult<Paginated<Order>>>
    get(i: { id: number }): Promise<ApiResult<Order>>
    cancel(i: { orderId: number; reason: string }): Promise<ApiResult<Order>>
    refund(i: { orderId: number; amountMinor: number; reason: string; method?: string }): Promise<ApiResult<Order>>
  }
  invoices: {
    list(i: OrderListQuery): Promise<ApiResult<Paginated<Invoice>>>
    get(i: { id: number }): Promise<ApiResult<Invoice>>
    print(i: { invoiceId: number }): Promise<ApiResult<Invoice>>
    reprint(i: { invoiceId: number; reason?: string }): Promise<ApiResult<Invoice>>
    testPrint(): Promise<ApiResult<{ ok: boolean; message: string }>>
  }
  printer: {
    state(): Promise<ApiResult<PrinterState>>
    list(): Promise<ApiResult<PrinterInfo[]>>
    updateSettings(i: Partial<PrinterSettings>): Promise<ApiResult<PrinterState>>
    probe(): Promise<ApiResult<{ reachable: boolean; message: string }>>
    /**
     * The invoice logo as it will actually print — 1-bit line art at the
     * head's dot width, not the colour original.
     */
    logo(): Promise<ApiResult<LogoState>>
    logoChoose(): Promise<ApiResult<LogoState>>
    logoRemove(): Promise<ApiResult<LogoState>>
  }
  reports: {
    businessDay(i: { businessDate: string }): Promise<ApiResult<any>>
    dateRange(i: DateRangeQuery): Promise<ApiResult<any>>
    employees(i: DateRangeQuery): Promise<ApiResult<any>>
    sessions(i: DateRangeQuery): Promise<ApiResult<any>>
    products(i: DateRangeQuery): Promise<ApiResult<any>>
    categories(i: DateRangeQuery): Promise<ApiResult<any>>
    deals(i: DateRangeQuery): Promise<ApiResult<any>>
    payments(i: DateRangeQuery): Promise<ApiResult<any>>
    cancellations(i: DateRangeQuery): Promise<ApiResult<any>>
    refunds(i: DateRangeQuery): Promise<ApiResult<any>>
  }
  dashboard: {
    stats(): Promise<ApiResult<DashboardStats>>
  }
  settings: {
    get(): Promise<ApiResult<AppSettings>>
    update(i: Partial<AppSettings>): Promise<ApiResult<AppSettings>>
    paymentMethods(i?: { includeInactive?: boolean }): Promise<ApiResult<PaymentMethod[]>>
    paymentMethodCreate(i: { code: string; label: string; requiresReference?: boolean; allowsChange?: boolean }): Promise<ApiResult<PaymentMethod>>
    paymentMethodUpdate(i: { id: number; label?: string; isActive?: boolean; requiresReference?: boolean; allowsChange?: boolean }): Promise<ApiResult<PaymentMethod>>
  }
  audit: {
    list(i: { page?: number; pageSize?: number; action?: string; actorId?: number; search?: string }): Promise<ApiResult<Paginated<AuditLogEntry>>>
  }
  backup: {
    create(i?: { note?: string }): Promise<ApiResult<{ path: string; sizeBytes: number; createdAt: number }>>
    list(): Promise<ApiResult<{ path: string; name: string; sizeBytes: number; createdAt: number }[]>>
    restore(i: { path: string; confirm: string }): Promise<ApiResult<{ restored: boolean }>>
    exportJson(): Promise<ApiResult<{ path: string }>>
  }
}

export interface LogoState {
  hasLogo: boolean
  enabled: boolean
  previewDataUrl: string | null
  widthDots: number
  /** Percentage of dots that will be burnt, so ink use stays visible. */
  inkPercent: number | null
}

export interface ProductWriteInput {
  categoryId: number
  name: string
  nameUrdu?: string
  description?: string
  /** Id returned by `menu:imagePick`; attached to the row on save. */
  stagedImageId?: string | null
  /** Drop the existing image on save. Wins over `stagedImageId`. */
  removeImage?: boolean
  isPopular?: boolean
  isAvailable?: boolean
  isActive?: boolean
  prices: { id?: number; variant: string; label: string; priceMinor: number }[]
}

export interface DealWriteInput {
  name: string
  nameUrdu?: string
  description?: string
  stagedImageId?: string | null
  removeImage?: boolean
  priceMinor: number
  categoryId?: number | null
  isAvailable?: boolean
  isActive?: boolean
  items: { id?: number; productId?: number | null; productName: string; variant: string; quantity: number; note?: string }[]
}

/** Channels that must not require an authenticated user. */
export const PUBLIC_CHANNELS: Channel[] = ['auth:signup', 'auth:login', 'auth:restore', 'auth:me']

/** Channels restricted to ADMIN. */
export const ADMIN_CHANNELS: Channel[] = [
  'users:list', 'users:create', 'users:approve', 'users:setStatus', 'users:setRole',
  'users:resetPassword', 'users:update',
  'menu:categoryCreate', 'menu:categoryUpdate', 'menu:categoryReorder',
  'menu:productCreate', 'menu:productUpdate', 'menu:productArchive', 'menu:productRestore',
  'menu:productReorder', 'menu:priceCreate', 'menu:priceUpdate', 'menu:priceArchive',
  'menu:imagePick',
  'deals:create', 'deals:update', 'deals:archive', 'deals:restore',
  'orders:cancel', 'orders:refund',
  'reports:businessDay', 'reports:dateRange', 'reports:employees', 'reports:sessions',
  'reports:products', 'reports:categories', 'reports:deals', 'reports:payments',
  'reports:cancellations', 'reports:refunds',
  'dashboard:stats',
  'settings:update', 'settings:paymentMethodCreate', 'settings:paymentMethodUpdate',
  'audit:list',
  'backup:create', 'backup:list', 'backup:restore', 'backup:exportJson',
  'printer:updateSettings', 'printer:logoChoose', 'printer:logoRemove',
  'session:activeAll'
]
