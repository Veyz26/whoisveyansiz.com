<?php
/**
 * Accounts, sessions, invites, consents and API tokens. Mirrors auth.py.
 * - Passwords: password_hash (Argon2id where available, else bcrypt).
 * - Session/invite/API tokens: random 256-bit values; only their SHA-256 is stored.
 * - In private mode only allow-listed emails can create or use an account.
 */
declare(strict_types=1);

namespace Linen;

final class AuthError extends \RuntimeException {}

/** Password was right, but this account has a passkey, so a recovery code is needed too. */
final class NeedsRecoveryCode extends \RuntimeException {}

final class Session
{
    public function __construct(
        public readonly ?int $userId, public readonly int $householdId, public readonly string $role,
        public readonly string $csrf, public readonly string $userName, public readonly ?string $email,
        public readonly bool $isDemo, public readonly string $tokenHash,
    ) {}
}

final class Auth
{
    public const PRIVACY_VERSION = '2026-11';
    public const SESSION_DAYS = 14;
    public const SESSION_IDLE_HOURS = 12;
    public const MAX_FAILED = 5;
    public const LOCK_MINUTES = 15;
    public const TRIAL_DAYS = 30;
    public const PURPOSES = ['service', 'ai_categorisation', 'product_updates'];

    public static function now(int $offsetSeconds = 0): string
    {
        return gmdate('Y-m-d H:i:s', time() + $offsetSeconds);
    }

    public static function token_hash(string $t): string
    {
        return hash('sha256', $t);
    }

