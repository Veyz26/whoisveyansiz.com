# Private budget app (`/private/`)

The household budget app (**KAVE Budget**), served at **whoisveyansiz.com/private/**. You sign
in with **Face ID or Touch ID** (passkeys). Only email addresses on an allowlist can get in. It's a PHP port of the current
Python version, so it runs on the existing Hostinger shared plan with no extra hosting.

Features: per-person and combined monthly budgets, debit-order change history, a next-month forecast
with insights, goals with suggested cuts, FNB/Capitec statement import, a debt planner, Excel
workbook import, a Power BI export and live feed, and POPIA tools (export, delete, retention, activity log).

## Folder layout

| Path | What it is | Deployed? |
|---|---|---|
| `public/` | Page, styles and script (`index.html`, `app.js`, `style.css`), `.htaccess`, and the PHP front controller `index.php` | → `public_html/private/` |
| `src/` | PHP application (one class per area; mirrors the Python modules) | → `public_html/private/app/` (blocked to browsers) |
| `dev/` | Local dev server, demo seeder, example config, rules generator | no |
| `tests/` | PHP tests, Python↔PHP parity test, HTTP end-to-end test, sample statements | no |
| `python-reference/` | The original Python version: the reference implementation and test oracle | no |

`npm run build` (in the site root) builds the portfolio and then copies `public/` and `src/` into
`out/private/`, so deploying the site deploys the app.

## Local development

Requires PHP 8.1+ (8.3 or 8.4 recommended) with `pdo_sqlite`, `openssl`, `mbstring`, `zip`, `simplexml`,
`ctype` and `curl` (Homebrew's `php` has them). `GET /private/api/health` lists any that are missing.

```bash
cp budget/dev/config.example.php budget/dev/config.php   # once; edit the allowlist
BUDGET_CONFIG=budget/dev/config.php php budget/dev/seed-demo.php --reset   # optional demo data
npm run budget:dev                                        # http://localhost:8766/private/
```

Tests:

```bash
php budget/tests/run.php                          # private mode, allowlist, Microsoft token checks, security
python3 budget/tests/parity.py [workbook.xlsx]    # PHP and Python give identical results
python3 budget/tests/e2e_http.py [workbook.xlsx]  # full HTTP run against the dev server (reset the dev DB first)
python3 budget/tests/concurrency.py              # simultaneous first requests and writes on a fresh database
```

Change the business logic in `python-reference/` first, then port it, then run the parity test.
`src/RuleData.php` is generated from the Python rules by `python3 budget/dev/gen_rules.py`.

## Deploying to Hostinger

### 1. Create the private config (once)

In hPanel → **File Manager**, next to `public_html` (in `domains/whoisveyansiz.com/`), create a folder
`budget-private` and a file `config.php` in it:

```php
<?php
return [
    'allowed_emails' => ['your-email@…', 'tiara-email@…'],   // who can get in
    'setup_codes' => [                                        // one-time codes to create each account
        'your-email@…'  => '…',
        'tiara-email@…' => '…',
    ],
    'public_url' => 'https://whoisveyansiz.com/private',     // passkeys are tied to this domain
];
```

A setup code can be a random code or a passphrase (the app calls it a "setup phrase"), with at least
6 letters or numbers: capitals, spaces and dashes are ignored, so `Our KAVE home` and `ourkavehome`
match. A random one is safer, for example the output of `php -r 'echo bin2hex(random_bytes(6)), PHP_EOL;'`;
an easy phrase only matters until both accounts exist. Being on the allowlist isn't enough to create an
account; you also need the code for your email (you can both use the same one). Give Tiara hers in person or in a message, not by email to the
same address. Once both accounts exist, you can delete `setup_codes` from the file.

The database (`linen.db`) is created in the same folder on first use. Both files stay **outside
`public_html`**, so they can never be downloaded. Anything you leave out of the config uses a safe default:

| Setting | Default |
|---|---|
| `require_passkey` | `true` |
| `timezone` | `Africa/Johannesburg` |
| password sign-in | on, for first-time setup and recovery |
| private mode | on |
| secure cookies | on |
| demo | off |

Microsoft sign-in is optional and off unless you add a `microsoft` block (see `dev/config.example.php`).

### 2. Deploy

1. In hPanel → **Advanced → PHP Configuration**, pick **PHP 8.3 or 8.4** (8.1 is the minimum).
2. If Hostinger deploys from GitHub (Option B in the site README), merging into `main` publishes the app;
   skip to step 4. Otherwise run `npm run build`, then zip from the command line so the dotfiles come along:
   `cd out && zip -r ../site.zip . && cd ..`
3. In File Manager, move the old `public_html/private/` folder out of `public_html` (keep it until the new
   version checks out), upload `site.zip` to `public_html` and extract it. Make sure
   `public_html/private/.htaccess` and `public_html/private/app/.htaccess` arrived; File Manager hides
   dotfiles by default.
4. Open `https://whoisveyansiz.com/private/` on your iPhone. Tap **Set up your account**, enter your
   email, a password and your setup code, then tap **Add Face ID**. Save the 10 recovery codes it shows, for example in
   the Passwords app. From then on, tap **Sign in with Face ID**; the passkey syncs to your Mac (Touch ID)
   through iCloud Keychain.
5. Tiara does the same on her phone, with her own setup code. The first person to sign up becomes the
   owner; the next one joins the same household automatically.
6. In **Settings → Import Excel**, upload your budget workbook and map “Veyz” and “T” to the two people.

To check it worked:
- `https://whoisveyansiz.com/private/api/health` must show `"ok": true` and `"schema": 4`.
- `https://whoisveyansiz.com/private/app/Auth.php` must return **403**.
- `https://whoisveyansiz.com/private/api/me` must return **401** when you're signed out.
- `https://www.whoisveyansiz.com/private/` must redirect to `https://whoisveyansiz.com/private/`
  (Face ID passkeys only work on the one host).
- Hard-refresh the app once: the browser's dev tools should show `Cache-Control: no-cache` on `app.js`.

When all of that passes, delete the old `private/` folder you moved aside.

### 3. Backups (once)

1. Copy `budget/ops/backup.php` into `budget-private/`, next to `config.php`.
2. In hPanel → **Advanced → Cron Jobs**, add a daily job:
   `/usr/bin/php /home/<user>/domains/whoisveyansiz.com/budget-private/backup.php`
3. Run it once by hand from the same screen and check that `budget-private/backups/` now has a
   `linen-….db` file.

Each run takes a consistent snapshot while the app is in use, checks it, and keeps the newest 14
(set `backup_keep` in the config to change that). Hostinger's own backups are a second copy; download a
snapshot to your Mac now and then for a third.

**Restore:** in File Manager, rename `linen.db` to `linen-broken.db` and delete any `linen.db-wal` and
`linen.db-shm` next to it. Copy the snapshot you want to `linen.db`, then open `/private/api/health` to
check it.

## On your iPhones (home-screen app)

It's a PWA (progressive web app), so it installs from Safari. No App Store is involved.

1. Open `https://whoisveyansiz.com/private/` in **Safari**. Tap **Share**, then **Add to Home Screen**. A
   small hint appears the first time.
2. Open **Budget** from the Home Screen. It runs full-screen with the cream status bar, an iPhone tab bar
   (Overview · Budget · Next · Goals · More) and bottom sheets for editing.
3. Sign in once inside the app (iOS keeps home-screen apps' sign-ins separate from Safari). From then on
   it's **Sign in with Face ID**.

Details:
- **Offline:** the service worker (`public/sw.js`) caches only the app's own files (page, script,
  styles, icons). Budget data is never cached on the phone. Offline, the app shows a "No connection"
  screen.
- **Reopening:** when you come back to the app after a couple of minutes, it refreshes the numbers.
- **iPhone touches:**
  - Amount fields open the decimal keypad.
  - Inputs don't trigger the iOS zoom.
  - Phone-number detection is off, so amounts aren't turned into call links.
  - Layouts respect the notch and the home indicator.
- **Icons:** in `public/icons/`. To change the design, edit `icon.svg` and re-export the PNGs (180, 192,
  512).
- **3D:** `public/scene3d.js` draws the glass jars on Overview (one per person: height is money in,
  layers are Essentials, Lifestyle, Savings and Transfers, clear glass is what's left) and the floating
  coins behind the sign-in screens. It loads three.js from `public/vendor/three/` (copied from the
  site's `node_modules/three`, MIT licence alongside) only on those screens, because the app's security
  policy allows scripts from its own domain only. Scenes pause when off screen or in the background,
  hold still with Reduce Motion on, and fall back to the regular cards where WebGL isn't available.
  Jar colours are the `--jar-*` tokens in `style.css` (separate light and dark sets, checked for
  colour-blind separation).

## Security and POPIA notes

- **Access:** the allowlist is checked at every sign-in and on every request, so removing an email locks
  that person out at once.
- **MFA with passkeys (Face ID / Touch ID, WebAuthn):**
  - Signing in needs your device plus your face or device PIN.
  - Passkeys are phishing-resistant: they only work on whoisveyansiz.com.
  - The server checks the challenge, origin, domain, user verification, signature and counter. Only
    public keys are stored.
  - Until someone has added a passkey they can't see anything except the setup screen.
  - Once a passkey exists, a password alone no longer works; it also needs one of 10 single-use,
    hashed recovery codes.
  - Manage passkeys and recovery codes in **Settings → Security**.
  - Tested with a software authenticator (`tests/FakeAuthenticator.php`). Check on a real iPhone after
    deploying.
- **Microsoft sign-in (optional):** accounts are bound to their immutable tenant + object id on first
  sign-in.
- **Microsoft sign-in protections:** it uses the authorization-code flow with PKCE, state, nonce and a
  browser-binding cookie. Work and school accounts from other organisations are refused unless their
  email domain is verified or the tenant is listed in `trusted_tenants` (protection against “nOAuth”).
- **Session cookies:** HttpOnly, Secure and SameSite=Strict, scoped to `/private/`. Changes also need a
  CSRF token.
- **Throttling:** sign-in attempts are rate-limited, and accounts lock after 5 failed passwords.
- **Data:**
  - Card and account numbers are masked to the last 4 digits before storage.
  - Statement lines are deleted after the retention period.
  - Export and delete are self-service.
- **Search engines:** the private area sends `noindex` and is disallowed in `robots.txt`.
- **Not ported from the Python version:** AI category suggestions (it needed the Anthropic SDK and an API
  key). Categorising by rules and remembering your corrections work as before.
- **Before selling this to others:** switch `private_mode` off and add payments, email, a lawyer-reviewed
  privacy notice and an Information Officer registration (see `python-reference/README.md`).
