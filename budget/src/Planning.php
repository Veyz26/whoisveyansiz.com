<?php
/** Next-month forecast with insights, and goals with suggested cuts. Mirrors forecast.py and goals.py. */
declare(strict_types=1);

namespace Linen;

final class Forecast
{
    private static function insight(string $kind, string $tone, string $title, string $detail, ?int $amount = null): array
    {
        return ['kind' => $kind, 'tone' => $tone, 'title' => $title, 'detail' => $detail, 'amount_cents' => $amount];
    }

    private static function slim(array $p): array
    {
        unset($p['sections'], $p['incoming_transfers']);
        return $p;
    }

    public static function forecast(Conn $db, int $hid, string $month, ?int $memberId = null, int $horizon = 6): array
    {
        $R = [Money::class, 'format_zar'];
        $M = [Money::class, 'month_name'];
        $next = Money::add_months($month, 1);
        $cur = Budget::month_view($db, $hid, $month, $memberId);
        $nxt = Budget::month_view($db, $hid, $next, $memberId);
        $ins = [];

        // Transfers between partners cancel out for the household, so they're only shown in a person's own
        // view; more saving is good news, not a warning.
        foreach ($memberId !== null && $nxt['people'] ? $nxt['people'][0]['incoming_transfers'] : [] as $l) {
            if ($l['change_cents'] && $l['change_cents'] < 0) {
                $ins[] = self::insight('change', 'warn', "Money from {$l['member_name']} goes down " . $R(-$l['change_cents']),
                    'From ' . $M($next) . ': ' . $R($l['prev_amount_cents']) . ' → ' . $R($l['amount_cents']) . '.', $l['change_cents']);
            }
        }
        foreach ($nxt['lines'] as $l) {
            if ($l['kind'] === 'transfer' && $memberId === null) {
                continue;
            }
            if ($l['change_cents']) {
                $up = $l['change_cents'] > 0;
                $who = $memberId === null ? "{$l['member_name']}'s " : '';
                $tone = $l['kind'] === 'saving' && $up ? 'good' : ($up === ($l['kind'] !== 'income') ? 'warn' : 'good');
                $ins[] = self::insight('change', $tone,
                    "$who{$l['name']} " . ($up ? 'goes up' : 'goes down') . ' ' . $R(abs($l['change_cents'])),
                    'From ' . $M($next) . ': ' . $R($l['prev_amount_cents']) . ' → ' . $R($l['amount_cents']) . '.',
                    $l['kind'] === 'income' ? $l['change_cents'] : -$l['change_cents']);
            } elseif ($l['is_new']) {
                $ins[] = self::insight('new', 'info', "New: {$l['name']}", $R($l['amount_cents']) . ' a month from ' . $M($next) . '.',
                    $l['kind'] !== 'income' ? -$l['amount_cents'] : $l['amount_cents']);
            }
        }
        foreach ($memberId !== null && $cur['people'] ? $cur['people'][0]['incoming_transfers'] : [] as $l) {
            if ($l['ends_this_month']) {
                $ins[] = self::insight('ending', 'warn', "Money from {$l['member_name']} ends this month",
                    'The last ' . $R($l['amount_cents']) . ' comes in ' . $M($month) . '.', -$l['amount_cents']);
            }
        }
        foreach ($cur['lines'] as $l) {
            if ($l['kind'] === 'transfer' && $memberId === null) {
                continue;
            }
            if ($l['ends_this_month'] && in_array($l['kind'], ['expense', 'saving', 'transfer'], true)) {
                $ins[] = self::insight('ending', 'good', "{$l['name']} ends this month",
                    'Its last ' . $R($l['amount_cents']) . ' payment is in ' . $M($month) . ', freeing that up from ' . $M($next) . '.', $l['amount_cents']);
            }
        }
        if ($memberId === null && count($nxt['people']) > 1) {
            $spare = array_values(array_filter($nxt['people'], fn($p) => $p['surplus_cents'] > 0));
            usort($spare, fn($a, $b) => $b['surplus_cents'] <=> $a['surplus_cents']);
            foreach ($nxt['people'] as $p) {
                if ($p['surplus_cents'] >= 0) {
                    continue;
                }
                $h = $spare[0] ?? null;
                $cover = $h && $h['surplus_cents'] >= -$p['surplus_cents'] ? " {$h['name']} has " . $R($h['surplus_cents']) . ' spare, so a transfer could cover it.' : '';
                $ins[] = self::insight('shortfall', 'warn', "{$p['name']} is " . $R(-$p['surplus_cents']) . ' short next month',
                    "Planned outgoings are more than {$p['name']}'s money in.$cover", $p['surplus_cents']);
            }
        }
        if ($nxt['household']['surplus_cents'] < 0) {
            $ins[] = self::insight('shortfall', 'warn', 'Next month is ' . $R(-$nxt['household']['surplus_cents']) . ' short overall',
                'Look at the lifestyle items on the Goals page for what could be trimmed.', $nxt['household']['surplus_cents']);
        }

        $scope = new Scope($hid, $memberId);
        $latest = Analysis::latest_month($db, $scope);
        if ($latest) {
            $actual = Analysis::average_by_category($db, $scope, min($latest, $month));
            arsort($actual);
            $planned = array_column($cur['by_category'], 'planned_cents', 'category');
            foreach ($actual as $cat => $avg) {
                if (!in_array($cat, [...Budget::REDUCIBLE_CATS, ...Budget::DISCRETIONARY_CATS], true)) {
                    continue;
                }
                $plan = $planned[$cat] ?? 0;
                if ($plan && $avg > $plan * 1.1 && $avg - $plan >= 20000) {
                    $ins[] = self::insight('overspend', 'warn', "$cat is running over plan",
                        'Statements average ' . $R($avg) . ' a month against ' . $R($plan) . ' planned.', $plan - $avg);
                }
            }
        }

        foreach (Budget::debit_order_review($db, $hid, $month, $memberId) as $d) {
            if ($d['year_change_pct'] && $d['year_change_pct'] >= 10 && $d['year_change_cents'] >= 10000) {
                $advice = in_array($d['category'], ['Insurance', 'Medical & health'], true) ? 'Worth getting a competing quote.'
                    : ($d['category'] === 'Subscriptions' ? 'Check you still use all of them.' : 'Worth checking why it went up.');
                $ins[] = self::insight('creep', 'info', "{$d['name']} is up " . number_format($d['year_change_pct'], 0) . '% since ' . $M($d['since_month']),
                    $R($d['since_amount_cents']) . ' → ' . $R($d['amount_cents']) . ". $advice", -$d['year_change_cents']);
            }
        }

        $income = $nxt['household']['income_cents'] + ($nxt['household']['transfer_in_cents'] ?? 0);
        if ($income) {
            $g = $nxt['by_group'];
            [$ess, $life, $sav] = array_map(fn($k) => Money::rnd(100 * $g[$k] / $income), ['Essentials', 'Lifestyle', 'Savings']);
            if ($sav < 10) {
                $ins[] = self::insight('balance', 'info', "Savings are $sav% of income",
                    "A common guide is 50% essentials, 30% lifestyle, 20% savings. You're at $ess% / $life% / $sav%.");
            }
        }
        $order = ['warn' => 0, 'good' => 1, 'info' => 2];
        usort($ins, fn($a, $b) => [$order[$a['tone']], -abs($a['amount_cents'] ?? 0)] <=> [$order[$b['tone']], -abs($b['amount_cents'] ?? 0)]);

        $proj = [];
        for ($i = 0; $i <= $horizon; $i++) {
            $m = Money::add_months($month, $i);
            $v = $i === 0 ? $cur : ($i === 1 ? $nxt : Budget::month_view($db, $hid, $m, $memberId));
            $proj[] = ['month' => $m, 'household_surplus_cents' => $v['household']['surplus_cents'],
                'people' => array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name'], 'surplus_cents' => $p['surplus_cents']], $v['people'])];
        }
        return [
            'month' => $month, 'next_month' => $next,
            'this' => ['household' => $cur['household'], 'people' => array_map([self::class, 'slim'], $cur['people'])],
            'next' => ['household' => $nxt['household'], 'people' => array_map([self::class, 'slim'], $nxt['people']), 'by_group' => $nxt['by_group']],
            'insights' => $ins, 'projection' => $proj,
        ];
    }
}

final class Goals
{
    private const CUT_SHARE = ['discretionary' => 0.5, 'reducible' => 0.1];

