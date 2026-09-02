/**
 * Global layout / reachability audit.
 *
 *   npm run layout-check            # normal run
 *   npm run layout-check -- --stress  # + seeds ~90 extra products so the cart
 *                                     #   can be filled with 100+ line items
 *
 * For every screen, at several window sizes, it asserts:
 *   1. no element clips content with `overflow: hidden` and no scrollable
 *      ancestor  (the generic "content became unreachable" detector)
 *   2. the page's scroll container can actually reach its last pixel
 *   3. nothing sits below the fold with no way to scroll to it
 *   4. the POS totals + Hold/Payment stay on screen with a huge cart
 *   5. every dialog's footer actions stay on screen
 */
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

const STRESS = process.argv.includes('--stress')
const SHOTS = join(process.cwd(), 'smoke-shots', 'layout')
mkdirSync(SHOTS, { recursive: true })

const SIZES = [
  { w: 1920, h: 1080, name: '1920x1080' },
  { w: 1440, h: 900, name: '1440x900' },
  { w: 1366, h: 768, name: '1366x768' },
  { w: 1280, h: 700, name: '1280x700' },
  { w: 1024, h: 620, name: '1024x620' }
]

const ADMIN_PAGES = [
  ['Dashboard', 'dashboard'],
  ['Orders', 'orders'],
  ['Employees', 'employees'],
  ['Sessions', 'sessions'],
  ['Menu', 'menu'],
  ['Deals', 'deals'],
  ['Invoices', 'invoices'],
  ['Reports', 'reports'],
  ['Printer', 'printer'],
  ['Settings', 'settings'],
  ['Audit Log', 'audit']
]

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`   ${ok ? '✓' : '✗ FAIL'}  ${label}${extra ? '   ' + extra : ''}`)
}

const app = await electron.launch({
  executablePath: electronPath,
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2500)
await win.evaluate(() => localStorage.clear())
await win.reload()

/* ------------------------------------------------------------------ */
/* generic detectors, injected into the page                           */
/* ------------------------------------------------------------------ */

/**
 * Walks the rendered tree and reports every element that is clipping its own
 * content (`overflow: hidden|clip`) while that content is genuinely taller /
 * wider than the box — i.e. pixels a user can never reach.
 */
const findClipped = () =>
  win.evaluate(() => {
    const out = []
    const walk = (el) => {
      const cs = getComputedStyle(el)
      const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
      const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip'
      const overY = el.scrollHeight - el.clientHeight
      const overX = el.scrollWidth - el.clientWidth
      // ignore sub-pixel rounding and decorative single-line truncation
      const textTruncated = cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap'
      if (clipsY && overY > 4 && el.clientHeight > 0) {
        out.push({
          axis: 'y',
          sel: el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName,
          lost: overY
        })
      }
      if (clipsX && overX > 4 && el.clientWidth > 0 && !textTruncated) {
        out.push({
          axis: 'x',
          sel: el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName,
          lost: overX
        })
      }
      for (const c of el.children) walk(c)
    }
    walk(document.body)
    return out
  })

/**
 * Every visible interactive control must present a comfortable click target.
 * Reports anything smaller than MIN×MIN so small controls can't creep back in.
 */
const findSmallTargets = (MIN = 30) =>
  win.evaluate((min) => {
    const sel = 'button, select, input:not([type="hidden"]), textarea, [role="button"], a.nav__item'
    const out = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue // hidden
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      // a checkbox/radio inside a clickable <label> is measured by the label,
      // which is the real hit area
      let box = r
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
        const lbl = el.closest('label')
        if (lbl) box = lbl.getBoundingClientRect()
      }
      if (box.height < min || box.width < min) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === 'string' ? el.className : '').trim().slice(0, 46),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 22),
          w: Math.round(box.width),
          h: Math.round(box.height)
        })
      }
    }
    return out
  }, MIN)

/** icon-only buttons must carry an accessible name (tooltip / aria-label) */
const findUnlabelledIcons = () =>
  win.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('button')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      const text = (el.textContent || '').trim()
      const looksIconOnly = text.length <= 2
      const named = el.getAttribute('aria-label') || el.getAttribute('title')
      if (looksIconOnly && !named) out.push({ text, cls: (el.className || '').slice(0, 40) })
    }
    return out
  })

