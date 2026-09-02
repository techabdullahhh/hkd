#!/usr/bin/env node
/**
 * Build the bundled menu photography in `resources/menu-images/`.
 *
 * Sources are curated by hand in `resources/menu-images/sources.json` — one
 * entry per menu item, naming a freely-licensed Wikimedia Commons photograph
 * of that exact dish. This script downloads each one, centre-crops it to 4:3,
 * scales it to 640×480 and writes a WEBP, then emits the `manifest.json` the
 * app reads at seed time (see src/main/services/images.ts).
 *
 * The generated .webp files are committed, so a normal build, install or
 * `npm test` never touches the network. Re-run this only when changing the
 * photography:
 *
 *     node scripts/build-menu-images.mjs           # only missing files
 *     node scripts/build-menu-images.mjs --force   # re-encode everything
 *
 * Requires ImageMagick (`magick`) and `cwebp`, both dev-machine tools only.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources', 'menu-images')
const SOURCES = join(OUT, 'sources.json')
const FORCE = process.argv.includes('--force')

/**
 * 500×375 is the largest 4:3 frame Commons will hand an anonymous client:
 * full-size originals answer 429, and the thumbnail ladder tops out at 500px
 * wide. It is still ample — a POS tile is ~200 CSS px, so this covers a 2×
 * HiDPI screen — and it keeps each file around 25 KB.
 */
const WIDTH = 500
const HEIGHT = 375
const QUALITY = 72
const THUMB_WIDTH = 500
const UA = { 'User-Agent': 'HashmiKaDera-POS/1.0 (menu image build; offline restaurant POS)' }

if (!existsSync(SOURCES)) {
  console.error(`No ${SOURCES} — nothing to build.`)
  process.exit(1)
}

const sources = JSON.parse(readFileSync(SOURCES, 'utf8'))
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Resolve a `File:…` title to a 500px thumbnail URL plus its licence line. */
async function resolveFile(title) {
  const u = new URL('https://en.wikipedia.org/w/api.php')
  u.searchParams.set('action', 'query')
  u.searchParams.set('format', 'json')
  u.searchParams.set('titles', title)
  u.searchParams.set('prop', 'imageinfo')
  u.searchParams.set('iiprop', 'url|size|mime|extmetadata')
  u.searchParams.set('iiurlwidth', String(THUMB_WIDTH))
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(attempt === 0 ? 1200 : 4000 * attempt)
    const res = await fetch(u, { headers: UA })
    const text = await res.text()
    if (!text.startsWith('{')) continue
    const json = JSON.parse(text)
    const page = Object.values(json?.query?.pages ?? {})[0]
    const ii = page?.imageinfo?.[0]
    if (!ii) throw new Error(`no imageinfo for ${title}`)
    // Commons metadata is HTML: strip the markup and decode the entities so
    // a credit reads "snowpea&bokchoi", not "snowpea&amp;bokchoi".
    const strip = (s) =>
      s
        ? String(s)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&(amp|lt|gt|quot|#0?39|apos|nbsp);/g, (_, e) =>
              ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#039': "'", apos: "'", nbsp: ' ' })[e] ?? ' '
            )
            .replace(/\s+/g, ' ')
            .trim()
        : ''
    return {
      url: ii.thumburl || ii.url,
      page: ii.descriptionurl,
      artist: strip(ii.extmetadata?.Artist?.value),
      license: strip(ii.extmetadata?.LicenseShortName?.value)
    }
  }
  throw new Error(`rate limited resolving ${title}`)
}

async function download(url) {
  // upload.wikimedia.org answers an anonymous burst with 429 and an HTML body,
  // so back off rather than hammering it.
  const clean = url.split('?')[0]
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 400 : Math.min(45000, 2500 * 2 ** (attempt - 1)))
    try {
      const res = await fetch(clean, { headers: UA })
      const buf = Buffer.from(await res.arrayBuffer())
      // A rate-limit or error response arrives as HTML, not an image.
      if (buf[0] === 0xff || (buf[0] === 0x89 && buf[1] === 0x50)) return buf
      process.stdout.write(`  … ${res.status} on ${clean.split('/').pop()}, retrying\n`)
    } catch {
      /* retry */
    }
  }
  throw new Error(`could not download ${clean}`)
}

/** Download one source photo, crop it to 4:3, scale it and encode a WEBP. */
async function buildOne(entry, dest) {
  const info = await resolveFile(entry.file)
  const raw = await download(info.url)
  const tmp = join(OUT, `.${entry.slug}.tmp`)
  writeFileSync(tmp, raw)
  try {
    // Centre-crop to 4:3 then scale — never letterbox, never distort.
    execFileSync('magick', [
      tmp,
      '-auto-orient',
      '-resize', `${WIDTH}x${HEIGHT}^`,
      '-gravity', entry.gravity || 'center',
      '-extent', `${WIDTH}x${HEIGHT}`,
      '-strip',
      `${tmp}.png`
    ])
    execFileSync('cwebp', ['-quiet', '-q', String(QUALITY), `${tmp}.png`, '-o', dest])
  } finally {
    rmSync(tmp, { force: true })
    rmSync(`${tmp}.png`, { force: true })
  }
  entry.artist = info.artist
  entry.license = info.license
  entry.page = info.page
}

const manifest = { products: {}, deals: {} }
const failed = []
let built = 0
let reused = 0

for (const group of ['products', 'deals']) {
  for (const entry of sources[group] ?? []) {
    const file = `${entry.slug}.webp`
    const dest = join(OUT, file)

    if (!FORCE && existsSync(dest)) {
      reused++
    } else {
      try {
        await buildOne(entry, dest)
        built++
        console.log(`  ${entry.slug.padEnd(18)} ${(statSync(dest).size / 1024).toFixed(1)} KB`)
      } catch (err) {
        // One unavailable source must not abandon the other thirty. Keep any
        // previously built file; otherwise the item ships without a photo and
        // the POS falls back to its placeholder.
        failed.push(`${entry.slug}: ${err.message}`)
        if (!existsSync(dest)) continue
      }
    }

    const credit = entry.credit || [entry.artist, entry.license].filter(Boolean).join(' · ')
    manifest[group][entry.name] = { file, credit }
  }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
if (built > 0) writeFileSync(SOURCES, JSON.stringify(sources, null, 2) + '\n')

const total = [...Object.values(manifest.products), ...Object.values(manifest.deals)].reduce(
  (sum, m) => sum + statSync(join(OUT, m.file)).size,
  0
)
console.log(
  `\n${built} built, ${reused} reused — ${Object.keys(manifest.products).length} products + ` +
    `${Object.keys(manifest.deals).length} deals, ${(total / 1024).toFixed(0)} KB total.`
)
if (failed.length) {
  console.log(`\n${failed.length} could not be built (those items fall back to the placeholder):`)
  for (const f of failed) console.log(`  - ${f}`)
  process.exitCode = 1
}
