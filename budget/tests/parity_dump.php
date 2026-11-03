<?php
/** Dumps the PHP implementation's outputs for tests/parity.py. Usage: php tests/parity_dump.php <scenario> [xlsx] */
declare(strict_types=1);

use Linen\{Analysis, Auth, Budget, Config, Db, Debt, Forecast, Goals, Money, Scope, Xlsx};

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../dev/seed-demo-lib.php';
$tmp = sys_get_temp_dir() . '/parity-' . getmypid() . '.db';
Config::set(['db_path' => $tmp, 'private_mode' => false, 'env' => 'development']);
$db = Db::connect();
$out = [];
$now = Money::this_month();
if ($argv[1] === 'demo') {
    $hid = seed_demo($db, $now);
    $members = array_column(Budget::members($db, $hid), 'id');
    for ($i = -5; $i <= 7; $i++) {
        $m = Money::add_months($now, $i);
        $out["month_view $m"] = Budget::month_view($db, $hid, $m);
    }
    foreach ([null, ...$members] as $mid) {
        $out["forecast $mid"] = Forecast::forecast($db, $hid, $now, $mid);
        $out["debits $mid"] = Budget::debit_order_review($db, $hid, $now, $mid);
        $out["member_view $mid"] = Budget::month_view($db, $hid, $now, $mid);
        $s = new Scope($hid, $mid);
        $out["summary $mid"] = Analysis::summary($db, $s, '2026-10');
        $out["fees $mid"] = Analysis::fees_and_interest($db, $s, '2026-10');
        $out["recurring $mid"] = Analysis::recurring($db, $s, '2026-10');
        $out["advice $mid"] = Analysis::top_actions($db, $s, '2026-10');
    }
    $out['goals'] = Goals::plan_all($db, $hid, $now);
    $out['debt'] = Debt::compare(Debt::load($db, $hid), 200000);
} else {
    $hid = $db->tx(fn($db) => Auth::create_household($db, 'Test', ['Veyz', 'Tiara']));
    [$v, $t] = array_column(Budget::members($db, $hid), 'id');
    $data = file_get_contents($argv[2]);
    $out['preview'] = Xlsx::preview($data);
    $out['import'] = Xlsx::import($db, $hid, $data, ['Veyz' => $v, 'T' => $t]);
    foreach (['2025-07', '2025-09', '2026-01', '2026-03', '2026-04', '2026-05', '2026-11', '2026-12'] as $m) {
        $out["month_view $m"] = Budget::month_view($db, $hid, $m);
        $out["forecast $m"] = Forecast::forecast($db, $hid, $m);
        $out["debits $m"] = Budget::debit_order_review($db, $hid, $m);
    }
    Goals::save($db, $hid, ['name' => 'Emergency fund', 'target_cents' => 3000000, 'target_month' => '2027-06']);
    Goals::save($db, $hid, ['name' => 'Laptop', 'target_cents' => 2000000, 'member_id' => $t]);
    $out['goals'] = Goals::plan_all($db, $hid, '2026-11');
}
@unlink($tmp);
echo json_encode($out, JSON_UNESCAPED_UNICODE);
