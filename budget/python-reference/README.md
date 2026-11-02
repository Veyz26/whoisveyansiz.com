# Linen — household budgeting for South African couples

*(“Linen” is a placeholder product name.)*

A subscription web app for households with more than one income. Each person has their own
salary, debit orders, monthly items and savings, and everything also rolls up into a
household view. It replaces the one-sheet-per-month Excel budget: amounts carry forward,
changes are recorded from the month they start, and next month is projected automatically.

Python 3.10+ standard library only. No bank logins, no scraping.

## Run it

```bash
python3 run.py --demo      # fictional household (Alex & Sam), resets on every start
python3 run.py             # real use: sign up at http://localhost:8765
python3 -m unittest discover tests
```

To bring in an existing Excel budget: Settings → Import Excel. It reads workbooks with one
sheet per month (named like “March 26”), each with a “<Name> Salary” row and items underneath,
and turns the differences between sheets into dated changes.

## Features

| Area | What it does |
|---|---|
| Monthly budget | One column per person, grouped by section (Debit orders, Monthly, Personal, Savings). Tick items off as paid. Transfers between partners show on both sides and cancel out in the household total. |
| Debit orders | Every debit order with its change vs last month, change over 12 months, history and upcoming changes. “Update” records an increase or decrease from a given month, either ongoing or for one month only. |
| Next month | Projection with insights: what changes, what ends (freeing money), who'll be short and whether the partner can cover it, debit orders creeping up, overspending against statements, and the 50/30/20 balance. Includes a six-month chart. |
| Goals | Months to reach each goal, the monthly amount needed for a deadline, and specific cuts from items marked reducible or discretionary (never fixed commitments). Cuts can be applied in one click. Includes a what-if slider. Spare money is shared across goals so the same rand isn't counted twice. |
| Statements | FNB and Capitec CSV import per person, de-duplication, auto-categorisation with learnable rules, optional AI suggestions (opt-in), spending vs plan, fees and recurring payments. |
| Debt plan | Avalanche vs snowball vs minimum payments, with interest saved. |
| Reports & Power BI | A ZIP star schema (dimensions for people, categories and months; facts for budget, transactions, goals and debts) plus a README with relationships and DAX measures. A token-protected live CSV feed for scheduled refresh in the Power BI service, with a Power Query template. |

## Selling it as a service

### Already built
- Accounts with sign-up, sign-in, invite links for a partner, and owner/partner roles.
- Multi-tenant data model: every row carries `household_id`, the household always comes from the session, and tests check that one household can't read or change another's data.
- 30-day trial, plans and a read-only state when a plan lapses (export and delete still work). Prices are placeholders in [budget_app/billing.py](budget_app/billing.py).
- Security:
  - Passwords hashed with scrypt.
  - Session, invite and API tokens are stored only as hashes.
  - Session cookies are HttpOnly and SameSite=Strict.
  - CSRF token on every change.
  - Login throttling and account lockout.
  - Strict Content-Security-Policy and other security headers, plus a host allow-list.
  - Idle and absolute session expiry.
  - Spreadsheet-formula injection is neutralised in exports.

### POPIA (Protection of Personal Information Act)
- **Consent:** a required consent at sign-up for processing, recorded with the privacy-notice version, plus separate opt-ins for AI (a cross-border transfer to Anthropic, USA) and marketing. Consents can be withdrawn in Settings.
- **Minimality:** card and account numbers are reduced to the last 4 digits before storage. The AI feature only receives merchant names.
- **Rights:** a self-service download of all data (access, s23), editing of every record (correction, s24), and a hard delete of the household (deletion, s24), which removes logins and runs a database VACUUM.
- **Retention:** statement lines are deleted after a per-household retention period (default 36 months) by a daily job.
- **Accountability:** an activity log covering sign-ins, consent changes, imports, exports, tokens and amount changes.
- **Special personal information:** a draft privacy notice ([web/app.js](web/app.js) → `privacyPage`) that addresses budget lines revealing health or religion (medication, tithes).

### Still needed before taking payments (business, legal and infrastructure)
1. **Payments:** integrate PayFast or Paystack at `billing.activate()` from a verified webhook, then remove the test-mode button (set `BUDGET_ENV=production`).
2. **Hosting:**
   - Run behind HTTPS (Caddy or nginx) with `BUDGET_SECURE_COOKIES=1`, `BUDGET_ALLOWED_HOSTS` and `BUDGET_PUBLIC_URL`.
   - Use a South African region (for example AWS Cape Town) or document the cross-border basis (s72).
   - Encrypt disks and backups at rest.
3. **Scale:** SQLite and the stdlib server are fine for early customers. Move to PostgreSQL and a production WSGI/ASGI server as usage grows; the domain modules don't depend on the web layer.
4. **Legal:**
   - Register an Information Officer with the Information Regulator.
   - Have a lawyer review the privacy notice and terms of service.
   - Sign operator agreements (s21) with the host, payment provider and Anthropic.
   - Write a PAIA manual and a security-breach notification procedure (s22).
5. **Email:** verification, password reset and invites by email (invites are copy-paste links today).
6. **Before launch:** an independent penetration test.

## Code map

`budget_app/`:

| Module | Responsibility |
|---|---|
| `budget.py` | Budget lines and amount history |
| `forecast.py` | Next-month projection and insights |
| `goals.py` | Goal plans and suggested cuts |
| `xlsx_import.py` | Excel workbook import |
| `auth.py` | Accounts, sessions, invites, consents, API tokens |
| `privacy.py` | POPIA export, delete and retention |
| `billing.py` | Plans and subscription gating |
| `export.py` | Power BI export |
| `parsers/`, `importer.py`, `categorise.py`, `analysis.py`, `advice.py` | Bank statements |
| `debt.py` | Debt payoff planner |
| `server.py` | HTTP API and security |
| `demo.py` | Demo household |

`web/` holds the UI: vanilla JS with no build step, a cream, pearl and linen palette, a colour-blind-safe slate and clay pair for the two partners, and light and dark modes.
