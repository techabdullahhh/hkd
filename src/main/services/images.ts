/**
 * Menu photography.
 *
 * Three rules shape this module:
 *
 *  1. **Nothing is stored at the size it arrived.** A phone photo is 3–6 MB;
 *     a POS tile shows it at roughly 200×150 CSS pixels. Every upload is
 *     centre-cropped to 4:3, downscaled to 640×480 and re-encoded as JPEG,
 *     which lands between 25 KB and 60 KB. That is what makes it safe to
 *     keep the bytes in SQLite.
 *  2. **The bytes live in the database.** `backup:create` copies the database
 *     file, so images travel with backups instead of quietly disappearing on
 *     restore. They sit in their own table so ordinary menu queries never
 *     read them.
 *  3. **The renderer never receives image bytes over IPC.** It receives a
 *     versioned `hkd-img://` URL and Chromium fetches (and caches) the image
 *     through the custom protocol registered in `main/index.ts`. A 30-item
 *     menu therefore costs one small JSON payload, not a megabyte of base64.
 *
 * Uploads are re-encoded with Electron's own `nativeImage`, deliberately
 * avoiding a native image dependency (sharp) that would add another
 * ABI-rebuild step to an app that already juggles better-sqlite3.
 */

import { BrowserWindow, dialog, nativeImage } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'

/**
 * `BRAND` is the restaurant's own logo rather than a menu item. It lives in
 * the same table so it is backed up, restored and replaced by exactly the
 * same machinery — there is only ever one row, at `BRAND_LOGO_ID`.
 */
export type ImageOwner = 'PRODUCT' | 'DEAL' | 'BRAND'

export const BRAND_LOGO_ID = 1

/** Tiles render around 200×150 CSS px; 640×480 stays crisp on a HiDPI screen. */
const TARGET_W = 640
const TARGET_H = 480
const JPEG_QUALITY = 68
/** Refuse absurd source files outright rather than trying to decode them. */
const MAX_SOURCE_BYTES = 24 * 1024 * 1024
/**
 * Upload formats. Electron's `nativeImage` decodes JPEG and PNG reliably and
 * little else, so the picker offers exactly what it can actually read rather
 * than accepting a WEBP or HEIC and failing confusingly afterwards.
 */
const ACCEPTED_UPLOAD = /\.(jpe?g|png)$/i
/** Plenty of detail for a 576-dot print head, and ~150 KB stored. */
const LOGO_MAX_W = 800
/** Formats the *bundled* photography may use — decoded by Chromium, not us. */
const ACCEPTED_BUNDLED = /\.(jpe?g|png|webp)$/i

export interface EncodedImage {
  bytes: Buffer
  mime: string
  width: number
  height: number
}

/* ------------------------------- encoding -------------------------------- */

/**
 * Centre-crop to 4:3 and downscale. Never upscales: a small source stays
 * small rather than being stretched into a soft, blurry tile.
 */
export function encodeForMenu(source: Buffer): EncodedImage {
  if (source.length > MAX_SOURCE_BYTES)
    throw new AppError('VALIDATION', 'That image file is too large. Choose one under 24 MB.')

  const img = nativeImage.createFromBuffer(source)
  if (img.isEmpty()) throw new AppError('VALIDATION', 'That file is not a readable image.')

  const { width: sw, height: sh } = img.getSize()
  if (!sw || !sh) throw new AppError('VALIDATION', 'That file is not a readable image.')

  const ratio = TARGET_W / TARGET_H
  let cw = sw
  let ch = Math.round(sw / ratio)
  if (ch > sh) {
    ch = sh
    cw = Math.round(sh * ratio)
  }
  const cropped =
    cw === sw && ch === sh
      ? img
      : img.crop({ x: Math.round((sw - cw) / 2), y: Math.round((sh - ch) / 2), width: cw, height: ch })

  const outW = Math.min(TARGET_W, cw)
  const outH = Math.max(1, Math.round(outW / ratio))
  const resized = outW === cw ? cropped : cropped.resize({ width: outW, height: outH, quality: 'good' })

  const bytes = resized.toJPEG(JPEG_QUALITY)
  if (!bytes || bytes.length === 0) throw new AppError('VALIDATION', 'That image could not be processed.')
  return { bytes, mime: 'image/jpeg', width: outW, height: outH }
}

