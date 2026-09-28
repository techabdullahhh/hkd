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
- **Runs on Windows, macOS, Linux and Chrome OS** (via the Linux container),
  from one codebase — see §8a for the Chromebook specifics
- **Thermal invoice printing** (58 mm / 80 mm) over **USB, Bluetooth or the
  network**, either through the printer's driver with the page sized to the
  receipt or as direct ESC/POS raw bytes — logo, bold total and auto-cut
  included. The app works out which connections the machine can actually use
  and explains the ones it cannot (see §8)
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

`build:win` produces `release/Hashmi Ka Dera POS-1.1.0-Setup.exe` (~89 MB).
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

One file: **`Hashmi Ka Dera POS-1.1.0-Setup.exe`** from `release/`.

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

Plug the receipt printer in by USB and install its driver once, then open
**Printer** in the app — it appears in the list. See §8 for the full guide,
including the direct ESC/POS mode to use if the driver misbehaves.

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

### Running on one shared PC (the normal setup)

The restaurant runs a **single terminal** that two or three people share, each
taking a five-to-six hour slot. The software is built for that: it is *who is
signed in*, not which machine, that decides whose numbers a sale lands on.

**Setting the PC up once**

1. The owner registers first — the first account on a fresh install becomes
   **ADMIN** automatically.
2. Admin → **Employees → + New employee** creates each member of staff with a
   starting password. (They can also register themselves, but then they sit as
   *pending* until the admin approves them, which is a slower path.)
3. Each employee changes their password on first login.

One Windows login is fine for everyone; the app's own accounts do the
separating. There is no need for separate Windows user profiles — in fact one
shared Windows account is better, because the database lives under
`%APPDATA%` per Windows user and a second profile would start an empty
restaurant.

**The shift handover**

```
Employee A → My Session → End session   (prints/records their totals)
           → user menu  → Sign out
Employee B → Sign in    → POS → Start session
```

Behaviour worth knowing, all covered by `tests/sharedTerminal.test.ts`:

- **Signing out does not end a session.** If someone signs out mid-shift — or
  the PC is restarted — their session is still open when they sign back in,
  with its running totals intact. Sessions end only when someone explicitly
  ends them.
- **Sales attach to the signed-in employee**, never to the terminal. Two
  people ringing up on the same PC produce two cleanly separated sets of
  takings.
- **Shifts may overlap.** Both employees can hold an open session at the same
  time; the admin dashboard shows every session currently on the floor.
- **Staff cannot see each other's takings.** An employee reading another
  employee's session is refused; only the admin can view any session.
- **A forgotten session can be closed by the admin** — useful when someone
  goes home without ending their shift. Closing is refused while that session
  still has held orders, so nothing is silently stranded.

**One gap to be aware of.** There is no inactivity lock. If someone walks away
still signed in, the next person can ring up sales under their name until
somebody signs out. On a shared till, make "sign out at the end of your shift"
part of the routine — or ask for an auto-lock to be added.

## 8. Printer setup

Invoices reach the printer one of **four** ways, chosen under **Printer → How
the printer is connected**. They all print the identical receipt — same logo,
same bold total, same cut — and differ only in how the bytes get there. Each
exists because the others are blocked on some machine this app has to run on.

| Connection | Use it when | Works on |
| --- | --- | --- |
| **Through the printer's driver** | A normal printer with a normal driver | Windows, macOS |
| **Direct ESC/POS — wired USB** | A USB thermal printer. **The most reliable option; prefer it wherever a cable is possible** | Everywhere, incl. Chrome OS |
| **Direct ESC/POS — Bluetooth** | The printer is paired over Bluetooth | Windows, macOS, desktop Linux. **Not Chrome OS** |
| **Direct ESC/POS — network** | The printer has Wi-Fi or an Ethernet socket | Everywhere, incl. Chrome OS |

The app works out which of these the machine can actually use and greys out the
rest with the reason attached, rather than letting someone pick one that saves
cleanly and then silently never prints (`src/main/printer/modes.ts`).

