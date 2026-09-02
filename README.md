# Hashmi Ka Dera (HKD) — Restaurant POS & Management System

ہاشمی کا ڈیرہ

A production-grade desktop point-of-sale and back-office system for a Pakistani
restaurant, built as a secure Electron application with a local SQLite database.
Currency is **PKR** throughout.

- **Always operational** — the restaurant is open 24/7. There is no "open
  restaurant" step; any authorised employee can sign in and use the POS at any
  time
- **POS** optimised for continuous, fast, keyboard-friendly order taking
- **Employee sessions** that are the unit of sales reporting — a session runs
  from an explicit start to an explicit end and **is never reset, split or
  ended by midnight**
- **Reporting date** is a separate, label-only concept (configurable rollover,
  default 6 PM) that groups sales for reports and never touches sessions or POS
  access
- **Fixed service charge** (default **PKR 30**) added to every order as
  `Subtotal − Discount + Service Charge = Total`. Configurable in Settings; the
  amount applied is frozen onto each order/invoice so history never changes
- **Immutable invoices** with permanent numbers and frozen snapshots
- **Thermal invoice printing** (58 mm / 80 mm) via the OS print stack, with a
  clearly-marked adapter seam for a future direct ESC/POS Bluetooth driver
- **Admin** management of menu, deals, prices, employees, payment methods, and
  settings, plus reports, an append-only audit log, and backup / restore

---

## 1. Technology

| Area          | Choice                                             |
| ------------- | -------------------------------------------------- |
| Shell         | Electron 33 (context isolation, preload, IPC only) |
| UI            | React 18 + TypeScript + Vite (via `electron-vite`) |
| Database      | SQLite (`better-sqlite3`)                          |
| Query layer   | Drizzle ORM + hand-verified DDL & SQL triggers     |
| Validation    | Zod-style checks in every service, typed IPC       |
| Passwords     | `bcryptjs` (salted hashes, never plaintext)        |
| Tests         | Vitest                                             |
| Packaging     | `electron-builder` → Windows NSIS installer        |

The renderer has **no Node access**. Every privileged operation goes through a
single validated IPC channel (`hkd:invoke`) to the main process, which owns the
database, the printer, the filesystem and all business rules.

---

## 2. Installation

Requirements: **Node.js 20 or 22**, npm 10+, a C/C++ toolchain for the native
SQLite module (Xcode CLT on macOS, `build-essential`/`windows-build-tools` on
Linux/Windows — usually already present).

```bash
npm install
```

`postinstall` compiles `better-sqlite3` for the bundled Electron runtime.

### The native-module note (important)

`better-sqlite3` is a native addon and must match the runtime that loads it:

- **Running the app** (`npm run dev`, `npm start`, packaging) needs it built for
  **Electron**. The `predev` / `prestart` hooks and `npm run rebuild` do this.
- **Running the tests** (`npm test`) needs it built for **Node**. The `pretest`
  hook and `npm run rebuild:node` do this.

You normally don't think about it — the pre-hooks switch it automatically (they
force the rebuild rather than trusting the cache, which is what makes
`npm test` → `npm run dev` work without a manual step). If you ever do see a
`NODE_MODULE_VERSION` error, run the matching rebuild script.

---

## 3. Development

```bash
npm run dev        # launches Electron with HMR for the renderer
```

On first launch the database is created in Electron's `userData` folder and
seeded with the menu and **development users** (see §6).

```bash
npm run typecheck  # strict TS for both main and renderer
npm test           # business-logic test suite (Vitest)
npm run test:watch
```

---

## 4. Database

