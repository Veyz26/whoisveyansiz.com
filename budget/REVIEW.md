# Specialist review: November 2026

Three independent reviews of the private budget app: **QA/testing**, **SRE/operations** and **personal
finance (South Africa)**. Everything was tested on throwaway databases. Findings marked ✅ were reproduced
a second time before going on this list.

**Overall:** the core is sound.
- Every sheet in the real workbook imports to exactly the workbook's own totals.
- The debt maths matches an independent amortisation.
- Tenant isolation, CSRF, XSS escaping and the passkey checks all held under attack.
- The security headers, cookies and access blocks were verified on real Apache.

**Status (2 November 2026):** Tiers 1 and 2 are fixed and retested. All suites pass: PHP (96 checks),
Python reference (31 tests), PHP/Python parity (0 differences on the demo data and the real workbook),
end-to-end HTTP and concurrency. Tiers 3 and 4 are open, apart from the two Tier 3 items marked done.

---

## Tier 1: blockers (fix before go-live)

**Fixed.** Each fix below was retested, with the test named in the Fix column.

| # | Finding | Source | Fix |
|---|---|---|---|
| 1 ✅ | **A fresh database breaks permanently if two requests arrive at once.** 11 of 12 parallel first requests return 500, the schema is left half-migrated, and every later request fails. | SRE C1 | Initialise and migrate inside one `BEGIN IMMEDIATE` transaction, re-reading `user_version` under the lock (patch tested: 12/12 OK). |
| 2 | **Simultaneous edits fail with "database is locked".** 4 of 12 parallel writes return 500; writes during an import fail within milliseconds. | SRE H1 | `Conn::tx` uses `BEGIN IMMEDIATE`, so writers wait for the 10 s busy timeout (tested: 12/12 OK). |
| 3 ✅ | **Anyone can sign up with an allow-listed email that hasn't been used yet.** No proof of owning the address, and they join the household; if they're first, they become the owner. | QA 2 | A one-time **setup code per email** in `config.php`, required at sign-up (or an owner-issued invite for the second person). |
| 4 ✅ | **Two-digit-year dates are misread.** `01 Oct 26` is stored as year 0026 and `15/10/26` as 0015-10-26. The import says success, then the retention job silently deletes those rows. | QA 1 | Strict 4-digit `Y`; try `y` formats first; reject years outside 2000–next year. |
| 5 ✅ | **Goals suggest halving debt repayments and medication.** Unrecognised items default to "discretionary", so cuts are offered on the car instalment, a credit-card repayment and "Tiara Monthly" (meds and tithes). The **Apply** button writes them into the budget. | Finance 1 | Default `Other` to fixed. Never offer cuts on debt, insurance, medical, giving, housing or debit orders. Warn before Apply. |
| 6 | **No backups.** `linen.db` is the only copy. | SRE H2 | `budget-private/backup.php` run by an hPanel cron: `VACUUM INTO` → integrity check → keep 14 → chmod 600 (tested, including a restore drill). |
| 7 | **Errors leak or vanish.** PHP warnings with server paths reach responses; a public `error_log` file is readable; a missing or bad config gives a blank 500. | SRE M3, QA 11 | `display_errors` off and logging outside the web root; a JSON 503 for config errors; deny `error_log`; `GET /api/health`. |

## Tier 2: wrong numbers or broken flows

