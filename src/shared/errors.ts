/**
 * Typed application errors. Every service throws `AppError`; the IPC layer
 * converts it to `{ ok: false, error }`. Restaurant staff only ever see the
 * `message`; developer stack traces stay in the main-process log.
 */

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ACCOUNT_PENDING'
  | 'ACCOUNT_DISABLED'
  | 'BAD_CREDENTIALS'
  | 'NO_SESSION'
  | 'SESSION_EXPIRED'
  | 'PRINTER_UNAVAILABLE'
  | 'PRINT_FAILED'
  | 'PAYMENT_INVALID'
  | 'DUPLICATE_ACTION'
  | 'IMMUTABLE'
  | 'DB_ERROR'
  | 'INTERNAL'

export class AppError extends Error {
  code: ErrorCode
  details?: unknown
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

export const err = {
  unauthenticated: (m = 'Please sign in to continue.') => new AppError('UNAUTHENTICATED', m),
  unauthorized: (m = 'You do not have permission to do that.') => new AppError('UNAUTHORIZED', m),
  validation: (m: string, details?: unknown) => new AppError('VALIDATION', m, details),
  notFound: (m = 'That record could not be found.') => new AppError('NOT_FOUND', m),
  conflict: (m: string) => new AppError('CONFLICT', m),
  noSession: (m = 'You need an active session before using the POS.') => new AppError('NO_SESSION', m),
  printerUnavailable: (m: string) => new AppError('PRINTER_UNAVAILABLE', m),
  printFailed: (m: string) => new AppError('PRINT_FAILED', m),
  paymentInvalid: (m: string) => new AppError('PAYMENT_INVALID', m),
  duplicate: (m = 'That action was already completed.') => new AppError('DUPLICATE_ACTION', m),
  internal: (m = 'Something went wrong. Please try again.') => new AppError('INTERNAL', m)
}
