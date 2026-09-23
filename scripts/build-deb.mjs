#!/usr/bin/env node
/**
 * Build the Chrome OS / Debian package.
 *
 * electron-builder cannot produce a usable .deb on macOS: its bundled fpm
 * shells out to the system `ar`, and macOS's `ar` writes a BSD archive with
 * a symbol table instead of the GNU archive dpkg expects. The result is a
 * 96-byte file that the build reports as a success and that fails only once
 * it reaches the Chromebook — the worst possible place to find out.
 *
 * A .deb is a plain `ar` archive of exactly three members, in order:
 *   debian-binary   the text "2.0\n"
 *   control.tar.gz  package metadata
 *   data.tar.gz     the files to install
 *
 * All of which is straightforward to write directly, with no toolchain to
 * install and the same bytes on every machine. Run after electron-builder
 * has produced the unpacked tree:
 *
 *   npx electron-builder --linux dir --x64
 *   node scripts/build-deb.mjs --arch amd64 --src release/linux-unpacked
 */

import { createHash } from 'crypto'
import { gzipSync } from 'zlib'
import { readFileSync, readdirSync, statSync, writeFileSync, lstatSync, readlinkSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}
const ARCH = arg('arch', 'amd64') // amd64 | arm64
const SRC = join(ROOT, arg('src', 'release/linux-unpacked'))
const OUT = join(ROOT, arg('out', `release/${pkg.name}_${pkg.version}_${ARCH}.deb`))

/* Short install path on purpose: ustar headers only hold a 100-character
 * name, and "Hashmi Ka Dera POS" would push the deepest file past it. */
const INSTALL_DIR = `/opt/${pkg.name}`
/* electron-builder names the Linux binary after the *package* name, not the
 * productName it uses on Windows and macOS. Getting this wrong produces a
 * desktop entry that points at nothing, so it is derived from the tree that
 * was actually built rather than guessed. */
const BINARY = pkg.name
const EXEC = `${INSTALL_DIR}/${BINARY}`

/* ------------------------------ tar writing ------------------------------ */

const BLOCK = 512
const pad = (buf) => {
  const rem = buf.length % BLOCK
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(BLOCK - rem)])
}
const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'

/**
 * One ustar header. Paths longer than 100 characters are split across the
 * `prefix` field at a directory boundary, which is what ustar is for.
 */
function tarHeader({ path, size = 0, mode = 0o644, type = '0', linkname = '', mtime }) {
  let name = path
  let prefix = ''
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', name.length - (name.length - 100) - 1)
    const split = name.lastIndexOf('/', 100)
    const at = split > 0 ? split : cut
    if (at <= 0) throw new Error(`path too long for ustar: ${path}`)
    prefix = name.slice(0, at)
    name = name.slice(at + 1)
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155)
      throw new Error(`path too long for ustar: ${path}`)
  }

  const h = Buffer.alloc(BLOCK)
  h.write(name, 0, 100)
  h.write(octal(mode, 8), 100, 8)
  h.write(octal(0, 8), 108, 8) // uid root
  h.write(octal(0, 8), 116, 8) // gid root
  h.write(octal(size, 12), 124, 12)
  h.write(octal(mtime, 12), 136, 12)
  h.write('        ', 148, 8) // checksum placeholder: spaces
  h.write(type, 156, 1)
  h.write(linkname, 157, 100)
  h.write('ustar\0', 257, 6)
  h.write('00', 263, 2)
  h.write('root', 265, 32)
  h.write('root', 297, 32)
  h.write(prefix, 345, 155)

  let sum = 0
  for (const b of h) sum += b
  h.write(octal(sum, 7) + ' ', 148, 8)
  return h
}

function makeTarGz(entries, mtime) {
  const parts = []
  for (const e of entries) {
    if (e.type === '5') parts.push(tarHeader({ ...e, size: 0, mtime }))
    else if (e.type === '2') parts.push(tarHeader({ ...e, size: 0, mtime }))
    else {
      parts.push(tarHeader({ ...e, size: e.content.length, mtime }))
      parts.push(pad(e.content))
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2)) // end-of-archive
  return gzipSync(Buffer.concat(parts), { level: 9 })
}

/* ------------------------------- ar writing ------------------------------ */

function arMember(name, content, mtime) {
  const h = Buffer.alloc(60, 0x20)
  h.write(name, 0, 16)
  h.write(String(mtime), 16, 12)
  h.write('0', 28, 6) // uid
  h.write('0', 34, 6) // gid
  h.write('100644', 40, 8)
  h.write(String(content.length), 48, 10)
  h.write('`\n', 58, 2)
  const body = content.length % 2 ? Buffer.concat([content, Buffer.from('\n')]) : content
  return Buffer.concat([h, body])
}

/* ------------------------------- the build ------------------------------- */

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    const st = lstatSync(full)
    const rel = relative(base, full)
    if (st.isSymbolicLink()) out.push({ rel, kind: 'link', target: readlinkSync(full) })
    else if (st.isDirectory()) {
      out.push({ rel, kind: 'dir' })
      walk(full, base, out)
    } else out.push({ rel, kind: 'file', size: st.size, mode: st.mode & 0o777 })
  }
  return out
}

