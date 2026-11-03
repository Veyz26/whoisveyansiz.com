<?php
/**
 * Loads config and classes. The app needs PHP 8.1+ with pdo_sqlite, zip, curl and simplexml
 * (all enabled on Hostinger by default).
 *
 * Config lookup, first match wins:
 *   1. the BUDGET_CONFIG environment variable (a path to a config.php file)
 *   2. <folder above public_html>/budget-private/config.php   (production: outside the web root)
 */
declare(strict_types=1);

namespace Linen;

foreach (glob(__DIR__ . '/*.php') as $file) {
    if (basename($file) !== 'bootstrap.php' && basename($file) !== 'index.php') {
        require_once $file;
    }
}

final class Config
{
    private static ?array $cfg = null;

    public static function load(?string $webroot = null): array
    {
        if (self::$cfg !== null) {
            return self::$cfg;
        }
        $path = getenv('BUDGET_CONFIG') ?: ($webroot ? dirname($webroot, 2) . '/budget-private/config.php' : '');
        if (!$path || !is_file($path)) {
            throw new \RuntimeException('Budget config not found. See budget/README.md → Deploy.');
        }
        $cfg = require $path;
        if (!is_array($cfg)) {
            throw new \RuntimeException('Budget config must return an array.');
        }
        self::$cfg = array_replace([
            'app_name' => 'Linen',
            'db_path' => dirname($path) . '/linen.db',
            'private_mode' => true,
            'allowed_emails' => [],
            'setup_codes' => [],         // email => one-time code needed to create a password account (private mode)
            'password_login' => true,
            'microsoft' => ['client_id' => '', 'client_secret' => '', 'tenant' => 'common'],
            'secure_cookies' => true,
            'env' => 'production',
            'demo' => false,
            'public_url' => '',
            'require_passkey' => true,   // everyone must add Face ID / Touch ID before using the app
            'rp_id' => '',               // passkey domain; defaults to public_url's host
            'rp_name' => '',
            'timezone' => 'Africa/Johannesburg',
        ], $cfg);
        self::$cfg['allowed_emails'] = array_map(fn($e) => strtolower(trim($e)), self::$cfg['allowed_emails']);
        $codes = [];
        foreach ((array)self::$cfg['setup_codes'] as $e => $c) {
            $codes[strtolower(trim((string)$e))] = (string)$c;
        }
        self::$cfg['setup_codes'] = $codes;
        date_default_timezone_set(self::$cfg['timezone']);  // so 'this month' flips at midnight SAST, not UTC
        return self::$cfg;
    }

    public static function set(array $cfg): void  // tests
    {
        self::$cfg = null;
        $tmp = tempnam(sys_get_temp_dir(), 'cfg');
        file_put_contents($tmp, '<?php return ' . var_export($cfg, true) . ';');
        putenv("BUDGET_CONFIG=$tmp");
        self::load();
        unlink($tmp);  // already loaded; don't leave config files behind in the temp folder
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::load()[$key] ?? $default;
    }
}