/**
 * The brand logo is stored differently from menu photography: no 4:3 crop
 * (a logo is whatever shape it is) and PNG rather than JPEG, because the
 * print pipeline re-thresholds it into line art and JPEG ringing around the
 * lettering would survive as speckle.
 */
export function encodeLogoSource(source: Buffer): EncodedImage {
  if (source.length > MAX_SOURCE_BYTES)
    throw new AppError('VALIDATION', 'That image file is too large. Choose one under 24 MB.')
  const img = nativeImage.createFromBuffer(source)
  if (img.isEmpty()) throw new AppError('VALIDATION', 'That file is not a readable image.')
  const { width: sw, height: sh } = img.getSize()
  if (!sw || !sh) throw new AppError('VALIDATION', 'That file is not a readable image.')

  const outW = Math.min(LOGO_MAX_W, sw)
  const resized = outW === sw ? img : img.resize({ width: outW, quality: 'good' })
  const size = resized.getSize()
  const bytes = resized.toPNG()
  if (!bytes || bytes.length === 0) throw new AppError('VALIDATION', 'That image could not be processed.')
  return { bytes, mime: 'image/png', width: size.width, height: size.height }
}

export function encodeFileForMenu(filePath: string): EncodedImage {
  if (!existsSync(filePath)) throw new AppError('NOT_FOUND', 'That image file no longer exists.')
  if (!ACCEPTED_UPLOAD.test(filePath)) throw new AppError('VALIDATION', 'Choose a JPG or PNG image.')
  return encodeForMenu(readFileSync(filePath))
}

/* -------------------------------- staging -------------------------------- */

/**
 * A product being *created* has no id yet, so a picked image is held here
 * until the row exists. Kept in memory on purpose — a staged image that is
 * never saved should leave nothing behind.
 */
interface Staged extends EncodedImage {
  at: number
}
const staged = new Map<string, Staged>()
const STAGE_TTL_MS = 30 * 60 * 1000
const STAGE_MAX = 12

function sweepStaging(): void {
  const cutoff = Date.now() - STAGE_TTL_MS
  for (const [k, v] of staged) if (v.at < cutoff) staged.delete(k)
  while (staged.size > STAGE_MAX) staged.delete(staged.keys().next().value as string)
}

export function stageImage(enc: EncodedImage): { stagedImageId: string; previewDataUrl: string; byteSize: number } {
  sweepStaging()
  const id = randomUUID()
  staged.set(id, { ...enc, at: Date.now() })
  return {
    stagedImageId: id,
    previewDataUrl: `data:${enc.mime};base64,${enc.bytes.toString('base64')}`,
    byteSize: enc.bytes.length
  }
}

/**
 * Native file picker + downscale, in one round trip. The renderer never
 * touches the filesystem and never uploads raw megabytes across IPC — it
 * gets back a small preview and a token.
 */
export async function pickAndStageImage(): Promise<{
  stagedImageId: string
  previewDataUrl: string
  byteSize: number
} | null> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title: 'Choose a photo for this menu item',
    buttonLabel: 'Use this photo',
    properties: ['openFile' as const],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
  }
  const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (res.canceled || !res.filePaths?.[0]) return null
  return stageImage(encodeFileForMenu(res.filePaths[0]))
}

/**
 * Pick and store the invoice logo in one step. Unlike a menu photo there is
 * nothing to stage: the brand logo has a fixed owner, so it can be written
 * immediately.
 */
export async function pickAndSetLogo(): Promise<{ replaced: boolean }> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title: 'Choose the logo printed on invoices',
    buttonLabel: 'Use this logo',
    properties: ['openFile' as const],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
  }
  const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (res.canceled || !res.filePaths?.[0]) return { replaced: false }
  const file = res.filePaths[0]
  if (!ACCEPTED_UPLOAD.test(file)) throw new AppError('VALIDATION', 'Choose a JPG or PNG image.')
  storeImage('BRAND', BRAND_LOGO_ID, encodeLogoSource(readFileSync(file)))
  return { replaced: true }
}

