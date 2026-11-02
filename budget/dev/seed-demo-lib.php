<?php
/** seed_demo(): the fictional demo household (mirrors python-reference/budget_app/demo.py). */
declare(strict_types=1);

use Linen\{Auth, Budget, Money, Statements};

function seed_demo(\Linen\Conn $db, ?string $now = null): int
{
    $now ??= Money::this_month();
    $hid = $db->tx(fn($db) => Auth::create_household($db, 'Alex & Sam', ['Alex', 'Sam'], true));
    [$alex, $sam] = array_map('intval', array_column($db->all('SELECT id FROM members WHERE household_id = ? ORDER BY sort', [$hid]), 'id'));
    $start = Money::add_months($now, -5);
    $line = function (int $m, string $kind, string $name, float $rands, ?string $section = null, array $kw = []) use ($db, $hid, $start) {
        return Budget::create_line($db, $hid, ['member_id' => $m, 'kind' => $kind, 'name' => $name, 'amount_cents' => (int)round($rands * 100),
            'start_month' => $kw['start'] ?? $start, 'section' => $section] + $kw);
    };
    $line($alex, 'income', 'Alex salary', 46200);
    $car = $line($alex, 'expense', 'Car finance', 5800, 'Debit orders', ['is_debit_order' => true, 'category' => 'Debt repayments']);
    $rent = $line($alex, 'expense', 'Rent', 15000, 'Debit orders', ['is_debit_order' => true]);
    $line($alex, 'expense', 'Utilities', 1800, 'Debit orders', ['is_debit_order' => true, 'category' => 'Housing & utilities', 'notes' => 'Gas, electricity, water']);
    $line($alex, 'expense', 'Fibre', 1000, 'Debit orders', ['is_debit_order' => true]);
    $ins = $line($alex, 'expense', 'Car & home insurance', 2600, 'Debit orders', ['is_debit_order' => true, 'category' => 'Insurance']);
    $line($alex, 'expense', 'Life & funeral cover', 1063, 'Debit orders', ['is_debit_order' => true, 'category' => 'Insurance', 'notes' => 'R747 + R186 + R130']);
    $subs = $line($alex, 'expense', 'Streaming subscriptions', 680, 'Debit orders', ['is_debit_order' => true, 'category' => 'Subscriptions',
        'notes' => 'Netflix R199 + Showmax R99 + Spotify R65 + iCloud R317']);
    $line($alex, 'expense', 'Bank fees', 455, 'Debit orders', ['is_debit_order' => true, 'category' => 'Bank fees']);
    $gym = $line($alex, 'expense', 'Gym', 750, 'Debit orders', ['is_debit_order' => true, 'category' => 'Fitness & leisure']);
    $gap = $line($alex, 'expense', 'Medical aid gap cover', 1700, 'Debit orders', ['is_debit_order' => true, 'category' => 'Medical & health']);
    $line($alex, 'expense', 'Fuel', 4000, 'Monthly', ['category' => 'Fuel & transport']);
    $line($alex, 'expense', 'Toiletries', 1000, 'Monthly', ['category' => 'Personal care']);
    $line($alex, 'expense', 'Golf', 1300, 'Personal', ['category' => 'Fitness & leisure']);
    $line($alex, 'expense', 'Haircut', 400, 'Personal', ['category' => 'Personal care']);
    $line($alex, 'expense', 'Dentist (3 payments)', 3000, 'Monthly', ['category' => 'Medical & health', 'start' => Money::add_months($now, -2),
        'end_month' => $now, 'notes' => 'R9 000 over 3 months']);
    $line($alex, 'saving', 'Emergency fund', 1000, 'Savings');
    $line($sam, 'income', 'Sam salary', 18800);
    $line($sam, 'expense', 'Groceries', 8000, 'Household', ['category' => 'Groceries']);
    $line($sam, 'expense', 'Date night', 2500, 'Household', ['category' => 'Eating out']);
    $line($sam, 'expense', 'Takeout', 1500, 'Household', ['category' => 'Eating out']);
    $line($sam, 'expense', 'Wax & beauty', 1600, 'Personal', ['category' => 'Personal care']);
    $line($sam, 'expense', 'Medication', 1400, 'Personal', ['category' => 'Medical & health']);
    $line($sam, 'expense', 'Tithes', 500, 'Personal', ['category' => 'Giving']);
    $line($sam, 'transfer', 'Contribution to rent', 1500, 'Transfers', ['to_member_id' => $alex]);
    $line($sam, 'saving', 'Tax-free savings', 1000, 'Savings', ['category' => 'Savings & investments', 'start' => Money::add_months($now, -3)]);

    Budget::set_amount($db, $hid, $rent, Money::add_months($now, -2), 1560000, 'onward', 'Annual escalation');
    Budget::set_amount($db, $hid, $ins, Money::add_months($now, -3), 290000, 'onward', 'Premium increase');
    Budget::set_amount($db, $hid, $ins, $now, 305000, 'onward', 'Premium increase');
    Budget::set_amount($db, $hid, $subs, Money::add_months($now, -1), 85000, 'onward', 'Added YouTube Premium');
    Budget::set_amount($db, $hid, $gym, Money::add_months($now, 1), 109000, 'onward', 'Contract renewal');
    $db->exec('UPDATE budget_lines SET end_month = ? WHERE id = ?', [Money::add_months($now, 6), $car]);
    $db->exec('UPDATE budget_lines SET end_month = ? WHERE id = ?', [$now, $gap]);
    foreach (array_column($db->all("SELECT id FROM budget_lines WHERE household_id = ? AND kind != 'income' ORDER BY sort LIMIT 9", [$hid]), 'id') as $lid) {
        Budget::set_paid($db, $hid, (int)$lid, $now, true);
    }
    $db->exec('INSERT INTO goals (household_id, member_id, name, target_cents, saved_cents, target_month) VALUES (?, NULL, ?, 6000000, 850000, ?)',
        [$hid, 'Emergency fund (3 months)', Money::add_months($now, 18)]);
    $db->exec('INSERT INTO goals (household_id, member_id, name, target_cents, saved_cents, target_month) VALUES (?, NULL, ?, 4500000, 600000, ?)',
        [$hid, 'Mauritius holiday', Money::add_months($now, 10)]);
    $db->exec('INSERT INTO goals (household_id, member_id, name, target_cents, saved_cents) VALUES (?, ?, ?, 2200000, 300000)', [$hid, $sam, 'New laptop']);
    foreach ([['Car finance', 3480000, 1325, 580000], ['Credit card', 1420000, 2075, 70000], ['Store account', 380000, 2400, 45000]] as $d) {
        $db->exec('INSERT INTO debts (household_id, name, balance_cents, apr_bp, min_payment_cents) VALUES (?, ?, ?, ?, ?)', [$hid, ...$d]);
    }
    $dir = __DIR__ . '/../tests';
    Statements::import($db, $hid, file_get_contents("$dir/fnb_sample.csv"), $alex, 'auto', 'FNB Cheque', 'transactional', 'fnb_sample.csv');
    Statements::import($db, $hid, file_get_contents("$dir/capitec_sample.csv"), $sam, 'auto', 'Capitec Everyday', 'transactional', 'capitec_sample.csv');
    return $hid;
}