Sections 8.1–8.3 cover wired USB, Bluetooth and network in turn.

### 8.1 Wired USB — the default

The restaurant's printer is a **wired USB thermal receipt printer** (Black
Copper or similar). It works two ways, both configured under **Printer** in the
app, and both use the same printer picked from the same list.

### Setting the printer up on the PC — once

1. Plug the printer into the PC by USB and switch it on.
2. Install its Windows driver — from the CD in the box or the maker's site
   (Black Copper: search "Black Copper BC-85AC driver"). If there is no driver
   to be found, Windows' built-in one works for raw mode: *Settings → Bluetooth
   & devices → Printers → Add device → Add manually → "Generic / Text Only"*,
   on the USB port the printer appeared on.
3. Open the app → **Printer** → **Refresh printers**. It appears in the list.
4. Leave **Receipt printer** on *Automatic* (it picks the one that looks like a
   receipt printer — a Black Copper will be chosen over an office laser) or
   select it explicitly. Set **Paper width** to match the roll: 80 mm for the
   BC-85/98 series, 58 mm for the small units.
5. **Print test invoice.**

From then on the cable is the only thing that matters. Plug it in and the
printer is online; the app reads the printer list live, so nothing needs
restarting.

### The two ways of printing

**Through the printer's driver** (default — start here). The app lays the
receipt out and prints it the way any program prints. The page is sized to the
receipt — measured after rendering and requested at exactly that length — so
the driver feeds one receipt's worth of paper and cuts. *(This used to be a
fixed A4 length, which is the classic "20 cm of blank paper after every
receipt" complaint.)*

**Direct ESC/POS** (the robust choice for USB thermal printers). The app sends
the printer its native command language — the same Epson-derived set every
receipt printer speaks — as raw bytes to its Windows queue, bypassing the
driver's page layout entirely. The printer uses its own font at the paper's
native column count, burns the logo dot-for-dot, feeds four lines and fires
the cutter. No page size, no scaling, no blank feed; nothing the driver can
get wrong. Switch to it if driver mode feeds blank paper, prints tiny, or
doesn't cut.

How raw mode reaches the printer without a serial port, a Bluetooth address
or a native USB library: Windows' spooler accepts a **RAW** document on any
installed queue and passes the bytes to the device untouched. The app calls
`winspool.drv` through a small PowerShell helper (the standard
"RawPrinterHelper"; nothing to install). On macOS/Linux it is `lp -o raw`.
See `src/main/printer/EscposRawAdapter.ts`.

Both modes print the identical logo: one thresholding pass produces both the
PNG the driver path embeds and the packed bitmap the ESC/POS path sends
(`src/main/printer/thermalImage.ts`). The logo prints 45 mm wide on 80 mm
paper, 30 mm on 58 mm.

### 8.2 Bluetooth

A Bluetooth thermal printer does not speak a special Bluetooth protocol. It
advertises the **Serial Port Profile** (SPP/RFCOMM), and every operating system
presents a paired SPP device as an ordinary serial port:

| | Port the printer appears as |
| --- | --- |
| Windows | `COM5` — created automatically when you pair |
| macOS | `/dev/cu.PrinterName` — created automatically when you pair |
| Linux | `/dev/rfcomm0` — **not** automatic, see below |

Write ESC/POS to that port and it prints. That is why this needs no native
module: no `node-bluetooth`, no `serialport`, nothing to rebuild against each
Electron release (`src/main/printer/serialPort.ts`).

**Setting it up**

1. **Pair the printer in the operating system**, not in this app — Windows
   *Settings → Bluetooth & devices → Add device*, macOS *System Settings →
   Bluetooth*. The PIN is usually `0000` or `1234`. Pairing is deliberately left
   to the OS: it is done once per printer and the PIN prompt belongs there.
