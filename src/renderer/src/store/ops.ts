import { create } from 'zustand'
import type { BusinessDay, WorkSession } from '@shared/types'
import { api } from '../lib/api'

interface OpsState {
  session: WorkSession | null
  /** today's reporting-day bucket — informational only; never gates anything */
  businessDay: BusinessDay | null
  loaded: boolean
  refresh: () => Promise<void>
  setSession: (s: WorkSession | null) => void
}

export const useOps = create<OpsState>((set) => ({
  session: null,
  businessDay: null,
  loaded: false,
  refresh: async () => {
    try {
      const [session, businessDay] = await Promise.all([
        api.session.current().catch(() => null),
        api.businessDay.current().catch(() => null)
      ])
      set({ session, businessDay, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  setSession: (s) => set({ session: s })
}))