- **Location:** `<userData>/data/taste-of-hkd.db`
  - macOS: `~/Library/Application Support/Hashmi Ka Dera POS/data/`
  - Windows: `%APPDATA%\Hashmi Ka Dera POS\data\`
- **Schema:** created and kept current on every boot from
  `src/main/db/migrate.ts` (idempotent DDL + immutability triggers). A
  `schema_meta` row tracks the version. `v2` strips the removed "business day"
  open/close lifecycle down to a bare reporting-date lookup; `v3` adds the
  per-order service charge column to `orders` and `invoices`. Both preserve and
  re-link existing data.
- **Money** is stored as integer paisa; **timestamps** as epoch milliseconds.
- **Immutability:** SQL triggers block `UPDATE`/`DELETE` on `invoice_lines`,
  `invoices` (financial columns), `payments`, and `audit_logs`. Completed orders'
  lines are frozen too. Products and deals are **archived, never deleted**, so
  historical invoices always resolve.

### Seed the database without launching the UI

```bash
npm run db:seed
```

---

## 5. Running & building

```bash
npm start            # preview the production bundle in Electron
npm run build        # typecheck + build main/preload/renderer into out/
npm run build:win    # build + produce the Windows installer in release/
npm run build:dir    # unpacked build for quick local inspection
```

`build:win` produces `release/Hashmi Ka Dera POS-1.0.0-Setup.exe` (~89 MB).
Icons are generated from the logo and live in `build/` — `icon.ico`
(multi-size, 16→256 px), `icon.icns` (built with macOS `iconutil`, not
ImageMagick, which writes a PNG under an `.icns` name) and `icon.png`.
electron-builder picks them up automatically.

**Cross-building works.** The Windows installer builds fine from macOS or
Linux — no Windows machine needed. `better-sqlite3` is a native module, but it
publishes prebuilt binaries for the Electron ABI (we need
`electron-v130-win32-x64`), so electron-builder downloads that instead of
compiling. Worth verifying after a toolchain change, because packaging the
host platform's binary by mistake produces an installer that fails only on the
user's PC:

```bash
file release/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
# → PE32+ executable (DLL) (GUI) x86-64, for MS Windows
```

---

## 5a. Giving the app to someone else

The app is a normal desktop program. The person receiving it needs **no Node,
no source, no internet** — just Windows 10 or 11 (64-bit).

### What to send

One file: **`Hashmi Ka Dera POS-1.0.0-Setup.exe`** from `release/`.

It is ~89 MB, so email will usually reject it — use WhatsApp Desktop, Google
Drive, a USB stick, or attach it to a GitHub Release. Do **not** send the
`win-unpacked` folder or the source code; the installer contains everything,
including Electron itself.

### Installing it

1. Double-click the `.exe`.
2. Windows will show **"Windows protected your PC"** — click **More info** →
   **Run anyway**. This is expected: the installer is not code-signed. A
   signing certificate costs a few hundred dollars a year; without one every
   Windows machine shows this warning the first time.
3. The wizard installs per-user (no administrator password needed) and creates
   a **Hashmi Ka Dera POS** desktop and Start-menu shortcut.

### First run — creating the first account

A packaged build ships with **no user accounts**. The development logins in
§6 exist only when running from source.

So on a fresh install: click **Create one** on the sign-in screen and register.
**The first account created becomes the ADMIN automatically.** Everyone who
signs up after that is created as a *pending employee* and cannot log in until
the admin approves them in **Employees**.

The menu, deals, food photography, invoice logo, payment methods and settings
are all seeded on first launch, so the POS is usable immediately.

### Important: each PC keeps its own data

This is an offline application. There is no server and no sync. Every install
has its own database, at:

```
%APPDATA%\Hashmi Ka Dera POS\data\taste-of-hkd.db
```

Sales, sessions, invoices and menu edits made on one PC do **not** appear on
another. Two PCs means two separate restaurants as far as the software is
concerned.

To copy a menu (or everything) to a second machine:

1. On the first PC: **Settings → Backup → Create backup**.
2. Copy the resulting `.db` file across.
3. On the second PC: **Settings → Backup → Restore**, choose the file, and type
   `RESTORE` to confirm. This *replaces* that machine's data — a safety copy of
   what was there is taken first.

### Printer on the new PC

Pair or install the thermal printer in **Windows Settings → Bluetooth &
devices → Printers** first, then open **Printer** in the app and select it.
See §8 for the full printer guide.

### Updating later

Build a new installer and run it over the existing installation. The database
lives outside the install folder, so **invoices, sessions and menu edits are
kept**. Bump `version` in `package.json` first so the file name reflects the
new version.

### Branding & fonts

The bilingual identity (English **Hashmi Ka Dera — HKD** and Urdu
**ہاشمی کا ڈیرہ** in Nastaliq) is rendered with two fonts **bundled** into the
build (`src/renderer/src/assets/fonts/`) — Fraunces for the display serif and
Noto Nastaliq Urdu for the Urdu script. No network is needed at runtime. The
name shown on invoices comes from **Settings → Restaurant name (English / Urdu)**.

### Menu photography

Every product and deal can carry a photo, shown on the POS tile above the name
and price. An item without one gets a drawn placeholder — never a broken image
and never a ragged grid.

**Where the bytes live.** In SQLite, in their own `menu_images` table, one row
per item. That is deliberate: `Settings → Backup` copies the database file, so
photos are backed up and restored with everything else instead of quietly
vanishing. The blob sits in a separate table so ordinary menu queries never drag
image data along with them.

**How they reach the screen.** Not over IPC. The main process registers a
`hkd-img://` scheme and the renderer gets a versioned URL
(`hkd-img://menu/product/12?v=1730000000000`), so Chromium fetches and caches
each photo exactly once. Opening the POS costs one small JSON payload, not a
megabyte of base64. The `?v=` stamp changes whenever the photo does, so a
replacement appears immediately despite the immutable cache header.

