<?php
/**
 * The monthly budget: each person's income, debit orders, monthly items and savings. Mirrors budget.py.
 * Lines carry forward month to month. The amount for a month is the latest change effective on or
 * before it, so a debit-order increase is recorded once, from the month it starts.
 */
declare(strict_types=1);

namespace Linen;

final class Budget
{
    public const KINDS = ['income', 'expense', 'saving', 'transfer'];
    public const FLEX = ['fixed', 'reducible', 'discretionary'];
    // "Other" is deliberately NOT discretionary: an item we don't recognise could be a loan instalment or medication.
    public const DISCRETIONARY_CATS = ['Eating out', 'Subscriptions', 'Fitness & leisure', 'Shopping', 'Entertainment'];
    // Never suggested as cuts, whatever their flexibility: contracts, minimum repayments, health, giving, housing.
    public const NEVER_CUT_CATS = ['Debt repayments', 'Insurance', 'Medical & health', 'Giving', 'Housing & utilities', 'Bank fees',
        'Interest charged', 'Other'];
    public const CANCELLABLE_DEBIT_CATS = ['Subscriptions', 'Fitness & leisure'];
    public const REDUCIBLE_CATS = ['Groceries', 'Fuel & transport', 'Personal care', 'Cash withdrawals'];
    private const REDUCIBLE_NAMES = '/UTILIT|ELECTRIC|WATER|FUEL|PETROL|FOOD|GROCER|TOILETR|DATE|CLEAN/i';

