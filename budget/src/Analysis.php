<?php
/** Aggregates over imported bank transactions (actual spending). Mirrors analysis.py, advice.py and debt.py. */
declare(strict_types=1);

namespace Linen;

/** Which data a query sees: one household, optionally one person in it. */
final class Scope
{
    public function __construct(public readonly int $householdId, public readonly ?int $memberId = null) {}

    /** @return array{0:string,1:array} */
    public function sql(string $alias = 't'): array
    {
        $clause = "$alias.household_id = ?";
        $params = [$this->householdId];
        if ($this->memberId !== null) {
            $clause .= " AND $alias.account_id IN (SELECT id FROM accounts WHERE member_id = ?)";
            $params[] = $this->memberId;
        }
        return [$clause, $params];
    }
}

final class Analysis
{
    private const COUNTED = "t.is_transfer = 0 AND t.category NOT IN ('Transfers', 'Savings & investments')";
    private const FEE_KINDS = [
        ['ATM / cash withdrawal fees', '/ATM|CASH WITHDRAWAL|CASH WDL|WITHDRAWAL FEE/'],
        ['Notification fees', '/NOTIFICATION|SMS/'],
        ['Cash deposit fees', '/CASH DEP/'],
        ['Declined / unpaid fees', '/DECLINED|UNPAID|INSUFFICIENT|DISHONOUR/'],
        ['Monthly account fee', '/MONTHLY|ACCOUNT FEE|SERVICE FEE|ADMIN FEE|MANAGEMENT FEE/'],
    ];
    public const DISCRETIONARY = ['Groceries', 'Fuel & transport', 'Eating out', 'Shopping', 'Entertainment', 'Other'];

    public static function months(Conn $db, Scope $s): array
    {
        [$w, $p] = $s->sql();
        return array_column($db->all("SELECT DISTINCT substr(t.posted_on, 1, 7) AS m FROM transactions t WHERE $w ORDER BY m DESC", $p), 'm');
    }

    public static function latest_month(Conn $db, Scope $s): ?string
    {
        return self::months($db, $s)[0] ?? null;
    }

    /**
     * How much of each month the statements cover (0..1), from each import's period. Each account counts from its
     * first statement to the newest month any account has, so a month it has no statement for (a gap, or a month
     * not uploaded yet) counts as 0; with several accounts the least-covered one counts, so a month is only
     * complete when every account's statements cover it.
     * @return array<string, float> month => share of its days covered, newest first
     */
    public static function coverage(Conn $db, Scope $s): array
    {
        $sql = 'SELECT i.account_id, i.period_from, i.period_to FROM imports i JOIN accounts a ON a.id = i.account_id
                WHERE i.household_id = ? AND i.period_from IS NOT NULL AND i.period_to IS NOT NULL';
        $p = [$s->householdId];
        if ($s->memberId !== null) {
            $sql .= ' AND a.member_id = ?';
            $p[] = $s->memberId;
        }
        $ranges = [];
        foreach ($db->all($sql . ' ORDER BY i.account_id, i.period_from', $p) as $r) {
            $ranges[$r['account_id']][] = [$r['period_from'], $r['period_to']];
        }
        $cov = [];
        $perAccount = [];
        foreach ($ranges as $list) {
            $days = [];  // month => days covered, overlapping statements merged first
            [$from, $to] = $list[0];
            foreach ([...array_slice($list, 1), null] as $next) {
                if ($next !== null && $next[0] <= date('Y-m-d', strtotime("$to +1 day"))) {
                    $to = max($to, $next[1]);
                    continue;
                }
                for ($d = $from; $d <= $to; $d = date('Y-m-d', strtotime("$end +1 day"))) {
                    $end = min($to, date('Y-m-t', strtotime($d)));
                    $days[substr($d, 0, 7)] = ($days[substr($d, 0, 7)] ?? 0) + (strtotime($end) - strtotime($d)) / 86400 + 1;
                }
                if ($next !== null) {
                    [$from, $to] = $next;
                }
            }
            $perAccount[] = $days;
        }
        $newest = $perAccount ? max(array_map(fn($d) => array_key_last($d), $perAccount)) : null;
        foreach ($perAccount as $days) {
            // An account with nothing for over two months before the newest month is closed or no longer uploaded:
            // it counts up to its last statement only, so it doesn't make every later month incomplete.
            $until = array_key_last($days) >= Money::add_months($newest, -2) ? $newest : array_key_last($days);
            for ($m = array_key_first($days); $m <= $until; $m = Money::add_months($m, 1)) {
                $cov[$m] = (float)min($cov[$m] ?? 1.0, ($days[$m] ?? 0) / (int)date('t', strtotime("$m-01")));
            }
        }
        krsort($cov);
        return $cov;
    }