**Uploading.** *Menu → (item) → Photo → Upload photo…* and the same control on
*Deals*. The native file dialog and the re-encode both happen in the main
process; the renderer only ever holds a small preview and a token. Uploads are
**JPG or PNG** — the formats Electron's `nativeImage` decodes reliably — and
every one is centre-cropped to 4:3, scaled to 640×480 and re-encoded to JPEG at
quality 68, so a 5 MB phone photo lands at roughly 40 KB. Re-encoding uses Electron's own
`nativeImage` rather than `sharp`, so no second native module needs an ABI
rebuild. A photo picked while *creating* an item is held in memory until you
press Save, then attached; if you never save, nothing is written.

**The bundled photos.** `resources/menu-images/` ships 31 freely-licensed
photographs — one per seeded product and deal — as 500×375 WEBP totalling about
930 KB, plus a `manifest.json` mapping them to seed menu items. (500 px wide is
the largest an anonymous client can pull from Wikimedia Commons, and it is
ample: a POS tile is ~200 CSS px, so it still covers a 2× HiDPI screen.) They are attached on first run
and **never overwrite an existing image**, so your own uploads survive every
restart and update. Attribution for all of them is listed in-app under
*Settings → Menu photography*.

To change the shipped photography, edit `resources/menu-images/sources.json`
(one entry per item: slug, menu name, Commons file title, optional crop
gravity) and run:

```bash
node scripts/build-menu-images.mjs --force   # needs ImageMagick + cwebp
```

The generated `.webp` files are committed, so a normal install, build or test
run never touches the network.

### The invoice logo

The HKD badge is printed at the top of every invoice — and getting it there is
not a matter of dropping an `<img>` into the receipt.

**Why it needs converting.** A thermal head has two states per dot: burn or
don't. There are no greys. The HKD logo is drawn on a **solid black**
background, so a straight greyscale threshold would burn that entire field —
a black band across the paper on every single receipt, wasting heat and paper
and making many printers stutter. Inverting first fixes the background but
turns the chef's face into a photographic negative.