    public static function valid_month(?string $m): string
    {
        if (!$m || !preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $m)) {
            throw new \InvalidArgumentException('Month must be YYYY-MM');
        }
        return $m;
    }

    public static function default_flexibility(string $category, string $name): string
    {
        $reducibleName = (bool)preg_match(self::REDUCIBLE_NAMES, $name);
        if (in_array($category, self::REDUCIBLE_CATS, true) || ($category === 'Other' && $reducibleName)) {
            return 'reducible';
        }
        if (in_array($category, self::DISCRETIONARY_CATS, true)) {
            return 'discretionary';
        }
        return $reducibleName ? 'reducible' : 'fixed';
    }

    public static function members(Conn $db, int $hid): array
    {
        return array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'user_id' => $r['user_id'] === null ? null : (int)$r['user_id']],
            $db->all('SELECT id, name, user_id FROM members WHERE household_id = ? ORDER BY sort, id', [$hid]));
    }

    private static function member_ok(Conn $db, int $hid, ?int $mid): bool
    {
        return $mid !== null && (bool)$db->val('SELECT 1 FROM members WHERE id = ? AND household_id = ?', [$mid, $hid]);
    }

    private static function line(Conn $db, int $hid, int $id): array
    {
        $r = $db->one('SELECT * FROM budget_lines WHERE id = ? AND household_id = ?', [$id, $hid]);
        if (!$r) {
            throw new NotFound('Budget line not found');
        }
        return $r;
    }

    public static function create_line(Conn $db, int $hid, array $f): int
    {
        $name = mb_substr(trim((string)($f['name'] ?? '')), 0, 80);
        $kind = $f['kind'] ?? 'expense';
        $memberId = isset($f['member_id']) ? (int)$f['member_id'] : null;
        $to = isset($f['to_member_id']) && $f['to_member_id'] !== null ? (int)$f['to_member_id'] : null;
        $amount = Money::cents($f['amount_cents'] ?? null);
        $start = self::valid_month($f['start_month'] ?? null);
        $end = $f['end_month'] ?? null;
        $isDo = !empty($f['is_debit_order']);
        if ($name === '') {
            throw new \InvalidArgumentException('Give the item a name');
        }
        if (!in_array($kind, self::KINDS, true)) {
            throw new \InvalidArgumentException('Unknown kind');
        }
        if (!self::member_ok($db, $hid, $memberId)) {
            throw new \InvalidArgumentException('Unknown person');
        }
        if ($kind === 'transfer' && (!self::member_ok($db, $hid, $to) || $to === $memberId)) {
            throw new \InvalidArgumentException('A transfer needs a different person to receive it');
        }
        if ($amount < 0) {
            throw new \InvalidArgumentException("Amount can't be negative");
        }
        if ($end) {
            self::valid_month($end);
            if ($end < $start) {
                throw new \InvalidArgumentException('End month is before the start month');
            }
        }
        $cat = $f['category'] ?? null;
        $cat = match ($kind) {
            'income' => 'Income',
            'transfer' => 'Transfers',
            'saving' => $cat ?: 'Savings & investments',
            default => $cat,
        };
        if (!in_array($cat, Categorise::categories(), true)) {
            $cat = Categorise::guess_category($name);
        }
        $flex = $f['flexibility'] ?? null;
        if (!in_array($flex, self::FLEX, true)) {
            $flex = self::default_flexibility($cat, $name);
            if ($isDo && $cat === 'Other') {
                $flex = 'fixed'; // an unrecognised debit order is a commitment
            }
        }
        $section = mb_substr(($f['section'] ?? null) ?: (['income' => 'Income', 'saving' => 'Savings', 'transfer' => 'Transfers'][$kind]
            ?? ($isDo ? 'Debit orders' : 'Monthly')), 0, 40);
        $notes = mb_substr(trim((string)($f['notes'] ?? '')), 0, 200) ?: null;
        return $db->tx(function (Conn $db) use ($hid, $memberId, $to, $kind, $section, $name, $cat, $isDo, $flex, $notes, $start, $end, $amount) {
            $sort = (int)$db->val('SELECT COALESCE(MAX(sort), 0) + 1 FROM budget_lines WHERE household_id = ?', [$hid]);
            $id = $db->insert('INSERT INTO budget_lines (household_id, member_id, to_member_id, kind, section, name, category,
                    is_debit_order, flexibility, notes, start_month, end_month, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$hid, $memberId, $kind === 'transfer' ? $to : null, $kind, $section, $name, $cat, (int)$isDo, $flex, $notes, $start, $end ?: null, $sort]);
            $db->exec('INSERT INTO budget_amounts (line_id, effective_month, amount_cents) VALUES (?, ?, ?)', [$id, $start, $amount]);
            return $id;
        });
    }

    public static function update_line(Conn $db, int $hid, int $id, array $fields): void
    {
        $line = self::line($db, $hid, $id);
        $allowed = ['name', 'section', 'category', 'is_debit_order', 'flexibility', 'notes', 'end_month', 'member_id', 'kind', 'to_member_id', 'goal_id'];
        $fields = array_intersect_key($fields, array_flip($allowed));
        $kind = $fields['kind'] ?? $line['kind'];
        if (!in_array($kind, self::KINDS, true)) {
            throw new \InvalidArgumentException('Unknown kind');
        }
        if ($kind === 'transfer') {
            $payer = (int)($fields['member_id'] ?? $line['member_id']);
            $to = isset($fields['to_member_id']) ? (int)$fields['to_member_id'] : ($line['to_member_id'] === null ? null : (int)$line['to_member_id']);
            if (!self::member_ok($db, $hid, $to) || $to === $payer) {
                throw new \InvalidArgumentException('A transfer needs a different person to receive it');
            }
            $fields['category'] = 'Transfers';
        } else {
            $fields['to_member_id'] = null;
        }
        if ($kind !== 'saving' && $line['goal_id'] !== null) {
            $fields['goal_id'] = null; // only saving lines fund goals
        }
        if ($kind !== 'transfer') {
            if ($kind === 'income') {
                $fields['category'] = 'Income';
            } elseif (in_array($line['kind'], ['income', 'transfer'], true) && in_array($fields['category'] ?? null, [null, 'Income', 'Transfers'], true)) {
                $fields['category'] = $kind === 'saving' ? 'Savings & investments' : Categorise::guess_category($fields['name'] ?? $line['name']);
            }
        }
        $sets = [];
        $params = [];
        foreach ($fields as $k => $v) {
            if ($k === 'name') {
                $v = mb_substr(trim((string)$v), 0, 80);
                if ($v === '') {
                    throw new \InvalidArgumentException('Give the item a name');
                }
            } elseif ($k === 'category' && !in_array($v, Categorise::categories(), true)) {
                throw new \InvalidArgumentException('Unknown category');
            } elseif ($k === 'flexibility' && !in_array($v, self::FLEX, true)) {
                throw new \InvalidArgumentException('Unknown flexibility');
            } elseif ($k === 'end_month') {
                $v = $v ?: null;
                if ($v) {
                    self::valid_month($v);
                    if ($v < $line['start_month']) {
                        throw new \InvalidArgumentException('End month is before the start month');
                    }
                }
            } elseif ($k === 'member_id') {
                $v = (int)$v;
                if (!self::member_ok($db, $hid, $v)) {
                    throw new \InvalidArgumentException('Unknown person');
                }
            } elseif ($k === 'to_member_id' && $v !== null) {
                $v = (int)$v;
            } elseif ($k === 'goal_id') {
                $v = $v === null || $v === '' || $kind !== 'saving' ? null : (int)$v;
                if ($v !== null && !$db->val('SELECT 1 FROM goals WHERE id = ? AND household_id = ?', [$v, $hid])) {
                    throw new \InvalidArgumentException('Unknown goal');
                }
            } elseif ($k === 'is_debit_order') {
                $v = (int)(bool)$v;
            } elseif ($k === 'notes') {
                $v = mb_substr(trim((string)$v), 0, 200) ?: null;
            } elseif ($k === 'section') {
                $v = mb_substr(trim((string)$v), 0, 40) ?: 'Monthly';
            }
            $sets[] = "$k = ?";
            $params[] = $v;
        }
        if ($sets) {
            $db->exec('UPDATE budget_lines SET ' . implode(', ', $sets) . ' WHERE id = ?', [...$params, $id]);
        }
    }

    public static function delete_line(Conn $db, int $hid, int $id): void
    {
        self::line($db, $hid, $id);
        $db->exec('DELETE FROM budget_lines WHERE id = ?', [$id]);
    }

    public static function amount_on(Conn $db, int $lineId, string $month): ?int
    {
        $v = $db->val('SELECT amount_cents FROM budget_amounts WHERE line_id = ? AND effective_month <= ? ORDER BY effective_month DESC LIMIT 1',
            [$lineId, $month]);
        return $v === null ? null : (int)$v;
    }

    /** Change an amount from $month onwards, or for $month only (the old amount resumes after). */
    public static function set_amount(Conn $db, int $hid, int $lineId, string $month, int $amount, string $mode = 'onward', ?string $note = null): array
    {
        $line = self::line($db, $hid, $lineId);
        self::valid_month($month);
        $amount = Money::cents($amount);
        if (!in_array($mode, ['onward', 'once'], true)) {
            throw new \InvalidArgumentException("mode must be 'onward' or 'once'");
        }
        if ($mode === 'once' && $month < $line['start_month']) {
            throw new \InvalidArgumentException("This item starts in {$line['start_month']}. For a one-off amount before then, add a separate item.");
        }
        $before = self::amount_on($db, $lineId, $month);
        $next = Money::add_months($month, 1);
        $db->tx(function (Conn $db) use ($line, $lineId, $month, $amount, $mode, $note, $before, $next) {
            if ($month < $line['start_month']) { // 'from then on' before the start: it now starts here, at this amount
                $db->exec('DELETE FROM budget_amounts WHERE line_id = ? AND effective_month = ?', [$lineId, $line['start_month']]);
                $db->exec('UPDATE budget_lines SET start_month = ? WHERE id = ?', [$month, $lineId]);
            }
            if ($mode === 'onward') { // replaces a one-month change made for this same month
                $db->exec("DELETE FROM budget_amounts WHERE line_id = ? AND effective_month = ? AND note = 'back to usual'", [$lineId, $next]);
            }
            if ($mode === 'once' && $before !== null
                && !$db->val('SELECT 1 FROM budget_amounts WHERE line_id = ? AND effective_month = ?', [$lineId, $next])) {
                $db->exec("INSERT INTO budget_amounts (line_id, effective_month, amount_cents, note) VALUES (?, ?, ?, 'back to usual')",
                    [$lineId, $next, self::amount_on($db, $lineId, $next)]);
            }
            $db->exec("INSERT INTO budget_amounts (line_id, effective_month, amount_cents, note) VALUES (?, ?, ?, ?)
                       ON CONFLICT (line_id, effective_month) DO UPDATE SET amount_cents = excluded.amount_cents,
                       note = excluded.note, created_at = datetime('now')",
                [$lineId, $month, $amount, mb_substr(trim((string)$note), 0, 120) ?: null]);
            if ($mode === 'onward') { // later one-month changes now return to the new amount, not the old one
                foreach ($db->all("SELECT effective_month FROM budget_amounts WHERE line_id = ? AND effective_month > ? AND note = 'back to usual'",
                        [$lineId, $next]) as $r) {
                    $usual = self::amount_on($db, $lineId, Money::add_months($r['effective_month'], -2));
                    if ($usual !== null) {
                        $db->exec('UPDATE budget_amounts SET amount_cents = ? WHERE line_id = ? AND effective_month = ?', [$usual, $lineId, $r['effective_month']]);
                    }
                }
            }
            // Drop redundant history rows (same amount as the row before), keeping the start row.
            $rows = $db->all('SELECT effective_month, amount_cents FROM budget_amounts WHERE line_id = ? ORDER BY effective_month', [$lineId]);
            for ($i = 1; $i < count($rows); $i++) {
                if ($rows[$i]['amount_cents'] === $rows[$i - 1]['amount_cents']) {
                    $db->exec('DELETE FROM budget_amounts WHERE line_id = ? AND effective_month = ?', [$lineId, $rows[$i]['effective_month']]);
                }
            }
        });
        return ['before_cents' => $before, 'after_cents' => $amount, 'month' => $month, 'mode' => $mode];
    }

    public static function history(Conn $db, int $hid, int $lineId): array
    {
        self::line($db, $hid, $lineId);
        $out = [];
        $prev = null;
        foreach ($db->all('SELECT effective_month, amount_cents, note FROM budget_amounts WHERE line_id = ? ORDER BY effective_month', [$lineId]) as $r) {
            $a = (int)$r['amount_cents'];
            $out[] = ['month' => $r['effective_month'], 'amount_cents' => $a, 'note' => $r['note'], 'change_cents' => $prev === null ? null : $a - $prev];
            $prev = $a;
        }
        return $out;
    }

    public static function set_paid(Conn $db, int $hid, int $lineId, string $month, bool $paid): void
    {
        self::line($db, $hid, $lineId);
        self::valid_month($month);
        $db->exec('INSERT INTO line_status (line_id, month, paid) VALUES (?, ?, ?) ON CONFLICT (line_id, month) DO UPDATE SET paid = excluded.paid',
            [$lineId, $month, (int)$paid]);
    }

    public static function active_lines(Conn $db, int $hid, string $month): array
    {
        $prevMonth = Money::add_months($month, -1);
        $rows = $db->all("SELECT l.*,
              (SELECT amount_cents FROM budget_amounts a WHERE a.line_id = l.id AND a.effective_month <= ? ORDER BY a.effective_month DESC LIMIT 1) AS amount_cents,
              (SELECT amount_cents FROM budget_amounts a WHERE a.line_id = l.id AND a.effective_month <= ? ORDER BY a.effective_month DESC LIMIT 1) AS prev_amount_cents,
              (SELECT paid FROM line_status s WHERE s.line_id = l.id AND s.month = ?) AS paid
            FROM budget_lines l
            WHERE l.household_id = ? AND l.start_month <= ? AND (l.end_month IS NULL OR l.end_month >= ?)
            ORDER BY l.sort, l.id", [$month, $prevMonth, $month, $hid, $month, $month]);
        $out = [];
        foreach ($rows as $r) {
            if ($r['amount_cents'] === null) {
                continue;
            }
            $prevActive = $r['start_month'] <= $prevMonth;
            $d = $r;
            foreach (['id', 'household_id', 'member_id', 'sort'] as $k) {
                $d[$k] = (int)$r[$k];
            }
            $d['to_member_id'] = $r['to_member_id'] === null ? null : (int)$r['to_member_id'];
            $d['goal_id'] = $r['goal_id'] === null ? null : (int)$r['goal_id'];
            $d['amount_cents'] = (int)$r['amount_cents'];
            $d['prev_amount_cents'] = $prevActive && $r['prev_amount_cents'] !== null ? (int)$r['prev_amount_cents'] : null;
            $d['change_cents'] = $d['prev_amount_cents'] !== null ? $d['amount_cents'] - $d['prev_amount_cents'] : null;
            $d['is_new'] = $r['start_month'] === $month;
            $d['ends_this_month'] = $r['end_month'] === $month;
            $d['paid'] = (bool)$r['paid'];
            $d['group'] = Categorise::group($r['category']);
            $d['is_debit_order'] = (bool)$r['is_debit_order'];
            $out[] = $d;
        }
        return $out;
    }

    private static function totals(array $lines, int $mid): array
    {
        $t = ['income_cents' => 0, 'expense_cents' => 0, 'saving_cents' => 0, 'transfer_in_cents' => 0, 'transfer_out_cents' => 0];
        foreach ($lines as $l) {
            $a = $l['amount_cents'];
            if ($l['kind'] === 'transfer') {
                if ($l['member_id'] === $mid) {
                    $t['transfer_out_cents'] += $a;
                }
                if ($l['to_member_id'] === $mid) {
                    $t['transfer_in_cents'] += $a;
                }
            } elseif ($l['member_id'] === $mid) {
                $t[$l['kind'] . '_cents'] += $a;
            }
        }
        $t['money_in_cents'] = $t['income_cents'] + $t['transfer_in_cents'];
        $t['money_out_cents'] = $t['expense_cents'] + $t['saving_cents'] + $t['transfer_out_cents'];
        $t['surplus_cents'] = $t['money_in_cents'] - $t['money_out_cents'];
        return $t;
    }

    public static function month_view(Conn $db, int $hid, string $month, ?int $memberId = null): array
    {
        self::valid_month($month);
        $people = self::members($db, $hid);
        $lines = self::active_lines($db, $hid, $month);
        $names = array_column($people, 'name', 'id');
        foreach ($lines as &$l) {
            $l['member_name'] = $names[$l['member_id']] ?? null;
            $l['to_member_name'] = $l['to_member_id'] !== null ? ($names[$l['to_member_id']] ?? null) : null;
        }
        unset($l);

        $per = [];
        foreach ($people as $p) {
            if ($memberId !== null && $p['id'] !== $memberId) {
                continue;
            }
            $sections = [];
            foreach ($lines as $l) {
                if ($l['member_id'] === $p['id']) {
                    $sections[$l['section']][] = $l;
                }
            }
            $per[] = $p + self::totals($lines, $p['id']) + [
                'sections' => array_map(fn($k) => ['name' => (string)$k, 'lines' => $sections[$k]], array_keys($sections)),
                'incoming_transfers' => array_values(array_filter($lines, fn($l) => $l['kind'] === 'transfer' && $l['to_member_id'] === $p['id'])),
            ];
        }
        $scoped = $memberId === null ? $lines : array_values(array_filter($lines, fn($l) => $l['member_id'] === $memberId));
        $sumKind = fn(string $k) => array_sum(array_map(fn($l) => $l['kind'] === $k ? $l['amount_cents'] : 0, $scoped));
        $hh = ['income_cents' => $sumKind('income'), 'expense_cents' => $sumKind('expense'), 'saving_cents' => $sumKind('saving')];
        if ($memberId === null) {
            $hh['surplus_cents'] = $hh['income_cents'] - $hh['expense_cents'] - $hh['saving_cents'];
        } else {
            $hh['surplus_cents'] = $per[0]['surplus_cents'] ?? 0;
            $hh['transfer_in_cents'] = $per[0]['transfer_in_cents'] ?? 0;
            $hh['transfer_out_cents'] = $per[0]['transfer_out_cents'] ?? 0;
        }
        $byGroup = ['Essentials' => 0, 'Lifestyle' => 0, 'Savings' => 0];
        $byCat = [];
        foreach ($scoped as $l) {
            if (in_array($l['kind'], ['expense', 'saving'], true)) {
                $g = $l['kind'] === 'saving' ? 'Savings' : $l['group'];
                $byGroup[isset($byGroup[$g]) ? $g : 'Lifestyle'] += $l['amount_cents'];
                $byCat[$l['category']] = ($byCat[$l['category']] ?? 0) + $l['amount_cents'];
            }
        }
        arsort($byCat);
        $paid = array_values(array_filter($scoped, fn($l) => $l['kind'] !== 'income'));
        $paidDone = array_filter($paid, fn($l) => $l['paid']);
        return [
            'month' => $month, 'people' => $per, 'household' => $hh, 'by_group' => $byGroup,
            'by_category' => array_map(fn($k) => ['category' => (string)$k, 'planned_cents' => $byCat[$k]], array_keys($byCat)),
            'progress' => ['paid' => count($paidDone), 'total' => count($paid),
                'paid_cents' => array_sum(array_column($paidDone, 'amount_cents')), 'total_cents' => array_sum(array_column($paid, 'amount_cents'))],
            'changes' => array_values(array_filter($scoped, fn($l) => $l['change_cents'] || $l['is_new'])),
            'lines' => $scoped,
        ];
    }

    /** Debit orders active in $month, with how they've moved over the past year. */
    public static function debit_order_review(Conn $db, int $hid, string $month, ?int $memberId = null): array
    {
        $names = array_column(self::members($db, $hid), 'name', 'id');
        $yearAgo = Money::add_months($month, -12);
        $out = [];
        foreach (self::active_lines($db, $hid, $month) as $l) {
            if (!$l['is_debit_order'] || ($memberId !== null && $l['member_id'] !== $memberId)) {
                continue;
            }
            $hist = $db->all('SELECT effective_month, amount_cents FROM budget_amounts WHERE line_id = ? ORDER BY effective_month', [$l['id']]);
            $then = self::amount_on($db, $l['id'], $yearAgo);
            $since = $then !== null ? $yearAgo : $hist[0]['effective_month'];
            $then ??= (int)$hist[0]['amount_cents'];
            $out[] = [
                'id' => $l['id'], 'name' => $l['name'], 'member_id' => $l['member_id'], 'member_name' => $names[$l['member_id']] ?? null,
                'category' => $l['category'], 'notes' => $l['notes'], 'amount_cents' => $l['amount_cents'], 'change_cents' => $l['change_cents'],
                'since_month' => $since, 'since_amount_cents' => $then, 'year_change_cents' => $l['amount_cents'] - $then,
                'year_change_pct' => $then ? round(100 * ($l['amount_cents'] - $then) / $then, 1) : null,
                'end_month' => $l['end_month'],
                'history' => array_values(array_map(fn($h) => ['month' => $h['effective_month'], 'amount_cents' => (int)$h['amount_cents']],
                    array_filter($hist, fn($h) => $h['effective_month'] <= $month))),
                'upcoming' => array_values(array_map(fn($h) => ['month' => $h['effective_month'], 'amount_cents' => (int)$h['amount_cents']],
                    array_filter($hist, fn($h) => $h['effective_month'] > $month))),
            ];
        }
        usort($out, fn($a, $b) => $b['amount_cents'] <=> $a['amount_cents']);
        return $out;
    }
}
