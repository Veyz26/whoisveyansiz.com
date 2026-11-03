<?php
/** POPIA rights + retention, billing, Power BI export. Mirrors privacy.py, billing.py and export.py. */
declare(strict_types=1);

namespace Linen;

final class Privacy
{
    private const EXPORT = [
        'household' => 'SELECT id, name, created_at, plan, subscription_status, trial_ends_on, paid_until, retention_months FROM households WHERE id = :h',
        'members' => 'SELECT id, name, sort FROM members WHERE household_id = :h',
        'users' => 'SELECT u.id, u.email, u.name, u.sso_provider, u.created_at, u.last_login_at, m.role FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.household_id = :h',
        'consents' => 'SELECT c.user_id, c.purpose, c.version, c.granted, c.created_at FROM consents c JOIN memberships m ON m.user_id = c.user_id WHERE m.household_id = :h',
        'budget_lines' => 'SELECT * FROM budget_lines WHERE household_id = :h',
        'budget_amounts' => 'SELECT a.* FROM budget_amounts a JOIN budget_lines l ON l.id = a.line_id WHERE l.household_id = :h',
        'line_status' => 'SELECT s.* FROM line_status s JOIN budget_lines l ON l.id = s.line_id WHERE l.household_id = :h',
        'goals' => 'SELECT * FROM goals WHERE household_id = :h',
        'accounts' => 'SELECT id, member_id, bank, label, last4, kind, created_at FROM accounts WHERE household_id = :h',
        'transactions' => 'SELECT id, account_id, posted_on, description, amount_cents, category, category_source, is_transfer FROM transactions WHERE household_id = :h',
        'rules' => 'SELECT pattern, match, direction, category, source, created_at FROM rules WHERE household_id = :h',
        'debts' => 'SELECT * FROM debts WHERE household_id = :h',
        'api_tokens' => 'SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_tokens WHERE household_id = :h',
        'audit_log' => 'SELECT user_id, action, detail, created_at FROM audit_log WHERE household_id = :h',
    ];

    public static function export(Conn $db, int $hid, ?int $uid): array
    {
        $out = [];
        foreach (self::EXPORT as $k => $sql) {
            $out[$k] = $db->all($sql, ['h' => $hid]);
        }
        $db->audit($hid, $uid, 'data.exported');
        $out['_about'] = ['exported_on' => gmdate('Y-m-d'),
            'note' => 'All personal information this service holds for your household. Amounts are in cents (ZAR). Passwords are stored only as one-way hashes and are not included.'];
        return $out;
    }

    public static function delete_household(Conn $db, int $hid): void
    {
        $db->tx(function (Conn $db) use ($hid) {
            $uids = array_column($db->all('SELECT user_id FROM memberships WHERE household_id = ?', [$hid]), 'user_id');
            $db->exec('DELETE FROM rules WHERE household_id = ?', [$hid]);
            $db->exec('DELETE FROM households WHERE id = ?', [$hid]);
            foreach ($uids as $u) {
                if (!$db->val('SELECT 1 FROM memberships WHERE user_id = ?', [$u])) {
                    $db->exec('DELETE FROM users WHERE id = ?', [$u]);
                }
            }
            $db->audit(null, null, 'household.deleted', "household #$hid");
        });
        try {
            $db->pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
            $db->pdo->exec('VACUUM'); // don't leave deleted pages readable in the file
        } catch (\PDOException) {
        }
    }

    public static function leave(Conn $db, int $hid, int $uid): void
    {
        $db->tx(function (Conn $db) use ($hid, $uid) {
            $db->exec('UPDATE members SET user_id = NULL WHERE household_id = ? AND user_id = ?', [$hid, $uid]);
            $db->exec('DELETE FROM memberships WHERE household_id = ? AND user_id = ?', [$hid, $uid]);
            if (!$db->val('SELECT 1 FROM memberships WHERE user_id = ?', [$uid])) {
                $db->exec('DELETE FROM users WHERE id = ?', [$uid]);
            }
            $db->audit($hid, null, 'user.left');
        });
    }