**What it does instead.** `src/main/printer/thermalImage.ts` applies a **local
adaptive threshold**: each dot is compared against the average brightness of
its own neighbourhood rather than one global cut-off. Flat regions — the black
ground, the flat red field — come out as paper; edges and dense marks come out
as ink. The result is clean line art in which the ring, the lettering and the
chef all read correctly, at roughly **19% ink coverage** instead of ~100%.
The window scales with the head, so 58 mm (384 dots) and 80 mm (576 dots)
produce the same weight of art rather than the wider paper printing thinner.

The mean comes from a summed-area table, so conversion is O(1) per pixel and
takes a few milliseconds. That is why it runs at print time rather than in a
build step — which in turn is what lets an uploaded logo get exactly the same
treatment as the bundled one. Results are memoised per (logo, paper width).

**Where it lives.** The colour source is stored in the database like menu
photography (`menu_images`, owner type `BRAND`), so it is carried by backup
and restore. `resources/brand/hkd-logo.png` ships as the default and is loaded
on first run — and, like the menu photos, **never overwrites a logo already
present**, so an uploaded one survives updates.

**Managing it.** *Printer → Invoice logo*: upload/replace, remove, and a
**Print the logo on invoices** switch (on by default — turn it off if a
particular printer handles rasters badly). The preview there, and in the
invoice preview dialog, shows the converted 1-bit art rather than the colour
original, because that is the only honest preview of what the paper will show.
The logo is resolved at print time from current settings and is deliberately
**not** frozen into the immutable invoice snapshot, so a reprint of an old
invoice carries today's logo. The plain-text/ESC-POS output is unchanged — it
cannot carry a raster.

---

## 6. User roles & development credentials

Two roles: **ADMIN** (full access) and **EMPLOYEE** (POS + own session / sales /
invoices only). Employees cannot change prices, delete products, modify invoices,
delete orders, view admin reports, manage staff, or change settings.

**Account creation:** the app has a signup flow. The **very first** account
becomes an active ADMIN so the system is usable; **every later signup is a
PENDING EMPLOYEE** and an admin must approve it. Admin rights are never granted
automatically.

Development seed accounts (created only in dev / when `HKD_SEED_DEV_USERS=1`,
**all forced to change password on first login** — no production secret is ever
committed):

| Role     | Username  | Password       |
| -------- | --------- | -------------- |
| Admin    | `admin`   | `Admin@12345`  |
| Employee | `victor1` | `Victor@12345` |
| Employee | `victor2` | `Victor@12345` |

Password changes and admin-initiated resets invalidate all of that user's
sessions.

---

## 7. Sessions & the reporting date (the core model)

**The restaurant is always operational.** There is no open/close switch, no
admin "open restaurant" action, and nothing gates login or the POS on the time
of day.

- An **employee session** is opened by the employee and stays open until *that
  employee* explicitly ends it. Every order/invoice references `session_id`
  directly.
- **Session metrics are computed purely `WHERE session_id = ?`** — no date
  filter anywhere. An order (and its revenue) rung up at 12:01 AM belongs to the
  same active session as one at 11:59 PM. Midnight never resets a session's
  invoice count, order count, totals or any other metric, and never starts a
  new session.
- The **reporting date** (`business_date`) is a separate, label-only concept. A
  configurable rollover hour (Settings → Reporting day, default 6 PM) decides
  which calendar date a sale is *reported* under so a night's trade past
  midnight stays on one date. Set it to `0` for pure calendar dates. Changing it
  affects reports only — never sessions, logins or the POS. `business_days` is
  just a lazily-created lookup of dates that had activity (id, date,
  first-activity time — no status, no lifecycle).

> `tests/session.test.ts` proves it: an employee starts a session, rings **5**
> invoices before midnight and **6** after — the *active* session reports
> **11** invoices and one continuous revenue total, with no admin action taken
> first. A second test runs 20 + 5 = **25** even with a midnight reporting
> rollover, and shows the 25 orders landing on two different reporting dates
> while the session total stays whole.