export function takeStagedImage(id: string): EncodedImage | null {
  const s = staged.get(id)
  if (!s) return null
  staged.delete(id)
  return { bytes: s.bytes, mime: s.mime, width: s.width, height: s.height }
}

/* ------------------------------- persistence ----------------------------- */

export function storeImage(ownerType: ImageOwner, ownerId: number, enc: EncodedImage, credit?: string): void {
  const now = Date.now()
  const existing = db
    .select({ id: schema.menuImages.id })
    .from(schema.menuImages)
    .where(and(eq(schema.menuImages.ownerType, ownerType), eq(schema.menuImages.ownerId, ownerId)))
    .get()
  const values = {
    ownerType,
    ownerId,
    mime: enc.mime,
    width: enc.width,
    height: enc.height,
    byteSize: enc.bytes.length,
    bytes: enc.bytes,
    credit: credit ?? null,
    updatedAt: now
  }
  if (existing) db.update(schema.menuImages).set(values).where(eq(schema.menuImages.id, existing.id)).run()
  else db.insert(schema.menuImages).values(values).run()
}

export function clearImage(ownerType: ImageOwner, ownerId: number): void {
  db.delete(schema.menuImages)
    .where(and(eq(schema.menuImages.ownerType, ownerType), eq(schema.menuImages.ownerId, ownerId)))
    .run()
}

export function hasImage(ownerType: ImageOwner, ownerId: number): boolean {
  return imageStamp(ownerType, ownerId) != null
}

/** `updated_at` only — deliberately never selects the blob. */
export function imageStamp(ownerType: ImageOwner, ownerId: number): number | null {
  const row = db
    .select({ v: schema.menuImages.updatedAt })
    .from(schema.menuImages)
    .where(and(eq(schema.menuImages.ownerType, ownerType), eq(schema.menuImages.ownerId, ownerId)))
    .get()
  return row?.v ?? null
}

/**
 * The `src` a tile renders. The `v=` stamp changes whenever the image does,
 * so Chromium can cache each URL forever and still show a replacement the
 * instant an admin uploads one.
 */
export function imageUrlFor(ownerType: ImageOwner, ownerId: number): string | null {
  const v = imageStamp(ownerType, ownerId)
  if (v == null) return null
  return `hkd-img://menu/${ownerType.toLowerCase()}/${ownerId}?v=${v}`
}

export function readImage(ownerType: ImageOwner, ownerId: number): { bytes: Buffer; mime: string } | null {
  const row = db
    .select({ bytes: schema.menuImages.bytes, mime: schema.menuImages.mime })
    .from(schema.menuImages)
    .where(and(eq(schema.menuImages.ownerType, ownerType), eq(schema.menuImages.ownerId, ownerId)))
    .get()
  if (!row) return null
  return { bytes: Buffer.from(row.bytes as Buffer), mime: row.mime }
}

/**
 * Applied by product/deal create+update. `removeImage` wins over a staged
 * upload so "remove, then save" is never ambiguous.
 */
export function applyImageWrite(
  ownerType: ImageOwner,
  ownerId: number,
  input: { stagedImageId?: string | null; removeImage?: boolean }
): void {
  if (input.removeImage) {
    clearImage(ownerType, ownerId)
    return
  }
  if (!input.stagedImageId) return
  const enc = takeStagedImage(input.stagedImageId)
  if (!enc) throw new AppError('VALIDATION', 'That image is no longer available — pick it again.')
  storeImage(ownerType, ownerId, enc)
}

/* ---------------------------- bundled artwork ---------------------------- */

interface BundleManifest {
  products?: Record<string, { file: string; credit?: string }>
  deals?: Record<string, { file: string; credit?: string }>
}

/**
 * Ships alongside the app: `resources/menu-images/` in the repo, and the
 * same folder under `process.resourcesPath` once packaged (see
 * electron-builder.yml `extraResources`).
 */
