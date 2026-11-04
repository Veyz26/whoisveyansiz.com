"""SQLite storage, multi-household. Every row of personal data carries a household_id and
every query is scoped by it. The file is created with owner-only permissions."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "budget.db"
SCHEMA_VERSION = 2

SCHEMA = """
-- Accounts, access and compliance ------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name            TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at   TEXT,
    failed_logins   INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT
);

CREATE TABLE IF NOT EXISTS households (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    plan                TEXT NOT NULL DEFAULT 'household',
    subscription_status TEXT NOT NULL DEFAULT 'trialing'
                        CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'cancelled')),
    trial_ends_on       TEXT,
    paid_until          TEXT,
    retention_months    INTEGER NOT NULL DEFAULT 36 CHECK (retention_months BETWEEN 6 AND 120),
    is_demo             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS memberships (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('owner', 'partner')),
    PRIMARY KEY (user_id, household_id)
);

CREATE TABLE IF NOT EXISTS invites (
    token_hash      TEXT PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL,
    used_at         TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash      TEXT PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    csrf_token      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL,      -- 'service', 'ai_categorisation', 'product_updates'
    version     TEXT NOT NULL,
    granted     INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER REFERENCES households(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    detail          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_household ON audit_log (household_id, created_at);

CREATE TABLE IF NOT EXISTS api_tokens (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE,
    prefix          TEXT NOT NULL,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at    TEXT,
    revoked_at      TEXT
);

-- People in the budget (not necessarily app users) ------------------------------------
CREATE TABLE IF NOT EXISTS members (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sort            INTEGER NOT NULL DEFAULT 0
);

-- Monthly budget plan --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_lines (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,  -- who pays / earns
    to_member_id    INTEGER REFERENCES members(id) ON DELETE CASCADE,           -- transfers only
    kind            TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'saving', 'transfer')),
    section         TEXT NOT NULL DEFAULT 'Monthly',
    name            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'Other',
    is_debit_order  INTEGER NOT NULL DEFAULT 0,
    flexibility     TEXT NOT NULL DEFAULT 'fixed' CHECK (flexibility IN ('fixed', 'reducible', 'discretionary')),
    notes           TEXT,
    goal_id         INTEGER REFERENCES goals(id) ON DELETE SET NULL,          -- saving lines: which goal they fund
    start_month     TEXT NOT NULL,          -- YYYY-MM
    end_month       TEXT,                   -- last month it applies, NULL = ongoing
    sort            INTEGER NOT NULL DEFAULT 0,
    source          TEXT,                   -- 'statements' when drafted from statements (and not edited since)
    draft_key       TEXT,                   -- what it was drafted from (PHP's draft_from_statements), kept after edits
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_lines_household ON budget_lines (household_id);

-- Amount history: the amount for month M is the row with the latest effective_month <= M.
CREATE TABLE IF NOT EXISTS budget_amounts (
    line_id         INTEGER NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
    effective_month TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (line_id, effective_month)
);

CREATE TABLE IF NOT EXISTS line_status (
    line_id         INTEGER NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
    month           TEXT NOT NULL,
    paid            INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (line_id, month)
);

CREATE TABLE IF NOT EXISTS goals (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,  -- NULL = shared goal
    name            TEXT NOT NULL,
    target_cents    INTEGER NOT NULL CHECK (target_cents > 0),
    saved_cents     INTEGER NOT NULL DEFAULT 0 CHECK (saved_cents >= 0),
    target_month    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bank statements ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,  -- NULL = joint
    bank            TEXT NOT NULL CHECK (bank IN ('fnb', 'capitec')),
    label           TEXT NOT NULL,
    last4           TEXT,               -- never the full account number
    kind            TEXT NOT NULL DEFAULT 'transactional',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (household_id, bank, label)
);

CREATE TABLE IF NOT EXISTS imports (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    filename        TEXT,
    imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
    rows_total      INTEGER NOT NULL,
    rows_added      INTEGER NOT NULL,
    rows_duplicate  INTEGER NOT NULL,
    period_from     TEXT,                   -- dates this statement covers (YYYY-MM-DD)
    period_to       TEXT
);

-- household_id 0 = built-in rules shared by everyone.
CREATE TABLE IF NOT EXISTS rules (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL DEFAULT 0,
    pattern         TEXT NOT NULL,
    match           TEXT NOT NULL DEFAULT 'word' CHECK (match IN ('word', 'regex')),
    direction       TEXT NOT NULL DEFAULT 'any' CHECK (direction IN ('any', 'in', 'out')),
    category        TEXT NOT NULL,
    priority        INTEGER NOT NULL DEFAULT 100,
    source          TEXT NOT NULL CHECK (source IN ('builtin', 'user', 'llm')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (household_id, pattern, match, direction)
);

CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    import_id       INTEGER REFERENCES imports(id) ON DELETE SET NULL,
    posted_on       TEXT NOT NULL,
    description     TEXT NOT NULL,          -- sanitised: long digit runs masked
    merchant        TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL,       -- negative = money out
    balance_cents   INTEGER,
    bank_category   TEXT,
    category        TEXT NOT NULL DEFAULT 'Other',
    category_source TEXT NOT NULL DEFAULT 'none'
                    CHECK (category_source IN ('none', 'rule', 'llm', 'bank', 'user')),
    rule_id         INTEGER REFERENCES rules(id) ON DELETE SET NULL,
    is_transfer     INTEGER NOT NULL DEFAULT 0,
    fingerprint     TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_txn_household_date ON transactions (household_id, posted_on);
CREATE INDEX IF NOT EXISTS ix_txn_merchant ON transactions (household_id, merchant);
CREATE INDEX IF NOT EXISTS ix_txn_amount ON transactions (household_id, amount_cents, posted_on);

CREATE TABLE IF NOT EXISTS debts (
    id                  INTEGER PRIMARY KEY,
    household_id        INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id           INTEGER REFERENCES members(id) ON DELETE SET NULL,
    name                TEXT NOT NULL,
    balance_cents       INTEGER NOT NULL CHECK (balance_cents >= 0),
    apr_bp              INTEGER NOT NULL CHECK (apr_bp >= 0),
    min_payment_cents   INTEGER NOT NULL CHECK (min_payment_cents >= 0),
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def db_path() -> Path:
    return Path(os.environ.get("BUDGET_DB", DEFAULT_DB))


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(path) if path else db_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(mode=0o600)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version not in (0, SCHEMA_VERSION):
        raise RuntimeError(
            f"{path} was created by an older version of the app (schema v{version}). "
            "Move it aside to start fresh."
        )
    if version == 0 and conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'transactions'").fetchone():
        raise RuntimeError(f"{path} was created by the single-user prototype. Move it aside to start fresh.")
    if version == 0:
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        from .categorise import seed_builtin_rules  # avoid import cycle

        seed_builtin_rules(conn)
    return conn


def audit(conn: sqlite3.Connection, household_id: int | None, user_id: int | None, action: str,
          detail: str | None = None) -> None:
    conn.execute("INSERT INTO audit_log (household_id, user_id, action, detail) VALUES (?, ?, ?, ?)",
                 (household_id, user_id, action, detail))