Ending a session shows a confirmation, then a permanent summary (start, end,
duration, orders, invoices, gross, discounts, refunds, net, payment breakdown),
which is frozen into `work_sessions.summary_json`.

---

## 8. Printer setup

**Settings → Printer.**

### Bluetooth thermal printer as a normal OS printer (recommended)

1. Pair the printer in Windows/macOS Bluetooth settings so it appears as a system
   printer.
2. In the app: **Printer mode = System printer**, pick it from **Selected
   printer**, set **Paper width** (58 or 80 mm), click **Print test invoice**.

The app renders the invoice to fixed-width HTML and prints it silently through
Electron's print pipeline to the chosen device.

### Direct ESC/POS Bluetooth (advanced, hardware-specific)

If your exact printer misbehaves as a generic OS printer, switch **Printer mode =
Direct ESC/POS Bluetooth** and enter the serial port / address. This path is
**intentionally inert until completed for your printer model** — see the header
of `src/main/printer/EscposBluetoothAdapter.ts`. `buildEscPos()` already emits a
valid Epson-compatible byte stream; only the transport (`serialport` or a vendor
SDK) needs wiring. The app never pretends a printer is connected.

### If printing fails

The invoice is **always saved** with a permanent number. Its print status shows
`FAILED`; every attempt is logged in `print_jobs`. Reprint from **Invoices** (or
the payment-success screen) once the printer is back. An invoice is only marked
`PRINTED` when the printer confirms the job.

### Bluetooth troubleshooting

| Symptom                     | Fix                                                              |
| --------------------------- | --------------------------------------------------------------- |
| No printers listed          | Re-pair in OS Bluetooth settings, then **Refresh printers**     |
| "not currently available"   | Printer is off or out of range; power-cycle and bring it closer |
| Prints blank / garbled      | Wrong paper width — toggle 58 ↔ 80 mm and test again            |
| Cuts off right edge         | Set width to match the roll; check the printer's own DIP config |
| Works once then stops       | Bluetooth sleep — disable power-saving for the COM port         |

---

## 9. Backup & restore

**Settings → Backup & restore.**

- **Create backup** — a consistent `.db` copy in `<userData>/backups/`.
- **Export JSON** — a human-readable dump (passwords redacted); not a restore
  format.
- **Restore** — requires typing `RESTORE` to confirm. The current database is
  copied to a `pre-restore-*.db` safety file first, so a restore can never
  silently lose data. The app reloads afterwards; sign in again.

Backups are also written to disk and listed by file, so they can be copied to
external / cloud storage as part of the restaurant's routine.

---

## 10. Testing

```bash
npm test              # headless business-logic suite (Vitest)
npm run smoke         # launches the real Electron app and drives the full
                      # happy path, saving screenshots to ./smoke-shots/
npm run layout-check            # reachability audit at 5 window sizes
npm run layout-check -- --stress  # …plus 90 seeded products so the cart is
                                  #    filled with 120+ line items
```

`layout-check` opens the real app at **1920×1080, 1440×900, 1366×768,
1280×700 and 1024×620** and, on **every** screen (POS, Dashboard, Orders,
Employees, Sessions, Menu, Deals, Invoices, Reports, Printer, Settings, Audit
Log) plus the payment dialog and the user menu, asserts:

- a generic **clipping detector** walks the whole rendered tree and fails if
  any element hides content (`overflow: hidden|clip`) that has no scrollable
  ancestor — i.e. pixels the user could never reach
- a **control-size detector** fails if any visible button, input, select or
  toggle is smaller than 30 × 30 px (a checkbox is measured by its clickable
  `<label>`), so small controls cannot creep back in
- every icon-only button carries a tooltip / `aria-label`
- the page scroll container actually reaches its last pixel
- with a **121-line cart**: the line list scrolls, and *Subtotal, Discount,
  Service Charges, Total, Hold and Payment* are all on screen
- every dialog's footer actions stay on screen

### The scrolling contract