2. **On Linux only**, bind the paired printer to a port. Pairing alone creates
   nothing, which is the single most confusing thing about Bluetooth printing
   on Linux — a correctly paired printer simply does not appear. Use the
   **Connect** button in the app's Bluetooth panel, or run it by hand:

   ```bash
   sudo rfcomm bind 0 AA:BB:CC:DD:EE:FF 1
   ```

   This is lost on restart. If the user is refused access to the port, add them
   to the group that owns it, then sign out and back in:

   ```bash
   sudo usermod -aG dialout $USER
   ```
3. In the app: **Printer** → connection **Direct ESC/POS — Bluetooth** →
   **Refresh printers** → pick the port → **Print test invoice**.

**Speed** is offered but only matters for a printer on a real serial cable;
Bluetooth negotiates its own. Leave it at 9,600 unless the manual says otherwise.

**Bluetooth is the least reliable of the four**, and worth avoiding where a
cable or the network is possible. The link drops when the printer sleeps or
drifts out of range, and it reconnects only when something writes to it — so a
failure shows up as a missing receipt at the counter. The app distinguishes
"out of range", "asleep", "not paired" and "not permitted" rather than reporting
one generic failure, because on a busy counter the difference between those is
the difference between a fix and a phone call.

### 8.3 Network (Wi-Fi or Ethernet)

Thermal printers with Wi-Fi or an Ethernet socket almost universally listen on
**TCP port 9100** — raw socket printing, sometimes called JetDirect. There is no
protocol on top: open the socket, write ESC/POS, close it. That makes this the
transport with the fewest moving parts in the app, and the only *wireless* one
that works everywhere — including Chrome OS, where Bluetooth is impossible.

1. Put the printer on the same network as the till (its manual will say how —
   usually a WPS button or a small web page).
2. Find its address. Most thermal printers print it on a self-test slip if you
   **hold the feed button while switching the printer on**.
3. In the app: **Printer** → connection **Direct ESC/POS — network** → type the
   address → **Save**. Or press **Find printers**, which tries port 9100 across
   the local network and lists what answers.
4. **Print test invoice.**

**Give the printer a fixed address** in the router's settings (a "DHCP
reservation"). If the router hands out addresses automatically, the printer's
can change when it restarts, and printing then fails with nothing visibly
wrong — the commonest cause of a network printer that "worked yesterday".

The address is stored separately from the USB/serial printer choice, so
switching between transports to test one does not lose the other.

### If printing fails

The invoice is **always saved** with a permanent number. Its print status shows
`FAILED`; every attempt is logged in `print_jobs`. Reprint from **Invoices** (or
the payment-success screen) once the printer is back. An invoice is only marked
`PRINTED` when the spooler accepts the job.

### Troubleshooting

| Symptom                                   | Fix                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| No printers listed                        | Cable in? Driver installed? Then **Refresh printers**                                 |
| "not installed right now"                 | The chosen printer has vanished from Windows — unplugged, or driver removed; re-pick  |
| Long blank strip after each receipt       | The driver is ignoring the page size → switch to **Direct ESC/POS**                   |
| Prints tiny / scaled                      | Same cause → **Direct ESC/POS**                                                       |
| Cuts off the right edge                   | Paper width set wrong — toggle 58 ↔ 80 mm                                             |
| Garbage characters in raw mode            | Printer is not ESC/POS (rare) → use driver mode                                       |
| Nothing prints, no error                  | Check the Windows print queue for a stuck job; clear it, power-cycle the printer      |
| Prints once, then stops                   | USB selective suspend — in Device Manager, untick "allow the computer to turn off…"    |

### Verifying the page geometry without a printer

`webContents.print` cannot be exercised on a machine with no printer, but the
identical measurement and page request can be pushed through Electron's PDF
pipeline. During development this confirmed one page at exactly the requested
length for 1-, 5- and 40-line receipts on both paper widths (e.g. a one-item
80 mm receipt: 80.1 × 177.8 mm, 1 page). Note that `printToPDF` takes the
page size in **inches** while `print` takes **microns** — an easy way to fool
yourself.

---

