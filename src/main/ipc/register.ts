import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc'
import { dispatch } from './handlers'

let registered = false

export function registerIpc(): void {
  if (registered) return
  registered = true
  ipcMain.handle('hkd:invoke', async (_event, channel: string, payload: unknown) => {
    if (!CHANNELS.includes(channel as never)) {
      return { ok: false, error: { code: 'VALIDATION', message: `Unknown channel: ${channel}` } }
    }
    return dispatch(channel as never, payload)
  })
}