1. **One page scroller.** The window never scrolls; `.shell__content` does.
2. **`min-height: 0` on every link of a flex/grid scroll chain.** Without it
   the default `min-height: auto` lets a container grow past the viewport and
   the overflow is clipped with *no scrollbar at all* — the original bug.
3. **`overflow: hidden` is never the mechanism.** The only clip is the app
   shell frame, whose children all scroll. The POS uses `overflow: auto` with
   an intrinsic `min-height: 600px`, so if a window is ever too short for the
   three-pane frame the **page** scrolls instead. Nothing depends on the
   user's screen resolution.
4. **Fixed sections never shrink.** In the cart, `.cart__foot` is
   `flex: 0 0 auto`: with the default `flex-shrink: 1` a 100-line order made
   the browser shrink the *footer* proportionally and clip the Payment row.
   The line list absorbs all the shrink; the actions are always pinned.
5. **No nested `max-height` scroll traps.** Tables grow naturally (scrolling
   horizontally only) so the page scroller reaches the last row.
6. **Nothing overlays the primary action.** Toasts render under the top bar,
   not bottom-right where Hold / Payment live.

The window also never opens larger than the display work area and maximises
itself on screens 800 px or shorter.

### The control-size contract

Restaurant staff use this all shift, often quickly and sometimes on a touch
screen, so **comfort beats compactness**. `tokens.css` defines the scale and
nothing in the app is allowed below `--control-sm`:

| Token           | Size | Used for                                          |
| --------------- | ---- | ------------------------------------------------- |
| `--control-xl`  | 50px | Charge, Hold / Payment, the cash keypad            |
| `--control-lg`  | 44px | quantity steppers, every input / select, nav items |
| `--control-md`  | 40px | standard buttons, icon buttons, filter chips       |
| `--control-sm`  | 34px | the smallest control permitted (row actions)       |

Also enforced: `--control-gap` (10px) between independently clickable
controls so a mis-tap can't fire the wrong action; destructive buttons are
visually and spatially separated from their neighbours; checkboxes are 24px
with the whole label as the hit area; and every control has distinct
hover / pressed / focus states.

The unit suite covers: sessions crossing midnight with no admin action and no
reset (5 + 6 = 11; 20 + 5 = 25), the reporting-date label / rollover, order
creation, server-side pricing, invoice numbering & uniqueness, totals, discounts
and the employee discount cap, the **fixed service charge** (default PKR 30,
included in the total, frozen onto historical invoices when the default later
changes, and omitted when set to 0), payment validation & change, deal pricing,
refunds, printer-failure handling, immutability triggers (invoices / payments /
audit log), product archival with historical-invoice integrity, and role
permissions (employee vs admin) including the IPC authorization gate.

---

## 11. Project layout

```
src/
  main/               Electron main process
    db/               schema, migrations (DDL + triggers), seed
    services/         all business logic (auth, session, businessDay, orders,
                      invoices, menu, deals, reports, printer, backup, audit…)
    printer/          PrinterAdapter interface + System / ESC-POS adapters + render
    ipc/              channel manifest → handler map → single ipcMain.handle
  preload/            contextBridge: builds typed window.api over one IPC channel
  shared/             types, IPC contract, time & money helpers, seed menu data
  renderer/           React app (POS, admin, employee screens, design system)
resources/
  menu-images/        bundled menu photography + sources.json + manifest.json
  brand/              the logo printed on invoices (colour source)
scripts/              build-menu-images, smoke driver, layout/accessibility audit
tests/                Vitest suites + electron mock
```

---

## 12. Adding a cloud sync layer later

The architecture keeps this cheap:

- All writes go through **services**, not ad-hoc SQL, so a change-feed / outbox
  can be added at that layer.
- Financial rows are **append-only and immutable**, which is exactly what a sync
  engine wants.
- IDs, invoice numbers and business-day/session references are explicit columns.
- The renderer only knows the typed `window.api`; swapping the transport under it
  does not touch the UI.