/** scroll a container to the bottom and report whether it got there */
const canReachBottom = (sel) =>
  win.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return { found: false }
    el.scrollTop = el.scrollHeight
    const reached = Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) <= 2
    return { found: true, reached, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
  }, sel)

/** is the element's box fully inside the window? */
const inViewport = (sel) =>
  win.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return { found: false }
    const r = el.getBoundingClientRect()
    return {
      found: true,
      visible: r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 0 && r.width > 0,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      winH: window.innerHeight
    }
  }, sel)

/* ------------------------------------------------------------------ */
/* sign in                                                             */
/* ------------------------------------------------------------------ */
await win.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
// The seeded password only survives until the first run of this script, which
// is forced to change it. Try both so the audit is re-runnable against an
// existing dev database instead of requiring a wipe.
const SEED_PW = 'Admin@12345'
const AUDIT_PW = 'NewPass123'
let signedIn = false
for (const pw of [SEED_PW, AUDIT_PW]) {
  await win.fill('input[autocomplete="username"]', 'admin')
  await win.fill('input[type="password"]', pw)
  await win.click('button:has-text("Sign in")')
  await win.waitForTimeout(1500)
  const hash = await win.evaluate(() => location.hash)
  if (hash.includes('change-password')) {
    const fields = win.locator('input[type="password"]')
    await fields.nth(0).fill(pw)
    await fields.nth(1).fill(AUDIT_PW)
    await fields.nth(2).fill(AUDIT_PW)
    await win.click('button:has-text("Save password")')
    await win.waitForTimeout(1800)
  }
  if (!(await win.evaluate(() => location.hash)).includes('login')) {
    signedIn = true
    break
  }
}
if (!signedIn) {
  console.error("Could not sign in as admin. Delete the dev database and retry — see README §4.")
  await app.close()
  process.exit(1)
}

if (STRESS) {
  console.log('seeding extra products for the 100+ line stress test…')
  const made = await win.evaluate(async () => {
    const cats = await window.api.menu.categories({})
    const catId = cats.data[0].id
    // Re-running the audit must not pile another 90 rows into the dev menu.
    const existing = await window.api.menu.products({ search: 'Stress Item' })
    if (existing.ok && existing.data.length >= 90) return existing.data.length
    let n = 0
    for (let i = 1; i <= 90; i++) {
      const r = await window.api.menu.productCreate({
        categoryId: catId,
        name: `Stress Item ${String(i).padStart(3, '0')}`,
        nameUrdu: 'ٹیسٹ',
        prices: [{ variant: 'STANDARD', label: 'Standard', priceMinor: 5000 + i * 10 }]
      })
      if (r.ok) n++
    }
    return n
  })
  console.log(`   seeded ${made} extra products`)
}

await win.click('a.nav__item:has-text("POS")')
await win.waitForTimeout(1200)
const startBtn = win.locator('button:has-text("Start session")').first()
if (await startBtn.count()) {
  await startBtn.click()
  await win.waitForTimeout(1500)
}