    public static function months_between(string $a, string $b): int
    {
        [$ya, $ma] = array_map('intval', explode('-', $a));
        [$yb, $mb] = array_map('intval', explode('-', $b));
        return ($yb - $ya) * 12 + ($mb - $ma);
    }

    public static function list(Conn $db, int $hid): array
    {
        return array_map(fn($g) => ['id' => (int)$g['id'], 'household_id' => (int)$g['household_id'],
            'member_id' => $g['member_id'] === null ? null : (int)$g['member_id'], 'name' => $g['name'],
            'target_cents' => (int)$g['target_cents'], 'saved_cents' => (int)$g['saved_cents'],
            'target_month' => $g['target_month'], 'created_at' => $g['created_at']],
            $db->all('SELECT * FROM goals WHERE household_id = ? ORDER BY created_at, id', [$hid]));
    }

    public static function save(Conn $db, int $hid, array $d, ?int $id = null): int
    {
        if ($id !== null) { // an edit only changes the fields it sends
            $old = $db->one('SELECT * FROM goals WHERE id = ? AND household_id = ?', [$id, $hid]);
            if (!$old) {
                throw new NotFound('Goal not found');
            }
            foreach (['name', 'target_cents', 'saved_cents', 'target_month', 'member_id'] as $k) {
                if (!array_key_exists($k, $d)) {
                    $d[$k] = $old[$k];
                }
            }
        }
        $name = mb_substr(trim((string)($d['name'] ?? '')), 0, 80);
        if (!isset($d['target_cents'])) {
            throw new \InvalidArgumentException('Target amount is required');
        }
        $target = Money::cents($d['target_cents'], 1);
        $saved = Money::cents($d['saved_cents'] ?? 0);
        if ($name === '' || $target <= 0 || $saved < 0) {
            throw new \InvalidArgumentException('Give the goal a name and a target above zero');
        }
        $tm = $d['target_month'] ?? null ?: null;
        if ($tm) {
            Budget::valid_month($tm);
        }
        $mid = isset($d['member_id']) && $d['member_id'] !== null && $d['member_id'] !== '' ? (int)$d['member_id'] : null;
        if ($mid !== null && !in_array($mid, array_column(Budget::members($db, $hid), 'id'), true)) {
            throw new \InvalidArgumentException('Unknown person');
        }
        if ($id === null) {
            return $db->insert('INSERT INTO goals (household_id, member_id, name, target_cents, saved_cents, target_month) VALUES (?, ?, ?, ?, ?, ?)',
                [$hid, $mid, $name, $target, $saved, $tm]);
        }
        if (!$db->exec('UPDATE goals SET member_id = ?, name = ?, target_cents = ?, saved_cents = ?, target_month = ? WHERE id = ? AND household_id = ?',
            [$mid, $name, $target, $saved, $tm, $id, $hid])) {
            throw new NotFound('Goal not found');
        }
        return $id;
    }