## 8a. Running on a Chromebook (Chrome OS)

Chrome OS cannot run Windows software. What it *can* run is Linux software,
inside a container it calls the **Linux development environment** (Crostini) —
and that is how this app runs there.

### First: can this Chromebook do it at all?

Open **Settings** and search for **Linux**.

- **"Linux development environment" is listed** → it will work. Turn it on
  (allow ~10 GB of disk) and continue below.
- **Not listed at all** → this Chromebook cannot run the app, and no change to
  the code can alter that. See *If Linux is unavailable*.

This is the honest floor: Linux support arrived in **Chrome OS 69** (2018) and
became dependable around **Chrome OS 80**. Chromebooks older than that, a few
low-end models that never received it, and **school or company-managed
Chromebooks where an administrator has blocked it**, cannot install it. On a
supported device the Chrome OS version otherwise does not matter — old and new
both work, because the app runs in its own container with its own libraries.

### Installing

1. Send the right package for the Chromebook's processor:
   - **`hashmi-ka-dera-pos_1.1.0_amd64.deb`** — Intel/AMD, most Chromebooks
   - **`hashmi-ka-dera-pos_1.1.0_arm64.deb`** — ARM (MediaTek, Snapdragon)

   Unsure? In the Linux terminal run `dpkg --print-architecture`.
2. Put the file in the **Linux files** folder in the Files app. That folder
   *is* the container's home directory, which is why it is the easy place to
   put it — anywhere else has to be shared with Linux first.
3. Open the **Terminal** app and install it:

   ```bash
   sudo apt update
   sudo apt install ./hashmi-ka-dera-pos_1.1.0_amd64.deb
   ```

   It appears in the launcher as *Hashmi Ka Dera POS*, or runs as
   `hashmi-ka-dera-pos`.

Two things about that command, both of which bite people:

- The leading **`./`** is required. Without it `apt` treats the argument as a
  package *name* to look up in the repositories and reports that it cannot
  find it, which reads like a broken file but is not.
- It needs **internet for this one step**. The package depends on nine system
  libraries (GTK, NSS, libsecret and friends) that Crostini does not ship, and
  `apt` fetches them. `sudo dpkg -i` is *not* a substitute: it does not
  resolve dependencies and will leave the package half-configured. If you have
  already run it and are stuck, `sudo apt --fix-broken install` recovers.

Older Chrome OS versions could install a `.deb` by double-clicking it in the
Files app. **Recent versions removed that**, and say *"Debian package installs
are no longer supported"*. The terminal command above is the supported route
and works on every version that has Linux at all — so use it regardless of
what the Files app offers.

Then set it up exactly as on any other machine: the first account created
becomes the admin (§5a).

### When the install fails

Two messages come up often enough to name, because neither means what it
sounds like.

**`Error: Unsupported file ./hashmi-ka-dera-pos_1.0.0_amd64.deb given on
commandline`**

This is not a complaint about the package. `apt` prints it when the path does
not resolve to an existing `.deb` — it never opened the file. The usual cause
is that the terminal's working directory is not where the file is: Terminal
starts in the Linux home directory, which is the **Linux files** folder, so a
download still sitting in Chrome OS **Downloads** is not there. Find it:

```bash
pwd
ls -l ~/*.deb
```

Then install it by the name `ls` actually printed. Watch for a browser or
Drive having renamed it (`…deb (1)`, `….deb.crdownload`) — quote the name if
it contains spaces. A file in Chrome OS Downloads can be reached at
`/mnt/chromeos/MyFiles/Downloads/` *if* that folder has been shared with
Linux, but moving it into Linux files is simpler.

**`Error: dpkg was interrupted, you must manually run 'sudo dpkg --configure
-a' to correct the problem.`**

An earlier attempt left dpkg's database half-finished, and `apt` refuses to
proceed until it is cleared. Do what it says, then install again:

```bash
sudo dpkg --configure -a
```

**`Unsatisfied dependencies:` listing packages this app has never heard of**
— `node-*`, or anything else unrelated to the nine libraries in `Depends`.

