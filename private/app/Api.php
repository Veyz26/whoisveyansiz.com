<?php
/**
 * JSON API. Mirrors server.py.
 * - Session cookie: random token, HttpOnly, SameSite=Strict, Secure, scoped to the app's path.
 * - CSRF: every state-changing request needs the session's token in X-CSRF-Token and a JSON body.
 * - Tenant isolation: the household comes from the session, never from the request.
 * - Sign-in throttled per IP; accounts lock after repeated failures.
 */
declare(strict_types=1);

namespace Linen;

final class ApiError extends \RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Raw
{
    public function __construct(public readonly string $body, public readonly string $type, public readonly ?string $filename = null,
                                public readonly int $status = 200) {}
}

final class Redirect
{
    public function __construct(public readonly string $to) {}
}

final class Ctx
{
    /** @var list<string> */
    public array $cookies = [];

    public function __construct(public readonly Conn $db, public readonly ?Session $sess, public readonly array $q,
                                public readonly array $body, public readonly string $base, public readonly string $baseUrl) {}

    public function hid(): int { return $this->sess->householdId; }
    public function uid(): ?int { return $this->sess->userId; }
    public function arg(string $k, ?string $d = null): ?string { return isset($this->q[$k]) && is_string($this->q[$k]) ? $this->q[$k] : $d; }

    public function month(string $k = 'month'): string
    {
        try {
            return Budget::valid_month($this->arg($k) ?: Money::this_month());
        } catch (\InvalidArgumentException $e) {
            throw new ApiError(400, $e->getMessage());
        }
    }

    public function member(): ?int
    {
        $m = $this->arg('member');
        if (!$m || $m === 'all') {
            return null;
        }
        if (!ctype_digit($m) || !in_array((int)$m, array_column(Budget::members($this->db, $this->hid()), 'id'), true)) {
            throw new ApiError(404, 'Unknown person');
        }
        return (int)$m;
    }

    public function int(string $k, bool $required = true): ?int
    {
        $v = $this->body[$k] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                throw new ApiError(400, "$k is required");
            }
            return null;
        }
        // Whole numbers only (no 1e30, no 12.5), within ±R10 billion in cents: keeps every later
        // calculation inside PHP's integer range.
        if (!(is_int($v) || (is_string($v) && preg_match('/^-?\d{1,13}$/', $v))) || abs((int)$v) > 1_000_000_000_000) {
            throw new ApiError(400, "$k must be a whole number within a sensible range");
        }
        return (int)$v;
    }

    /** JSON booleans, 1/0 and the strings "true"/"false" (so "false" isn't treated as true). */
    public function bool(string $k, bool $default = false): bool
    {
        $v = $this->body[$k] ?? null;
        return match (true) {
            $v === null, $v === '' => $default,
            in_array($v, [true, 1, '1', 'true', 'yes', 'on'], true) => true,
            in_array($v, [false, 0, '0', 'false', 'no', 'off'], true) => false,
            default => throw new ApiError(400, "$k must be true or false"),
        };
    }

    public function sessionCookie(string $token, int $maxAge): void
    {
        $this->cookies[] = Api::cookie('linen_sid', $token, $maxAge, $this->base . '/', 'Strict');
    }
}

final class Api
{
    private static array $routes = [];

    public static function cookie(string $name, string $value, int $maxAge, string $path, string $sameSite): string
    {
        return "$name=$value; Path=$path; HttpOnly; SameSite=$sameSite; Max-Age=$maxAge" . (Config::get('secure_cookies') ? '; Secure' : '');
    }

    private static function route(string $method, string $pattern, callable $fn, bool $public = false, bool $write = false,
                                  bool $owner = false, bool $setup = false): void
    {
        // $setup: allowed before the account has a passkey (everything else needs one when require_passkey is on).
        self::$routes[] = [$method, '#^' . $pattern . '$#', $fn, compact('public', 'write', 'owner', 'setup')];
    }