    /** Deletes the goal and returns an undo token; linked budget items are re-linked on undo. */
    public static function delete(Conn $db, int $hid, int $id): string
    {
        $goal = $db->one('SELECT * FROM goals WHERE id = ? AND household_id = ?', [$id, $hid]);
        if (!$goal) {
            throw new NotFound('Goal not found');
        }
        return $db->tx(function (Conn $db) use ($hid, $id, $goal) {
            $token = Undo::stash($db, $hid, 'goal', ['goal' => $goal,
                'line_ids' => array_map('intval', array_column($db->all('SELECT id FROM budget_lines WHERE goal_id = ?', [$id]), 'id'))]);
            $db->exec('DELETE FROM goals WHERE id = ?', [$id]);
            return $token;
        });
    }

    private static function cut_candidates(array $view): array
    {
        $out = [];
        foreach ($view['lines'] as $l) {
            $share = self::CUT_SHARE[$l['flexibility']] ?? null;
            if ($l['kind'] !== 'expense' || !$share || $l['amount_cents'] < 5000) {
                continue;
            }
            if (in_array($l['category'], Budget::NEVER_CUT_CATS, true)
                || ($l['is_debit_order'] && !in_array($l['category'], Budget::CANCELLABLE_DEBIT_CATS, true))) {
                continue;
            }
            $cut = intdiv((int)($l['amount_cents'] * $share), 1000) * 1000;
            if ($cut) {
                $out[] = ['line_id' => $l['id'], 'name' => $l['name'], 'member_name' => $l['member_name'], 'category' => $l['category'],
                    'flexibility' => $l['flexibility'], 'current_cents' => $l['amount_cents'], 'cut_cents' => $cut, 'new_cents' => $l['amount_cents'] - $cut];
            }
        }
        usort($out, fn($a, $b) => [$a['flexibility'] !== 'discretionary', -$a['cut_cents']] <=> [$b['flexibility'] !== 'discretionary', -$b['cut_cents']]);
        return $out;
    }

