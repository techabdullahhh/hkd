/**
 * Minimal `electron` stand-in for unit tests. Only the surface the main
 * services actually touch is implemented. Printer tests use the ESC/POS
 * adapter path, which never constructs a BrowserWindow.
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'hkd-test-'))

export const app = {
  isPackaged: false,
  getPath: (_name: string) => dir,
  getAppPath: () => process.cwd(),
  getVersion: () => '1.0.0-test',
  getName: () => 'taste-of-hkd-pos',
  whenReady: () => Promise.resolve(),
  on: () => undefined,
  quit: () => undefined,
  requestSingleInstanceLock: () => true
}

export class BrowserWindow {
  webContents = {
    getPrintersAsync: async () => [],
    print: (_o: unknown, cb: (ok: boolean, reason: string) => void) => cb(false, 'no printer in test'),
    on: () => undefined,
    setWindowOpenHandler: () => undefined,
    openDevTools: () => undefined
  }
  once() {}
  on() {}
  loadURL() {
    return Promise.resolve()
  }
  loadFile() {
    return Promise.resolve()
  }
  destroy() {}
  show() {}
  isMinimized() {
    return false
  }
  restore() {}
  focus() {}
  static getAllWindows() {
    return [] as BrowserWindow[]
  }
}

export const ipcMain = { handle: () => undefined, on: () => undefined }
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] })
}
export const protocol = {
  registerSchemesAsPrivileged: () => undefined,
  handle: () => undefined
}
/**
 * Image decoding is a Chromium facility with no Node equivalent, so tests
 * exercise the storage/URL layer rather than the encoder.
 */
export const nativeImage = {
  createFromBuffer: () => ({
    isEmpty: () => true,
    getSize: () => ({ width: 0, height: 0 }),
    crop: () => nativeImage.createFromBuffer(),
    resize: () => nativeImage.createFromBuffer(),
    toJPEG: () => Buffer.alloc(0)
  })
}
export const contextBridge = { exposeInMainWorld: () => undefined }
export const ipcRenderer = { invoke: () => Promise.resolve() }
export const shell = { openExternal: () => Promise.resolve() }
export const session = {
  defaultSession: {
    webRequest: { onHeadersReceived: () => undefined },
    setPermissionRequestHandler: () => undefined
  }
}

export default { app, BrowserWindow, ipcMain, contextBridge, ipcRenderer, shell, session, dialog, protocol, nativeImage }