    public static function handle(string $webroot): void
    {
        try {
            Config::load($webroot);
        } catch (\Throwable $e) {
            error_log('[budget] config: ' . $e->getMessage());
            self::send(503, ['error' => "The budget isn't set up on this server yet (config missing or invalid)."]);
            return;
        }
        $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php')), '/');
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $route = str_starts_with($path, $base) ? substr($path, strlen($base)) : $path;
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $method = $method === 'HEAD' ? 'GET' : $method;
        $baseUrl = rtrim((string)Config::get('public_url'), '/')
            ?: ((($_SERVER['HTTPS'] ?? '') === 'on' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $base);

        try {
            $body = [];
            if (in_array($method, ['POST', 'PATCH', 'DELETE'], true)) {
                $raw = file_get_contents('php://input', false, null, 0, 12 * 1024 * 1024 + 1);
                if (strlen((string)$raw) > 12 * 1024 * 1024) {
                    throw new ApiError(413, 'File too large');
                }
                if ($raw !== '' && $raw !== false) {
                    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
                        throw new ApiError(415, 'Use application/json');
                    }
                    $body = json_decode($raw, true);
                    if (!is_array($body)) {
                        throw new ApiError(400, 'Invalid JSON');
                    }
                }
            }
            self::register();
            $db = Db::connect();
            Privacy::purge_if_due($db);
            foreach (self::$routes as [$m, $re, $fn, $o]) {
                if ($m !== $method || !preg_match($re, $route, $match)) {
                    continue;
                }
                $sess = Auth::get_session($db, $_COOKIE['linen_sid'] ?? null);
                if (!$o['public']) {
                    if (!$sess) {
                        throw new ApiError(401, 'Please sign in');
                    }
                    if ($method !== 'GET' && !hash_equals($sess->csrf, (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
                        throw new ApiError(403, 'Your session expired. Refresh the page.');
                    }
                    if (!$o['setup'] && $sess->userId !== null && Config::get('require_passkey') && Passkeys::count($db, $sess->userId) === 0) {
                        throw new ApiError(403, 'Add Face ID or Touch ID to your account first.');
                    }
                    if ($o['owner'] && $sess->role !== 'owner') {
                        throw new ApiError(403, 'Only the household owner can do that');
                    }
                    if ($o['write'] && !Billing::status($db, $sess->householdId)['can_write']) {
                        throw new ApiError(402, 'Your trial has ended. Choose a plan to keep editing; you can still view, export or delete your data.');
                    }
                }
                $ctx = new Ctx($db, $sess, $_GET, $body, $base, $baseUrl);
                $result = $fn($ctx, ...array_slice($match, 1));
                self::send($result instanceof Raw ? $result->status : 200, $result, $ctx->cookies);
                return;
            }
            throw new ApiError(404, 'Not found');
        } catch (ApiError $e) {
            self::send($e->status, ['error' => $e->getMessage()]);
        } catch (AuthError $e) {
            self::send($e->getCode() === 429 ? 429 : 400, ['error' => $e->getMessage()]);
        } catch (PasskeyError $e) {
            self::send(400, ['error' => $e->getMessage()]);
        } catch (NotFound $e) {
            self::send(404, ['error' => $e->getMessage()]);
        } catch (\InvalidArgumentException $e) {
            self::send(400, ['error' => $e->getMessage()]);
        } catch (\TypeError | \ValueError | \ArithmeticError $e) {
            // Wrong-typed or out-of-range input that got past the field checks: the request is bad, not the server.
            error_log('[budget] bad input: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
            self::send(400, ['error' => "Some of the information sent wasn't in the expected format."]);
        } catch (\Throwable $e) {
            error_log('[budget] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            self::send(500, ['error' => 'Something went wrong. Please try again.']);
        }
    }

    private static function send(int $status, mixed $payload, array $cookies = []): void
    {
        http_response_code($payload instanceof Redirect ? 302 : $status);
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('X-Robots-Tag: noindex, nofollow');
        foreach ($cookies as $c) {
            header("Set-Cookie: $c", false);
        }
        if ($payload instanceof Redirect) {
            header('Location: ' . $payload->to);
            return;
        }
        if ($payload instanceof Raw) {
            header('Content-Type: ' . $payload->type);
            if ($payload->filename) {
                header('Content-Disposition: attachment; filename="' . $payload->filename . '"');
            }
            echo $payload->body;
            return;
        }
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    private static function ip(): string
    {
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }

    private static function lineFields(Ctx $c): array
    {
        $b = $c->body;
        foreach (['name', 'section', 'category', 'flexibility', 'notes', 'kind', 'end_month', 'start_month', 'mode', 'note', 'month'] as $k) {
            if (isset($b[$k]) && !is_string($b[$k])) {
                throw new ApiError(400, "$k must be text");
            }
        }
        $out = array_intersect_key($b, array_flip(['name', 'section', 'category', 'flexibility', 'notes', 'kind']));
        if (array_key_exists('is_debit_order', $b)) {
            $out['is_debit_order'] = $c->bool('is_debit_order');
        }
        foreach (['member_id', 'to_member_id', 'goal_id'] as $k) {
            if (array_key_exists($k, $b)) {
                $out[$k] = $c->int($k, false);
            }
        }
        if (array_key_exists('end_month', $b)) {
            $out['end_month'] = $b['end_month'] ?: null;
        }
        return $out;
    }

    private static function confirmPassword(Ctx $c): void
    {
        Auth::throttle($c->db, 'confirm:' . $c->uid(), 5, 600);
        $u = $c->db->one('SELECT password_hash, sso_subject FROM users WHERE id = ?', [$c->uid()]);
        if ($u && !$u['password_hash'] && $u['sso_subject']) {
            // SSO-only account: typing the email address is the confirmation.
            if (strtolower(trim((string)($c->body['password'] ?? ''))) !== strtolower((string)$c->sess->email)) {
                throw new ApiError(403, 'Type your email address to confirm');
            }
            return;
        }
        if (!$u || !password_verify((string)($c->body['password'] ?? ''), (string)$u['password_hash'])) {
            throw new ApiError(403, 'Password is incorrect');
        }
    }

    private static function register(): void
    {
        if (self::$routes) {
            return;
        }
        $R = self::route(...);

        // --- health (for uptime monitors; reveals no personal data) ------------------------
        $R('GET', '/api/health', function (Ctx $c) {
            $missing = array_values(array_filter(['pdo_sqlite', 'openssl', 'mbstring', 'zip', 'simplexml', 'ctype'], fn($e) => !extension_loaded($e)));
            return ['ok' => !$missing, 'schema' => (int)$c->db->val('PRAGMA user_version'), 'php' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
                'sqlite' => (string)$c->db->val('SELECT sqlite_version()'), 'missing_extensions' => $missing];
        }, public: true);

        // --- config & auth ------------------------------------------------------------
        $R('GET', '/api/config', fn(Ctx $c) => [
            'app_name' => Config::get('app_name'), 'private_mode' => (bool)Config::get('private_mode'),
            'microsoft' => Microsoft::enabled(), 'password_login' => (bool)Config::get('password_login'),
            'demo' => (bool)Config::get('demo'), 'privacy_version' => Auth::PRIVACY_VERSION, 'require_passkey' => (bool)Config::get('require_passkey'),
            'plans' => Config::get('private_mode') ? new \stdClass() : Billing::PLANS,
        ], public: true);

        $R('POST', '/api/auth/signup', function (Ctx $c) {
            Auth::throttle($c->db, 'signup:' . self::ip(), 5, 600);
            $uid = Auth::signup($c->db, $c->body);
            $c->sessionCookie(Auth::start_session($c->db, $uid), Auth::SESSION_DAYS * 86400);
            return ['ok' => true];
        }, public: true);

        $R('POST', '/api/auth/lookup', function (Ctx $c) {
            if (!Config::get('private_mode')) {
                throw new ApiError(404, 'Not found');
            }
            Auth::throttle($c->db, 'lookup:' . self::ip(), 20, 600);
            try {
                return Auth::lookup($c->db, (string)($c->body['email'] ?? ''));
            } catch (AuthError $e) {
                throw new ApiError(400, $e->getMessage());
            }
        }, public: true);

        $R('POST', '/api/auth/login', function (Ctx $c) {
            Auth::throttle($c->db, 'login:' . self::ip(), 10, 60);
            try {
                $uid = Auth::login($c->db, (string)($c->body['email'] ?? ''), (string)($c->body['password'] ?? ''), $c->body['recovery_code'] ?? null);
            } catch (NeedsRecoveryCode $e) {
                return new Raw(json_encode(['error' => $e->getMessage(), 'need_recovery_code' => true]), 'application/json', null, 401);
            } catch (AuthError $e) {
                throw new ApiError(401, $e->getMessage());
            }
            $c->sessionCookie(Auth::start_session($c->db, $uid), Auth::SESSION_DAYS * 86400);
            return ['ok' => true];
        }, public: true);

        $R('GET', '/api/auth/microsoft/start', function (Ctx $c) {
            if (!Microsoft::enabled()) {
                throw new ApiError(404, 'Microsoft sign-in is not configured');
            }
            Auth::throttle($c->db, 'sso:' . self::ip(), 20, 600);
            [$url, $binding] = Microsoft::start($c->db, $c->baseUrl);
            // Lax so the cookie comes back on Microsoft's redirect; it only proves the same browser started the sign-in.
            $c->cookies[] = Api::cookie('linen_oauth', $binding, 600, $c->base . '/api/auth/microsoft/', 'Lax');
            return new Redirect($url);
        }, public: true);

        $R('GET', '/api/auth/microsoft/callback', function (Ctx $c) {
            $c->cookies[] = Api::cookie('linen_oauth', '', 0, $c->base . '/api/auth/microsoft/', 'Lax');
            $fail = fn(string $msg) => new Redirect($c->base . '/#/signin?error=' . rawurlencode($msg));
            if ($c->arg('error')) {
                return $fail($c->arg('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Microsoft sign-in failed.');
            }
            try {
                $id = Microsoft::finish($c->db, $c->baseUrl, (string)$c->arg('code', ''), (string)$c->arg('state', ''), $_COOKIE['linen_oauth'] ?? null);
                $uid = Auth::sso_login($c->db, 'microsoft', $id['subject'], $id['email'], $id['name']);
                $c->sessionCookie(Auth::start_session($c->db, $uid), Auth::SESSION_DAYS * 86400);
            } catch (AuthError $e) {
                $c->db->audit(null, null, 'sso.refused', $e->getMessage());
                return $fail($e->getMessage());
            }
            return new Redirect($c->base . '/#/overview');
        }, public: true);

        $R('POST', '/api/auth/demo', function (Ctx $c) {
            if (!Config::get('demo')) {
                throw new ApiError(404, 'Not found');
            }
            $hid = $c->db->val('SELECT id FROM households WHERE is_demo = 1 ORDER BY id LIMIT 1');
            if ($hid === null) {
                throw new ApiError(404, 'No demo household');
            }
            $c->sessionCookie(Auth::start_session($c->db, null, (int)$hid), 4 * 3600);
            return ['ok' => true];
        }, public: true);

        $R('POST', '/api/auth/logout', function (Ctx $c) {
            Auth::end_session($c->db, $_COOKIE['linen_sid'] ?? null);
            $c->sessionCookie('', 0);
            return ['ok' => true];
        }, setup: true);

        $R('POST', '/api/auth/logout-all', function (Ctx $c) {
            if ($c->uid()) {
                Auth::end_all_sessions($c->db, $c->uid());
            }
            $c->sessionCookie('', 0);
            return ['ok' => true];
        });

        $R('POST', '/api/auth/password', function (Ctx $c) {
            if (!$c->uid()) {
                throw new ApiError(400, 'Not available in the demo');
            }
            Auth::throttle($c->db, 'pw:' . $c->uid(), 5, 600);
            Auth::change_password($c->db, $c->uid(), $c->hid(), (string)($c->body['old'] ?? ''), (string)($c->body['new'] ?? ''));
            $c->sessionCookie('', 0);
            return ['ok' => true];
        });

        $R('GET', '/api/me', function (Ctx $c) {
            $needsPasskey = $c->uid() && Config::get('require_passkey') && Passkeys::count($c->db, $c->uid()) === 0;
            if ($needsPasskey) {
                // Until Face ID is added, reveal nothing about the household.
                return ['user' => ['id' => $c->uid(), 'name' => $c->sess->userName, 'email' => $c->sess->email, 'role' => $c->sess->role,
                        'has_password' => true, 'sso' => null],
                    'household' => ['id' => null, 'name' => '', 'retention_months' => 0, 'is_demo' => false], 'members' => [],
                    'csrf' => $c->sess->csrf, 'billing' => ['status' => 'private', 'can_write' => false, 'plans' => new \stdClass()],
                    'consents' => new \stdClass(), 'categories' => [], 'groups' => new \stdClass(), 'this_month' => Money::this_month(),
                    'statement_months' => [], 'llm' => ['available' => false], 'private_mode' => (bool)Config::get('private_mode'),
                    'passkeys' => ['count' => 0, 'recovery_left' => 0, 'required' => true], 'setup_only' => true];
            }
            $h = $c->db->one('SELECT id, name, retention_months, is_demo FROM households WHERE id = ?', [$c->hid()]);
            $h['is_demo'] = (bool)$h['is_demo'];
            $u = $c->uid() ? $c->db->one('SELECT password_hash IS NOT NULL AS has_password, sso_provider FROM users WHERE id = ?', [$c->uid()]) : null;
            return [
                'user' => ['id' => $c->uid(), 'name' => $c->sess->userName, 'email' => $c->sess->email, 'role' => $c->sess->role,
                    'has_password' => (bool)($u['has_password'] ?? false), 'sso' => $u['sso_provider'] ?? null],
                'household' => $h, 'members' => Budget::members($c->db, $c->hid()), 'csrf' => $c->sess->csrf,
                'billing' => Billing::status($c->db, $c->hid()),
                'consents' => $c->uid() ? (Auth::current_consents($c->db, $c->uid()) ?: new \stdClass()) : new \stdClass(),
                'categories' => Categorise::categories(), 'groups' => RuleData::GROUPS, 'this_month' => Money::this_month(),
                'statement_months' => Analysis::months($c->db, new Scope($c->hid())),
                'llm' => ['available' => false, 'installed' => false, 'reason' => 'AI categorisation is not available in this version.'],
                'private_mode' => (bool)Config::get('private_mode'),
                'passkeys' => $c->uid() ? ['count' => Passkeys::count($c->db, $c->uid()), 'recovery_left' => Passkeys::recovery_left($c->db, $c->uid()),
                    'required' => (bool)Config::get('require_passkey')] : ['count' => 0, 'recovery_left' => 0, 'required' => false],
            ];
        }, setup: true);

        // --- passkeys (Face ID / Touch ID) --------------------------------------------
        $R('POST', '/api/auth/passkey/options', function (Ctx $c) {
            Auth::throttle($c->db, 'passkey:' . self::ip(), 30, 600);
            return Passkeys::login_options($c->db, $c->baseUrl);
        }, public: true);

        $R('POST', '/api/auth/passkey/verify', function (Ctx $c) {
            Auth::throttle($c->db, 'passkey-verify:' . self::ip(), 20, 600);
            try {
                $uid = Passkeys::login_verify($c->db, $c->body, $c->baseUrl);
            } catch (PasskeyError $e) {
                throw new ApiError(401, $e->getMessage());
            }
            $email = (string)$c->db->val('SELECT email FROM users WHERE id = ?', [$uid]);
            if (!Auth::email_allowed($email)) {
                throw new ApiError(403, 'This account no longer has access to this private area.');
            }
            $c->db->exec('UPDATE users SET last_login_at = ?, failed_logins = 0 WHERE id = ?', [Auth::now(), $uid]);
            $c->sessionCookie(Auth::start_session($c->db, $uid), Auth::SESSION_DAYS * 86400);
            $c->db->audit(null, $uid, 'login.passkey');
            return ['ok' => true];
        }, public: true);

        $R('POST', '/api/passkeys/options', function (Ctx $c) {
            if (!$c->uid()) {
                throw new ApiError(400, 'Not available in the demo');
            }
            return Passkeys::register_options($c->db, $c->uid(), $c->baseUrl);
        }, setup: true);

        $R('POST', '/api/passkeys', function (Ctx $c) {
            if (!$c->uid()) {
                throw new ApiError(400, 'Not available in the demo');
            }
            $first = Passkeys::count($c->db, $c->uid()) === 0;
            $id = Passkeys::register_verify($c->db, $c->uid(), (array)($c->body['credential'] ?? []), $c->baseUrl, (string)($c->body['name'] ?? ''));
            $c->db->audit($c->hid(), $c->uid(), 'passkey.added', (string)($c->body['name'] ?? ''));
            return ['id' => $id, 'recovery_codes' => $first ? Passkeys::new_recovery_codes($c->db, $c->uid()) : null];
        }, setup: true);

        $R('GET', '/api/passkeys', fn(Ctx $c) => ['passkeys' => $c->uid() ? Passkeys::list($c->db, $c->uid()) : [],
            'recovery_left' => $c->uid() ? Passkeys::recovery_left($c->db, $c->uid()) : 0]);

        $R('DELETE', '/api/passkeys/(\d+)', function (Ctx $c, string $id) {
            if (Config::get('require_passkey') && Passkeys::count($c->db, $c->uid()) <= 1) {
                throw new ApiError(400, 'Add Face ID on another device before removing your last passkey.');
            }
            Passkeys::delete($c->db, $c->uid(), (int)$id);
            $c->db->audit($c->hid(), $c->uid(), 'passkey.removed', $id);
            return ['ok' => true];
        });

        $R('POST', '/api/passkeys/recovery-codes', function (Ctx $c) {
            if (!$c->uid()) {
                throw new ApiError(400, 'Not available in the demo');
            }
            Auth::throttle($c->db, 'recovery:' . $c->uid(), 5, 3600);
            $c->db->audit($c->hid(), $c->uid(), 'recovery_codes.regenerated');
            return ['recovery_codes' => Passkeys::new_recovery_codes($c->db, $c->uid())];
        });

        // --- household ------------------------------------------------------------------
        $R('PATCH', '/api/household', function (Ctx $c) {
            $name = mb_substr(trim((string)($c->body['name'] ?? '')), 0, 80);
            $ret = $c->int('retention_months', false);
            if ($name !== '') {
                $c->db->exec('UPDATE households SET name = ? WHERE id = ?', [$name, $c->hid()]);
            }
            if ($ret !== null) {
                if ($ret < 6 || $ret > 120) {
                    throw new ApiError(400, 'Keep statements for 6 to 120 months');
                }
                $c->db->exec('UPDATE households SET retention_months = ? WHERE id = ?', [$ret, $c->hid()]);
                $c->db->audit($c->hid(), $c->uid(), 'retention.changed', "$ret months");
                Privacy::purge($c->db);
            }
            return ['ok' => true];
        }, owner: true);

        $R('POST', '/api/members', function (Ctx $c) {
            $name = mb_substr(trim((string)($c->body['name'] ?? '')), 0, 40);
            if ($name === '') {
                throw new ApiError(400, 'Enter a name');
            }
            $n = (int)$c->db->val('SELECT COUNT(*) FROM members WHERE household_id = ?', [$c->hid()]);
            if ($n >= 6) {
                throw new ApiError(400, 'A household can have up to 6 people');
            }
            return ['id' => $c->db->insert('INSERT INTO members (household_id, name, sort) VALUES (?, ?, ?)', [$c->hid(), $name, $n])];
        }, owner: true, write: true);

        $R('PATCH', '/api/members/(\d+)', function (Ctx $c, string $id) {
            $name = mb_substr(trim((string)($c->body['name'] ?? '')), 0, 40);
            if ($name === '') {
                throw new ApiError(400, 'Enter a name');
            }
            if (!$c->db->exec('UPDATE members SET name = ? WHERE id = ? AND household_id = ?', [$name, (int)$id, $c->hid()])) {
                throw new ApiError(404, 'Unknown person');
            }
            return ['ok' => true];
        }, write: true);

        $R('POST', '/api/invites', function (Ctx $c) {
            if (!$c->uid()) {
                throw new ApiError(400, 'Not available in the demo');
            }
            return ['token' => Auth::create_invite($c->db, $c->hid(), $c->uid()), 'expires_in_days' => 7];
        }, owner: true);

        // --- budget --------------------------------------------------------------------
        $R('GET', '/api/budget', fn(Ctx $c) => Budget::month_view($c->db, $c->hid(), $c->month(), $c->member()));

        $R('POST', '/api/budget/lines', function (Ctx $c) {
            $f = self::lineFields($c);
            $f['member_id'] = $c->int('member_id');
            $f['kind'] = $c->body['kind'] ?? 'expense';
            $f['amount_cents'] = $c->int('amount_cents');
            $f['start_month'] = $c->body['start_month'] ?? $c->month();
            return ['id' => Budget::create_line($c->db, $c->hid(), $f)];
        }, write: true);

        $R('PATCH', '/api/budget/lines/(\d+)', function (Ctx $c, string $id) {
            Budget::update_line($c->db, $c->hid(), (int)$id, self::lineFields($c));
            return ['ok' => true];
        }, write: true);

        $R('DELETE', '/api/budget/lines/(\d+)', function (Ctx $c, string $id) {
            Budget::delete_line($c->db, $c->hid(), (int)$id);
            return ['ok' => true];
        }, write: true);

        $R('POST', '/api/budget/lines/(\d+)/amount', function (Ctx $c, string $id) {
            self::lineFields($c); // type-checks month / mode / note
            $r = Budget::set_amount($c->db, $c->hid(), (int)$id, (string)($c->body['month'] ?? $c->month()), $c->int('amount_cents'),
                (string)($c->body['mode'] ?? 'onward'), $c->body['note'] ?? null);
            $c->db->audit($c->hid(), $c->uid(), 'budget.amount_changed', "line $id from {$r['month']} ({$r['mode']})");
            return $r;
        }, write: true);

        $R('GET', '/api/budget/lines/(\d+)/history', fn(Ctx $c, string $id) => Budget::history($c->db, $c->hid(), (int)$id));

        $R('POST', '/api/budget/lines/(\d+)/paid', function (Ctx $c, string $id) {
            Budget::set_paid($c->db, $c->hid(), (int)$id, (string)($c->body['month'] ?? $c->month()), $c->bool('paid'));
            return ['ok' => true];
        }, write: true);

        $R('GET', '/api/debit-orders', fn(Ctx $c) => Budget::debit_order_review($c->db, $c->hid(), $c->month(), $c->member()));
        $R('GET', '/api/forecast', fn(Ctx $c) => Forecast::forecast($c->db, $c->hid(), $c->month(), $c->member()));

        // --- goals ---------------------------------------------------------------------
        $R('GET', '/api/goals', fn(Ctx $c) => Goals::plan_all($c->db, $c->hid(), $c->month()));
        $R('POST', '/api/goals', fn(Ctx $c) => ['id' => Goals::save($c->db, $c->hid(), $c->body)], write: true);
        $R('PATCH', '/api/goals/(\d+)', fn(Ctx $c, string $id) => ['id' => Goals::save($c->db, $c->hid(), $c->body, (int)$id)], write: true);
        $R('DELETE', '/api/goals/(\d+)', function (Ctx $c, string $id) {
            Goals::delete($c->db, $c->hid(), (int)$id);
            return ['ok' => true];
        }, write: true);

        // --- statements ------------------------------------------------------------------
        $R('GET', '/api/transactions', function (Ctx $c) {
            [$w, $p] = (new Scope($c->hid(), $c->member()))->sql();
            $sql = "SELECT t.id, t.posted_on, t.description, t.amount_cents, t.category, t.category_source, t.is_transfer, a.label AS account
                    FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE $w";
            if ($c->arg('month')) {
                $sql .= ' AND substr(t.posted_on, 1, 7) = ?';
                $p[] = $c->month();
            }
            if ($c->arg('category')) {
                $sql .= ' AND t.category = ?';
                $p[] = $c->arg('category');
            }
            if ($c->arg('q')) {
                $sql .= ' AND t.description LIKE ?';
                $p[] = '%' . mb_substr($c->arg('q'), 0, 60) . '%';
            }
            if ($c->arg('unknown')) {
                $sql .= " AND t.category_source = 'none' AND t.is_transfer = 0";
            }
            return $c->db->all($sql . ' ORDER BY t.posted_on DESC, t.id DESC LIMIT 1000', $p);
        });

        $R('POST', '/api/transactions/(\d+)/category', fn(Ctx $c, string $id) =>
            Categorise::set_category($c->db, $c->hid(), (int)$id, (string)($c->body['category'] ?? ''), $c->bool('make_rule', true)), write: true);

        $R('POST', '/api/import', function (Ctx $c) {
            // PDFs are binary, so the browser sends them base64-encoded.
            $content = isset($c->body['content_b64']) ? (string)base64_decode((string)$c->body['content_b64'], true) : (string)($c->body['content'] ?? '');
            if (trim($content) === '') {
                throw new ApiError(400, 'Empty file');
            }
            $filename = mb_substr((string)($c->body['filename'] ?? ''), 0, 120);
            try {
                $st = Statements::parse($content, (string)($c->body['bank'] ?? 'auto'));
            } catch (StatementFormatError $e) {
                throw new ApiError(422, $e->getMessage());
            }
            $memberId = $c->int('member_id', false);
            $label = $c->body['account_label'] ?? null;
            // auto: a statement from an account seen before goes to that account and person. A new account needs
            // its owner once; the answer comes back as member_id (null = joint).
            if (!empty($c->body['auto'])) {
                $known = Statements::known_account($c->db, $c->hid(), $st);
                if ($known) {
                    [$memberId, $label] = [$known['member_id'], $known['label']];
                } elseif (!array_key_exists('member_id', $c->body)) {
                    $dates = array_column($st['transactions'], 'posted_on');
                    return new Raw(json_encode(['error' => 'Whose account is this?', 'needs_owner' => true, 'bank' => $st['bank'],
                        'last4' => $st['account_last4'], 'first_date' => min($dates), 'last_date' => max($dates)]), 'application/json', null, 409);
                }
            }
            $r = Statements::import_parsed($c->db, $c->hid(), $st, $memberId, $label, 'transactional', $filename);
            $c->db->audit($c->hid(), $c->uid(), 'statement.imported', "{$r['rows_added']} new rows");
            return $r;
        }, write: true);

        $R('POST', '/api/categorise/ai', fn(Ctx $c) => throw new ApiError(503, 'AI categorisation is not available in this version.'), write: true);

        $R('GET', '/api/actuals', function (Ctx $c) {
            $s = new Scope($c->hid(), $c->member());
            $m = $c->arg('month') ?: Analysis::latest_month($c->db, $s);
            if (!$m) {
                return ['has_data' => false];
            }
            $m = Budget::valid_month($m);
            return ['has_data' => true, 'summary' => Analysis::summary($c->db, $s, $m), 'fees' => Analysis::fees_and_interest($c->db, $s, $m),
                'recurring' => Analysis::recurring($c->db, $s, $m), 'advice' => Analysis::top_actions($c->db, $s, $m)];
        });

        // --- debts ---------------------------------------------------------------------
        $R('GET', '/api/debts', fn(Ctx $c) => Debt::load($c->db, $c->hid()));
        $R('POST', '/api/debts', function (Ctx $c) {
            $name = mb_substr(trim((string)($c->body['name'] ?? '')), 0, 60);
            [$bal, $apr, $min] = [$c->int('balance_cents'), $c->int('apr_bp'), $c->int('min_payment_cents')];
            if ($name === '' || $bal < 0 || $apr < 0 || $apr > 10000 || $min < 0) {
                throw new ApiError(400, "Check the values: balance and payment can't be negative, rate is 0-100%.");
            }
            return ['id' => $c->db->insert('INSERT INTO debts (household_id, name, balance_cents, apr_bp, min_payment_cents) VALUES (?, ?, ?, ?, ?)',
                [$c->hid(), $name, $bal, $apr, $min])];
        }, write: true);
        $R('DELETE', '/api/debts/(\d+)', function (Ctx $c, string $id) {
            $c->db->exec('DELETE FROM debts WHERE id = ? AND household_id = ?', [(int)$id, $c->hid()]);
            return ['ok' => true];
        }, write: true);
        $R('GET', '/api/debts/plan', function (Ctx $c) {
            $x = $c->arg('extra_cents', '0');
            if (!ctype_digit($x)) {
                throw new ApiError(400, 'extra_cents must be a whole number');
            }
            return Debt::compare(Debt::load($c->db, $c->hid()), (int)$x);
        });

        // --- Excel workbook --------------------------------------------------------------
        $xl = function (Ctx $c): string {
            $d = base64_decode((string)($c->body['content_b64'] ?? ''), true);
            if ($d === false || $d === '') {
                throw new ApiError(400, 'Upload an .xlsx file');
            }
            return $d;
        };
        $R('POST', '/api/workbook/preview', function (Ctx $c) use ($xl) {
            try {
                return Xlsx::preview($xl($c));
            } catch (WorkbookError $e) {
                throw new ApiError(422, $e->getMessage());
            }
        }, write: true);
        $R('POST', '/api/workbook/import', function (Ctx $c) use ($xl) {
            $map = [];
            foreach ((array)($c->body['person_map'] ?? []) as $k => $v) {
                if (is_numeric($v)) {
                    $map[(string)$k] = (int)$v;
                }
            }
            try {
                return Xlsx::import($c->db, $c->hid(), $xl($c), $map, $c->uid(), ($c->body['from_month'] ?? null) ?: null);
            } catch (WorkbookError $e) {
                throw new ApiError(422, $e->getMessage());
            }
        }, write: true);

        // --- exports & Power BI ------------------------------------------------------------
        $R('GET', '/api/export/powerbi\.zip', function (Ctx $c) {
            $c->db->audit($c->hid(), $c->uid(), 'export.powerbi');
            return new Raw(Export::zip($c->db, $c->hid()), 'application/zip', 'budget-powerbi.zip');
        });
        $R('GET', '/api/export/(\w+)\.csv', function (Ctx $c, string $t) {
            if (!in_array($t, Export::TABLES, true)) {
                throw new ApiError(404, 'Unknown table');
            }
            return new Raw(Export::csv($c->db, $c->hid(), $t), 'text/csv; charset=utf-8', "$t.csv");
        });
        $R('GET', '/api/powerbi/(\w+)\.csv', function (Ctx $c, string $t) {
            $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
            $hid = Auth::check_api_token($c->db, trim(preg_replace('/^Bearer\s+/i', '', $hdr)));
            if (!$hid) {
                Auth::throttle($c->db, 'token:' . self::ip(), 20, 60);
                throw new ApiError(401, 'Missing or invalid API token');
            }
            if (!in_array($t, Export::TABLES, true)) {
                throw new ApiError(404, 'Unknown table');
            }
            return new Raw(Export::csv($c->db, $hid, $t), 'text/csv; charset=utf-8');
        }, public: true);
        $R('GET', '/api/tokens', fn(Ctx $c) => [
            'tokens' => $c->db->all('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE household_id = ? AND revoked_at IS NULL ORDER BY id DESC', [$c->hid()]),
            'tables' => Export::TABLES, 'query_template' => Export::power_query($c->baseUrl, 'fact_budget'), 'base_url' => $c->baseUrl,
        ]);
        $R('POST', '/api/tokens', function (Ctx $c) {
            if (!$c->uid()) {
                throw new ApiError(400, 'Not available in the demo');
            }
            return ['token' => Auth::create_api_token($c->db, $c->hid(), $c->uid(), (string)($c->body['name'] ?? 'Power BI'))];
        }, owner: true);
        $R('DELETE', '/api/tokens/(\d+)', function (Ctx $c, string $id) {
            Auth::revoke_api_token($c->db, $c->hid(), $c->uid(), (int)$id);
            return ['ok' => true];
        }, owner: true);

        // --- privacy (POPIA) ---------------------------------------------------------------
        $R('GET', '/api/privacy/export', fn(Ctx $c) => new Raw(
            json_encode(Privacy::export($c->db, $c->hid(), $c->uid()), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'application/json', 'my-budget-data.json'));
        $R('POST', '/api/privacy/consent', function (Ctx $c) {
            if (!$c->uid()) {
                throw new ApiError(400, 'Not available in the demo');
            }
            Auth::set_consent($c->db, $c->uid(), $c->hid(), (string)($c->body['purpose'] ?? ''), $c->bool('granted'));
            return ['ok' => true];
        });
        $R('GET', '/api/privacy/audit', fn(Ctx $c) => Privacy::audit_entries($c->db, $c->hid()));
        $R('POST', '/api/privacy/delete-household', function (Ctx $c) {
            if ($c->sess->isDemo) {
                throw new ApiError(400, "The demo can't be deleted");
            }
            self::confirmPassword($c);
            Privacy::delete_household($c->db, $c->hid());
            $c->sessionCookie('', 0);
            return ['ok' => true];
        }, owner: true);
        $R('POST', '/api/privacy/leave', function (Ctx $c) {
            if ($c->sess->role === 'owner') {
                throw new ApiError(400, "The owner can't leave; delete the household instead.");
            }
            self::confirmPassword($c);
            Privacy::leave($c->db, $c->hid(), $c->uid());
            $c->sessionCookie('', 0);
            return ['ok' => true];
        });

        // --- billing (SaaS mode only) ------------------------------------------------------
        $R('GET', '/api/billing', fn(Ctx $c) => Billing::status($c->db, $c->hid()));
        $R('POST', '/api/billing/simulate', function (Ctx $c) {
            if (Config::get('env') !== 'development') {
                throw new ApiError(403, "Payments aren't configured.");
            }
            $plan = (string)($c->body['plan'] ?? 'household');
            Billing::activate($c->db, $c->hid(), $plan, $c->uid(), (Billing::PLANS[$plan]['interval'] ?? '') === 'year' ? 12 : 1);
            return Billing::status($c->db, $c->hid());
        }, owner: true);
        $R('POST', '/api/billing/cancel', function (Ctx $c) {
            Billing::cancel($c->db, $c->hid(), $c->uid());
            return Billing::status($c->db, $c->hid());
        }, owner: true);
    }
}