This is the container being broken *before* the POS was involved, usually by
Debian's Node packages or a third-party repository added earlier. `apt` will
not install anything at all while any package is in that state, so it fails
here despite having nothing to do with this package. Repair it, then install:

```bash
sudo apt --fix-broken install     # run twice; the second should do nothing
```

If it still cannot resolve them, remove the offending packages outright —
nothing in this app depends on them:

```bash
sudo apt remove --purge <the packages it named>
```

Worth knowing because the message arrives *before* `apt` has looked at the
architecture, so a container in this state hides a wrong-architecture package
behind an unrelated error.

**`package architecture (arm64) does not match system (amd64)`** — the wrong
one of the two packages. Check with `dpkg --print-architecture` and send the
matching file; the name in `Depends` is not the issue.

**If `apt` cannot reach the network**, install the dependencies from a machine
that can and use dpkg directly — this also side-steps `apt` argument handling
entirely:

```bash
sudo apt install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
  xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0
sudo dpkg -i ./hashmi-ka-dera-pos_1.1.0_amd64.deb
```

**To rule out a corrupted transfer**, compare the checksum against the build
machine (`shasum -a 256` on macOS, `sha256sum` on Linux). A truncated copy is
the one failure mode that genuinely is the file's fault, and `.deb` files this
large do get truncated by flaky USB sticks and cloud sync:

```bash
sha256sum ~/hashmi-ka-dera-pos_1.1.0_amd64.deb
```

### Uninstalling or upgrading

```bash
sudo apt remove hashmi-ka-dera-pos              # keeps the database
sudo apt install ./hashmi-ka-dera-pos_1.1.0_amd64.deb   # upgrade in place
```

Neither touches the data: the database lives in the user's config directory
(§5a), not in the installed package. Take a backup before upgrading anyway.

**Bump `version` in `package.json` for every build you hand to someone.** `apt`
compares versions and *silently does nothing* when the installed one already
matches — it reports "already the newest version" and exits 0, so a rebuilt
package with the same number looks installed and is not. This is worth stating
because it cost a real debugging session: a package with new code in it, built
under the old number, appeared to install and changed nothing.

To confirm which build is actually on a machine, read it out of the installed
app rather than trusting the version string:

```bash
dpkg -l hashmi-ka-dera-pos | tail -1                          # ii + version
grep -ac ESCPOS_NETWORK /opt/hashmi-ka-dera-pos/resources/app.asar   # 0 = pre-1.1.0
```

To force the same version in anyway:

```bash
sudo apt reinstall ./hashmi-ka-dera-pos_1.1.0_amd64.deb
```

Deleting the `.deb` does not uninstall anything — it is only the installer. The
app lives in `/opt/hashmi-ka-dera-pos`; remove it with `apt remove`.

### The printer on Chrome OS

This is the part that differs most, and it is why the app behaves differently
here.

Printers configured in Chrome OS itself are **invisible** inside the Linux
container, and that container ships with no print system whatsoever — `lp`
does not exist. The driver-based print path therefore cannot work on a
Chromebook at all.

What does work is direct ESC/POS, and the app defaults to it on Chrome OS. It
reaches the printer one of two ways there, and **which one depends on the
Chromebook**:

- Where the kernel creates `/dev/usb/lp0`, ESC/POS bytes written to that file
  *are* the protocol. The app lists the node and prefers it automatically.
- Where it does not — and on current Crostini it generally does not, because
  the kernel ships without `usblp` — the printer is reached through a CUPS raw
  queue instead. See *A USB printer on Chrome OS needs CUPS* below, which is
  the route verified on real hardware.

Try the steps immediately below first; if no node appears, that section is the
one to follow.

1. Plug the printer in and switch it on.
2. **Settings → About Chrome OS → Linux → Manage USB devices**, and turn the
   printer's switch on. (Chrome OS may also offer this in a notification when
   you plug it in.)