const mtime = Math.floor(Date.now() / 1000)
const found = walk(SRC)
if (!found.some((f) => f.kind === 'file' && f.rel === BINARY)) {
  const candidates = found.filter((f) => f.kind === 'file' && !f.rel.includes('/') && (f.mode & 0o111) !== 0)
  throw new Error(
    `No executable named "${BINARY}" in ${SRC}. Found: ${candidates.map((c) => c.rel).join(', ') || '(none)'}`
  )
}
const dataEntries = []
const md5s = []
let installedBytes = 0

// directory chain for the install prefix
for (const d of ['./opt', `.${INSTALL_DIR}`]) dataEntries.push({ path: d, type: '5', mode: 0o755 })

for (const f of found) {
  const path = `.${INSTALL_DIR}/${f.rel}`
  if (f.kind === 'dir') {
    dataEntries.push({ path, type: '5', mode: 0o755 })
  } else if (f.kind === 'link') {
    dataEntries.push({ path, type: '2', linkname: f.target, mode: 0o777 })
  } else {
    const content = readFileSync(join(SRC, f.rel))
    /*
     * chrome-sandbox must be setuid root or Electron refuses to start with
     * "SUID sandbox helper binary was found, but is not configured
     * correctly" — a failure that would greet the restaurant on first launch.
     */
    const isSandbox = f.rel.endsWith('chrome-sandbox')
    const executable = isSandbox || (f.mode & 0o111) !== 0
    const mode = isSandbox ? 0o4755 : executable ? 0o755 : 0o644
    dataEntries.push({ path, type: '0', mode, content })
    md5s.push(`${createHash('md5').update(content).digest('hex')}  ${path.slice(2)}`)
    installedBytes += content.length
  }
}

// desktop entry, icon and a launcher on PATH
const desktop = `[Desktop Entry]
Name=Hashmi Ka Dera POS
Comment=Restaurant point of sale
Exec="${EXEC}" %U
Terminal=false
Type=Application
Icon=${pkg.name}
StartupWMClass=Hashmi Ka Dera POS
Categories=Office;Finance;
`
const icon = readFileSync(join(ROOT, 'build/icon.png'))
const extras = [
  { path: './usr', type: '5', mode: 0o755 },
  { path: './usr/share', type: '5', mode: 0o755 },
  { path: './usr/share/applications', type: '5', mode: 0o755 },
  { path: `./usr/share/applications/${pkg.name}.desktop`, type: '0', mode: 0o644, content: Buffer.from(desktop) },
  { path: './usr/share/icons', type: '5', mode: 0o755 },
  { path: './usr/share/icons/hicolor', type: '5', mode: 0o755 },
  { path: './usr/share/icons/hicolor/256x256', type: '5', mode: 0o755 },
  { path: './usr/share/icons/hicolor/256x256/apps', type: '5', mode: 0o755 },
  { path: `./usr/share/icons/hicolor/256x256/apps/${pkg.name}.png`, type: '0', mode: 0o644, content: icon },
  { path: './usr/bin', type: '5', mode: 0o755 },
  { path: `./usr/bin/${pkg.name}`, type: '2', linkname: EXEC, mode: 0o777 }
]
for (const e of extras) {
  dataEntries.push(e)
  if (e.type === '0') {
    md5s.push(`${createHash('md5').update(e.content).digest('hex')}  ${e.path.slice(2)}`)
    installedBytes += e.content.length
  }
}

const DEPENDS = [
  'libgtk-3-0',
  'libnotify4',
  'libnss3',
  'libxss1',
  'libxtst6',
  'xdg-utils',
  'libatspi2.0-0',
  'libuuid1',
  'libsecret-1-0'
].join(', ')

const control = `Package: ${pkg.name}
Version: ${pkg.version}
License: UNLICENSED
Vendor: Hashmi Ka Dera
Architecture: ${ARCH}
Maintainer: Hashmi Ka Dera <leetforcepk@gmail.com>
Installed-Size: ${Math.ceil(installedBytes / 1024)}
Depends: ${DEPENDS}
Section: misc
Priority: optional
Homepage: https://github.com/techabdullahhh/hkd
Description: Restaurant point of sale for Hashmi Ka Dera
 Offline point-of-sale and management system: orders, immutable invoices,
 thermal receipt printing, employee sessions and reporting.
`

const controlEntries = [
  { path: './control', type: '0', mode: 0o644, content: Buffer.from(control) },
  { path: './md5sums', type: '0', mode: 0o644, content: Buffer.from(md5s.join('\n') + '\n') }
]

const deb = Buffer.concat([
  Buffer.from('!<arch>\n'),
  arMember('debian-binary', Buffer.from('2.0\n'), mtime),
  arMember('control.tar.gz', makeTarGz(controlEntries, mtime), mtime),
  arMember('data.tar.gz', makeTarGz(dataEntries, mtime), mtime)
])

writeFileSync(OUT, deb)
console.log(`${relative(ROOT, OUT)}  ${(deb.length / 1024 / 1024).toFixed(1)} MB  (${ARCH}, ${md5s.length} files, installed ${(installedBytes / 1024 / 1024).toFixed(0)} MB)`)
