<?php
/** Seed a fictional demo household (Alex & Sam), mirroring python-reference/budget_app/demo.py.
 *  Usage: BUDGET_CONFIG=dev/config.php php dev/seed-demo.php [--reset] */
declare(strict_types=1);

use Linen\{Config, Db};

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/seed-demo-lib.php';
Config::load();
if (in_array('--reset', $argv, true)) {
    foreach (['', '-wal', '-shm'] as $s) {
        @unlink(Config::get('db_path') . $s);
    }
}
$db = Db::connect();
echo 'Seeded demo household #' . seed_demo($db) . "\n";