3. In the app: **Printer → Refresh printers**. It appears as
   `USB receipt printer (/dev/usb/lp0)`.
4. **Print test invoice.**

**If it says the printer needs permission**, the container user is not in the
`lp` group. Open the Linux terminal, run this once, then sign out of Chrome OS
and back in:

```bash
sudo usermod -aG lp $USER
```

The app detects this exact case and shows that command rather than a bare
"permission denied".

**If the USB printer never appears**, work through this in order — step 2 is
the one people miss:

```bash
lsusb | grep -i -E 'print|thermal|pos'   # is the printer visible at all?
ls -l /dev/usb/lp* /dev/lp*              # did the kernel create a node?
groups                                   # are you in the lp group?
```

1. Nothing from `lsusb` → the printer is not shared into the container. Redo
   *Manage USB devices*; if the toggle is missing, unplug and re-plug the
   printer and look for the Chrome OS notification.
2. `lsusb` shows it but there is no `/dev/usb/lp0` → the kernel's printer
   driver has not attached. `sudo modprobe usblp`, then re-plug. Some printers
   present as a vendor-specific device rather than a standard printer, and
   those produce no node at all — the network route below is the answer.
3. The node exists but is not writable → `sudo usermod -aG lp $USER`, then sign
   out of Chrome OS and back in.

#### A USB printer on Chrome OS needs CUPS, not a device node

This is the route that actually works on a Chromebook, confirmed on real
hardware with a Rongta 80Series2. It is worth reading before touching any
settings, because the obvious path is a dead end:

**Crostini's kernel has no `usblp` driver**, so `/dev/usb/lp0` will never
appear however the printer is shared. The app's simplest transport is therefore
unavailable on Chrome OS specifically. What does work is CUPS's USB backend,
which talks to the printer through user-space libusb and needs no kernel
driver — the app then prints to it as a raw queue, exactly as it does to any
other CUPS queue.

The order matters. Chrome OS's own print system **re-claims the device**, which
shows up as the USB-sharing toggle silently switching itself off again:

1. **Settings → Printing → Printers** — remove the printer, and any other entry
   matching it. While it is registered here, Chrome OS will not release it.
2. Unplug the printer.
3. **Settings → About Chrome OS → Linux → Manage USB devices** — toggle it on.
4. Plug it back in. If Chrome OS offers to set it up as a printer, **dismiss
   that** — accepting re-claims the device.
5. Restart the container: right-click **Terminal** → *Shut down Linux*, then
   reopen it. A toggle flipped while the container is running does not take
   effect until it restarts.
6. `lsusb` should now list the printer.

**The success signal is that Ctrl+P in Chrome can no longer find the printer.**
A USB device belongs to Chrome OS or to Linux, never both, so "it still prints
from Chrome" means the handover has not happened. This is the single most
confusing part of the process and is worth saying to anyone doing it.

Then install CUPS in the container and add the printer as a raw queue:

```bash
sudo apt update && sudo apt install -y cups cups-client
sudo usermod -aG lp,lpadmin $USER
sudo systemctl enable --now cups
# sign out of Chrome OS and back in, for the group change
sudo lpinfo -v | grep usb          # note: lpinfo lives in /usr/sbin, hence sudo
sudo lpadmin -p HKD -v "usb:///80Series2?serial=XXXX" -E
printf '\x1b@TEST\n\n\n\x1dVB\x00' | lp -d HKD -o raw
```

No `-m` on `lpadmin` is deliberate: a queue with no driver is a raw queue, which
is what ESC/POS wants. Then in the app choose **Direct ESC/POS — wired USB** and
select `HKD`.

**If `lpinfo -v` lists no `usb://` line**, check `/dev/bus/usb/` — the container's
udev sometimes fails to create the device node, and libusb cannot open what has
no node. `sudo /usr/lib/cups/backend/usb` reports how many devices libusb found;
a count that is short by one against `lsusb` is this exact fault. Restarting the
container (step 5) is the fix. The node can be created by hand as a last
resort — major 189, minor `(bus-1)*128 + (device-1)` — but one made that way
does not survive a re-plug or a restart, so it is a diagnostic, not a solution.

