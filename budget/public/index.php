<?php
// Front controller for /private/api/*. Static files (index.html, app.js, style.css) are served directly.
declare(strict_types=1);

// Never show PHP errors to visitors (they can leak server paths and break JSON); log them privately
// next to the config, outside public_html, when that folder exists.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
$private = dirname(__DIR__, 2) . '/budget-private';
if (is_dir($private) && is_writable($private)) {
    ini_set('error_log', $private . '/php-errors.log');
}

$app = is_dir(__DIR__ . '/app') ? __DIR__ . '/app' : __DIR__ . '/../src';  // deployed : local dev
require $app . '/bootstrap.php';

\Linen\Api::handle(__DIR__);