/* ------------------------------------------------------------------ */
/* the run                                                             */
/* ------------------------------------------------------------------ */
let cartFilled = false
for (const size of SIZES) {
  console.log(`\n── ${size.name} ──────────────────────────────────────`)
  const bw = await app.browserWindow(win)
  await bw.evaluate((w, s) => {
    if (w.isMaximized()) w.unmaximize()
    w.setContentSize(s.w, s.h)
  }, size)
  await win.waitForTimeout(900)

  /* ---------- POS with a very long order ----------
     the cart is a client-side store, so it is filled once and survives every
     resize / navigation below — no need to re-click hundreds of tiles */
  await win.click('a.nav__item:has-text("POS")')
  await win.waitForTimeout(1000)
  if (!cartFilled) {
    const catCount = await win.locator('.pos__cat').count()
    for (let c = 0; c < catCount; c++) {
      await win.locator('.pos__cat').nth(c).click().catch(() => {})
      await win.waitForTimeout(180)
      const tiles = win.locator('.tile')
      const n = await tiles.count()
      for (let i = 0; i < n; i++) {
        const t = tiles.nth(i).locator('.tile__foot, .tile__pill').first()
        if (await t.count()) await t.click({ timeout: 2000 }).catch(() => {})
      }
    }
    cartFilled = true
  }
  await win.waitForTimeout(500)
  const lines = await win.locator('.cart__line').count()

  check(`POS · ${lines} cart lines · Payment button on screen`, (await inViewport('.cart__actions .btn--primary')).visible)
  check('POS · Hold button on screen', (await inViewport('.cart__actions .btn')).visible)
  check('POS · grand total on screen', (await inViewport('.cart__totrow.grand')).visible)
  const cs = await canReachBottom('.cart__lines')
  check('POS · cart list scrolls to its last line', cs.reached, `${cs.scrollHeight}px in ${cs.clientHeight}px`)
  check('POS · product grid scrolls to the bottom', (await canReachBottom('.pos__menu')).reached)
  let clipped = await findClipped()
  check('POS · nothing clipped without a scrollbar', clipped.length === 0, JSON.stringify(clipped.slice(0, 4)))
  let small = await findSmallTargets()
  check('POS · every control is a comfortable target', small.length === 0, JSON.stringify(small.slice(0, 6)))
  const unlabelled = await findUnlabelledIcons()
  check('POS · every icon button has a tooltip / label', unlabelled.length === 0, JSON.stringify(unlabelled.slice(0, 6)))
  await win.screenshot({ path: join(SHOTS, `${size.name}-pos.png`) })

  /* ---------- subtotal / service charge / total all readable ---------- */
  const labels = await win.evaluate(() =>
    [...document.querySelectorAll('.cart__totrow')].map((r) => r.textContent.trim())
  )
  check(
    'POS · subtotal, discount, service charge & total all present',
    labels.some((t) => t.startsWith('Subtotal')) &&
      labels.some((t) => t.includes('Service Charges')) &&
      labels.some((t) => t.startsWith('Total')),
    labels.join(' | ')
  )

  /* ---------- payment dialog ---------- */
  await win.click('.cart__actions .btn--primary')
  await win.waitForTimeout(900)
  check('Payment dialog · Charge button on screen', (await inViewport('.modal__foot .btn--primary')).visible)
  check('Payment dialog · body scrolls to the bottom', (await canReachBottom('.modal__body')).reached)
  clipped = await findClipped()
  check('Payment dialog · nothing clipped', clipped.length === 0, JSON.stringify(clipped.slice(0, 4)))
  small = await findSmallTargets()
  check('Payment dialog · every control is a comfortable target', small.length === 0, JSON.stringify(small.slice(0, 6)))
  await win.screenshot({ path: join(SHOTS, `${size.name}-payment.png`) })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)

  /* ---------- user-menu dropdown must not be clipped by the topbar ---------- */
  await win.click('.usermenu__btn')
  await win.waitForTimeout(350)
  check('Top bar · user menu dropdown is visible', (await inViewport('.usermenu__pop')).visible)
  await win.keyboard.press('Escape')
  await win.evaluate(() => document.querySelector('.usermenu__scrim')?.click())
  await win.waitForTimeout(300)

  /* ---------- every admin page ---------- */
  for (const [nav, file] of ADMIN_PAGES) {
    await win.click(`a.nav__item:has-text("${nav}")`)
    await win.waitForTimeout(1000)
    const s = await canReachBottom('.shell__content')
    check(`${nav} · scrolls to the very bottom`, s.reached, `${s.scrollHeight}px in ${s.clientHeight}px`)
    const c = await findClipped()
    check(`${nav} · nothing clipped without a scrollbar`, c.length === 0, JSON.stringify(c.slice(0, 3)))
    const sm = await findSmallTargets()
    check(`${nav} · every control is a comfortable target`, sm.length === 0, JSON.stringify(sm.slice(0, 6)))
    await win.screenshot({ path: join(SHOTS, `${size.name}-${file}.png`) })
  }
}

console.log(`\n${failures === 0 ? '✅  ALL LAYOUT CHECKS PASSED' : `❌  ${failures} LAYOUT CHECK(S) FAILED`}`)
await app.close()
process.exit(failures === 0 ? 0 : 1)