    /** Deletes statement lines older than each household's retention period. Runs at most daily. */
    public static function purge_if_due(Conn $db): int
    {
        $last = $db->val("SELECT value FROM meta WHERE key = 'retention_last_run'");
        if ($last && $last > Auth::now(-86400)) {
            return 0;
        }
        $db->exec("INSERT INTO meta (key, value) VALUES ('retention_last_run', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [Auth::now()]);
        return self::purge($db);
    }

    public static function purge(Conn $db): int
    {
        $n = 0;
        foreach ($db->all('SELECT id, retention_months FROM households') as $h) {
            $cutoff = Money::add_months(gmdate('Y-m'), -(int)$h['retention_months']) . '-01';
            $c = $db->exec('DELETE FROM transactions WHERE household_id = ? AND posted_on < ?', [$h['id'], $cutoff]);
            if ($c) {
                $db->audit((int)$h['id'], null, 'retention.purged', "$c transactions before $cutoff");
                $n += $c;
            }
        }
        return $n;
    }

    public static function audit_entries(Conn $db, int $hid, int $limit = 60): array
    {
        return $db->all('SELECT a.action, a.detail, a.created_at, u.name AS user_name FROM audit_log a
            LEFT JOIN users u ON u.id = a.user_id WHERE a.household_id = ? ORDER BY a.id DESC LIMIT ?', [$hid, $limit]);
    }
}

final class Billing
{
    public const PLANS = [
        'household' => ['name' => 'Household', 'price_cents' => 7900, 'interval' => 'month',
            'features' => ['2 people', 'Monthly budget & forecast', 'Goals', 'Statement import', 'Power BI export']],
        'household_annual' => ['name' => 'Household (annual)', 'price_cents' => 79000, 'interval' => 'year',
            'features' => ['Everything in Household', '2 months free']],
    ];

    public static function status(Conn $db, int $hid): array
    {
        $h = $db->one('SELECT * FROM households WHERE id = ?', [$hid]);
        $today = gmdate('Y-m-d');
        $state = $h['subscription_status'];
        if ($state === 'trialing' && $h['trial_ends_on'] && $h['trial_ends_on'] < $today) {
            $state = 'expired';
        }
        if ($state === 'active' && $h['paid_until'] && $h['paid_until'] < $today) {
            $state = 'past_due';
        }
        $days = $state === 'trialing' && $h['trial_ends_on'] ? (int)((strtotime($h['trial_ends_on']) - strtotime($today)) / 86400) : null;
        $private = (bool)Config::get('private_mode');
        return [
            'plan' => $h['plan'], 'plan_info' => self::PLANS[$h['plan']] ?? null, 'status' => $private ? 'private' : $state,
            'trial_ends_on' => $h['trial_ends_on'], 'trial_days_left' => $days, 'paid_until' => $h['paid_until'],
            // Private mode is the owner's own household: no subscription gate.
            'can_write' => $private || (bool)$h['is_demo'] || in_array($state, ['trialing', 'active'], true)
                || ($state === 'cancelled' && $h['paid_until'] && $h['paid_until'] >= $today),
            'plans' => self::PLANS, 'payments_configured' => false, 'dev_mode' => Config::get('env') === 'development',
        ];
    }

    public static function activate(Conn $db, int $hid, string $plan, ?int $uid, int $months): void
    {
        if (!isset(self::PLANS[$plan])) {
            throw new \InvalidArgumentException('Unknown plan');
        }
        $db->exec("UPDATE households SET plan = ?, subscription_status = 'active', paid_until = ? WHERE id = ?",
            [$plan, gmdate('Y-m-d', time() + 31 * 86400 * $months), $hid]);
        $db->audit($hid, $uid, 'subscription.activated', $plan);
    }

    public static function cancel(Conn $db, int $hid, ?int $uid): void
    {
        $db->exec("UPDATE households SET subscription_status = 'cancelled' WHERE id = ?", [$hid]);
        $db->audit($hid, $uid, 'subscription.cancelled');
    }
}

final class Export
{
    public const TABLES = ['dim_person', 'dim_category', 'dim_month', 'fact_budget', 'fact_transactions', 'fact_goals', 'fact_debts'];

    private static function rands(?int $c): string
    {
        if ($c === null) {
            return '';
        }
        return ($c < 0 ? '-' : '') . intdiv(abs($c), 100) . '.' . sprintf('%02d', abs($c) % 100);
    }

    private static function month_range(Conn $db, int $hid): array
    {
        $r = $db->one('SELECT MIN(m) AS lo, MAX(m) AS hi FROM (SELECT start_month AS m FROM budget_lines WHERE household_id = :h
                       UNION ALL SELECT substr(posted_on, 1, 7) FROM transactions WHERE household_id = :h)', ['h' => $hid]);
        $today = gmdate('Y-m');
        $m = $r['lo'] ?? $today;
        $last = max($r['hi'] ?? $today, Money::add_months($today, 6));
        $out = [];
        while ($m <= $last && count($out) < 240) {
            $out[] = $m;
            $m = Money::add_months($m, 1);
        }
        return $out;
    }

    /** @return array{0:array,1:array} header, rows */
    public static function rows(Conn $db, int $hid, string $table): array
    {
        $people = array_column(Budget::members($db, $hid), 'name', 'id');
        switch ($table) {
            case 'dim_person':
                $rows = [];
                foreach ($people as $id => $n) {
                    $rows[] = [$id, $n];
                }
                $rows[] = [0, 'Joint'];
                return [['person_id', 'person'], $rows];
            case 'dim_category':
                $rows = [];
                foreach (RuleData::GROUPS as $c => $g) {
                    $rows[] = [$c, $g];
                }
                return [['category', 'group'], $rows];
            case 'dim_month':
                $rows = [];
                foreach (self::month_range($db, $hid) as $m) {
                    [$y, $mo] = array_map('intval', explode('-', $m));
                    $rows[] = [$m, "$m-01", $y, $mo, date('M Y', mktime(0, 0, 0, $mo, 1, $y)), 'Q' . (intdiv($mo - 1, 3) + 1)];
                }
                return [['month', 'month_start', 'year', 'month_number', 'month_label', 'quarter'], $rows];
            case 'fact_budget':
                $rows = [];
                foreach (self::month_range($db, $hid) as $m) {
                    foreach (Budget::active_lines($db, $hid, $m) as $l) {
                        $rows[] = [$m, $l['member_id'], $l['to_member_id'] ?? '', $l['id'], $l['name'], $l['kind'], $l['section'], $l['category'],
                            Categorise::group($l['category']), (int)$l['is_debit_order'], $l['flexibility'], self::rands($l['amount_cents']),
                            $l['amount_cents'], self::rands($l['change_cents']), (int)$l['paid']];
                    }
                }
                return [['month', 'person_id', 'to_person_id', 'line_id', 'item', 'kind', 'section', 'category', 'group', 'is_debit_order',
                    'flexibility', 'amount', 'amount_cents', 'change_vs_prior_month', 'paid'], $rows];
            case 'fact_transactions':
                $rows = array_map(fn($r) => [$r['posted_on'], substr($r['posted_on'], 0, 7), $r['member_id'] ?? 0, $r['account'], $r['bank'],
                    $r['description'], $r['category'], Categorise::group($r['category']), (int)$r['is_transfer'], self::rands((int)$r['amount_cents']), (int)$r['amount_cents']],
                    $db->all('SELECT t.*, a.label AS account, a.bank, a.member_id FROM transactions t JOIN accounts a ON a.id = t.account_id
                              WHERE t.household_id = ? ORDER BY t.posted_on', [$hid]));
                return [['date', 'month', 'person_id', 'account', 'bank', 'description', 'category', 'group', 'is_transfer', 'amount', 'amount_cents'], $rows];
            case 'fact_goals':
                $rows = array_map(fn($g) => [$g['id'], $g['name'], $g['member_id'] ?? 0, self::rands((int)$g['target_cents']), self::rands((int)$g['saved_cents']), $g['target_month'] ?? ''],
                    $db->all('SELECT * FROM goals WHERE household_id = ?', [$hid]));
                return [['goal_id', 'goal', 'person_id', 'target', 'saved', 'target_month'], $rows];
            case 'fact_debts':
                $rows = array_map(fn($d) => [$d['id'], $d['name'], $d['member_id'] ?? 0, self::rands((int)$d['balance_cents']), $d['apr_bp'] / 100, self::rands((int)$d['min_payment_cents'])],
                    $db->all('SELECT * FROM debts WHERE household_id = ?', [$hid]));
                return [['debt_id', 'debt', 'person_id', 'balance', 'interest_rate_pct', 'minimum_payment'], $rows];
        }
        throw new NotFound('Unknown table');
    }

    public static function csv(Conn $db, int $hid, string $table): string
    {
        [$header, $rows] = self::rows($db, $hid, $table);
        $h = fopen('php://temp', 'r+');
        fputcsv($h, $header, ',', '"', '');
        foreach ($rows as $r) {
            // Neutralise spreadsheet formula injection in free-text cells.
            fputcsv($h, array_map(fn($c) => is_string($c) && $c !== '' && str_contains('=+-@', $c[0]) && !is_numeric($c) ? "'$c" : $c, $r), ',', '"', '');
        }
        rewind($h);
        $out = stream_get_contents($h);
        fclose($h);
        return "\u{FEFF}" . $out;
    }

    public const README = <<<'TXT'
Budget export for Power BI / Excel
====================================

Load in Power BI Desktop: Get Data > Folder > select this unzipped folder > Combine & Transform,
or Get Data > Text/CSV for each file.

Relationships (Model view):
  fact_budget[month]           -> dim_month[month]
  fact_transactions[month]     -> dim_month[month]
  fact_budget[person_id]       -> dim_person[person_id]
  fact_transactions[person_id] -> dim_person[person_id]
  fact_budget[category]        -> dim_category[category]
  fact_transactions[category]  -> dim_category[category]

Amounts: 'amount' is in rands (negative = money out for transactions); '*_cents' are exact integers.
fact_budget has one row per budget item per month, including future months, so it doubles as a forecast.

Starter measures (DAX):
  Planned out = CALCULATE(SUM(fact_budget[amount]), fact_budget[kind] IN {"expense","saving"})
  Income = CALCULATE(SUM(fact_budget[amount]), fact_budget[kind] = "income")
  Surplus = [Income] - [Planned out]
  Actual spend = -CALCULATE(SUM(fact_transactions[amount]), fact_transactions[amount] < 0, fact_transactions[is_transfer] = 0)
TXT;

    public static function zip(Conn $db, int $hid): string
    {
        if (!class_exists(\ZipArchive::class)) {
            throw new \RuntimeException('The PHP zip extension is needed for this export.');
        }
        $tmp = tempnam(sys_get_temp_dir(), 'pbi');
        $z = new \ZipArchive();
        $z->open($tmp, \ZipArchive::OVERWRITE);
        foreach (self::TABLES as $t) {
            $z->addFromString("$t.csv", self::csv($db, $hid, $t));
        }
        $z->addFromString('README.txt', self::README);
        $z->close();
        $data = file_get_contents($tmp);
        unlink($tmp);
        return $data;
    }

    public static function power_query(string $base, string $table): string
    {
        return "let\n    Source = Csv.Document(\n        Web.Contents(\"$base/api/powerbi/$table.csv\",\n            [Headers = [Authorization = \"Bearer \" & ApiToken]]),\n"
            . "        [Delimiter = \",\", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),\n    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true])\nin\n    Promoted";
    }
}