    /** Months the statements cover (almost) fully: at least 90% of the days, newest first. */
    public static function complete_months(Conn $db, Scope $s): array
    {
        return array_keys(array_filter(self::coverage($db, $s), fn($f) => $f >= 0.9));
    }

    public static function category_totals(Conn $db, Scope $s, string $month): array
    {
        [$w, $p] = $s->sql();
        $out = [];
        // Money back (refunds) lowers its category's spending; income isn't spending.
        foreach ($db->all("SELECT t.category, -SUM(t.amount_cents) AS spend FROM transactions t
                WHERE $w AND substr(t.posted_on, 1, 7) = ? AND t.category != 'Income' AND " . self::COUNTED . ' GROUP BY t.category HAVING spend > 0',
                [...$p, $month]) as $r) {
            $out[$r['category']] = (int)$r['spend'];
        }
        return $out;
    }

    /** @return array{0:int,1:int} income, spend */
    public static function totals(Conn $db, Scope $s, string $month): array
    {
        [$w, $p] = $s->sql();
        $r = $db->one("SELECT COALESCE(SUM(CASE WHEN t.category = 'Income' AND t.amount_cents > 0 THEN t.amount_cents END), 0) AS income,
                              COALESCE(-SUM(CASE WHEN t.category != 'Income' THEN t.amount_cents END), 0) AS spend
                       FROM transactions t WHERE $w AND substr(t.posted_on, 1, 7) = ? AND " . self::COUNTED, [...$p, $month]);
        return [(int)$r['income'], (int)$r['spend']];
    }

    /** Up to $n complete months before $month (a part-month would drag comparisons down). */
    public static function prior_months(Conn $db, Scope $s, string $month, int $n = 3): array
    {
        $have = array_flip(self::complete_months($db, $s));
        $out = [];
        for ($i = 1; $i <= $n; $i++) {
            $m = Money::add_months($month, -$i);
            if (isset($have[$m])) {
                $out[] = $m;
            }
        }
        return $out;
    }

    public static function average_by_category(Conn $db, Scope $s, string $month, int $n = 3): array
    {
        // Complete months only; with none yet, the months that have any data.
        $have = array_flip(self::complete_months($db, $s) ?: self::months($db, $s));
        $ms = [];
        for ($i = 0; $i < $n; $i++) {
            $m = Money::add_months($month, -$i);
            if (isset($have[$m])) {
                $ms[] = $m;
            }
        }
        if (!$ms) {
            return [];
        }
        $sums = [];
        foreach ($ms as $m) {
            foreach (self::category_totals($db, $s, $m) as $c => $v) {
                $sums[$c] = ($sums[$c] ?? 0) + $v;
            }
        }
        return array_map(fn($v) => Money::rnd($v / count($ms)), $sums);
    }

    public static function summary(Conn $db, Scope $s, string $month): array
    {
        [$income, $spend] = self::totals($db, $s, $month);
        $cats = self::category_totals($db, $s, $month);
        $priors = self::prior_months($db, $s, $month);
        $priorCats = array_map(fn($m) => self::category_totals($db, $s, $m), $priors);
        $priorTotals = array_map(fn($m) => self::totals($db, $s, $m), $priors);
        $avg = fn(array $xs) => $xs ? Money::rnd(array_sum($xs) / count($xs)) : null;
        $all = array_keys($cats);
        foreach ($priorCats as $pc) {
            $all = array_merge($all, array_keys($pc));
        }
        $by = [];
        foreach (array_unique($all) as $c) {
            $by[] = ['category' => $c, 'spend_cents' => $cats[$c] ?? 0,
                     'prior_avg_cents' => $avg(array_map(fn($pc) => $pc[$c] ?? 0, $priorCats))];
        }
        usort($by, fn($a, $b) => $b['spend_cents'] <=> $a['spend_cents']);
        [$w, $p] = $s->sql();
        $saved = (int)$db->val("SELECT COALESCE(-SUM(t.amount_cents), 0) FROM transactions t WHERE $w
            AND substr(t.posted_on, 1, 7) = ? AND t.category = 'Savings & investments' AND t.amount_cents < 0", [...$p, $month]);
        // Money moved to (net of money back from) the household's own accounts: savings, investments and transfers.
        // What came in, minus spending, minus this, is how much the balance changed.
        $moved = (int)$db->val("SELECT COALESCE(-SUM(t.amount_cents), 0) FROM transactions t WHERE $w
            AND substr(t.posted_on, 1, 7) = ? AND NOT (" . self::COUNTED . ')', [...$p, $month]);
        $uncat = (int)$db->val("SELECT COUNT(*) FROM transactions t WHERE $w AND substr(t.posted_on, 1, 7) = ? AND t.category = 'Other'",
            [...$p, $month]);
        $cov = self::coverage($db, $s)[$month] ?? null;
        return [
            'month' => $month, 'coverage' => $cov === null ? null : round($cov, 2), 'partial' => $cov !== null && $cov < 0.9,
            'income_cents' => $income, 'spend_cents' => $spend, 'moved_cents' => $moved, 'net_cents' => $income - $spend - $moved,
            'saved_cents' => $saved, 'prior_months' => $priors,
            'prior_spend_avg_cents' => $avg(array_column($priorTotals, 1)),
            'prior_income_avg_cents' => $avg(array_column($priorTotals, 0)),
            'by_category' => $by, 'uncategorised' => $uncat,
        ];
    }

    public static function fee_kind(string $description): string
    {
        $d = mb_strtoupper($description);
        foreach (self::FEE_KINDS as [$kind, $re]) {
            if (preg_match($re, $d)) {
                return $kind;
            }
        }
        return 'Other fees';
    }

    public static function window(string $month, int $n = 3): array
    {
        $out = [];
        for ($i = $n - 1; $i >= 0; $i--) {
            $out[] = Money::add_months($month, -$i);
        }
        return $out;
    }

    public static function fees_and_interest(Conn $db, Scope $s, string $month, int $n = 3): array
    {
        $ms = self::window($month, $n);
        [$w, $p] = $s->sql();
        $rows = $db->all("SELECT t.posted_on, t.description, t.amount_cents, t.category, a.label AS account
            FROM transactions t JOIN accounts a ON a.id = t.account_id
            WHERE $w AND t.category IN ('Bank fees', 'Interest charged') AND t.amount_cents < 0
              AND substr(t.posted_on, 1, 7) IN (" . Conn::placeholders($ms) . ') ORDER BY t.posted_on DESC', [...$p, ...$ms]);
        $per = array_fill_keys($ms, ['fees_cents' => 0, 'interest_cents' => 0]);
        foreach ($rows as $r) {
            $per[substr($r['posted_on'], 0, 7)][$r['category'] === 'Bank fees' ? 'fees_cents' : 'interest_cents'] -= (int)$r['amount_cents'];
        }
        // Averages over the months in the window that statements cover in full (a statement starting on the
        // 28th must not count as a whole month of fees); with none, over the months that have any data.
        $complete = array_values(array_intersect($ms, self::complete_months($db, $s)));
        $use = $complete ?: array_values(array_intersect($ms, self::months($db, $s)));
        $nm = max(1, count($use));
        $inUse = fn(array $r) => in_array(substr($r['posted_on'], 0, 7), $use, true);
        $kinds = [];
        $interest = [];
        foreach ($rows as $r) {
            if (!$inUse($r)) {
                continue;
            }
            $amt = -(int)$r['amount_cents'];
            if ($r['category'] === 'Bank fees') {
                $k = self::fee_kind($r['description']);
                $kinds[$k] ??= ['count' => 0, 'total_cents' => 0];
                $kinds[$k]['count']++;
                $kinds[$k]['total_cents'] += $amt;
            } else {
                $interest[$r['account']] = ($interest[$r['account']] ?? 0) + $amt;
            }
        }
        $fk = [];
        foreach ($kinds as $k => $v) {
            $fk[] = ['kind' => $k, ...$v, 'monthly_avg_cents' => Money::rnd($v['total_cents'] / $nm), 'avoidable' => $k !== 'Monthly account fee' && $k !== 'Other fees'];
        }
        usort($fk, fn($a, $b) => $b['total_cents'] <=> $a['total_cents']);
        arsort($interest);
        $ia = [];
        foreach ($interest as $a => $c) {
            $ia[] = ['account' => $a, 'total_cents' => $c, 'monthly_avg_cents' => Money::rnd($c / $nm)];
        }
        $perList = [];
        foreach ($ms as $m) {
            $perList[] = ['month' => $m, ...$per[$m]];
        }
        return [
            'months' => $ms, 'averaged_months' => $use, 'per_month' => $perList, 'fee_kinds' => $fk, 'interest_by_account' => $ia,
            'fees_monthly_avg_cents' => Money::rnd(array_sum(array_map(fn($m) => $per[$m]['fees_cents'], $use)) / $nm),
            'interest_monthly_avg_cents' => Money::rnd(array_sum(array_map(fn($m) => $per[$m]['interest_cents'], $use)) / $nm),
        ];
    }

    /** Money-out merchants seen in at least 2 of the last months at a similar amount (within 10%). */
    public static function recurring(Conn $db, Scope $s, string $month, int $lookback = 6): array
    {
        $ms = self::window($month, $lookback);
        [$w, $p] = $s->sql();
        $rows = $db->all("SELECT t.merchant, t.category, t.description, t.posted_on, t.amount_cents FROM transactions t
            WHERE $w AND t.amount_cents < 0 AND t.is_transfer = 0
              AND t.category NOT IN ('Transfers', 'Bank fees', 'Interest charged', 'Cash withdrawals')
              AND substr(t.posted_on, 1, 7) IN (" . Conn::placeholders($ms) . ') ORDER BY t.posted_on', [...$p, ...$ms]);
        $by = [];
        foreach ($rows as $r) {
            $by[$r['merchant']][] = $r;
        }
        $out = [];
        foreach ($by as $merchant => $txns) {
            $per = [];
            foreach ($txns as $t) {
                $k = substr($t['posted_on'], 0, 7);
                $per[$k] = ($per[$k] ?? 0) - (int)$t['amount_cents'];
            }
            if (count($per) < 2) {
                continue;
            }
            $typical = Money::rnd(Money::median(array_values($per)));
            if ($typical <= 0 || array_filter($per, fn($a) => abs($a - $typical) > 0.1 * $typical)) {
                continue;
            }
            $last = end($txns);
            $desc = mb_strtoupper($last['description']);
            $isDo = str_contains($desc, 'DEBIT ORDER') || str_contains($desc, 'DEBICHECK') || str_contains($desc, 'MAGTAPE DEBIT');
            if (in_array($last['category'], self::DISCRETIONARY, true) && !$isDo) {
                continue;
            }
            $out[] = ['merchant' => (string)$merchant, 'category' => $last['category'],
                'kind' => $isDo ? 'debit order' : ($last['category'] === 'Subscriptions' ? 'subscription' : 'recurring'),
                'monthly_cents' => $typical, 'annual_cents' => $typical * 12, 'months_seen' => count($per),
                'last_seen' => $last['posted_on'], 'active' => substr($last['posted_on'], 0, 7) >= Money::add_months($month, -1)];
        }
        usort($out, fn($a, $b) => $b['monthly_cents'] <=> $a['monthly_cents']);
        return $out;
    }

    // ------------------------------------------------------------------ advice (advice.py)
    private const STREAMING = ['NETFLIX', 'SHOWMAX', 'DISNEY', 'PRIME VIDEO', 'PRIMEVIDEO', 'AMAZON PRIME', 'DSTV', 'YOUTUBE', 'APPLE TV', 'BOX OFFICE'];

    private static function action(string $kind, string $title, string $detail, ?int $impact, array $evidence): array
    {
        return ['kind' => $kind, 'title' => $title, 'detail' => $detail, 'monthly_impact_cents' => $impact, 'evidence' => $evidence];
    }

    public static function top_actions(Conn $db, Scope $s, string $month, int $n = 3): array
    {
        $R = [Money::class, 'format_zar'];
        $sum = self::summary($db, $s, $month);
        $c = [];

        // Fees
        $f = self::fees_and_interest($db, $s, $month);
        $avoid = array_values(array_filter($f['fee_kinds'], fn($k) => $k['avoidable']));
        $avoidAvg = array_sum(array_column($avoid, 'monthly_avg_cents'));
        $acct = null;
        foreach ($f['fee_kinds'] as $k) {
            if ($k['kind'] === 'Monthly account fee') {
                $acct = $k;
            }
        }
        if ($avoidAvg >= 2000 || ($acct && $acct['monthly_avg_cents'] > 15000)) {
            $tips = [];
            foreach ($avoid as $k) {
                $tips[] = match (true) {
                    str_starts_with($k['kind'], 'ATM') => 'draw cash less often in bigger amounts, or use cash-back at till points',
                    $k['kind'] === 'Notification fees' => 'switch SMS notifications to free in-app notifications',
                    $k['kind'] === 'Cash deposit fees' => 'deposit cash less often or ask payers to pay by EFT',
                    default => "move debit orders to just after payday so they don't bounce",
                };
            }
            if ($acct && $acct['monthly_avg_cents'] > 15000) {
                $tips[] = 'check whether a cheaper account tier covers how you actually bank';
            }
            $c[] = self::action('fees', $avoidAvg ? 'Cut avoidable bank fees (~' . $R($avoidAvg) . '/month)' : 'Review your account fee',
                'You could ' . implode('; ', $tips) . '.', $avoidAvg ?: null,
                array_map(fn($k) => "{$k['kind']}: {$k['count']}× in 3 months, " . $R($k['total_cents']), $f['fee_kinds']));
        }

        // Interest / surplus
        $debts = Debt::load($db, $s->householdId);
        $nets = [$sum['net_cents']];
        foreach (array_slice($sum['prior_months'], 0, 2) as $m) {
            $nets[] = self::summary($db, $s, $m)['net_cents'];
        }
        $avgNet = Money::rnd(array_sum($nets) / count($nets));
        $spare = max(0, intdiv(intdiv(max(0, $avgNet), 2), 10000) * 10000);
        $interestAvg = $f['interest_monthly_avg_cents'];
        if ($debts && $spare) {
            $plan = Debt::compare($debts, $spare);
            $best = $plan[$plan['recommended']];
            $months = $best['months_saved'];
            $saved = $best['interest_saved_cents'];
            $method = $plan['recommended'] === 'avalanche' ? 'highest rate first' : 'smallest balance first';
            if ($saved === null) { // at the minimums some debt never clears
                $title = 'Paying an extra ' . $R($spare) . "/month towards {$best['target']} first would help clear your debt";
                $detail = "At the minimum payments, some of your debt never gets paid off because the minimum doesn't cover the interest. "
                    . "With the extra, it's cleared in about {$best['months']} months ($method).";
                $impact = null;
            } else {
                $title = 'Paying an extra ' . $R($spare) . "/month towards {$best['target']} first would save about " . $R($saved) . ' in interest';
                $detail = "That's the {$plan['recommended']} method ($method)" . ($months ? ", and you'd be debt-free $months months sooner" : '') . '.';
                $impact = $best['months'] ? Money::rnd($saved / $best['months']) : null;
            }
            $c[] = self::action('debt', $title, $detail, $impact, ['Average monthly surplus: ' . $R($avgNet), 'Interest charged: ~' . $R($interestAvg) . '/month']);
        } elseif ($interestAvg > 5000) {
            $c[] = self::action('debt', "You're paying ~" . $R($interestAvg) . '/month in interest',
                'Add your loans and cards on the Debt plan page to see which to pay first and how much interest an extra payment saves.', $interestAvg,
                array_map(fn($i) => "{$i['account']}: " . $R($i['total_cents']) . ' interest in 3 months', $f['interest_by_account']));
        } elseif ($spare >= 50000 && $sum['saved_cents'] < $spare) {
            $c[] = self::action('save', "You've had about " . $R($spare) . ' left over on average',
                'Setting up a transfer to savings on payday is one way to stop it being spent by default.', null,
                ['Average monthly surplus: ' . $R($avgNet), 'Saved this month: ' . $R($sum['saved_cents'])]);
        }

        // Subscriptions
        $subs = array_values(array_filter(self::recurring($db, $s, $month), fn($r) => $r['active'] && $r['category'] === 'Subscriptions'));
        if ($subs) {
            $total = array_sum(array_column($subs, 'monthly_cents'));
            $streaming = array_values(array_filter($subs, function ($r) {
                foreach (self::STREAMING as $x) {
                    if (str_contains($r['merchant'], $x)) {
                        return true;
                    }
                }
                return false;
            }));
            $ev = array_map(fn($r) => ucwords(strtolower($r['merchant'])) . ': ' . $R($r['monthly_cents']) . '/month', $subs);
            if (count($streaming) >= 2) {
                $cheap = min(array_column($streaming, 'monthly_cents'));
                $c[] = self::action('subscriptions', 'Rotate streaming services (save ~' . $R($cheap) . '/month)',
                    'You pay for ' . count($streaming) . " streaming services. Keep one at a time and switch when you've finished what you're watching.", $cheap, $ev);
            } else {
                $c[] = self::action('subscriptions', 'Review ' . count($subs) . ' subscriptions (' . $R($total) . '/month)',
                    "That's " . $R($total * 12) . " a year. Cancel any you haven't used in the last month.",
                    count($subs) > 1 ? min(array_column($subs, 'monthly_cents')) : null, $ev);
            }
        }

        // Spikes
        foreach ($sum['by_category'] as $cat) {
            $prior = $cat['prior_avg_cents'];
            if (!$prior || in_array($cat['category'], ['Bank fees', 'Interest charged', 'Debt repayments', 'Housing & utilities', 'Insurance', 'Medical & health', 'Other'], true)) {
                continue;
            }
            $diff = $cat['spend_cents'] - $prior;
            if ($diff >= 30000 && $cat['spend_cents'] >= $prior * 1.25) {
                $c[] = self::action('spike', "{$cat['category']} is up " . $R($diff) . ' on usual',
                    'You spent ' . $R($cat['spend_cents']) . ' vs a ' . $R($prior) . ' average. Bringing it back to normal frees up ' . $R($diff) . ' a month.',
                    $diff, ['This month: ' . $R($cat['spend_cents']), 'Previous average: ' . $R($prior)]);
            }
        }

        // Rewards: unquantified, so it only fills a slot nothing better takes.
        [$w, $p] = $s->sql();
        $spend = [];
        foreach ($db->all("SELECT a.bank, SUM(-t.amount_cents) AS spend FROM transactions t JOIN accounts a ON a.id = t.account_id
                WHERE $w AND substr(t.posted_on, 1, 7) = ? AND t.amount_cents < 0 AND t.category IN ('Groceries', 'Fuel & transport')
                GROUP BY a.bank", [...$p, $month]) as $r) {
            $spend[$r['bank']] = (int)$r['spend'];
        }
        if (($spend['fnb'] ?? 0) >= 200000) {
            $c[] = self::action('rewards', 'Check your eBucks reward level',
                'You put ' . $R($spend['fnb']) . " of groceries and fuel through FNB this month. eBucks earn rates depend on your reward level, so check in the FNB app which qualifying criteria you're missing.",
                null, ['FNB groceries + fuel: ' . $R($spend['fnb'])]);
        } elseif (($spend['capitec'] ?? 0) >= 200000) {
            $c[] = self::action('rewards', 'Check Capitec Live Better cashback',
                'You put ' . $R($spend['capitec']) . ' of groceries and fuel through Capitec this month. See in the Capitec app whether Live Better cashback is on for your card spend.',
                null, ['Capitec groceries + fuel: ' . $R($spend['capitec'])]);
        }

        usort($c, fn($a, $b) => [$a['monthly_impact_cents'] === null, -($a['monthly_impact_cents'] ?? 0)]
            <=> [$b['monthly_impact_cents'] === null, -($b['monthly_impact_cents'] ?? 0)]);
        $picked = [];
        $spikes = 0;
        foreach ($c as $a) {
            if ($a['kind'] === 'spike' && $spikes++) {
                continue;
            }
            $picked[] = $a;
            if (count($picked) === $n) {
                break;
            }
        }
        return ['month' => $month, 'actions' => $picked, 'total_candidates' => count($c)];
    }
}

/** Debt payoff planner: avalanche vs snowball vs minimums (debt.py). */
final class Debt
{
    public const MAX_MONTHS = 600;

    public static function load(Conn $db, int $householdId): array
    {
        return array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'balance_cents' => (int)$r['balance_cents'],
            'apr_bp' => (int)$r['apr_bp'], 'min_payment_cents' => (int)$r['min_payment_cents']],
            $db->all('SELECT * FROM debts WHERE household_id = ? ORDER BY id', [$householdId]));
    }

    private static function interest(int $balance, int $aprBp): int
    {
        return intdiv($balance * $aprBp + 60000, 120000);
    }

    public static function simulate(array $debts, int $extra = 0, string $strategy = 'avalanche', bool $rollover = true): array
    {
        $idx = array_keys($debts);
        if ($strategy === 'avalanche') {
            usort($idx, fn($a, $b) => [-$debts[$a]['apr_bp'], $debts[$a]['balance_cents']] <=> [-$debts[$b]['apr_bp'], $debts[$b]['balance_cents']]);
        } elseif ($strategy === 'snowball') {
            usort($idx, fn($a, $b) => [$debts[$a]['balance_cents'], -$debts[$a]['apr_bp']] <=> [$debts[$b]['balance_cents'], -$debts[$b]['apr_bp']]);
        } elseif ($strategy === 'minimum') {
            $extra = 0;
            $rollover = false;
        } else {
            throw new \InvalidArgumentException($strategy);
        }
        $bal = array_column($debts, 'balance_cents');
        $paidOff = array_map(fn($b) => $b > 0 ? null : 0, $bal);
        $int = array_fill(0, count($debts), 0);
        $budget = array_sum(array_column($debts, 'min_payment_cents')) + $extra;
        $byMonth = [array_sum($bal)];
        $month = 0;
        while (array_filter($bal, fn($b) => $b > 0) && $month < self::MAX_MONTHS) {
            $month++;
            foreach ($debts as $i => $d) {
                if ($bal[$i] > 0) {
                    $ch = self::interest($bal[$i], $d['apr_bp']);
                    $bal[$i] += $ch;
                    $int[$i] += $ch;
                }
            }
            $available = $rollover ? $budget : null;
            foreach ($debts as $i => $d) {
                if ($bal[$i] > 0) {
                    $pay = min($bal[$i], $d['min_payment_cents']);
                    $bal[$i] -= $pay;
                    if ($available !== null) {
                        $available -= $pay;
                    }
                }
            }
            $available ??= $extra;
            foreach ($idx as $i) {
                if ($available <= 0) {
                    break;
                }
                if ($bal[$i] > 0) {
                    $pay = min($bal[$i], $available);
                    $bal[$i] -= $pay;
                    $available -= $pay;
                }
            }
            foreach ($bal as $i => $b) {
                if ($b === 0 && $paidOff[$i] === null) {
                    $paidOff[$i] = $month;
                }
            }
            $byMonth[] = array_sum($bal);
        }
        $stuck = (bool)array_filter($bal, fn($b) => $b > 0);
        $order = array_keys($debts);
        usort($order, fn($a, $b) => [$paidOff[$a] === null, $paidOff[$a] ?? 0] <=> [$paidOff[$b] === null, $paidOff[$b] ?? 0]);
        $target = null; // where extra money goes first: the first debt in this strategy's order with a balance
        if ($strategy !== 'minimum') {
            foreach ($idx as $i) {
                if ($debts[$i]['balance_cents'] > 0) {
                    $target = $debts[$i]['name'];
                    break;
                }
            }
        }
        return [
            'strategy' => $strategy, 'target' => $target, 'months' => $stuck ? null : $month, 'never_pays_off' => $stuck,
            'total_interest_cents' => array_sum($int), 'monthly_budget_cents' => $budget,
            'payoff_order' => array_map(fn($i) => ['name' => $debts[$i]['name'], 'paid_off_month' => $paidOff[$i], 'interest_cents' => $int[$i]], $order),
            'balances_by_month' => $byMonth,
        ];
    }

    public static function compare(array $debts, int $extra): array
    {
        $debts = array_values($debts);
        if (!$debts) {
            return ['debts' => 0];
        }
        $base = self::simulate($debts, 0, 'minimum');
        $ava = self::simulate($debts, $extra, 'avalanche');
        $snow = self::simulate($debts, $extra, 'snowball');
        foreach ([&$ava, &$snow] as &$plan) {
            // Against a baseline that never pays off, "interest saved" would be meaningless (it runs for 50 years).
            $plan['interest_saved_cents'] = $base['never_pays_off'] ? null : $base['total_interest_cents'] - $plan['total_interest_cents'];
            $plan['months_saved'] = $base['months'] !== null && $plan['months'] !== null ? $base['months'] - $plan['months'] : null;
        }
        unset($plan);
        return ['debts' => count($debts), 'extra_cents' => $extra, 'baseline' => $base, 'avalanche' => $ava, 'snowball' => $snow,
            'recommended' => $ava['total_interest_cents'] <= $snow['total_interest_cents'] ? 'avalanche' : 'snowball',
            'avalanche_vs_snowball_cents' => $snow['total_interest_cents'] - $ava['total_interest_cents'],
            // minimums that don't cover the monthly interest: the balance grows
            'warnings' => array_values(array_map(fn($d) => ['name' => $d['name'], 'interest_cents' => self::interest($d['balance_cents'], $d['apr_bp']),
                'min_payment_cents' => $d['min_payment_cents']], array_filter($debts, fn($d) => $d['balance_cents'] > 0
                && $d['min_payment_cents'] <= self::interest($d['balance_cents'], $d['apr_bp']))))];
    }
}
