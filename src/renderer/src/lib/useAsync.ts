import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiCallError } from './api'
import { toast } from '../store/toast'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fnRef
      .current()
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Failed to load.')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}

/** Run a mutating call with standard toast handling. */
export async function run<T>(
  fn: () => Promise<T>,
  opts: { success?: string; onError?: (msg: string, code: string) => void } = {}
): Promise<T | undefined> {
  try {
    const r = await fn()
    if (opts.success) toast.success(opts.success)
    return r
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Something went wrong.'
    const code = e instanceof ApiCallError ? e.code : 'INTERNAL'
    if (opts.onError) opts.onError(msg, code)
    else toast.error(msg)
    return undefined
  }
}
