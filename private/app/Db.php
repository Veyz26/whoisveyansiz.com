<?php
/**
 * SQLite storage, multi-household. Every row of personal data carries a household_id and every
 * query is scoped by it. Keep the database file OUTSIDE public_html (see README → Deploy).
 * SQL avoids RETURNING / window functions so older SQLite builds on shared hosting work.
 */
declare(strict_types=1);

namespace Linen;

use PDO;

final class Db
{
    public const SCHEMA_VERSION = 7;

    /** Schema changes after the first release, applied in order to existing databases. */
    public const MIGRATIONS = [
        3 => <<<'SQL'
ALTER TABLE users ADD COLUMN webauthn_handle TEXT;
CREATE TABLE IF NOT EXISTS passkeys (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id   TEXT NOT NULL UNIQUE,       -- base64url
    public_key_pem  TEXT NOT NULL,
    alg             INTEGER NOT NULL,           -- COSE: -7 ES256, -257 RS256
    sign_count      INTEGER NOT NULL DEFAULT 0,
    transports      TEXT,
    name            TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at    TEXT
);
CREATE TABLE IF NOT EXISTS recovery_codes (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash       TEXT NOT NULL,
    used_at         TEXT
);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    challenge_hash  TEXT PRIMARY KEY,
    purpose         TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
SQL,
        4 => <<<'SQL'
ALTER TABLE budget_lines ADD COLUMN goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_txn_amount ON transactions (household_id, amount_cents, posted_on);
SQL,
        // Which dates each statement covers (so averages skip part-months), and budget items drafted from
        // statements (so they can be redrafted without touching items people added themselves).
        5 => <<<'SQL'
ALTER TABLE imports ADD COLUMN period_from TEXT;
ALTER TABLE imports ADD COLUMN period_to TEXT;
UPDATE imports SET period_from = (SELECT MIN(posted_on) FROM transactions t WHERE t.import_id = imports.id),
                   period_to = (SELECT MAX(posted_on) FROM transactions t WHERE t.import_id = imports.id);
ALTER TABLE budget_lines ADD COLUMN source TEXT;
ALTER TABLE budget_lines ADD COLUMN draft_key TEXT;
SQL,
        6 => <<<'SQL'
ALTER TABLE sessions ADD COLUMN device TEXT;
SQL,
        // Snapshots taken just before small deletes and category changes, so the toast's "Undo" can put them back.
        7 => <<<'SQL'
CREATE TABLE IF NOT EXISTS undo_items (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    kind            TEXT NOT NULL,
    payload         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
SQL,
    ];

    public const SCHEMA = <<<'SQL'
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name            TEXT NOT NULL,
    password_hash   TEXT,                   -- NULL for SSO-only accounts
    sso_provider    TEXT,
    sso_subject     TEXT,                   -- Microsoft tid:oid, immutable
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at   TEXT,
    failed_logins   INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT,
    UNIQUE (sso_provider, sso_subject)
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

CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash      TEXT PRIMARY KEY,
    binding_hash    TEXT NOT NULL,
    verifier        TEXT NOT NULL,
    nonce           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
    key             TEXT NOT NULL,
    at              REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_rate_limits ON rate_limits (key, at);

CREATE TABLE IF NOT EXISTS meta (
    key             TEXT PRIMARY KEY,
    value           TEXT
);

CREATE TABLE IF NOT EXISTS consents (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS members (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sort            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budget_lines (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    to_member_id    INTEGER REFERENCES members(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'saving', 'transfer')),
    section         TEXT NOT NULL DEFAULT 'Monthly',
    name            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'Other',
    is_debit_order  INTEGER NOT NULL DEFAULT 0,
    flexibility     TEXT NOT NULL DEFAULT 'fixed' CHECK (flexibility IN ('fixed', 'reducible', 'discretionary')),
    notes           TEXT,
    start_month     TEXT NOT NULL,
    end_month       TEXT,
    sort            INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_lines_household ON budget_lines (household_id);

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
    member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    target_cents    INTEGER NOT NULL CHECK (target_cents > 0),
    saved_cents     INTEGER NOT NULL DEFAULT 0 CHECK (saved_cents >= 0),
    target_month    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY,
    household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
    bank            TEXT NOT NULL CHECK (bank IN ('fnb', 'capitec')),
    label           TEXT NOT NULL,
    last4           TEXT,
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
    rows_duplicate  INTEGER NOT NULL
);

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
    description     TEXT NOT NULL,
    merchant        TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL,
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
SQL;

    public static function connect(?string $path = null): Conn
    {
        $path ??= Config::get('db_path');
        if (!is_file($path)) {
            $dir = dirname($path);
            if (!is_dir($dir)) {
                mkdir($dir, 0700, true);
            }
            touch($path);
            chmod($path, 0600);
        }
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 10,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON');
        try {
            $pdo->exec('PRAGMA journal_mode = WAL');
        } catch (\PDOException) {
            // Some shared filesystems don't support WAL; the default journal is fine.
        }
        $db = new Conn($pdo);
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() !== self::SCHEMA_VERSION) {
            // Create or upgrade in ONE write-locked transaction, re-reading the version under the lock,
            // so two first requests arriving together can't half-migrate the file.
            $db->tx(function () use ($pdo, $db) {
                $v = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
                if ($v !== 0 && ($v < 2 || $v > self::SCHEMA_VERSION)) {
                    throw new \RuntimeException("Database schema v$v isn't supported by this version.");
                }
                if ($v === 0) {
                    $pdo->exec(self::SCHEMA);
                    Categorise::seed_builtin_rules($db);
                    $v = 2;
                }
                foreach (self::MIGRATIONS as $mv => $sql) {
                    if ($v < $mv) {
                        $pdo->exec($sql);
                        self::upgrade_data($db, $mv);
                        $v = $mv;
                    }
                }
                $pdo->exec('PRAGMA user_version = ' . self::SCHEMA_VERSION);
            });
        }
        return $db;
    }

    /** Data changes that SQL alone can't make, run right after that version's SQL (same transaction). */
    private static function upgrade_data(Conn $db, int $version): void
    {
        if ($version === 5) {
            // Statements already imported get what new imports get: long numbers glued to letters masked, payee names
            // without dates and references, and fingerprints by running balance (so re-uploading a statement is still
            // recognised). OR IGNORE: should two old rows now look identical, the second keeps its old fingerprint.
            // FNB fee rows were all "FNB bank fee": name them as new imports do (the biggest on a statement's last
            // day is the monthly account fee, the others transaction fees).
            $monthly = [];
            foreach ($db->all("SELECT t.id, t.import_id, t.amount_cents FROM transactions t JOIN imports i ON i.id = t.import_id
                               WHERE t.description = 'FNB bank fee' AND t.posted_on = i.period_to AND t.amount_cents < 0 ORDER BY t.amount_cents DESC") as $t) {
                $monthly[$t['import_id']] = $t['id'];  // ordered so the biggest fee is last, and wins
            }
            $db->exec("UPDATE transactions SET description = CASE WHEN id IN (" . (Conn::placeholders($monthly) ?: 'NULL') . ")
                       THEN 'FNB monthly account fee' ELSE 'FNB transaction fee' END WHERE description = 'FNB bank fee'", array_values($monthly));
            $seen = [];
            foreach ($db->all('SELECT id, account_id, posted_on, amount_cents, description, balance_cents FROM transactions ORDER BY id') as $t) {
                $desc = Statements::sanitise($t['description']);
                $base = $t['posted_on'] . '|' . $t['amount_cents'] . '|' . mb_strtoupper($desc);
                $seen[$t['account_id'] . "|$base"] = ($seen[$t['account_id'] . "|$base"] ?? 0) + 1;
                $fp = Statements::fingerprint((int)$t['account_id'], $base, $t['balance_cents'] === null ? null : (int)$t['balance_cents'],
                    $seen[$t['account_id'] . "|$base"]);
                $db->exec('UPDATE OR IGNORE transactions SET description = ?, merchant = ?, fingerprint = ? WHERE id = ?',
                    [$desc, Statements::merchant_key($desc), $fp, $t['id']]);
            }
            // People's "remember for this payee" rules were the payee key as a word, which often didn't match the
            // description it came from ("APPLE COM BILL" vs "Apple.Com/Bill"); make them payee patterns.
            // The new key only when it's still specific: an old "PAYSHAP CREDIT V" rekeys to "V", which would catch
            // every payment with a V in it, so that rule keeps all of its old words (no broader than before).
            foreach ($db->all("SELECT id, pattern FROM rules WHERE source = 'user' AND match = 'word'") as $r) {
                $key = Statements::merchant_key($r['pattern']);
                $pattern = match (true) {
                    mb_strtoupper($r['pattern']) === 'FNB BANK FEE' => 'FNB (?:MONTHLY ACCOUNT|TRANSACTION) FEE',  // fee rows' new names
                    Categorise::specific_payee($key) => Categorise::payee_pattern($key),
                    default => Categorise::payee_pattern(mb_strtoupper($r['pattern'])),
                };
                $db->exec("UPDATE OR IGNORE rules SET pattern = ?, match = 'regex' WHERE id = ?", [$pattern, $r['id']]);
            }
            // FNB-aware built-in rules (own-account transfers, card repayments, FNB policies), applied again, but never
            // to what people chose: rows they set themselves, or rows one of their payee rules set.
            $db->exec("UPDATE rules SET priority = 260 WHERE household_id = 0 AND source = 'builtin' AND category = 'Debt repayments'
                       AND pattern IN ('CREDIT CARD', 'CC PAYMENT')");
            $db->exec("DELETE FROM rules WHERE household_id = 0 AND source = 'builtin' AND category = 'Income' AND pattern = 'REFUND'");
            Categorise::seed_builtin_rules($db);
            foreach ($db->all('SELECT id FROM households') as $h) {
                $ids = array_map('intval', array_column($db->all("SELECT t.id FROM transactions t LEFT JOIN rules r ON r.id = t.rule_id
                    WHERE t.household_id = ? AND t.category_source != 'user' AND (r.id IS NULL OR r.source = 'builtin')", [$h['id']]), 'id'));
                Categorise::apply_rules($db, (int)$h['id'], $ids);
            }
            // Older imports only know their first and last row: close gaps of up to a week between an account's
            // consecutive statements, so back-to-back statements cover the days between them.
            $prev = null;
            foreach ($db->all('SELECT id, account_id, period_from, period_to FROM imports WHERE period_from IS NOT NULL ORDER BY account_id, period_from') as $i) {
                if ($prev && $prev['account_id'] === $i['account_id'] && $i['period_from'] > $prev['period_to']
                    && strtotime($i['period_from']) - strtotime($prev['period_to']) <= 8 * 86400) {
                    $db->exec('UPDATE imports SET period_to = ? WHERE id = ?', [date('Y-m-d', strtotime($i['period_from'] . ' -1 day')), $prev['id']]);
                }
                $prev = $i['period_to'] >= ($prev['period_to'] ?? '') || $prev['account_id'] !== $i['account_id'] ? $i : $prev;
            }
        }
    }
}

/** Thin PDO wrapper with the handful of helpers the app needs. */
final class Conn
{
    private int $depth = 0;

    public function __construct(public readonly PDO $pdo) {}

    public function q(string $sql, array $params = []): \PDOStatement
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st;
    }

    public function all(string $sql, array $params = []): array
    {
        return $this->q($sql, $params)->fetchAll();
    }

    public function one(string $sql, array $params = []): ?array
    {
        $r = $this->q($sql, $params)->fetch();
        return $r === false ? null : $r;
    }

    public function val(string $sql, array $params = []): mixed
    {
        $v = $this->q($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    public function exec(string $sql, array $params = []): int
    {
        return $this->q($sql, $params)->rowCount();
    }

    public function insert(string $sql, array $params = []): int
    {
        $this->q($sql, $params);
        return (int)$this->pdo->lastInsertId();
    }

    /**
     * Nested-safe transaction, like Python's `with conn:`. BEGIN IMMEDIATE takes the write lock up
     * front, so a concurrent writer waits for the busy timeout instead of failing with "database is
     * locked" when a read-then-write transaction tries to upgrade its lock.
     */
    public function tx(callable $fn): mixed
    {
        if ($this->depth++ === 0) {
            $this->pdo->exec('BEGIN IMMEDIATE');
        }
        try {
            $r = $fn($this);
            if (--$this->depth === 0) {
                $this->pdo->exec('COMMIT');
            }
            return $r;
        } catch (\Throwable $e) {
            if (--$this->depth === 0 && $this->pdo->inTransaction()) {
                $this->pdo->exec('ROLLBACK');
            }
            throw $e;
        }
    }

    public function audit(?int $householdId, ?int $userId, string $action, ?string $detail = null): void
    {
        $this->q('INSERT INTO audit_log (household_id, user_id, action, detail) VALUES (?, ?, ?, ?)',
            [$householdId, $userId, $action, $detail]);
    }

    public static function placeholders(array $xs): string
    {
        return implode(',', array_fill(0, count($xs), '?'));
    }
}