#### Bluetooth cannot work on Chrome OS

Not "is not set up yet" — **cannot**. Chrome OS keeps the Bluetooth adapter on
the host side and passes only *USB* devices into the Linux container. Inside
the container there is no adapter, `bluetoothd` is not running, and
`bluetoothctl` reports no controller. This is a boundary of the platform, not a
missing feature of this app, and no change to the code can move it. The app
detects the container and greys the option out with that explanation rather
than letting it be selected.

To confirm it on the machine itself:

```bash
bluetoothctl list     # prints nothing inside Crostini
ls /sys/class/bluetooth/   # empty
```

#### So for wireless on a Chromebook, use a network printer

A Wi-Fi or Ethernet thermal printer is the answer, and it is the *easiest*
setup of all four — the container has unrestricted network access, so it needs
no sharing, no permissions, no `usermod` and no root. Follow §8.3. This is the
recommendation for any Chromebook where the cable is inconvenient.

### Other Chrome OS notes

- **Graphics.** Chrome OS puts Linux apps on screen through a Wayland bridge
  rather than a real GPU stack, which leaves Electron's defaults showing a
  black or torn window. The app detects the container and switches to CPU
  compositing there — and only there, so a normal Linux PC keeps hardware
  acceleration.
- **Data** lives in `~/.config/hashmi-ka-dera-pos/data/` *inside the
  container*. Chrome OS's own Files app does not see it, so take backups
  through **Settings → Backup** and copy them into **Linux files**, which is
  shared with Chrome OS.
- **Screen size.** Chromebooks are often 1366×768. The layout is audited at
  that size and smaller.
- **Performance.** A 4 GB Chromebook runs this, but the container wants about
  1 GB of that. 8 GB is comfortable.

### If Linux is unavailable

If the Chromebook has no Linux option, the realistic choices are, in order of
sense:

1. **Use a cheap Windows mini-PC or laptop** for the till. The Windows
   installer already exists and is the best-tested path.
2. **Use a newer Chromebook** — anything from roughly 2019 onwards has Linux.
3. Rebuilding the app as a web or Android application would be a different
   product, not a setting: the entire design rests on an embedded database and
   direct printer access, neither of which a Chrome OS browser tab has.

### Building the Chrome OS packages

```bash
npm run build:chromeos       # both architectures, verified
npm run build:linux          # amd64 only
npm run build:linux:arm      # arm64 only
```

The `.deb` is **not** produced by electron-builder. Its bundled `fpm` shells
out to the host's `ar`, and on macOS that writes a BSD archive with a symbol
table instead of the GNU archive `dpkg` expects — emitting a 96-byte file
*and reporting success*, a failure that would surface only on the Chromebook.
`scripts/build-deb.mjs` writes the archive directly instead (no toolchain, same
bytes everywhere), and `scripts/verify-deb.mjs` reads the finished artifact
back with an independent parser, checking 25 things including that
`chrome-sandbox` is setuid root, that the desktop entry's `Exec` points at a
file that is actually in the package, and that every `md5sums` entry matches
its bytes. Both build scripts run the verifier and fail if it does.

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
    printer/          PrinterAdapter interface + four transports (driver, raw
                      USB, Bluetooth serial, network 9100) + mode availability
                      + thermal logo conversion + invoice render
    ipc/              channel manifest → handler map → single ipcMain.handle
  preload/            contextBridge: builds typed window.api over one IPC channel
  shared/             types, IPC contract, time & money helpers, seed menu data
  renderer/           React app (POS, admin, employee screens, design system)
resources/
  menu-images/        bundled menu photography + sources.json + manifest.json
  brand/              the logo printed on invoices (colour source)
scripts/              build-menu-images, build-deb + verify-deb (Chrome OS),
                      smoke driver, layout/accessibility audit
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