    private static function fee_win(Conn $db, int $hid, ?int $mid, string $month): int
    {
        $s = new Scope($hid, $mid);
        $latest = Analysis::latest_month($db, $s);
        if (!$latest) {
            return 0;
        }
        $f = Analysis::fees_and_interest($db, $s, min($latest, $month));
        return array_sum(array_map(fn($k) => $k['avoidable'] ? $k['monthly_avg_cents'] : 0, $f['fee_kinds']));
    }

    /** Budgeted saving lines that go towards this goal (already counted as money going out). */
    public static function linked_savings(Conn $db, int $hid, int $goalId, string $month): int
    {
        return array_sum(array_map(fn($l) => $l['kind'] === 'saving' && $l['goal_id'] === $goalId ? $l['amount_cents'] : 0,
            Budget::active_lines($db, $hid, $month)));
    }

    /** @param array<int,bool> $used cut suggestions already given to another goal (each cut is counted once) */
    public static function plan(Conn $db, int $hid, array $goal, string $month, ?int $contribution = null, array &$used = [],
                                bool $feeAvailable = true): array
    {
        $remaining = max(0, $goal['target_cents'] - $goal['saved_cents']);
        $next = Money::add_months($month, 1);
        $view = Budget::month_view($db, $hid, $next, $goal['member_id']);
        $surplusRaw = $view['household']['surplus_cents'];
        $surplus = max(0, $surplusRaw);
        $linked = isset($goal['id']) ? self::linked_savings($db, $hid, $goal['id'], $next) : 0;
        $cap = ($contribution === null ? $surplus : max(0, $contribution)) + $linked;
        $past = $goal['target_month'] && $goal['target_month'] <= $month;
        $monthsAt = fn(int $per) => $per > 0 ? (int)ceil($remaining / $per) : null;
        $r = [
            'goal' => $goal, 'remaining_cents' => $remaining, 'progress_pct' => round(100 * $goal['saved_cents'] / $goal['target_cents'], 1),
            'monthly_surplus_cents' => $surplus, 'contribution_cents' => $cap, 'linked_savings_cents' => $linked,
            'months_needed' => $remaining === 0 ? 0 : $monthsAt($cap), 'required_monthly_cents' => null, 'months_left' => null,
            'gap_cents' => 0, 'past_target' => $past && $remaining > 0, 'on_track' => $remaining === 0, 'cuts' => [], 'fee_win_cents' => 0,
        ];
        if ($r['months_needed'] !== null) {
            $r['eta_month'] = Money::add_months($month, $r['months_needed']);
        }
        if ($goal['target_month'] && !$past) {
            $left = max(1, self::months_between($month, $goal['target_month']));
            $required = (int)ceil($remaining / $left);
            $r['months_left'] = $left;
            $r['required_monthly_cents'] = $required;
            $r['gap_cents'] = max(0, $required - $cap);
            $r['on_track'] = $cap >= $required;
        } elseif ($past) {
            $r['on_track'] = $remaining === 0; // past its date: needs a new one
        } else {
            $r['on_track'] = $remaining === 0 || $cap > 0;
        }
        $targetExtra = $goal['target_month'] && !$past ? $r['gap_cents'] : null;
        $fee = $feeAvailable ? self::fee_win($db, $hid, $goal['member_id'], $month) : 0;
        $picked = [];
        $total = 0;
        if ($fee) {
            $r['fee_win_cents'] = $fee;
            $total += $fee;
        }
        foreach (self::cut_candidates($view) as $c) {
            if (isset($used[$c['line_id']])) {
                continue;
            }
            if (($targetExtra !== null && $total >= $targetExtra) || ($targetExtra === null && count($picked) >= 4)) {
                break;
            }
            $picked[] = $c;
            $total += $c['cut_cents'];
        }
        if ($remaining && ($targetExtra === null || $targetExtra > 0)) {
            foreach ($picked as $c) {
                $used[$c['line_id']] = true;
            }
            $r['cuts'] = $picked;
            $r['cuts_total_cents'] = $total;
            // A shortfall next month uses up the first part of any cuts.
            $r['months_with_cuts'] = $monthsAt($cap + $total + min(0, $surplusRaw));
            if ($r['months_with_cuts'] !== null) {
                $r['eta_with_cuts'] = Money::add_months($month, $r['months_with_cuts']);
            }
            if ($targetExtra !== null) {
                $r['cuts_close_gap'] = $total + min(0, $surplusRaw) >= $targetExtra;
            }
        }
        return $r;
    }

