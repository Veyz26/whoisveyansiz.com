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
            $sets[] = 'source = NULL';  // an edited item drafted from statements is now theirs: a redraft keeps it
            $db->exec('UPDATE budget_lines SET ' . implode(', ', $sets) . ' WHERE id = ?', [...$params, $id]);
        }
    }

    // ------------------------------------------------------------------ drafting from statements (PHP only)
    /**
     * Drafts each person's budget from the statements of the accounts they own, so every page has numbers as soon
     * as statements are in. Only months the statements cover in full are used (up to the last 6):
     * - income: each payer whose money is categorised Income;
     * - each regular payment (debit orders, subscriptions; Analysis::recurring) as its own item;
     * - bank fees, interest and the rest of the spending, one item per category;
     * - money moved to the household's own accounts (savings, investments, pockets), net of money back from them:
     *   "Moved to your own accounts" when more went out, "Back from your own accounts" when more came back.
     * Each of those months gets its actual amount, so the plan's left over is the change in the balance. From the
     * month after, an item carries a typical amount:
     * - spending categories and own-account moves: the average over the months;
     * - regular payments: the latest month's amount (a debit order that went up stays up);
     * - income: the payer's usual payment (an amount they paid in two different months), not a one-off top-up.
     * Income and payments seen only once are one-offs: they keep their actual amount and stop. "Regular" is judged
     * on every statement row, part-months included, so a debit order on the 31st that fell outside one statement
     * still counts.
     * Items are marked source = 'statements' and remember what they were drafted from (draft_key). Redrafting
     * replaces only untouched drafted items; items people added, edited, ticked as paid or linked to a goal stay,
     * and nothing they already cover is drafted again (the same draft_key or kind and name; a payer when they've
     * added income of about the same amount; a category, or own-account moves, they've added an item for). A person whose
     * budget was built by hand (no drafted items) is left alone. Joint accounts aren't drafted: nobody is the
     * obvious owner.
     * @return array{lines:int, months:list<string>, members:list<string>}
     */
    public static function draft_from_statements(Conn $db, int $hid, ?int $onlyMember = null): array
    {
        return $db->tx(function (Conn $db) use ($hid, $onlyMember) {
            $out = ['lines' => 0, 'months' => [], 'members' => []];
            foreach (self::members($db, $hid) as $mem) {
                if ($onlyMember !== null && $mem['id'] !== $onlyMember) {
                    continue;
                }
                $byHand = !$db->val('SELECT 1 FROM budget_lines WHERE household_id = ? AND member_id = ? AND draft_key IS NOT NULL', [$hid, $mem['id']])
                    && $db->val('SELECT 1 FROM budget_lines WHERE household_id = ? AND member_id = ?', [$hid, $mem['id']]);
                if ($byHand) {
                    continue;
                }
                $s = new Scope($hid, $mem['id']);
                $months = array_reverse(array_slice(Analysis::complete_months($db, $s), 0, 6));  // oldest first
                if (!$months) {
                    continue;  // no month covered in full yet: nothing to draft without guessing
                }
                $out['lines'] += self::draft_member($db, $hid, $mem['id'], $s, $months);
                $out['members'][] = $mem['name'];
                $out['months'] = array_values(array_unique([...$out['months'], ...$months]));
            }
            sort($out['months']);
            return $out;
        });
    }

    /** True while every budget item a person has is an untouched draft (or they have none): safe to redraft. */
    public static function draft_untouched(Conn $db, int $hid, int $memberId): bool
    {
        return !$db->val("SELECT 1 FROM budget_lines WHERE household_id = ? AND member_id = ? AND (source IS NULL OR source != 'statements')",
            [$hid, $memberId]);
    }

    private static function draft_member(Conn $db, int $hid, int $memberId, Scope $s, array $months): int
    {
        $db->exec("DELETE FROM budget_lines WHERE household_id = ? AND member_id = ? AND source = 'statements'", [$hid, $memberId]);
        $theirs = [];  // what the items they keep already cover
        $theirIncome = [];  // amounts of income items they added themselves
        foreach ($db->all('SELECT id, kind, name, category, draft_key FROM budget_lines WHERE household_id = ? AND member_id = ?', [$hid, $memberId]) as $r) {
            $theirs[$r['kind'] . '|' . mb_strtolower($r['name'])] = true;
            if ($r['draft_key'] !== null) {
                $theirs[$r['draft_key']] = true;
            } elseif ($r['kind'] === 'income') {
                $theirIncome[] = (int)self::amount_on($db, (int)$r['id'], end($months));
            } elseif ($r['kind'] === 'saving') {
                $theirs['moves'] = true;
            } else {
                $theirs['cat|' . $r['category']] = true;
            }
        }
        $last = end($months);
        $regular = [];
        foreach (Analysis::recurring($db, $s, $last) as $r) {
            if ($r['active']) {
                $regular[$r['merchant']] = true;
            }
        }
        [$w, $p] = $s->sql();
        // Every row, part-months included: how often something happens is judged on all of them.
        $rows = $db->all("SELECT t.posted_on, substr(t.posted_on, 1, 7) AS m, t.merchant, t.category, t.description, t.amount_cents, t.is_transfer
            FROM transactions t WHERE $w ORDER BY t.posted_on", $p);
        $inWindow = array_flip($months);
        $items = [];
        $moved = array_fill_keys($months, 0);
        foreach ($rows as $t) {
            $amt = (int)$t['amount_cents'];
            $cat = $t['category'];
            if ($t['is_transfer'] || $cat === 'Transfers' || $cat === 'Savings & investments') {
                if (isset($inWindow[$t['m']])) {
                    $moved[$t['m']] -= $amt;
                }
                continue;
            }
            if ($amt > 0 && $cat !== 'Income') {
                [$key, $kind] = ["cat|$cat", 'expense'];  // money back lowers that category's spending
            } elseif ($amt > 0) {
                [$key, $kind] = ["in|{$t['merchant']}", 'income'];
            } elseif (isset($regular[$t['merchant']]) && !in_array($cat, ['Bank fees', 'Interest charged'], true)) {
                [$key, $kind] = ["reg|{$t['merchant']}", 'expense'];
            } else {
                [$key, $kind] = ["cat|$cat", 'expense'];
            }
            $items[$key] ??= ['kind' => $kind, 'category' => $kind === 'income' ? 'Income' : $cat, 'debit_order' => false,
                'per' => array_fill_keys($months, 0), 'seen' => [], 'credits' => [],
                'name' => str_starts_with($key, 'cat|') ? $cat : self::payee_name($t['merchant'])];
            $it = &$items[$key];
            $it['seen'][$t['m']] = true;
            if ($kind === 'income') {
                $it['credits'][] = [$t['m'], $amt];
            }
            if (isset($inWindow[$t['m']])) {
                $it['per'][$t['m']] += $kind === 'income' ? $amt : -$amt;
            }
            if (str_starts_with($key, 'reg|') && preg_match('/DEBIT ORDER|DEBICHECK|MAGTAPE DEBIT|\bD\/O\b/i', $t['description'])) {
                $it['debit_order'] = true;
            }
            unset($it);
        }
        $avg = fn(array $per) => Money::rnd(array_sum($per) / count($months));
        // A category whose refunds beat its spending in a month: that excess is money back, planned as income.
        $back = array_fill_keys($months, 0);
        foreach ($items as $key => &$it) {
            if (str_starts_with($key, 'cat|')) {
                foreach ($it['per'] as $m => $v) {
                    if ($v < 0) {
                        [$back[$m], $it['per'][$m]] = [$back[$m] - $v, 0];
                    }
                }
            }
        }
        unset($it);
        $items['cat|refunds'] = ['kind' => 'income', 'category' => 'Income', 'debit_order' => false, 'name' => 'Money back (refunds)',
            'per' => $back, 'seen' => [], 'credits' => []];
        // Own-account moves, net, as two items so neither amount is ever negative.
        $items['moves|out'] = ['kind' => 'saving', 'category' => 'Savings & investments', 'debit_order' => false, 'name' => 'Moved to your own accounts',
            'per' => array_map(fn($v) => max(0, $v), $moved), 'seen' => [], 'credits' => []];
        $items['moves|back'] = ['kind' => 'income', 'category' => 'Income', 'debit_order' => false, 'name' => 'Back from your own accounts',
            'per' => array_map(fn($v) => max(0, -$v), $moved), 'seen' => [], 'credits' => []];

        $made = 0;
        ksort($items);
        foreach ($items as $key => $it) {
            $present = array_filter($it['per'], fn($v) => $v > 0);
            // Income they added themselves covers a payer when it's about the same amount (their "Salary" is this
            // payroll); a different amount (a bonus, a side gig) doesn't.
            $usual = str_starts_with($key, 'in|') ? self::usual_amount($it, $months) : 0;
            $covered = isset($theirs[$key]) || isset($theirs[$it['kind'] . '|' . mb_strtolower($it['name'])])
                || ($usual > 0 && array_filter($theirIncome, fn($a) => abs($a - $usual) <= 0.1 * $usual))
                || (str_starts_with($key, 'moves|') && isset($theirs['moves'])) || ($it['kind'] === 'expense' && isset($theirs['cat|' . $it['category']]));
            if (!$present || $covered) {
                continue;
            }
            if ($key === 'cat|refunds') {
                [$typical, $start] = [0, array_key_first($present)];  // money back happened; it isn't planned on
            } elseif (str_starts_with($key, 'cat|') || str_starts_with($key, 'moves|')) {
                [$typical, $start] = [$avg($it['per']), $months[0]];
            } else {
                // Regular when seen in two different months (any rows, part-months too), or when there's only one month.
                $typical = count($it['seen']) >= 2 || count($months) === 1 ? self::usual_amount($it, $months) : 0;
                $start = array_key_first($present);
            }
            $id = self::create_line($db, $hid, ['member_id' => $memberId, 'kind' => $it['kind'], 'name' => $it['name'],
                'category' => $it['category'], 'is_debit_order' => $it['debit_order'], 'amount_cents' => $it['per'][$start], 'start_month' => $start]);
            foreach ($months as $m) {
                if ($m > $start) {
                    self::set_amount($db, $hid, $id, $m, $it['per'][$m]);
                }
            }
            if ($typical === 0) {
                $db->exec('UPDATE budget_lines SET end_month = ? WHERE id = ?', [array_key_last($present), $id]);  // a one-off
            } elseif ($typical !== $it['per'][end($months)]) {
                self::set_amount($db, $hid, $id, Money::add_months(end($months), 1), $typical);
            }
            $db->exec("UPDATE budget_lines SET source = 'statements', draft_key = ? WHERE id = ?", [$key, $id]);
            $made++;
        }
        return $made;
    }

    /**
     * What a regular item usually costs: the latest month it appeared in. For income, the payer's usual payment: the
     * latest single amount they also paid (within 5%) in another month, so a one-off top-up isn't planned on.
     */
    private static function usual_amount(array $it, array $months): int
    {
        if ($it['kind'] === 'income') {
            foreach (array_reverse($it['credits']) as [$m, $a]) {
                foreach ($it['credits'] as [$m2, $a2]) {
                    if ($m2 !== $m && abs($a2 - $a) <= 0.05 * $a) {
                        return $a;
                    }
                }
            }
        }
        foreach (array_reverse($months) as $m) {
            if ($it['per'][$m] > 0) {
                return $it['per'][$m];
            }
        }
        return 0;
    }

    /** "ACME PAYROLL SERVICES" -> "Acme Payroll Services", keeping short codes such as FNB or MTN in capitals. */
    private static function payee_name(string $merchant): string
    {
        return implode(' ', array_map(fn($w) => strlen($w) <= 3 && $w !== 'COM' ? $w : ucfirst(strtolower($w)),
            explode(' ', $merchant))) ?: 'Payment';
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
        $db->exec('UPDATE budget_lines SET source = NULL WHERE id = ?', [$lineId]);  // ticked: theirs now, a redraft keeps it
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
