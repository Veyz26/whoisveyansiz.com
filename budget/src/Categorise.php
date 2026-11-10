<?php
/**
 * Rule-based categorisation, with user overrides becoming rules. Mirrors categorise.py.
 * 'word' rules match whole words (so 'RAIN' doesn't match 'TRAINING'); 'regex' rules are
 * case-insensitive. Highest priority wins: user (1000) > llm (500) > builtin (100-300).
 * Built-in rules live in household 0 and apply to everyone.
 */
declare(strict_types=1);

namespace Linen;

final class Categorise
{
    public const USER_PRIORITY = 1000;
    public const NON_SPEND = ['Transfers', 'Savings & investments'];

    public static function categories(): array
    {
        return array_keys(RuleData::GROUPS);
    }

    public static function group(string $category): string
    {
        return RuleData::GROUPS[$category] ?? 'Lifestyle';
    }

    public static function seed_builtin_rules(Conn $db): void
    {
        $db->tx(function (Conn $db) {
            foreach (RuleData::BUILTIN as [$cat, $prio, $dir, $patterns]) {
                foreach ($patterns as $p) {
                    [$match, $pattern] = str_starts_with($p, 'regex:') ? ['regex', substr($p, 6)] : ['word', $p];
                    $db->exec("INSERT OR IGNORE INTO rules (household_id, pattern, match, direction, category, priority, source)
                               VALUES (0, ?, ?, ?, ?, ?, 'builtin')", [$pattern, $match, $dir, $cat, $prio]);
                }
            }
        });
    }

    private static array $cache = [];

    public static function compile(string $pattern, string $match): string
    {
        $key = "$match\0$pattern";
        if (!isset(self::$cache[$key])) {
            self::$cache[$key] = $match === 'regex'
                ? '~' . str_replace('~', '\~', $pattern) . '~iu'
                : '~(?<![A-Z0-9])' . preg_quote(mb_strtoupper($pattern), '~') . '(?![A-Z0-9])~u';
        }
        return self::$cache[$key];
    }

    /** Best guess for a budget line typed by hand ('Netflix', 'Rent'). */
    public static function guess_category(string $name, int $sign = -1): string
    {
        $rules = RuleData::BUILTIN;
        usort($rules, fn($a, $b) => $b[1] <=> $a[1]);
        $upper = mb_strtoupper($name);
        foreach ($rules as [$cat, , $dir, $patterns]) {
            if (($dir === 'in' && $sign < 0) || ($dir === 'out' && $sign > 0)) {
                continue;
            }
            foreach ($patterns as $p) {
                if (!str_starts_with($p, 'regex:') && preg_match(self::compile($p, 'word'), $upper)) {
                    return $cat;
                }
            }
        }
        return 'Other';
    }

    public static function load_rules(Conn $db, int $householdId): array
    {
        return $db->all('SELECT * FROM rules WHERE household_id IN (0, ?) ORDER BY priority DESC, length(pattern) DESC, id',
            [$householdId]);
    }

    public static function match_rule(array $rules, string $description, int $amount): ?array
    {
        $text = mb_strtoupper($description);
        foreach ($rules as $r) {
            if (($r['direction'] === 'in' && $amount < 0) || ($r['direction'] === 'out' && $amount > 0)) {
                continue;
            }
            if (preg_match(self::compile($r['pattern'], $r['match']), $text)) {
                return $r;
            }
        }
        return null;
    }

    /** @return array{0:string,1:string,2:?int} category, source, rule id */
    public static function categorise_one(array $rules, string $description, int $amount, ?string $bankCategory): array
    {
        $rule = self::match_rule($rules, $description, $amount);
        if ($rule) {
            return [$rule['category'], $rule['source'] === 'llm' ? 'llm' : 'rule', (int)$rule['id']];
        }
        if ($bankCategory) {
            $mapped = RuleData::BANK_CATEGORY_MAP[strtolower(trim($bankCategory))] ?? null;
            if ($mapped) {
                return [$mapped, 'bank', null];
            }
        }
        return $amount > 0 ? ['Income', 'none', null] : ['Other', 'none', null];
    }

    /** (Re)categorise transactions, never touching manual ('user') choices or linked transfers. */
    public static function apply_rules(Conn $db, int $householdId, ?array $ids = null): int
    {
        $rules = self::load_rules($db, $householdId);
        $sql = "SELECT id, description, amount_cents, bank_category FROM transactions
                WHERE household_id = ? AND category_source != 'user' AND is_transfer = 0";
        $params = [$householdId];
        if ($ids !== null) {
            if (!$ids) {
                return 0;
            }
            $sql .= ' AND id IN (' . Conn::placeholders($ids) . ')';
            $params = array_merge($params, $ids);
        }
        $n = 0;
        foreach ($db->all($sql, $params) as $t) {
            [$cat, $src, $rid] = self::categorise_one($rules, $t['description'], (int)$t['amount_cents'], $t['bank_category']);
            $db->exec('UPDATE transactions SET category = ?, category_source = ?, rule_id = ? WHERE id = ?', [$cat, $src, $rid, $t['id']]);
            $n++;
        }
        return $n;
    }

    /** Manual override; with $makeRule, the merchant's other transactions follow too. */
    /**
     * A rule that recognises a payee from its key: the key's words in order with letters-only boundaries (so "FNB INSURE"
     * matches "FNB Insure1234567") and anything between them ("APPLE COM BILL" matches "Apple.Com/Bill"). Mirrors categorise.payee_pattern.
     */
    public static function payee_pattern(string $merchant): string
    {
        return implode('.*?', array_map(fn($w) => '(?<![A-Z])' . preg_quote($w, '~') . '(?![A-Z])', preg_split('/\s+/', trim($merchant))));
    }

    /** Whether a payee key is specific enough for a rule ("V" or "FNB" would catch far too much). Mirrors categorise.specific_payee. */
    public static function specific_payee(string $merchant): bool
    {
        $letters = strlen(preg_replace('/[^A-Z]/', '', mb_strtoupper($merchant)));
        return $letters >= 5 || ($letters >= 4 && count(preg_split('/\s+/', trim($merchant))) >= 2);
    }

    public static function set_category(Conn $db, int $householdId, int $txnId, string $category, bool $makeRule = true): array
    {
        if (!in_array($category, self::categories(), true)) {
            throw new \InvalidArgumentException("Unknown category");
        }
        $txn = $db->one('SELECT * FROM transactions WHERE id = ? AND household_id = ?', [$txnId, $householdId]);
        if (!$txn) {
            throw new NotFound('Transaction not found');
        }
        return $db->tx(function (Conn $db) use ($txn, $category, $makeRule, $householdId, $txnId) {
            $affected = 1;
            $db->exec("UPDATE transactions SET category = ?, category_source = 'user', is_transfer = ? WHERE id = ?",
                [$category, (int)($category === 'Transfers'), $txnId]);
            $makeRule = $makeRule && self::specific_payee($txn['merchant']);
            if ($makeRule) {
                $dir = $txn['amount_cents'] > 0 ? 'in' : 'out';
                $pattern = self::payee_pattern($txn['merchant']);
                $db->exec("INSERT INTO rules (household_id, pattern, match, direction, category, priority, source)
                           VALUES (?, ?, 'regex', ?, ?, ?, 'user')
                           ON CONFLICT (household_id, pattern, match, direction)
                           DO UPDATE SET category = excluded.category, priority = excluded.priority, source = 'user'",
                    [$householdId, $pattern, $dir, $category, self::USER_PRIORITY]);
                $ruleId = (int)$db->val("SELECT id FROM rules WHERE household_id = ? AND pattern = ? AND match = 'regex' AND direction = ?",
                    [$householdId, $pattern, $dir]);
                $sign = $dir === 'in' ? '>' : '<';
                $affected += $db->exec("UPDATE transactions SET category = ?, category_source = 'rule', rule_id = ?, is_transfer = ?
                    WHERE household_id = ? AND merchant = ? AND id != ? AND category_source != 'user' AND amount_cents $sign 0",
                    [$category, $ruleId, (int)($category === 'Transfers'), $householdId, $txn['merchant'], $txnId]);
            }
            return ['updated' => $affected, 'rule_created' => $makeRule];
        });
    }

    /** set_category with a snapshot stashed first, so the toast's "Undo" can put every affected transaction (and the rule) back. */
    public static function set_category_undoable(Conn $db, int $householdId, int $txnId, string $category, bool $makeRule = true): array
    {
        return $db->tx(function (Conn $db) use ($householdId, $txnId, $category, $makeRule) {
            $txn = $db->one('SELECT * FROM transactions WHERE id = ? AND household_id = ?', [$txnId, $householdId]);
            if (!$txn) {
                throw new NotFound('Transaction not found');
            }
            $makeRule = $makeRule && self::specific_payee($txn['merchant']);
            $dir = $txn['amount_cents'] > 0 ? 'in' : 'out';
            $sign = $dir === 'in' ? '>' : '<';
            $where = $makeRule ? "(t.id = ? OR (t.merchant = ? AND t.category_source != 'user' AND t.amount_cents $sign 0))" : 't.id = ?';
            $txns = $db->all("SELECT t.id, t.category, t.category_source, t.rule_id, t.is_transfer FROM transactions t WHERE t.household_id = ? AND $where",
                $makeRule ? [$householdId, $txnId, $txn['merchant']] : [$householdId, $txnId]);
            $ruleSql = "SELECT id, category, priority, source FROM rules WHERE household_id = ? AND pattern = ? AND match = 'regex' AND direction = ?";
            $ruleArgs = [$householdId, self::payee_pattern($txn['merchant']), $dir];
            $prev = $makeRule ? $db->one($ruleSql, $ruleArgs) : null;
            $r = self::set_category($db, $householdId, $txnId, $category, $makeRule);
            $rule = $makeRule ? ['id' => (int)$db->val($ruleSql, $ruleArgs),
                'prev' => $prev ? ['category' => $prev['category'], 'priority' => (int)$prev['priority'], 'source' => $prev['source']] : null] : null;
            $r['undo'] = Undo::stash($db, $householdId, 'category', ['txns' => $txns, 'rule' => $rule]);
            return $r;
        });
    }

    /**
     * The transactions nobody has sorted yet, one card per payee (so one choice sorts the lot), biggest groups first.
     * A payee too vague for a rule gets a card per transaction.
     */
    public static function review_queue(Conn $db, int $householdId): array
    {
        $rows = $db->all("SELECT t.id, t.posted_on, t.description, t.merchant, t.amount_cents, a.label AS account
                          FROM transactions t JOIN accounts a ON a.id = t.account_id
                          WHERE t.household_id = ? AND t.category_source = 'none' AND t.is_transfer = 0
                          ORDER BY t.posted_on DESC, t.id DESC", [$householdId]);
        $groups = [];
        foreach ($rows as $r) {
            $remembers = self::specific_payee((string)$r['merchant']);
            $key = $remembers ? ($r['amount_cents'] > 0 ? 'in:' : 'out:') . $r['merchant'] : 'txn:' . $r['id'];
            $groups[$key] ??= ['id' => (int)$r['id'], 'merchant' => $r['merchant'], 'description' => $r['description'], 'posted_on' => $r['posted_on'],
                'amount_cents' => (int)$r['amount_cents'], 'account' => $r['account'], 'count' => 0, 'total_cents' => 0, 'remembers' => $remembers];
            $groups[$key]['count']++;
            $groups[$key]['total_cents'] += (int)$r['amount_cents'];
        }
        $items = array_values($groups);
        usort($items, fn($a, $b) => [$b['count'], abs($b['total_cents'])] <=> [$a['count'], abs($a['total_cents'])]);
        return ['items' => $items, 'total' => count($rows)];
    }

    public static function to_review(Conn $db, int $householdId): int
    {
        return (int)$db->val("SELECT COUNT(*) FROM transactions WHERE household_id = ? AND category_source = 'none' AND is_transfer = 0", [$householdId]);
    }
}

final class NotFound extends \RuntimeException {}