    /**
     * Plans for every goal, sharing out spare money so no rand is counted twice (see goals.py):
     * personal goals first from that person's spare money, shared goals from what's left of the
     * household's; deadlines first, open goals split the rest; past-date goals get nothing; each cut
     * suggestion and the bank-fee saving go to one goal only.
     */
    public static function plan_all(Conn $db, int $hid, string $month): array
    {
        $all = self::list($db, $hid);
        $next = Money::add_months($month, 1);
        $contrib = [];
        $allocate = function (array $goals, int $pool) use (&$contrib, $db, $hid, $month, $next): int {
            $live = array_values(array_filter($goals, fn($g) => $g['saved_cents'] < $g['target_cents'] && !($g['target_month'] && $g['target_month'] <= $month)));
            $dated = array_values(array_filter($live, fn($g) => (bool)$g['target_month']));
            usort($dated, fn($a, $b) => strcmp($a['target_month'], $b['target_month']));
            foreach ($dated as $g) {
                $need = max(0, (int)ceil(($g['target_cents'] - $g['saved_cents']) / max(1, self::months_between($month, $g['target_month'])))
                    - self::linked_savings($db, $hid, $g['id'], $next));
                $contrib[$g['id']] = min($need, $pool);
                $pool -= $contrib[$g['id']];
            }
            $open = array_values(array_filter($live, fn($g) => !$g['target_month']));
            foreach ($open as $g) {
                $contrib[$g['id']] = intdiv($pool, count($open));
            }
            return array_sum(array_map(fn($g) => $contrib[$g['id']] ?? 0, $goals));
        };
        $personal = 0;
        $memberIds = array_unique(array_filter(array_column($all, 'member_id'), fn($m) => $m !== null));
        sort($memberIds);
        foreach ($memberIds as $mid) {
            $pool = max(0, Budget::month_view($db, $hid, $next, $mid)['household']['surplus_cents']);
            $personal += $allocate(array_values(array_filter($all, fn($g) => $g['member_id'] === $mid)), $pool);
        }
        $household = max(0, Budget::month_view($db, $hid, $next)['household']['surplus_cents']);
        $allocate(array_values(array_filter($all, fn($g) => $g['member_id'] === null)), max(0, $household - $personal));

        $order = $all;
        usort($order, function ($a, $b) use ($month) {
            $key = fn($g) => [(bool)$g['target_month'] && $g['target_month'] <= $month, $g['target_month'] === null, $g['target_month'] ?? '', $g['id']];
            return $key($a) <=> $key($b);
        });
        $used = [];
        $plans = [];
        $feeGiven = false;
        foreach ($order as $g) {
            $plans[$g['id']] = self::plan($db, $hid, $g, $month, $contrib[$g['id']] ?? 0, $used, !$feeGiven);
            $feeGiven = $feeGiven || $plans[$g['id']]['fee_win_cents'] > 0;
        }
        return array_map(fn($g) => $plans[$g['id']], $all);
    }
}
