import type { Channel } from '@shared/ipc'
import { ADMIN_CHANNELS, PUBLIC_CHANNELS } from '@shared/ipc'
import { AppError } from '@shared/errors'
import type { ApiResult } from '@shared/types'
import { getCurrentUser, requireAdmin, requireAuth } from '../services/context'

import * as auth from '../services/auth'
import * as users from '../services/users'
import * as businessDay from '../services/businessDay'
import * as session from '../services/session'
import * as menu from '../services/menu'
import * as images from '../services/images'
import * as deals from '../services/deals'
import * as orders from '../services/orders'
import * as invoices from '../services/invoices'
import * as printer from '../services/printer'
import * as reports from '../services/reports'
import { getDashboardStats } from '../services/dashboard'
import * as settings from '../services/settings'
import { listAudit } from '../services/audit'
import * as backup from '../services/backup'

/** The renderer's current auth token, echoed on privileged auth calls. */
let activeToken: string | null = null

type Handler = (payload: any) => unknown | Promise<unknown>

const handlers: Record<Channel, Handler> = {
  /* auth */
  'auth:signup': (p) => auth.signup(p),
  'auth:login': (p) => {
    const u = auth.login(p)
    activeToken = u.token
    return u
  },
  'auth:restore': (p) => {
    const u = auth.restore(p.token)
    activeToken = u.token
    return u
  },
  'auth:logout': () => {
    auth.logout(activeToken ?? undefined)
    activeToken = null
    return null
  },
  'auth:changePassword': (p) => {
    const cu = requireAuth()
    const { token } = auth.changePassword(cu.id, p.currentPassword, p.newPassword)
    activeToken = token
    return { token }
  },
  'auth:me': () => {
    if (!activeToken) return null
    try {
      return auth.restore(activeToken)
    } catch {
      activeToken = null
      return null
    }
  },

  /* users */
  'users:list': (p) => (requireAdmin(), users.listUsers(p?.includeArchived)),
  'users:create': (p) => users.createUser(p),
  'users:approve': (p) => users.approveUser(p.userId, p.role),
  'users:setStatus': (p) => users.setUserStatus(p.userId, p.status),
  'users:setRole': (p) => users.setUserRole(p.userId, p.role),
  'users:resetPassword': (p) => (users.resetUserPassword(p.userId, p.newPassword), null),
  'users:update': (p) => users.updateUser(p.userId, p.fullName),

  /* business day */
  'businessDay:current': () => (requireAuth(), businessDay.getCurrentBusinessDay()),
  'businessDay:list': (p) => businessDay.listBusinessDays(p?.limit),

  /* sessions */
  'session:current': () => session.getCurrentSession(),
  'session:open': (p) => session.openSession(p?.openingNote),
  'session:close': (p) => session.closeSession(p.sessionId, p?.closingNote),
  'session:summary': (p) => session.getSessionSummary(p.sessionId),
  'session:list': (p) => session.listSessions(p ?? {}),
  'session:activeAll': () => session.listActiveSessions(),

  /* menu */
  'menu:categories': (p) => menu.listCategories(p?.includeInactive),
  'menu:categoryCreate': (p) => menu.createCategory(p.name, p.nameUrdu),
  'menu:categoryUpdate': (p) => menu.updateCategory(p),
  'menu:categoryReorder': (p) => (menu.reorderCategories(p.orderedIds), null),
  'menu:products': (p) => menu.listProducts(p ?? {}),
  'menu:productGet': (p) => menu.getProduct(p.id),
  'menu:productCreate': (p) => menu.createProduct(p),
  'menu:productUpdate': (p) => menu.updateProduct(p),
  'menu:productArchive': (p) => menu.archiveProduct(p.id, p?.reason),
  'menu:productRestore': (p) => menu.restoreProduct(p.id),
  'menu:productReorder': (p) => (menu.reorderProducts(p.categoryId, p.orderedIds), null),
  'menu:priceCreate': (p) => menu.createPrice(p),
  'menu:priceUpdate': (p) => menu.updatePrice(p),
  'menu:priceArchive': (p) => menu.archivePrice(p.id),
  'menu:posMenu': () => menu.getPosMenu(),
  'menu:imagePick': () => images.pickAndStageImage(),
  'menu:imageCredits': () => images.imageCredits(),

  /* deals */
  'deals:list': (p) => deals.listDeals(p?.includeArchived),
  'deals:get': (p) => deals.getDeal(p.id),
  'deals:create': (p) => deals.createDeal(p),
  'deals:update': (p) => deals.updateDeal(p),
  'deals:archive': (p) => deals.archiveDeal(p.id),
  'deals:restore': (p) => deals.restoreDeal(p.id),

  /* pos / orders */
  'pos:holdOrder': (p) => orders.holdOrder(p),
  'pos:heldOrders': () => orders.listHeldOrders(),
  'pos:resumeOrder': (p) => orders.resumeHeldOrder(p.orderId),
  'pos:deleteHeld': (p) => (orders.deleteHeldOrder(p.orderId, p?.reason), null),
  'pos:checkout': async (p) => {
    const r = await orders.checkout(p)
    const invoice = invoices.getInvoice(r.invoiceId)
    return { order: r.order, invoice, printed: r.printed, printMessage: r.printMessage }
  },
  'orders:list': (p) => orders.listOrders(p ?? {}),
  'orders:get': (p) => orders.getOrder(p.id),
  'orders:cancel': (p) => orders.cancelOrder(p.orderId, p.reason),
  'orders:refund': (p) => orders.refundOrder(p.orderId, p.amountMinor, p.reason, p?.method),

  /* invoices */
  'invoices:list': (p) => invoices.listInvoices(p ?? {}),
  'invoices:get': (p) => invoices.getInvoice(p.id),
  'invoices:print': (p) => invoices.printInvoice(p.invoiceId),
  'invoices:reprint': (p) => invoices.reprintInvoice(p.invoiceId, p?.reason),
  'invoices:testPrint': () => invoices.testPrint(),

  /* printer */
  'printer:state': () => printer.getPrinterState(),
  'printer:list': () => printer.listPrinters(),
  'printer:updateSettings': (p) => printer.updatePrinterSettings(p),
  'printer:logo': () => printer.getLogoState(),
  'printer:logoChoose': () => printer.chooseLogo(),
  'printer:logoRemove': () => printer.removeLogo(),
  'printer:probe': () => printer.probePrinter(),

  /* reports */
  'reports:businessDay': (p) => reports.businessDayReport(p.businessDate),
  'reports:dateRange': (p) => reports.dateRangeReport(p),
  'reports:employees': (p) => reports.employeesReport(p),
  'reports:sessions': (p) => reports.sessionsReport(p),
  'reports:products': (p) => reports.productsReport(p),
  'reports:categories': (p) => reports.categoriesReport(p),
  'reports:deals': (p) => reports.dealsReport(p),
  'reports:payments': (p) => reports.paymentsReport(p),
  'reports:cancellations': (p) => reports.cancellationsReport(p),
  'reports:refunds': (p) => reports.refundsReport(p),

  /* dashboard */
  'dashboard:stats': () => getDashboardStats(),

  /* settings */
  'settings:get': () => (requireAuth(), settings.getSettings()),
  'settings:update': (p) => settings.updateSettings(p),
  'settings:paymentMethods': (p) => (requireAuth(), settings.listPaymentMethods(p?.includeInactive)),
  'settings:paymentMethodCreate': (p) => settings.createPaymentMethod(p),
  'settings:paymentMethodUpdate': (p) => settings.updatePaymentMethod(p),

  /* audit */
  'audit:list': (p) => listAudit(p ?? {}),

  /* backup */
  'backup:create': (p) => backup.createBackup(p?.note),
  'backup:list': () => backup.listBackups(),
  'backup:restore': (p) => backup.restoreBackup(p.path, p.confirm),
  'backup:exportJson': () => backup.exportJson()
}