**Fixed.** Items 17 and 18 were checked on Apache only; recheck them on Hostinger after the first
deploy (the README's post-deploy checks cover both). For item 19, every page and tab now fits a 375 px
screen; the last two overflows were a long Power BI feed URL and the file picker.

| # | Finding | Source | Fix |
|---|---|---|---|
| 8 ✅ | **The workbook import invents surpluses in the months between sheets** (e.g. Dec 2025 +R20,850 against about R1,000 on the sheets either side), because renamed items end early. | Finance 2 | End missing items the month before the next sheet; offer "match renamed items" in the preview. |
| 9 | **Later sheets never update a line's section, debit-order flag or category** ("Car" stays not-a-debit-order). | Finance 3 | Update classification from each later sheet. |
| 10 ✅ | **Re-importing a workbook duplicates every line.** | QA 5 | Match by person and name; make it idempotent. |
| 11 ✅ | **Goals double-count money.** Shared goals use the household surplus *and* personal goals use each person's (R3,269 allocated against R1,669 spare). Cuts and fee savings are counted for every goal. An overdue deadline takes the whole pool. Budgeted saving lines aren't linked to goals. | Finance 4–7, QA 4 | Allocate personal pools first and the shared pool from the remainder. Show cuts once, at page level. Mark overdue goals "past its date". Add `goal_id` to saving lines. |
| 12 ✅ | **"From then on" changes don't stick over an earlier "that month only" change** (rent reverts the next month). Changes made before a line's start month spread wrongly. | Finance 13–14, QA 3 | Remove the "back to usual" row on onward changes; handle months before the start. |
| 13 ✅ | **The debt planner reports nonsense when a minimum doesn't cover interest** ("saves R142 million"). | Finance 10 | Detect it and say "your minimum doesn't cover the interest"; suppress savings figures. |
| 14 | **The advice names the wrong debt** (the first to be paid off, not the one receiving the extra money). | Finance 8 | Return and use the strategy's actual target. |
| 15 | **Huge or odd numbers cause permanent 500s** (amounts ≥ 9e18, 1e30). Type-confused fields give 500s. Deep CBOR nesting can crash a worker. | QA 8, 11, 12 | Validate types and ranges in one helper (0–R1 billion); CBOR depth and size limits. |
| 16 | **No visible "not financial advice" note in private mode**, and some wording reads as a personal product recommendation under FAIS ("Move R… to … tax-free savings"). | Finance 9 | App-wide footer disclaimer; reword the debt and savings actions; "advice" → "budgeting guidance" in the notice. |
| 17 | **The portfolio's "cache for a year" rule leaks into `/private/app.js` and `sw.js`**: double Cache-Control headers. A CDN could serve old code after a deploy. | SRE H3 | Override in `private/.htaccess` (snippet verified on Apache). |
| 18 | **Face ID fails on `www.whoisveyansiz.com`** (passkeys are tied to one host). | SRE M4, QA | `www` → apex redirect in both `.htaccess` files. |
| 19 | **Pages overflow sideways on iPhone** (Debts, Reports, Settings → Privacy at 375 px). | QA 9 | `minmax(0,1fr)` grid; wrap tables. |
| 20 | **Statements imported without an account label merge across people**; the last importer takes all of them. | QA 10 | Never silently reassign an account; include the person in the default label. |
| 21 | **Transfer and saving changes get the wrong tone in insights** (e.g. a partner's transfer change is shown as a household warning). | Finance 15 | Skip transfers at household level; treat a savings increase as positive. |

## Tier 3: performance, operations and hardening

- **Imports:**
  - Import time grows with history: 8.6–8.9 s for a tiny import once there are 25–41k transactions. Add an index on `(household_id, amount_cents, posted_on)` (measured 8.8 s → 0.4 s) and only match transfers for the new rows.
  - Large CSVs exhaust memory. Lower the upload cap to about 3 MB.
  - Lower the zip-bomb cap from 300 MB to about 30 MB.
- **`/api/actuals`:** about 1 s at 41k transactions. Use month ranges instead of `substr()`, memoise `months()`, and stop recomputing the summary.
- **Deploys:**
  - Move the old `private/` out before extracting.
  - Load an explicit file list in `bootstrap.php`.
  - Make the copy script fail if a `.htaccess` is missing.
  - Choose PHP **8.3 or 8.4** in hPanel (8.1 is end-of-life).
  - Document the `openssl` and `ctype` extensions.
- **Security events:** failed logins, refused SSO and passkey counter alerts are logged with no household, so the Activity log never shows them.
- **API tokens** survive a user's removal from the allowlist.
- **POPIA:**
  - The data export misses passkeys, import filenames and some columns.
  - Add `secure_delete`.
  - Mention backups in the retention wording.
  - Add a specific consent for special personal information (health, religion).
- **Timezone (done):** set `Africa/Johannesburg`. Otherwise the 1st of the month shows the previous month until 02:00.
- **Statement parsing:**
  - A bad balance cell rejects the whole file.
  - `-1.234,56` is misread.
  - A semicolon CSV with commas inside descriptions fails.
  - Quoted quotes are lost.
  - Capitec "Amount + Fee" exports are detected as FNB.
  - Windows-1252 accents are lost in the browser before upload.
- **Categorisation:**
  - The generic `FEE` rule turns school, gym and licence fees into bank fees.
  - "INTEREST FREE" is counted as interest.
  - Add the SA rules the finance review listed (vehicle and credit lines, insurers, medical schemes, school fees, household help).
- **Small API issues:**
  - `PATCH` on a goal resets omitted fields.
  - `"false"` strings are treated as true.
  - `%` in search matches everything.
  - The transaction list silently stops at 1,000 rows.
  - Members can be renamed by a partner.
  - DELETE on unknown ids returns 200.
- **Service worker:** stamp a build version into the cache name, and add a ~3 s network timeout before falling back offline.
- **Tests (done):** `Config::set()` leaves temp config files behind.

## Tier 4: worth adding (finance review, by value)

1. **Pay and debit-order dates within the month:** flag debit orders that run before payday.
2. **Shared pot / joint account:** e.g. "Tiara to Shared Savings".
3. **Emergency-fund guidance:** months of essentials covered, aiming for 3–6.
4. **Sinking funds for annual costs:** licence, insurance excess, December, the medical-aid increase in January.
5. **Salary increases, bonus or 13th cheque, and annual escalations** in the projection.
6. **Tax-free savings tracker per person:** R36,000 a year and R500,000 lifetime; plus a retirement annuity tracker.
7. **Credit-card minimums as a % of the balance; vehicle balloon payments; overdrafts.**
8. **Net worth and a debt-to-income ratio** (with signposting to an NCR debt counsellor).

## Couldn't be tested without the real thing

- **LiteSpeed (Hostinger):** `.htaccess` behaviour. Real Apache was tested.
- **iPhone:** Face ID and PWA install/update.
- **Microsoft sign-in.**
- **PHP 8.1–8.4 at runtime:** checked statically and run on 8.5.
- **Hostinger's PHP defaults.**

The post-deploy checklist in the SRE runbook covers these on day one.
