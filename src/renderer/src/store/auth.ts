import { create } from 'zustand'
import type { AuthUser } from '@shared/types'
import { api, ApiCallError } from '../lib/api'

const TOKEN_KEY = 'hkd.token'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  signup: (username: string, fullName: string, password: string) => Promise<{ pending: boolean }>
  logout: () => Promise<void>
  restore: () => Promise<void>
  refresh: () => Promise<void>
  setUser: (u: AuthUser) => void
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  ready: false,

  login: async (username, password) => {
    set({ loading: true })
    try {
      const user = await api.auth.login({ username, password })
      localStorage.setItem(TOKEN_KEY, user.token)
      set({ user })
    } finally {
      set({ loading: false })
    }
  },

  signup: async (username, fullName, password) => {
    const { user } = await api.auth.signup({ username, fullName, password })
    return { pending: user.status === 'PENDING' }
  },

  logout: async () => {
    try {
      await api.auth.logout()
    } catch {
      /* ignore */
    }
    localStorage.removeItem(TOKEN_KEY)
    set({ user: null })
  },

  restore: async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      set({ ready: true })
      return
    }
    try {
      const user = await api.auth.restore({ token })
      localStorage.setItem(TOKEN_KEY, user.token)
      set({ user, ready: true })
    } catch (e) {
      if (e instanceof ApiCallError) localStorage.removeItem(TOKEN_KEY)
      set({ user: null, ready: true })
    }
  },

  refresh: async () => {
    try {
      const user = await api.auth.me()
      if (user) {
        localStorage.setItem(TOKEN_KEY, user.token)
        set({ user })
      } else {
        localStorage.removeItem(TOKEN_KEY)
        set({ user: null })
      }
    } catch {
      /* keep current */
    }
    void get
  },

  setUser: (u) => set({ user: u })
}))
