#!/usr/bin/env node
/**
 * Check that a .deb is actually installable before it goes near a Chromebook.
 *
 * This exists because a build can report success and still emit a package
 * that fails only on the target machine — which is exactly what happened
 * with electron-builder's fpm on macOS (a 96-byte file that looked fine).
 * Everything here is read back out of the finished artifact, not from the
 * code that wrote it.
 *
 *   node scripts/verify-deb.mjs release/hashmi-ka-dera-pos_1.0.0_amd64.deb
 */
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'

const file = process.argv[2]
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/verify-deb.mjs <file.deb>')
  process.exit(2)
}

// Python's tarfile does the reading, so the packer's own code is never the
// thing confirming the packer's output.
const script = String.raw`
import tarfile, io, hashlib, sys, os
deb = sys.argv[1]
d = open(deb, 'rb').read()
fail = []
def check(name, ok):
    print(('  PASS  ' if ok else '  FAIL  ') + name)
    if not ok: fail.append(name)

check('ar magic', d[:8] == b'!<arch>\n')
off, members = 8, []
while off < len(d):
    h = d[off:off+60]
    if len(h) < 60: break
    name = h[0:16].decode().strip(); size = int(h[48:58].decode().strip())
    if h[58:60] != b'\x60\n': fail.append('member magic ' + name)
    members.append((name, d[off+60:off+60+size]))
    off += 60 + size + (size % 2)

names = [m[0] for m in members]
check('three members in dpkg order', names == ['debian-binary','control.tar.gz','data.tar.gz'])
check('debian-binary is 2.0', members[0][1] == b'2.0\n')

ctl = tarfile.open(fileobj=io.BytesIO(members[1][1]), mode='r:gz')
control = ctl.extractfile('./control').read().decode()
fields = dict(l.split(': ',1) for l in control.splitlines() if ': ' in l and not l.startswith(' '))
for k in ('Package','Version','Architecture','Maintainer','Depends','Installed-Size','Description'):
    check('control has ' + k, k in fields)
arch = fields.get('Architecture','')
check('architecture is a real dpkg arch', arch in ('amd64','arm64','armhf','i386'))

data = tarfile.open(fileobj=io.BytesIO(members[2][1]), mode='r:gz')
ti = data.getmembers(); byname = {m.name: m for m in ti}
pkgname = fields['Package']
base = './opt/' + pkgname
exe = base + '/' + pkgname
sandbox = base + '/chrome-sandbox'

check('main executable present', exe in byname)
check('main executable is executable', exe in byname and bool(byname[exe].mode & 0o111))
check('chrome-sandbox is setuid root (Electron will not start otherwise)',
      sandbox in byname and byname[sandbox].mode == 0o4755 and byname[sandbox].uid == 0)
check('app.asar present', base + '/resources/app.asar' in byname)
check('native sqlite bundled', any('better_sqlite3.node' in n for n in byname))
check('menu photography bundled', any('menu-images' in n for n in byname))
check('invoice logo bundled', any('brand/hkd-logo.png' in n for n in byname))
check('desktop entry installed', './usr/share/applications/%s.desktop' % pkgname in byname)
check('icon installed', './usr/share/icons/hicolor/256x256/apps/%s.png' % pkgname in byname)
sym = './usr/bin/' + pkgname
check('launcher on PATH is a symlink to the binary',
      sym in byname and byname[sym].issym() and byname[sym].linkname == exe.lstrip('.'))
check('every file owned by root', all(m.uid == 0 and m.gid == 0 for m in ti))

desk = data.extractfile('./usr/share/applications/%s.desktop' % pkgname)
dtxt = desk.read().decode() if desk else ''
import re
m = re.search(r'^Exec="?([^"\n %]+)', dtxt, re.M)
check('desktop Exec points at a file that is in the package',
      bool(m) and ('.' + m.group(1)) in byname)

md5s = dict(reversed(l.split('  ',1)) for l in ctl.extractfile('./md5sums').read().decode().splitlines())
bad = 0
for path, want in md5s.items():
    f = data.extractfile('./' + path)
    if f is None: continue
    if hashlib.md5(f.read()).hexdigest() != want: bad += 1
check('md5sums match contents (%d files)' % len(md5s), bad == 0)

size_mb = len(d) / 1024 / 1024
check('size is plausible for an Electron app (>50 MB)', size_mb > 50)
print('\n  %s  %.1f MB, %s, %d entries' % (os.path.basename(deb), size_mb, arch, len(ti)))
sys.exit(1 if fail else 0)
`

/**
 * If real dpkg is on this machine, let it have the final word.
 *
 * The checks above are deliberately independent of the packer, but they are
 * still my reading of the format rather than dpkg's. `dpkg-deb` is the actual
 * consumer, so when it is available its verdict outranks mine. It is not a
 * requirement — the packer has to work on a machine with no dpkg at all,
 * which is the normal case on macOS — so absence is reported, not failed.
 *
 * Install it with `brew install dpkg` to enable this. Note that Homebrew's
 * build cannot *install* packages (no `dpkg -i`), but it reads them fine,
 * which is all this needs.
 */
function crossCheckWithDpkg() {
  let version
  try {
    version = execFileSync('dpkg-deb', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')[0]
      .trim()
  } catch {
    console.log('\n  SKIP  cross-check against real dpkg — dpkg-deb not installed (brew install dpkg)')
    return true
  }

  const run = (args) => execFileSync('dpkg-deb', [...args, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  let ok = true
  const check = (name, pass) => {
    console.log((pass ? '  PASS  ' : '  FAIL  ') + name)
    if (!pass) ok = false
  }

  console.log(`\n  cross-check with ${version}`)
  try {
    const info = run(['--info'])
    check('dpkg-deb reads the archive', /new Debian package, version 2\.0/.test(info))
    check('dpkg-deb parses the control fields', /^ Package: /m.test(info))
  } catch (e) {
    check('dpkg-deb reads the archive', false)
    process.stderr.write(String(e.stderr ?? e.message))
  }
  try {
    check('dpkg-deb lists the payload', run(['--contents']).trim().split('\n').length > 50)
  } catch (e) {
    check('dpkg-deb lists the payload', false)
    process.stderr.write(String(e.stderr ?? e.message))
  }
  return ok
}

let structurallyOk = true
try {
  process.stdout.write(execFileSync('python3', ['-c', script, file], { encoding: 'utf8' }))
} catch (e) {
  process.stdout.write(e.stdout ?? '')
  process.stderr.write(e.stderr ?? '')
  structurallyOk = false
}

if (structurallyOk && crossCheckWithDpkg()) {
  console.log('\n✅  package verified')
} else {
  console.error('\n❌  package is NOT installable — do not ship it')
  process.exit(1)
}
