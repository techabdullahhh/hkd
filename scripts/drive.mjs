/**
 * Smoke test: launches the built Electron app and drives the full happy path
 * (login → forced password change → open business day → start session →
 * build a cart → take payment → visit every admin page), saving a screenshot
 * at each step to ./smoke-shots/.
 *
 *   npm run smoke
 *
 * Requires no display server on macOS/Windows. Resets the local dev database.
 */
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'smoke-shots')
mkdirSync(SHOTS, { recursive: true })
const shot = (w, name) => w.screenshot({ path: join(SHOTS, name + '.png') })
const log = (...a) => console.log('•', ...a)

const app = await electron.launch({
  executablePath: electronPath,
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
})

const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2500)
// start from a clean signed-out state regardless of any persisted token
await win.evaluate(() => localStorage.clear())
await win.reload()
await win.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
await win.waitForTimeout(500)
log('window title:', await win.title())
log('brand (Urdu):', await win.locator('.brandmark__ur').first().innerText().catch(() => '(none)'))
log('brand (English):', await win.locator('.brandmark__en').first().innerText().catch(() => '(none)'))
await shot(win, '01-login')

// --- login as admin ---
// The seeded password only works until the first run, which is forced to
// change it — try both so the smoke test is re-runnable without a DB wipe.
const SEED_PW = 'Admin@12345'
const SMOKE_PW = 'NewPass123'
let signedIn = false
for (const candidate of [SEED_PW, SMOKE_PW]) {
  await win.fill('input[autocomplete="username"]', 'admin')
  await win.fill('input[type="password"]', candidate)
  await win.click('button:has-text("Sign in")')
  await win.waitForTimeout(1500)
  // --- forced password change ---
  if ((await win.evaluate(() => location.hash)).includes('change-password')) {
    const pw = win.locator('input[type="password"]')
    await pw.nth(0).fill(candidate)
    await pw.nth(1).fill(SMOKE_PW)
    await pw.nth(2).fill(SMOKE_PW)
    await win.click('button:has-text("Save password")')
    await win.waitForTimeout(1800)
  }
  if (!(await win.evaluate(() => location.hash)).includes('login')) {
    signedIn = true
    break
  }
}
log('after login url:', await win.evaluate(() => location.hash), signedIn ? '' : '(SIGN-IN FAILED)')
await shot(win, '02-after-login')
if (!signedIn) {
  console.error('Could not sign in as admin — delete the dev database and retry (README §4).')
  await app.close()
  process.exit(1)
}
await shot(win, '03-dashboard')

// --- the restaurant is always open: no "open business day" step ---
const openBtn = win.locator('button:has-text("Open business day")')
log('open-business-day button present?', (await openBtn.count()) > 0, '(expected: false)')

// --- go straight to the POS ---
await win.click('a.nav__item:has-text("POS")')
await win.waitForTimeout(1200)
await shot(win, '05-pos-need-session')

// start session if prompted
const startSession = win.locator('button:has-text("Start session")').first()
if (await startSession.count()) {
  await startSession.click()
  await win.waitForTimeout(1500)
  log('started session')
}
await shot(win, '06-pos-menu')

// --- add products to cart ---
const tiles = win.locator('.tile')
await tiles.first().waitFor({ timeout: 5000 })
const n = await tiles.count()
log('product tiles visible:', n)
// click a few add buttons / pills
for (let i = 0; i < Math.min(4, n); i++) {
  const t = tiles.nth(i)
  const foot = t.locator('.tile__foot, .tile__pill').first()
  if (await foot.count()) await foot.click()
  await win.waitForTimeout(250)
}
await shot(win, '07-cart-filled')
const cartCount = await win.locator('.cart__line').count()
log('cart lines:', cartCount)

// --- payment ---
await win.click('button:has-text("Payment")')
await win.waitForTimeout(900)
await shot(win, '08-payment-modal')
// choose Cash (default), quick tender, charge
const cashBtn = win.locator('.tag-btn:has-text("Cash")').first()
if (await cashBtn.count()) await cashBtn.click()
const quick = win.locator('.tag-btn').filter({ hasText: /^\d/ }).first()
if (await quick.count()) await quick.click()
await win.waitForTimeout(300)
await win.click('button:has-text("Charge")')
await win.waitForTimeout(2500)
await shot(win, '09-payment-done')
const invText = await win.locator('.inv-preview').innerText().catch(() => '')
log('invoice has "Service Charges" line:', invText.includes('Service Charges'))
// The receipt the employee sees straight after payment must carry the logo —
// it was once missing here while the Invoices screen had it.
const logoOnReceipt = await win.locator('.inv-preview__logo').count()
log('invoice shows the printed logo:', logoOnReceipt > 0, '(expected: true)')
log('invoice has "PKR":', invText.includes('PKR'))
log('payment screen text:', (await win.locator('.modal').innerText().catch(() => '')).slice(0, 260))

// close success -> new order
const newOrder = win.locator('button:has-text("New order")').first()
if (await newOrder.count()) await newOrder.click()
await win.waitForTimeout(800)

// --- visit a few admin pages ---
for (const [label, file] of [
  ['Orders', '10-orders'],
  ['Invoices', '11-invoices'],
  ['Reports', '12-reports'],
  ['Menu', '13-menu'],
  ['Printer', '14-printer'],
  ['Audit Log', '15-audit']
]) {
  const link = win.locator(`a.nav__item:has-text("${label}")`).first()
  if (await link.count()) {
    await link.click()
    await win.waitForTimeout(1200)
    await shot(win, file)
  }
}

// --- end session from My... actually admin: Sessions page ---
await win.click('a.nav__item:has-text("Dashboard")')
await win.waitForTimeout(1200)
await shot(win, '16-dashboard-final')
log('DONE')

await app.close()