    public static function token(int $bytes = 32): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    public static function hash_password(string $pw): string
    {
        return password_hash($pw, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
    }

    public static function check_strength(string $pw): void
    {
        if (strlen($pw) < 10) {
            throw new AuthError('Use at least 10 characters for your password.');
        }
        if (in_array(strtolower($pw), ['password123', '1234567890', 'qwertyuiop'], true) || count(array_unique(str_split($pw))) < 5) {
            throw new AuthError('That password is too easy to guess.');
        }
    }

    public static function email_allowed(string $email): bool
    {
        if (!Config::get('private_mode')) {
            return true;
        }
        return in_array(strtolower(trim($email)), Config::get('allowed_emails'), true);
    }

    /** Setup phrases ignore capitals, spaces and punctuation, so "Our KAVE" matches "ourkave". */
    public const SETUP_MIN = 6;  // letters or numbers; signup is throttled and only works for invited emails

    public static function setup_code_ok(string $email, string $given): bool
    {
        $expected = Config::get('setup_codes')[strtolower(trim($email))] ?? '';
        $norm = fn(string $c) => strtoupper(preg_replace('/[^0-9A-Za-z]/', '', $c));
        if ($expected !== '' && strlen($norm($expected)) < self::SETUP_MIN) {
            // A phrase this short can never match; tell the owner in the PHP error log.
            error_log("KAVE: the setup phrase for $email in config.php needs at least " . self::SETUP_MIN . ' letters or numbers');
            return false;
        }
        return $expected !== '' && hash_equals($norm($expected), $norm($given));
    }

    private static function record_consents(Conn $db, int $uid, array $consents): void
    {
        foreach (self::PURPOSES as $p) {
            if (array_key_exists($p, $consents)) {
                $db->exec('INSERT INTO consents (user_id, purpose, version, granted) VALUES (?, ?, ?, ?)',
                    [$uid, $p, self::PRIVACY_VERSION, (int)(bool)$consents[$p]]);
            }
        }
    }

    public static function current_consents(Conn $db, int $uid): array
    {
        $out = [];
        foreach ($db->all('SELECT purpose, granted, version, created_at FROM consents c WHERE user_id = ?
                AND id = (SELECT MAX(id) FROM consents WHERE user_id = c.user_id AND purpose = c.purpose)', [$uid]) as $r) {
            $out[$r['purpose']] = ['granted' => (bool)$r['granted'], 'version' => $r['version'], 'at' => $r['created_at']];
        }
        return $out;
    }

    public static function set_consent(Conn $db, int $uid, int $hid, string $purpose, bool $granted): void
    {
        if (!in_array($purpose, self::PURPOSES, true) || $purpose === 'service') {
            throw new AuthError("That consent can't be changed here. Delete your account to withdraw it.");
        }
        $db->tx(function (Conn $db) use ($uid, $hid, $purpose, $granted) {
            self::record_consents($db, $uid, [$purpose => $granted]);
            $db->audit($hid, $uid, 'consent.changed', "$purpose=" . ($granted ? 'yes' : 'no'));
        });
    }

    public static function create_household(Conn $db, string $name, array $memberNames, bool $isDemo = false): int
    {
        $hid = $db->insert('INSERT INTO households (name, trial_ends_on, is_demo) VALUES (?, ?, ?)',
            [mb_substr($name, 0, 80), gmdate('Y-m-d', time() + self::TRIAL_DAYS * 86400), (int)$isDemo]);
        $i = 0;
        foreach ($memberNames as $m) {
            if (trim((string)$m) !== '') {
                $db->exec('INSERT INTO members (household_id, name, sort) VALUES (?, ?, ?)', [$hid, mb_substr(trim($m), 0, 40), $i++]);
            }
        }
        return $hid;
    }

    private static function first_name(string $name): string
    {
        return explode(' ', trim($name))[0];
    }

    /**
     * Creates the user and puts them in a household:
     * - with a valid invite → that household as partner;
     * - private mode and a household already exists → join it as partner (the allowlist is the invite);
     * - otherwise → a new household as owner.
     */
    private static function create_user(Conn $db, string $email, string $name, ?string $pwHash, ?string $partner, array $consents,
                                        ?string $invite, ?string $ssoProvider = null, ?string $ssoSubject = null): int
    {
        return $db->tx(function (Conn $db) use ($email, $name, $pwHash, $partner, $consents, $invite, $ssoProvider, $ssoSubject) {
            $inv = null;
            if ($invite) {
                $inv = $db->one('SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', [self::token_hash($invite), self::now()]);
                if (!$inv) {
                    throw new AuthError('This invite link has expired or was already used. Ask for a new one.');
                }
            }
            $uid = $db->insert('INSERT INTO users (email, name, password_hash, sso_provider, sso_subject) VALUES (?, ?, ?, ?, ?)',
                [$email, $name, $pwHash, $ssoProvider, $ssoSubject]);
            self::record_consents($db, $uid, $consents);
            $joinHid = $inv ? (int)$inv['household_id'] : null;
            if (!$joinHid && Config::get('private_mode')) {
                $joinHid = $db->val('SELECT id FROM households WHERE is_demo = 0 ORDER BY id LIMIT 1');
                $joinHid = $joinHid === null ? null : (int)$joinHid;
            }
            if ($joinHid) {
                if ($inv) {
                    $db->exec('UPDATE invites SET used_at = ? WHERE token_hash = ?', [self::now(), $inv['token_hash']]);
                }
                $db->exec("INSERT INTO memberships (user_id, household_id, role) VALUES (?, ?, 'partner')", [$uid, $joinHid]);
                $m = $db->one('SELECT id FROM members WHERE household_id = ? AND user_id IS NULL AND lower(name) = lower(?)',
                    [$joinHid, self::first_name($name)]);
                if ($m) {
                    $db->exec('UPDATE members SET user_id = ? WHERE id = ?', [$uid, $m['id']]);
                } else {
                    $n = (int)$db->val('SELECT COUNT(*) FROM members WHERE household_id = ?', [$joinHid]);
                    $db->exec('INSERT INTO members (household_id, name, user_id, sort) VALUES (?, ?, ?, ?)', [$joinHid, self::first_name($name), $uid, $n]);
                }
                $db->audit($joinHid, $uid, 'user.joined', $email);
            } else {
                $people = array_filter([self::first_name($name), $partner ? trim($partner) : null]);
                $hid = self::create_household($db, self::first_name($name) . "'s household", $people);
                $db->exec("INSERT INTO memberships (user_id, household_id, role) VALUES (?, ?, 'owner')", [$uid, $hid]);
                $db->exec('UPDATE members SET user_id = ? WHERE household_id = ? AND sort = 0', [$uid, $hid]);
                $db->audit($hid, $uid, 'user.signup', $email);
            }
            return $uid;
        });
    }

    /**
     * Private mode's sign-in starts with the email: says what that person does next, so the page shows
     * only that. Only invited emails get an answer beyond 'not_invited', and that list is just the household.
     * @return array{next: string, name?: string}  next: not_invited | new | password | passkey | microsoft
     */
    public static function lookup(Conn $db, string $email): array
    {
        $email = strtolower(trim($email));
        if (!preg_match('/^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$/', $email)) {
            throw new AuthError('Enter a valid email address.');
        }
        if (!self::email_allowed($email)) {
            return ['next' => 'not_invited'];
        }
        $u = $db->one('SELECT id, name, password_hash FROM users WHERE email = ?', [$email]);
        if (!$u) {
            return ['next' => Config::get('password_login') ? 'new' : 'microsoft'];
        }
        $first = explode(' ', trim((string)$u['name']))[0];
        $next = Passkeys::count($db, (int)$u['id']) > 0 ? 'passkey' : ($u['password_hash'] && Config::get('password_login') ? 'password' : 'microsoft');
        return ['next' => $next, 'name' => $first];
    }

    public static function signup(Conn $db, array $d): int
    {
        $email = strtolower(trim((string)($d['email'] ?? '')));
        $name = mb_substr(trim((string)($d['name'] ?? '')), 0, 60);
        $pw = (string)($d['password'] ?? '');
        if (!Config::get('password_login')) {
            throw new AuthError('Sign in with Microsoft instead.');
        }
        if (!preg_match('/^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$/', $email)) {
            throw new AuthError('Enter a valid email address.');
        }
        if (!self::email_allowed($email)) {
            throw new AuthError("This is a private area. Ask the owner to add your email.");
        }
        // Private mode: being on the allowlist isn't proof you own the address, so a password account
        // also needs the one-time setup code from config.php (an invite link or Microsoft sign-in is proof too).
        if (Config::get('private_mode') && empty($d['invite']) && !self::setup_code_ok($email, (string)($d['setup_code'] ?? ''))) {
            throw new AuthError("That setup phrase isn't right. Ask the owner for it.");
        }
        if ($name === '') {
            throw new AuthError('Enter your name.');
        }
        self::check_strength($pw);
        $consents = (array)($d['consents'] ?? []);
        if (empty($consents['service'])) {
            throw new AuthError('You need to accept the privacy notice to create an account.');
        }
        if ($db->val('SELECT 1 FROM users WHERE email = ?', [$email])) {
            throw new AuthError('An account with that email already exists. Sign in instead.');
        }
        return self::create_user($db, $email, $name, self::hash_password($pw), $d['partner_name'] ?? null, $consents, $d['invite'] ?? null);
    }

    public static function login(Conn $db, string $email, string $pw, ?string $recoveryCode = null): int
    {
        $email = strtolower(trim($email));
        $u = $db->one('SELECT * FROM users WHERE email = ?', [$email]);
        $generic = new AuthError('Email or password is incorrect.');
        if (!$u || !$u['password_hash']) {
            password_verify($pw, '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG'); // equal work either way
            throw $generic;
        }
        if (!self::email_allowed($email)) {
            throw new AuthError('This account no longer has access to this private area.');
        }
        if ($u['locked_until'] && $u['locked_until'] > self::now()) {
            throw new AuthError('Too many attempts. Try again in a few minutes.');
        }
        if (!password_verify($pw, $u['password_hash'])) {
            $failed = (int)$u['failed_logins'] + 1;
            $locked = $failed >= self::MAX_FAILED ? self::now(self::LOCK_MINUTES * 60) : null;
            $db->exec('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [$locked ? 0 : $failed, $locked, $u['id']]);
            $db->audit(null, (int)$u['id'], 'login.failed', $locked ? 'locked' : null);
            throw $generic;
        }
        // With a passkey on the account, a password alone isn't enough: it also takes a one-time recovery code.
        if (Passkeys::count($db, (int)$u['id']) > 0) {
            if ($recoveryCode === null || trim($recoveryCode) === '') {
                throw new NeedsRecoveryCode('This account signs in with a passkey (Face ID, Touch ID or Windows Hello). Use that, or enter one of your recovery codes.');
            }
            if (!Passkeys::use_recovery_code($db, (int)$u['id'], $recoveryCode)) {
                $failed = (int)$u['failed_logins'] + 1;
                $locked = $failed >= self::MAX_FAILED ? self::now(self::LOCK_MINUTES * 60) : null;
                $db->exec('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [$locked ? 0 : $failed, $locked, $u['id']]);
                $db->audit(null, (int)$u['id'], 'login.bad_recovery_code');
                throw new AuthError("That recovery code isn't valid (each code works once).");
            }
            $db->audit(null, (int)$u['id'], 'login.recovery_code_used', Passkeys::recovery_left($db, (int)$u['id']) . ' left');
        }
        $db->exec('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [self::now(), $u['id']]);
        if (password_needs_rehash($u['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
            $db->exec('UPDATE users SET password_hash = ? WHERE id = ?', [self::hash_password($pw), $u['id']]);
        }
        return (int)$u['id'];
    }

    /** Microsoft sign-in: find or create the user for a verified (tid, oid) and email. */
    public static function sso_login(Conn $db, string $provider, string $subject, string $email, string $name): int
    {
        $email = strtolower(trim($email));
        if (!self::email_allowed($email)) {
            throw new AuthError("This is a private area and $email isn't on the list.");
        }
        $bySub = $db->one('SELECT * FROM users WHERE sso_provider = ? AND sso_subject = ?', [$provider, $subject]);
        if ($bySub) {
            $uid = (int)$bySub['id'];
        } else {
            $byEmail = $db->one('SELECT * FROM users WHERE email = ?', [$email]);
            if ($byEmail && $byEmail['sso_subject'] && $byEmail['sso_subject'] !== $subject) {
                throw new AuthError('That email is already linked to a different Microsoft account.');
            }
            if ($byEmail) {
                $uid = (int)$byEmail['id'];
                $db->exec('UPDATE users SET sso_provider = ?, sso_subject = ? WHERE id = ?', [$provider, $subject, $uid]);
            } else {
                // Signing in with SSO for the first time is consenting to the privacy notice shown on the sign-in page.
                $uid = self::create_user($db, $email, mb_substr($name ?: explode('@', $email)[0], 0, 60), null, null,
                    ['service' => true], null, $provider, $subject);
            }
        }
        $db->exec('UPDATE users SET last_login_at = ?, failed_logins = 0 WHERE id = ?', [self::now(), $uid]);
        return $uid;
    }

    /** A short, human name for the browser a session was started from, e.g. "iPhone · Safari". */
    public static function device_label(?string $userAgent): string
    {
        $ua = (string)$userAgent;
        $has = fn(string ...$any) => (bool)array_filter($any, fn($n) => str_contains($ua, $n));
        $device = match (true) {
            $has('iPhone') => 'iPhone',
            $has('iPad') => 'iPad',
            $has('Android') => $has('Mobile') ? 'Android phone' : 'Android tablet',
            $has('Macintosh') => 'Mac',
            $has('Windows') => 'Windows PC',
            $has('CrOS') => 'Chromebook',
            $has('Linux') => 'Linux computer',
            default => '',
        };
        $browser = match (true) {
            $has('Edg/', 'EdgiOS/', 'EdgA/') => 'Edge',
            $has('OPR/') => 'Opera',
            $has('Firefox/', 'FxiOS/') => 'Firefox',
            $has('SamsungBrowser/') => 'Samsung Internet',
            $has('Chrome/', 'CriOS/') => 'Chrome',
            $has('Safari/') => 'Safari',
            // An app added to the iPhone Home Screen sends no browser name.
            $has('iPhone', 'iPad') && $has('AppleWebKit') => 'Home Screen app',
            default => '',
        };
        return implode(' · ', array_filter([$device, $browser])) ?: 'Unknown device';
    }

    public static function start_session(Conn $db, ?int $uid, ?int $hid = null, ?string $userAgent = null): string
    {
        if ($hid === null) {
            $hid = $db->val("SELECT household_id FROM memberships WHERE user_id = ? ORDER BY role = 'owner' DESC", [$uid]);
            if ($hid === null) {
                throw new AuthError("This account isn't part of a household.");
            }
        }
        $t = self::token();
        $device = self::device_label($userAgent ?? $_SERVER['HTTP_USER_AGENT'] ?? null);
        $db->tx(function (Conn $db) use ($t, $uid, $hid, $device) {
            $db->exec('DELETE FROM sessions WHERE expires_at < ?', [self::now()]);
            $db->exec('INSERT INTO sessions (token_hash, user_id, household_id, csrf_token, expires_at, device) VALUES (?, ?, ?, ?, ?, ?)',
                [self::token_hash($t), $uid, (int)$hid, self::token(24), self::now(self::SESSION_DAYS * 86400), $device]);
            $db->audit((int)$hid, $uid, 'login');
        });
        return $t;
    }

    public static function get_session(Conn $db, ?string $token): ?Session
    {
        if (!$token) {
            return null;
        }
        $r = $db->one('SELECT s.*, u.name AS user_name, u.email, h.is_demo, m.role AS role
            FROM sessions s JOIN households h ON h.id = s.household_id
            LEFT JOIN users u ON u.id = s.user_id
            LEFT JOIN memberships m ON m.user_id = s.user_id AND m.household_id = s.household_id
            WHERE s.token_hash = ?', [self::token_hash($token)]);
        if (!$r) {
            return null;
        }
        if ($r['expires_at'] < self::now() || $r['last_seen_at'] < self::now(-self::SESSION_IDLE_HOURS * 3600)) {
            $db->exec('DELETE FROM sessions WHERE token_hash = ?', [$r['token_hash']]);
            return null;
        }
        $role = $r['role'] ?? (($r['user_id'] === null && $r['is_demo']) ? 'owner' : null);
        if ($role === null || ($r['email'] && !self::email_allowed($r['email']))) {
            return null; // removed from the household, or from the allowlist
        }
        if ($r['last_seen_at'] < self::now(-300)) {
            $db->exec('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [self::now(), $r['token_hash']]);
        }
        return new Session($r['user_id'] === null ? null : (int)$r['user_id'], (int)$r['household_id'], $role, $r['csrf_token'],
            $r['user_name'] ?? 'Demo', $r['email'], (bool)$r['is_demo'], $r['token_hash']);
    }

    public static function end_session(Conn $db, ?string $token): void
    {
        if ($token) {
            $db->exec('DELETE FROM sessions WHERE token_hash = ?', [self::token_hash($token)]);
        }
    }

    public static function end_all_sessions(Conn $db, int $uid): void
    {
        $db->exec('DELETE FROM sessions WHERE user_id = ?', [$uid]);
    }

    /** The id shown for a session in "Where you're signed in": stable, and it gives away nothing about the token. */
    private static function session_public_id(string $tokenHash): string
    {
        return substr(hash('sha256', 'sid:' . $tokenHash), 0, 16);
    }

    /** Sessions of the signed-in person that still work, this one first, then most recently used. */
    public static function list_sessions(Conn $db, Session $s): array
    {
        $rows = $s->userId === null
            ? $db->all('SELECT token_hash, device, created_at, last_seen_at FROM sessions WHERE token_hash = ?', [$s->tokenHash])
            : $db->all('SELECT token_hash, device, created_at, last_seen_at FROM sessions
                WHERE user_id = ? AND expires_at >= ? AND last_seen_at >= ? ORDER BY last_seen_at DESC',
                [$s->userId, self::now(), self::now(-self::SESSION_IDLE_HOURS * 3600)]);
        // Sessions from before devices were recorded: the one asking can still be named from its own request.
        $here = self::device_label($_SERVER['HTTP_USER_AGENT'] ?? null);
        $out = array_map(fn(array $r) => [
            'id' => self::session_public_id($r['token_hash']),
            'device' => $r['device'] ?: ($r['token_hash'] === $s->tokenHash ? $here : 'Unknown device'),
            'created_at' => $r['created_at'], 'last_seen_at' => $r['last_seen_at'], 'current' => $r['token_hash'] === $s->tokenHash,
        ], $rows);
        usort($out, fn(array $a, array $b) => $b['current'] <=> $a['current']);  // stable: the rest keep their order
        return $out;
    }

    /** Signs out one other session of the same person. Returns false when the id isn't theirs (or is this session). */
    public static function end_session_by_id(Conn $db, Session $s, string $publicId): bool
    {
        if ($s->userId === null) {
            return false;
        }
        foreach ($db->all('SELECT token_hash FROM sessions WHERE user_id = ? AND token_hash <> ?', [$s->userId, $s->tokenHash]) as $r) {
            if (hash_equals(self::session_public_id($r['token_hash']), $publicId)) {
                return $db->exec('DELETE FROM sessions WHERE token_hash = ?', [$r['token_hash']]) > 0;
            }
        }
        return false;
    }

    /** Signs out every session of this person except the one asking. Returns how many were ended. */
    public static function end_other_sessions(Conn $db, Session $s): int
    {
        return $s->userId === null ? 0
            : $db->exec('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$s->userId, $s->tokenHash]);
    }

    public static function change_password(Conn $db, int $uid, int $hid, string $old, string $new): void
    {
        $u = $db->one('SELECT password_hash FROM users WHERE id = ?', [$uid]);
        if ($u && $u['password_hash'] && !password_verify($old, $u['password_hash'])) {
            throw new AuthError('Your current password is incorrect.');
        }
        self::check_strength($new);
        $db->tx(function (Conn $db) use ($uid, $hid, $new) {
            $db->exec('UPDATE users SET password_hash = ? WHERE id = ?', [self::hash_password($new), $uid]);
            $db->exec('DELETE FROM sessions WHERE user_id = ?', [$uid]);
            $db->audit($hid, $uid, 'password.changed');
        });
    }

    public static function create_invite(Conn $db, int $hid, int $uid): string
    {
        $t = self::token(24);
        $db->exec('INSERT INTO invites (token_hash, household_id, created_by, expires_at) VALUES (?, ?, ?, ?)',
            [self::token_hash($t), $hid, $uid, self::now(7 * 86400)]);
        $db->audit($hid, $uid, 'invite.created');
        return $t;
    }

    public static function create_api_token(Conn $db, int $hid, ?int $uid, string $name): string
    {
        $t = 'bt_' . self::token();
        $db->exec('INSERT INTO api_tokens (household_id, name, token_hash, prefix, created_by) VALUES (?, ?, ?, ?, ?)',
            [$hid, mb_substr(trim($name) ?: 'Power BI', 0, 60), self::token_hash($t), substr($t, 0, 9), $uid]);
        $db->audit($hid, $uid, 'api_token.created', $name);
        return $t;
    }

    public static function check_api_token(Conn $db, ?string $t): ?int
    {
        if (!$t || !str_starts_with($t, 'bt_')) {
            return null;
        }
        $r = $db->one('SELECT id, household_id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL', [self::token_hash($t)]);
        if (!$r) {
            return null;
        }
        $db->exec('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', [self::now(), $r['id']]);
        return (int)$r['household_id'];
    }

    public static function revoke_api_token(Conn $db, int $hid, ?int $uid, int $id): void
    {
        $db->exec('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND household_id = ?', [self::now(), $id, $hid]);
        $db->audit($hid, $uid, 'api_token.revoked', (string)$id);
    }

    /** DB-backed sliding-window rate limit (PHP keeps no memory between requests). */
    public static function throttle(Conn $db, string $key, int $limit = 10, int $per = 60): void
    {
        $now = microtime(true);
        $db->exec('DELETE FROM rate_limits WHERE at < ?', [$now - 3600]);
        if ((int)$db->val('SELECT COUNT(*) FROM rate_limits WHERE key = ? AND at > ?', [$key, $now - $per]) >= $limit) {
            throw new AuthError('Too many attempts. Wait a minute and try again.', 429);
        }
        $db->exec('INSERT INTO rate_limits (key, at) VALUES (?, ?)', [$key, $now]);
    }
}

/**
 * Microsoft identity platform sign-in (OpenID Connect, authorization code flow with PKCE).
 *
 * The ID token comes straight from Microsoft's token endpoint over TLS in a back-channel request,
 * so per OpenID Connect Core 3.1.3.7 the TLS server check stands in for verifying the token's
 * signature. Issuer, audience, expiry and nonce are still checked. Accounts are bound to the
 * immutable tenant + object id on first sign-in, so a later change of email can't take one over.
 */
final class Microsoft
{
    public const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

    public static function enabled(): bool
    {
        $m = Config::get('microsoft');
        return !empty($m['client_id']) && !empty($m['client_secret']);
    }

    private static function tenant(): string
    {
        return Config::get('microsoft')['tenant'] ?: 'common';
    }

    public static function redirect_uri(string $baseUrl): string
    {
        return $baseUrl . '/api/auth/microsoft/callback';
    }

    /** @return array{0:string,1:string} authorize URL, browser-binding token for a cookie */
    public static function start(Conn $db, string $baseUrl): array
    {
        $state = Auth::token();
        $binding = Auth::token();
        $verifier = Auth::token(48);
        $nonce = Auth::token();
        $db->exec("DELETE FROM oauth_states WHERE created_at < datetime('now', '-15 minutes')");
        $db->exec('INSERT INTO oauth_states (state_hash, binding_hash, verifier, nonce) VALUES (?, ?, ?, ?)',
            [Auth::token_hash($state), Auth::token_hash($binding), $verifier, $nonce]);
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $q = http_build_query([
            'client_id' => Config::get('microsoft')['client_id'], 'response_type' => 'code', 'response_mode' => 'query',
            'redirect_uri' => self::redirect_uri($baseUrl), 'scope' => 'openid profile email', 'state' => $state, 'nonce' => $nonce,
            'code_challenge' => $challenge, 'code_challenge_method' => 'S256', 'prompt' => 'select_account',
        ]);
        return ['https://login.microsoftonline.com/' . rawurlencode(self::tenant()) . "/oauth2/v2.0/authorize?$q", $binding];
    }

    /** @return array{subject:string,email:string,name:string} */
    public static function finish(Conn $db, string $baseUrl, string $code, string $state, ?string $binding): array
    {
        $row = $db->one("SELECT * FROM oauth_states WHERE state_hash = ? AND created_at > datetime('now', '-10 minutes')", [Auth::token_hash($state)]);
        $db->exec('DELETE FROM oauth_states WHERE state_hash = ?', [Auth::token_hash($state)]);
        if (!$row || !$binding || !hash_equals($row['binding_hash'], Auth::token_hash($binding))) {
            throw new AuthError('Sign-in expired or was started in another browser. Please try again.');
        }
        $cfg = Config::get('microsoft');
        $ch = curl_init('https://login.microsoftonline.com/' . rawurlencode(self::tenant()) . '/oauth2/v2.0/token');
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_POSTFIELDS => http_build_query([
                'client_id' => $cfg['client_id'], 'client_secret' => $cfg['client_secret'], 'grant_type' => 'authorization_code',
                'code' => $code, 'redirect_uri' => self::redirect_uri($baseUrl), 'code_verifier' => $row['verifier'],
                'scope' => 'openid profile email',
            ]),
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $tok = is_string($body) ? json_decode($body, true) : null;
        if ($status !== 200 || empty($tok['id_token'])) {
            throw new AuthError("Microsoft didn't complete the sign-in. Please try again.");
        }
        $parts = explode('.', $tok['id_token']);
        $claims = count($parts) === 3 ? json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true) : null;
        return self::validate_claims(is_array($claims) ? $claims : null, $row['nonce']);
    }

    /**
     * Checks the ID token claims and returns the identity. Separate from finish() so it can be tested.
     * @return array{subject:string,email:string,name:string}
     */
    public static function validate_claims(?array $claims, string $nonce): array
    {
        if (!$claims) {
            throw new AuthError('Unreadable sign-in response.');
        }
        $cfg = Config::get('microsoft');
        $tid = (string)($claims['tid'] ?? '');
        $tenant = self::tenant();
        $tenantOk = match ($tenant) {
            'common' => $tid !== '',
            'consumers' => $tid === self::CONSUMER_TENANT,
            'organizations' => $tid !== '' && $tid !== self::CONSUMER_TENANT,
            default => strcasecmp($tid, $tenant) === 0,
        };
        if (!$tenantOk || ($claims['iss'] ?? '') !== "https://login.microsoftonline.com/$tid/v2.0"
            || ($claims['aud'] ?? '') !== $cfg['client_id'] || (int)($claims['exp'] ?? 0) < time() - 60
            || !hash_equals($nonce, (string)($claims['nonce'] ?? '')) || empty($claims['oid'])) {
            throw new AuthError("The sign-in response didn't check out. Please try again.");
        }
        // In multi-tenant mode anyone can create an Entra tenant and put any address in a user's email
        // field ("nOAuth"). Only trust email from personal Microsoft accounts (verified by Microsoft),
        // a single configured tenant, organisations listed in trusted_tenants, or a domain-verified claim.
        $trusted = $tid === self::CONSUMER_TENANT || !in_array($tenant, ['common', 'organizations', 'consumers'], true)
            || in_array(strtolower($tid), array_map('strtolower', $cfg['trusted_tenants'] ?? []), true)
            || !empty($claims['xms_edov']);
        if (!$trusted) {
            throw new AuthError("Work or school accounts from other organisations can't sign in here. Use a personal Microsoft account.");
        }
        $email = (string)($claims['email'] ?? '') ?: (string)($claims['preferred_username'] ?? '');
        if ($email === '' || !str_contains($email, '@')) {
            throw new AuthError("Your Microsoft account didn't share an email address.");
        }
        return ['subject' => "$tid:{$claims['oid']}", 'email' => $email, 'name' => (string)($claims['name'] ?? '')];
    }
}
