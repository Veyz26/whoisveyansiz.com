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
            if ($makeRule && $txn['merchant'] !== '') {
                $dir = $txn['amount_cents'] > 0 ? 'in' : 'out';
                $db->exec("INSERT INTO rules (household_id, pattern, match, direction, category, priority, source)
                           VALUES (?, ?, 'word', ?, ?, ?, 'user')
                           ON CONFLICT (household_id, pattern, match, direction)
                           DO UPDATE SET category = excluded.category, priority = excluded.priority, source = 'user'",
                    [$householdId, $txn['merchant'], $dir, $category, self::USER_PRIORITY]);
                $ruleId = (int)$db->val("SELECT id FROM rules WHERE household_id = ? AND pattern = ? AND match = 'word' AND direction = ?",
                    [$householdId, $txn['merchant'], $dir]);
                $sign = $dir === 'in' ? '>' : '<';
                $affected += $db->exec("UPDATE transactions SET category = ?, category_source = 'rule', rule_id = ?, is_transfer = ?
                    WHERE household_id = ? AND merchant = ? AND id != ? AND category_source != 'user' AND amount_cents $sign 0",
                    [$category, $ruleId, (int)($category === 'Transfers'), $householdId, $txn['merchant'], $txnId]);
            }
            return ['updated' => $affected, 'rule_created' => $makeRule && $txn['merchant'] !== ''];
        });
    }
}

final class NotFound extends \RuntimeException {}
