<?php
/**
 * Daily backup of the budget database. Copy this file to domains/whoisveyansiz.com/budget-private/
 * (next to config.php, OUTSIDE public_html) and add an hPanel → Advanced → Cron Job, daily:
 *
 *     /usr/bin/php /home/<user>/domains/whoisveyansiz.com/budget-private/backup.php
 *
 * It writes a consistent snapshot with `VACUUM INTO` (safe while the app is in use), verifies it with
 * PRAGMA integrity_check, restricts permissions to the owner, and keeps the newest 14 snapshots in
 * budget-private/backups/. Exit code 0 = OK, 1 = failed (hPanel can email cron output on failure).
 *
 * Restore: see "Backups" in budget/README.md.
 */
declare(strict_types=1);

$dir = __DIR__;
$cfgFile = getenv('BUDGET_CONFIG') ?: "$dir/config.php";
$cfg = is_file($cfgFile) ? require $cfgFile : null;
if (!is_array($cfg)) {
    fwrite(STDERR, "backup: config not found or invalid at $cfgFile\n");
    exit(1);
}
$db = $cfg['db_path'] ?? dirname($cfgFile) . '/linen.db';
if (!is_file($db)) {
    fwrite(STDERR, "backup: no database yet at $db (nothing to back up)\n");
    exit(0);
}
$keep = (int)($cfg['backup_keep'] ?? 14);
$outDir = $cfg['backup_dir'] ?? dirname($db) . '/backups';
if (!is_dir($outDir) && !mkdir($outDir, 0700, true)) {
    fwrite(STDERR, "backup: can't create $outDir\n");
    exit(1);
}
chmod($outDir, 0700);
$target = sprintf('%s/linen-%s.db', $outDir, gmdate('Ymd-His'));

try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 30]);
    $pdo->exec('VACUUM INTO ' . $pdo->quote($target));   // needs SQLite 3.27+
    chmod($target, 0600);
    $check = new PDO('sqlite:' . $target, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $ok = $check->query('PRAGMA integrity_check')->fetchColumn();
    $version = (int)$check->query('PRAGMA user_version')->fetchColumn();
    $check = null;
    if ($ok !== 'ok') {
        rename($target, "$target.corrupt");
        throw new RuntimeException("integrity_check: $ok");
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'backup: FAILED ' . $e->getMessage() . "\n");
    exit(1);
}

$all = glob("$outDir/linen-*.db") ?: [];
rsort($all);                                  // newest first (timestamped names sort by time)
foreach (array_slice($all, $keep) as $old) {
    unlink($old);
}
printf("backup: OK %s (%s KB, schema v%d, %d kept)\n", basename($target), number_format(filesize($target) / 1024), $version, min(count($all), $keep));
exit(0);