function resourceDir(name: string): string | null {
  const candidates: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron')
    if (app?.isPackaged) candidates.push(join(process.resourcesPath, name))
    if (app?.getAppPath) candidates.push(join(app.getAppPath(), 'resources', name))
  } catch {
    /* no Electron app context (tests) */
  }
  candidates.push(join(process.cwd(), 'resources', name))
  return candidates.find((c) => existsSync(c)) ?? null
}

const bundledDir = (): string | null => resourceDir('menu-images')

/**
 * The logo that ships with the app, loaded on first run. Like the menu
 * photography it never overwrites what is already there, so a logo the
 * restaurant uploaded survives every update.
 */
export function seedBundledLogo(): boolean {
  if (hasImage('BRAND', BRAND_LOGO_ID)) return false
  const dir = resourceDir('brand')
  if (!dir) return false
  const file = join(dir, 'hkd-logo.png')
  if (!existsSync(file)) return false
  try {
    storeImage('BRAND', BRAND_LOGO_ID, encodeLogoSource(readFileSync(file)), 'Bundled with the app')
    return true
  } catch {
    // Test environments have no image decoder; the logo is simply absent.
    return false
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
}

/**
 * Attach the shipped photography to seeded menu rows.
 *
 * Bundled files are already 640×480 and compressed by
 * `scripts/build-menu-images.mjs`, so they are stored verbatim — no decode,
 * no re-encode. An owner that already has an image is left alone, so an
 * admin's own upload is never overwritten by a later app start.
 */
export function seedBundledImages(): { attached: number; skipped: number } {
  const dir = bundledDir()
  if (!dir) return { attached: 0, skipped: 0 }
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return { attached: 0, skipped: 0 }

  let manifest: BundleManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest
  } catch {
    return { attached: 0, skipped: 0 }
  }

  let attached = 0
  let skipped = 0

  const attach = (ownerType: ImageOwner, ownerId: number, entry: { file: string; credit?: string }): void => {
    if (hasImage(ownerType, ownerId)) {
      skipped++
      return
    }
    const file = join(dir, entry.file)
    if (!existsSync(file)) return
    const ext = entry.file.slice(entry.file.lastIndexOf('.')).toLowerCase()
    const bytes = readFileSync(file)
    storeImage(
      ownerType,
      ownerId,
      { bytes, mime: MIME_BY_EXT[ext] ?? 'image/jpeg', width: TARGET_W, height: TARGET_H },
      entry.credit
    )
    attached++
  }

  for (const [name, entry] of Object.entries(manifest.products ?? {})) {
    const row = db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.name, name)).get()
    if (row) attach('PRODUCT', row.id, entry)
  }
  for (const [name, entry] of Object.entries(manifest.deals ?? {})) {
    const row = db.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.name, name)).get()
    if (row) attach('DEAL', row.id, entry)
  }
  return { attached, skipped }
}

/** Attribution for the bundled photography, surfaced in Admin › Settings. */
export function imageCredits(): { name: string; credit: string }[] {
  const dir = bundledDir()
  if (!dir) return []
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return []
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest
    return [...Object.entries(m.products ?? {}), ...Object.entries(m.deals ?? {})]
      .filter(([, e]) => e.credit)
      .map(([name, e]) => ({ name, credit: e.credit as string }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** Total bytes of menu photography — shown in Settings so it stays honest. */
export function imageStorageStats(): { count: number; totalBytes: number; bundledFiles: number } {
  const rows = db.select({ n: schema.menuImages.byteSize }).from(schema.menuImages).all()
  const dir = bundledDir()
  let bundledFiles = 0
  if (dir) {
    try {
      bundledFiles = readdirSync(dir).filter((f) => ACCEPTED_BUNDLED.test(f) && statSync(join(dir, f)).isFile()).length
    } catch {
      bundledFiles = 0
    }
  }
  return { count: rows.length, totalBytes: rows.reduce((s, r) => s + r.n, 0), bundledFiles }
}
