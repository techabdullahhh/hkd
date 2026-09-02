import { app, BrowserWindow, protocol, screen, session, shell } from 'electron'
import { join } from 'path'
import { initDatabase } from './db/connection'
import { seedAll } from './db/seed'
import { registerIpc } from './ipc/register'
import { readImage, type ImageOwner } from './services/images'

const isDev = !app.isPackaged

/**
 * Menu photos are served over their own scheme rather than shipped through
 * IPC as base64. Chromium then caches them like any other image, so opening
 * the POS costs one small JSON payload instead of a megabyte of inline data.
 * It must be declared before `app.ready`.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'hkd-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

/** `hkd-img://menu/product/12?v=1730000000000` → the stored bytes. */
function registerImageProtocol(): void {
  protocol.handle('hkd-img', async (request) => {
    try {
      const url = new URL(request.url)
      const [kind, rawId] = url.pathname.replace(/^\/+/, '').split('/')
      const ownerType = kind === 'product' ? 'PRODUCT' : kind === 'deal' ? 'DEAL' : null
      const ownerId = Number(rawId)
      if (url.hostname !== 'menu' || !ownerType || !Number.isInteger(ownerId) || ownerId <= 0) {
        return new Response('Not found', { status: 404 })
      }
      const img = readImage(ownerType as ImageOwner, ownerId)
      if (!img) return new Response('Not found', { status: 404 })
      return new Response(new Uint8Array(img.bytes), {
        status: 200,
        headers: {
          'Content-Type': img.mime,
          // The URL carries a ?v= stamp that changes with the image, so the
          // response itself can be cached indefinitely.
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

function createWindow(): void {
  // Never open larger than the display actually offers — a window taller than
  // the work area pushes the bottom of the UI off-screen where it cannot be
  // reached. Minimums stay small enough for 1024×600 netbook-class screens.
  const { width: availW, height: availH } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: Math.min(1440, availW),
    height: Math.min(900, availH),
    minWidth: Math.min(1024, availW),
    minHeight: Math.min(600, availH),
    show: false,
    backgroundColor: '#14100c',
    title: 'Hashmi Ka Dera — Restaurant POS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs to import the shared IPC manifest
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    win.show()
    // if the display is short, start maximised so no vertical space is wasted
    if (availH <= 800) win.maximize()
    if (isDev) win.webContents.openDevTools({ mode: 'detach' })
  })

  // External links open in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (!url.startsWith('file://')) e.preventDefault()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function hardenSession(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self' 'unsafe-inline' data: blob: ws:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: blob: hkd-img:;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: hkd-img:; font-src 'self' data:;"
        ]
      }
    })
  })
  // Deny all permission requests (camera, geolocation, etc.) — a POS needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}

app.whenReady().then(() => {
  initDatabase()
  try {
    seedAll({ withDevUsers: isDev || process.env.HKD_SEED_DEV_USERS === '1' })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', e)
  }
  hardenSession()
  registerImageProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Single instance
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}