export async function dispatch(channel: Channel, payload: unknown): Promise<ApiResult<unknown>> {
  try {
    if (!handlers[channel]) throw new AppError('VALIDATION', `Unknown channel: ${channel}`)

    // authz gate
    if (!PUBLIC_CHANNELS.includes(channel)) {
      const cu = getCurrentUser()
      if (!cu) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.')
      if (ADMIN_CHANNELS.includes(channel)) requireAdmin()
    }

    const data = await handlers[channel](payload ?? {})
    return { ok: true, data }
  } catch (e) {
    if (e instanceof AppError) {
      // eslint-disable-next-line no-console
      if (e.code === 'INTERNAL' || e.code === 'DB_ERROR') console.error(`[ipc:${channel}]`, e)
      return { ok: false, error: { code: e.code, message: e.message } }
    }
    // eslint-disable-next-line no-console
    console.error(`[ipc:${channel}] unhandled`, e)
    const msg =
      e instanceof Error && /immutable|append-only/i.test(e.message)
        ? 'That record is part of the permanent financial history and cannot be changed.'
        : 'Something went wrong. Please try again, and contact your administrator if it continues.'
    return { ok: false, error: { code: 'INTERNAL', message: msg } }
  }
}

export function getActiveToken(): string | null {
  return activeToken
}
