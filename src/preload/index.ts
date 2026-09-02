import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/ipc'
import type { Api } from '@shared/ipc'

/**
 * The renderer never touches Node or ipcRenderer directly. It gets exactly
 * one thing: a typed `window.api` object whose every method forwards to the
 * single validated `hkd:invoke` channel in the main process.
 */
function buildApi(): Api {
  const root: Record<string, Record<string, unknown>> = {}
  for (const channel of CHANNELS) {
    const [domain, action] = channel.split(':')
    root[domain] ??= {}
    root[domain][action] = (payload: unknown) => ipcRenderer.invoke('hkd:invoke', channel, payload)
  }
  return root as unknown as Api
}

const api = buildApi()

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
  contextBridge.exposeInMainWorld('hkd', {
    platform: process.platform,
    versions: process.versions
  })
} else {
  // @ts-expect-error fallback for contextIsolation:false (not used in prod)
  window.api = api
}
