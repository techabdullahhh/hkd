import type { Api } from '@shared/ipc'
import type { ApiError, ApiResult } from '@shared/types'

export class ApiCallError extends Error {
  code: string
  constructor(e: ApiError) {
    super(e.message)
    this.name = 'ApiCallError'
    this.code = e.code
  }
}

/**
 * Wraps `window.api` so callers get a resolved value or a thrown
 * `ApiCallError` — never an `{ ok: false }` union to unpack by hand.
 */
type Unwrapped<T> = T extends (...args: infer A) => Promise<ApiResult<infer R>>
  ? (...args: A) => Promise<R>
  : never

type UnwrappedApi = {
  [D in keyof Api]: { [M in keyof Api[D]]: Unwrapped<Api[D][M]> }
}

function wrap(): UnwrappedApi {
  const raw = window.api as unknown as Record<string, Record<string, (p?: unknown) => Promise<ApiResult<unknown>>>>
  const out: Record<string, Record<string, unknown>> = {}
  for (const domain of Object.keys(raw)) {
    out[domain] = {}
    for (const method of Object.keys(raw[domain])) {
      out[domain][method] = async (payload?: unknown) => {
        const res = await raw[domain][method](payload)
        if (!res || typeof res !== 'object' || !('ok' in res)) {
          throw new ApiCallError({ code: 'INTERNAL', message: 'The application did not respond correctly.' })
        }
        if (res.ok) return res.data
        throw new ApiCallError(res.error)
      }
    }
  }
  return out as unknown as UnwrappedApi
}

export const api = wrap()
