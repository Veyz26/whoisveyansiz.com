<?php
/** Local dev router for `php -S`, emulating public_html/private/.htaccess:
 *    BUDGET_CONFIG=dev/config.php php -S localhost:8766 dev/router.php
 *  then open http://localhost:8766/private/ */
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$pub = realpath(__DIR__ . '/../public');
if ($uri === '/' || $uri === '/private') {
    header('Location: /private/');
    return true;
}
if (!str_starts_with($uri, '/private/')) {
    http_response_code(404);
    return true;
}
$rel = substr($uri, strlen('/private/'));
if (str_starts_with($rel, 'api/')) {
    $_SERVER['SCRIPT_NAME'] = '/private/index.php';
    require $pub . '/index.php';
    return true;
}
$file = realpath($pub . '/' . ($rel === '' ? 'index.html' : $rel));
if (!$file || !str_starts_with($file, $pub) || !is_file($file) || str_ends_with($file, '.php')) {
    http_response_code(404);
    return true;
}
$types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'webmanifest' => 'application/manifest+json'];
header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
readfile($file);
return true;
