<?php
/**
 * PHP tests for what only the PHP version has (private mode, allowlist, Microsoft sign-in checks)
 * plus security basics. Business logic parity with the Python reference is covered by tests/parity.py.
 * Usage (from budget/): php tests/run.php
 */
declare(strict_types=1);

use Linen\{Auth, AuthError, Billing, Budget, Config, Db, Export, Microsoft, NeedsRecoveryCode, Passkeys, PasskeyError, Privacy, Session, Statements};

require __DIR__ . '/FakeAuthenticator.php';
require __DIR__ . '/FakePdf.php';

require __DIR__ . '/../src/bootstrap.php';

$failures = 0;
$count = 0;
function check(bool $ok, string $what): void
{
    global $failures, $count;
    $count++;
    if (!$ok) {
        $failures++;
        echo "FAIL: $what\n";
    }
}
function throws(callable $fn, string $cls, string $what, ?string $contains = null): void
{
    try {
        $fn();
        check(false, "$what (no exception)");
    } catch (\Throwable $e) {
        check($e instanceof $cls && ($contains === null || str_contains($e->getMessage(), $contains)), "$what (got " . $e::class . ': ' . $e->getMessage() . ')');
    }
}
function fresh(array $cfg = []): \Linen\Conn
{
    $db = sys_get_temp_dir() . '/linen-test-' . bin2hex(random_bytes(4)) . '.db';
    Config::set($cfg + ['db_path' => $db, 'private_mode' => true, 'allowed_emails' => ['veyz@example.test', 'tiara@example.test'],
        'setup_codes' => ['veyz@example.test' => 'VEYZ-CODE-1234', 'tiara@example.test' => 'TIARA-CODE-5678'],
        'microsoft' => ['client_id' => 'cid', 'client_secret' => 'x', 'tenant' => 'common'], 'env' => 'development']);
    return Db::connect();
}
const PW = 'correct horse battery';

// --- private mode: allowlist and one shared household ---------------------------------------
$db = fresh();
throws(fn() => Auth::signup($db, ['email' => 'stranger@example.test', 'name' => 'X', 'password' => PW, 'consents' => ['service' => true]]),
    AuthError::class, 'non-allowlisted signup is refused', 'private');
throws(fn() => Auth::signup($db, ['email' => 'veyz@example.test', 'name' => 'Veyz', 'password' => PW, 'consents' => []]),
    AuthError::class, 'signup needs the service consent');
throws(fn() => Auth::signup($db, ['email' => 'veyz@example.test', 'name' => 'Veyz', 'password' => PW, 'consents' => ['service' => true]]),
    AuthError::class, 'allow-listed signup without the setup code is refused', 'setup phrase');
throws(fn() => Auth::signup($db, ['email' => 'veyz@example.test', 'name' => 'Veyz', 'password' => PW, 'setup_code' => 'TIARA-CODE-5678', 'consents' => ['service' => true]]),
    AuthError::class, "someone else's setup code is refused", 'setup phrase');
$v = Auth::signup($db, ['email' => 'Veyz@Example.test', 'name' => 'Veyz', 'partner_name' => 'Tiara', 'password' => PW, 'setup_code' => 'veyz code 1234', 'consents' => ['service' => true]]);
check($v > 0, 'setup code accepted regardless of case, spaces and dashes');
$hid = (int)$db->val('SELECT household_id FROM memberships WHERE user_id = ?', [$v]);
check($db->val('SELECT role FROM memberships WHERE user_id = ?', [$v]) === 'owner', 'first allowlisted user owns the household');
$t = Auth::sso_login($db, 'microsoft', Microsoft::CONSUMER_TENANT . ':oid-tiara', 'tiara@example.test', 'Tiara Chetty');
check((int)$db->val('SELECT household_id FROM memberships WHERE user_id = ?', [$t]) === $hid, 'second allowlisted user joins the same household');
check($db->val('SELECT role FROM memberships WHERE user_id = ?', [$t]) === 'partner', '...as partner');
check((int)$db->val("SELECT user_id FROM members WHERE household_id = ? AND name = 'Tiara'", [$hid]) === $t, '...linked to her person in the budget');
check((int)$db->val('SELECT COUNT(*) FROM members WHERE household_id = ?', [$hid]) === 2, 'no duplicate person created');
throws(fn() => Auth::sso_login($db, 'microsoft', 'x:oid-evil', 'evil@example.test', 'Evil'), AuthError::class, 'SSO for non-allowlisted email is refused');

// SSO binding: same email from a different Microsoft account is refused once bound
throws(fn() => Auth::sso_login($db, 'microsoft', Microsoft::CONSUMER_TENANT . ':other-oid', 'tiara@example.test', 'T'),
    AuthError::class, 'a different Microsoft account cannot take over a bound email', 'different Microsoft account');
check(Auth::sso_login($db, 'microsoft', Microsoft::CONSUMER_TENANT . ':oid-tiara', 'tiara@example.test', 'T') === $t, 'returning SSO user signs in');
$vsso = Auth::sso_login($db, 'microsoft', Microsoft::CONSUMER_TENANT . ':oid-veyz', 'veyz@example.test', 'Veyz');
check($vsso === $v, 'existing password account gets linked on first SSO sign-in');

// Removing someone from the allowlist cuts off existing sessions
$tok = Auth::start_session($db, $t);
check(Auth::get_session($db, $tok)?->role === 'partner', 'session works while allowlisted');
Config::set(['db_path' => Config::get('db_path'), 'private_mode' => true, 'allowed_emails' => ['veyz@example.test'],
    'microsoft' => ['client_id' => 'cid', 'client_secret' => 'x', 'tenant' => 'common']]);
check(Auth::get_session($db, $tok) === null, 'session stops working once removed from the allowlist');

// --- sessions, passwords, lockout ----------------------------------------------------------
$tok = Auth::start_session($db, $v);
check($db->val('SELECT COUNT(*) FROM sessions WHERE token_hash = ?', [$tok]) === 0, 'raw session token is never stored');
check(!str_contains((string)$db->val('SELECT password_hash FROM users WHERE id = ?', [$v]), PW), 'password is hashed');
check(Auth::login($db, 'VEYZ@example.test', PW) === $v, 'login is case-insensitive on email');
// "Where you're signed in": each person sees and ends only their own sessions
$uas = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' => 'iPhone · Safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' => 'iPhone · Home Screen app',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' => 'Mac · Chrome',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' => 'Windows PC · Edge',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' => 'Android phone · Chrome',
    '' => 'Unknown device',
];
foreach ($uas as $ua => $want) {
    check(Auth::device_label($ua) === $want, 'device label: ' . $want, Auth::device_label($ua));
}
$mine = Auth::get_session($db, $tok);
$phone = Auth::start_session($db, $v, null, array_key_first($uas));
$herTok = Auth::start_session($db, $t);  // she's off the allowlist by now, so build her session by hand
$hers = new Session($t, $hid, 'partner', 'csrf', 'Tiara', 'tiara@example.test', false, Auth::token_hash($herTok));
$list = Auth::list_sessions($db, $mine);
check(count($list) === 2 && $list[0]['current'] && !$list[1]['current'] && $list[1]['device'] === 'iPhone · Safari',
    'sessions list shows this device first, then the others by name');
check(!str_contains(json_encode($list), Auth::token_hash($phone)) && !str_contains(json_encode($list), $phone), 'sessions list never exposes tokens');
check(!Auth::end_session_by_id($db, $hers, $list[1]['id']) && Auth::get_session($db, $phone) !== null, "one person can't end another's session");
check(!Auth::end_session_by_id($db, $mine, $list[0]['id']), 'the current session is not ended from the list');
check(Auth::end_session_by_id($db, $mine, $list[1]['id']) && Auth::get_session($db, $phone) === null, 'a session can be signed out from another device');
Auth::start_session($db, $v);
Auth::start_session($db, $v);
check(Auth::end_other_sessions($db, $mine) === 2 && count(Auth::list_sessions($db, $mine)) === 1 && Auth::get_session($db, $tok) !== null
    && (int)$db->val('SELECT COUNT(*) FROM sessions WHERE token_hash = ?', [$hers->tokenHash]) === 1, 'signing out other devices keeps this one, and leaves other people alone');
for ($i = 0; $i < Auth::MAX_FAILED; $i++) {
    try {
        Auth::login($db, 'veyz@example.test', 'wrong password!!');
    } catch (AuthError) {
    }
}
throws(fn() => Auth::login($db, 'veyz@example.test', PW), AuthError::class, 'account locks after repeated failures', 'Too many');

// --- Microsoft token claims ----------------------------------------------------------------
$good = ['tid' => Microsoft::CONSUMER_TENANT, 'iss' => 'https://login.microsoftonline.com/' . Microsoft::CONSUMER_TENANT . '/v2.0',
    'aud' => 'cid', 'exp' => time() + 600, 'nonce' => 'n1', 'oid' => 'o1', 'email' => 'veyz@example.test', 'name' => 'Veyz'];
$id = Microsoft::validate_claims($good, 'n1');
check($id['subject'] === Microsoft::CONSUMER_TENANT . ':o1' && $id['email'] === 'veyz@example.test', 'valid personal-account token accepted');
foreach (['aud' => 'other', 'nonce' => 'n2', 'exp' => time() - 3600, 'iss' => 'https://evil.example/v2.0', 'oid' => ''] as $k => $bad) {
    throws(fn() => Microsoft::validate_claims([$k => $bad] + $good, 'n1'), AuthError::class, "token with bad $k rejected");
}
$orgTid = '11111111-2222-3333-4444-555555555555';
$org = ['tid' => $orgTid, 'iss' => "https://login.microsoftonline.com/$orgTid/v2.0"] + $good;
throws(fn() => Microsoft::validate_claims($org, 'n1'), AuthError::class, 'untrusted work tenant rejected (nOAuth)', 'Work or school');
check(Microsoft::validate_claims(['xms_edov' => true] + $org, 'n1')['email'] === 'veyz@example.test', 'domain-verified work email accepted');
Config::set(['db_path' => Config::get('db_path'), 'microsoft' => ['client_id' => 'cid', 'client_secret' => 'x', 'tenant' => 'consumers']]);
throws(fn() => Microsoft::validate_claims($org, 'n1'), AuthError::class, 'consumers tenant rejects work accounts');

// --- tenant isolation & billing in SaaS mode -----------------------------------------------
$db = fresh(['private_mode' => false]);
$a = Auth::signup($db, ['email' => 'a@example.test', 'name' => 'A', 'password' => PW, 'consents' => ['service' => true]]);
$b = Auth::signup($db, ['email' => 'b@example.test', 'name' => 'B', 'password' => PW, 'consents' => ['service' => true]]);
$ha = (int)$db->val('SELECT household_id FROM memberships WHERE user_id = ?', [$a]);
$hb = (int)$db->val('SELECT household_id FROM memberships WHERE user_id = ?', [$b]);
check($ha !== $hb, 'SaaS mode: each signup gets its own household');
$ma = Budget::members($db, $ha)[0]['id'];
$line = Budget::create_line($db, $ha, ['member_id' => $ma, 'kind' => 'expense', 'name' => 'Rent', 'amount_cents' => 100, 'start_month' => '2026-01']);
throws(fn() => Budget::set_amount($db, $hb, $line, '2026-02', 1), \Linen\NotFound::class, "another household can't change a line");
throws(fn() => Budget::create_line($db, $hb, ['member_id' => $ma, 'kind' => 'expense', 'name' => 'x', 'amount_cents' => 1, 'start_month' => '2026-01']),
    \InvalidArgumentException::class, "another household can't use someone else's person");
$db->exec("UPDATE households SET trial_ends_on = '2020-01-01' WHERE id = ?", [$ha]);
check(!Billing::status($db, $ha)['can_write'], 'expired trial is read-only in SaaS mode');

// --- statements, export, POPIA delete --------------------------------------------------------
$r = Statements::import($db, $ha, file_get_contents(__DIR__ . '/fnb_sample.csv'), $ma, 'auto', 'FNB');
check($r['rows_added'] === 88 && $r['rows_duplicate'] === 0, 'FNB sample imports 88 rows');
$again = Statements::import($db, $ha, file_get_contents(__DIR__ . '/fnb_sample.csv'), $ma, 'auto', 'FNB');
check($again['rows_added'] === 0, 're-import adds nothing');
check(!$db->val("SELECT 1 FROM transactions WHERE description LIKE '%4512%'"), 'card numbers are masked');
Budget::create_line($db, $ha, ['member_id' => $ma, 'kind' => 'expense', 'name' => '=HYPERLINK("x")', 'amount_cents' => 1, 'start_month' => '2026-01']);
check(!preg_match('/\n[^\n]*,=HYPERLINK/', Export::csv($db, $ha, 'fact_budget')), 'CSV export neutralises formulas');
$tokPbi = Auth::create_api_token($db, $ha, $a, 'PBI');
check(Auth::check_api_token($db, $tokPbi) === $ha, 'API token resolves to its household');
$exp = Privacy::export($db, $ha, $a);
check(!str_contains(json_encode($exp), 'password_hash'), 'data export excludes password hashes');
Privacy::delete_household($db, $ha);
foreach (['transactions', 'budget_lines', 'accounts', 'api_tokens'] as $tbl) {
    check((int)$db->val("SELECT COUNT(*) FROM $tbl WHERE household_id = ?", [$ha]) === 0, "delete removes $tbl");
}
check(!$db->val('SELECT 1 FROM users WHERE id = ?', [$a]), 'delete removes the login');
check((bool)$db->val('SELECT 1 FROM users WHERE id = ?', [$b]), "other households are untouched");

// --- setup phrases ------------------------------------------------------------------------------
Config::set(['private_mode' => true, 'setup_codes' => ['A@B.test' => 'OurKAVE', 'c@d.test' => 'Kave1']]);
check(Auth::setup_code_ok('a@b.test', 'our kave') && !Auth::setup_code_ok('a@b.test', 'OurKAVE!x'), 'a short passphrase like OurKAVE works, and only exactly');
check(!Auth::setup_code_ok('c@d.test', 'Kave1') && !Auth::setup_code_ok('c@d.test', ''), 'a phrase under 6 letters or numbers never matches');

// --- passkeys (Face ID / Touch ID) -------------------------------------------------------------
$db = fresh();
$base = 'https://whoisveyansiz.com/private';
$u = Auth::signup($db, ['email' => 'veyz@example.test', 'name' => 'Veyz', 'password' => PW, 'setup_code' => 'VEYZ-CODE-1234', 'consents' => ['service' => true]]);
check(Auth::lookup($db, ' VEYZ@example.test ') === ['next' => 'password', 'name' => 'Veyz'], 'email check: account without Face ID asks for the password');
check(Auth::lookup($db, 'tiara@example.test') === ['next' => 'new'], 'email check: invited email without an account goes to setup');
check(Auth::lookup($db, 'someone@else.test') === ['next' => 'not_invited'], 'email check: uninvited email learns nothing else');
throws(fn() => Auth::lookup($db, 'not-an-email'), AuthError::class, 'email check rejects a malformed email', 'valid email');
$phone = new FakeAuthenticator('whoisveyansiz.com', 'https://whoisveyansiz.com');
$opts = Passkeys::register_options($db, $u, $base);
check($opts['rp']['id'] === 'whoisveyansiz.com' && $opts['authenticatorSelection']['userVerification'] === 'required', 'registration asks for Face ID on this domain');
check($opts['authenticatorSelection']['authenticatorAttachment'] === 'platform' && $opts['hints'] === ['client-device'], 'registration saves the passkey on this device, not a phone via QR code');
check(Passkeys::login_options($db, $base)['hints'] === ['client-device'], 'sign-in prefers this device over a QR code');
check(strlen(Passkeys::unb64u($opts['user']['id'])) === 16 && $opts['user']['id'] === Passkeys::register_options($db, $u, $base)['user']['id'], 'user handle is a stable random 16-byte value, not the database id');
$pkId = Passkeys::register_verify($db, $u, $phone->create($opts), $base, 'iPhone');
check(Passkeys::count($db, $u) === 1 && $pkId > 0, 'passkey registered');
check(Auth::lookup($db, 'veyz@example.test')['next'] === 'passkey', 'email check: account with Face ID offers Face ID');
throws(fn() => Passkeys::register_verify($db, $u, $phone->create($opts), $base, 'again'), PasskeyError::class, 'registration challenge is single-use');

// sign in
check(Passkeys::login_verify($db, $phone->get(Passkeys::login_options($db, $base)), $base) === $u, 'Face ID sign-in returns the right user');
$lo = Passkeys::login_options($db, $base);
$assertion = $phone->get($lo);
Passkeys::login_verify($db, $assertion, $base);
throws(fn() => Passkeys::login_verify($db, $assertion, $base), PasskeyError::class, 'a signed response cannot be replayed');
throws(fn() => Passkeys::login_verify($db, $phone->get(Passkeys::login_options($db, $base), 0x05, 'https://evil.example'), $base),
    PasskeyError::class, 'response from another website (phishing) is refused', 'different website');
throws(fn() => Passkeys::login_verify($db, $phone->get(Passkeys::login_options($db, $base), 0x05, null, 'evil.example'), $base),
    PasskeyError::class, 'passkey for another domain is refused', 'different website');
throws(fn() => Passkeys::login_verify($db, $phone->get(Passkeys::login_options($db, $base), 0x01), $base),
    PasskeyError::class, 'without Face ID (user verification) is refused', 'Face ID');
$other = new FakeAuthenticator('whoisveyansiz.com', 'https://whoisveyansiz.com');
$other->credId = $phone->credId;  // same credential id, different key = forged signature
$other->userHandle = $phone->userHandle;
throws(fn() => Passkeys::login_verify($db, $other->get(Passkeys::login_options($db, $base)), $base), PasskeyError::class, 'forged signature is refused', 'signature');
$stranger = new FakeAuthenticator('whoisveyansiz.com', 'https://whoisveyansiz.com');
throws(fn() => Passkeys::login_verify($db, $stranger->get(Passkeys::login_options($db, $base)), $base), PasskeyError::class, 'unknown passkey is refused', 'registered');
$fake = Passkeys::login_options($db, $base);
$fake['challenge'] = FakeAuthenticator::b64u(random_bytes(32));
throws(fn() => Passkeys::login_verify($db, $phone->get($fake), $base), PasskeyError::class, 'made-up challenge is refused', 'expired');

// hardware keys: the counter must go up
$key = new FakeAuthenticator('whoisveyansiz.com', 'https://whoisveyansiz.com', false);
Passkeys::register_verify($db, $u, $key->create(Passkeys::register_options($db, $u, $base)), $base, 'YubiKey');
check(Passkeys::login_verify($db, $key->get(Passkeys::login_options($db, $base)), $base) === $u, 'hardware key with counter signs in');
$key->counter = 0; // cloned key reporting an old counter (get() bumps it to 1, below the stored 2)
throws(fn() => Passkeys::login_verify($db, $key->get(Passkeys::login_options($db, $base)), $base), PasskeyError::class, 'counter going backwards is refused', 'copied');

// RS256 keys (some Windows Hello devices) convert to a valid public key
$rsa = openssl_pkey_get_details(openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]))['rsa'];
[$pem, $alg] = Passkeys::cose_to_pem([1 => 3, 3 => -257, -1 => $rsa['n'], -2 => $rsa['e']]);
check($alg === -257 && openssl_pkey_get_public($pem) !== false, 'RS256 passkeys are supported');

// password + recovery code once a passkey exists
throws(fn() => Auth::login($db, 'veyz@example.test', PW), NeedsRecoveryCode::class, 'password alone is not enough once Face ID is set up');
$codes = Passkeys::new_recovery_codes($db, $u);
check(count($codes) === 10 && !$db->val('SELECT 1 FROM recovery_codes WHERE code_hash = ?', [$codes[0]]), '10 recovery codes, stored hashed');
check(Auth::login($db, 'veyz@example.test', PW, strtolower($codes[0])) === $u, 'password + recovery code signs in');
throws(fn() => Auth::login($db, 'veyz@example.test', PW, $codes[0]), AuthError::class, 'each recovery code works once', 'once');
check(Passkeys::recovery_left($db, $u) === 9, 'recovery codes left are counted');

// --- Tier 1 regressions ------------------------------------------------------------------------
// Dates: two-digit years are 20xx; implausible years are refused instead of stored (and later purged).
check(\Linen\Money::parse_date('01 Oct 26') === '2026-10-01' && \Linen\Money::parse_date('15/10/26') === '2026-10-15', 'two-digit years read as 20xx');
throws(fn() => \Linen\Money::parse_date('01 Oct 1926'), \Linen\ParseError::class, 'years before 2000 are refused');
throws(fn() => \Linen\Money::parse_date('31/02/2026'), \Linen\ParseError::class, 'impossible dates are refused');
$db = fresh(['private_mode' => false]);
$hid = $db->tx(fn($db) => Auth::create_household($db, 'T', ['A']));
$imp = Statements::import($db, $hid, "Date,Amount,Balance,Description\n01 Oct 26,-100.00,1,A\n15/10/26,-50.00,1,B\n");
check($db->val('SELECT MIN(posted_on) FROM transactions') === '2026-10-01' && $db->val('SELECT MAX(posted_on) FROM transactions') === '2026-10-15', 'statement with 2-digit years stores 2026 dates');
Privacy::purge($db);
check((int)$db->val('SELECT COUNT(*) FROM transactions') === 2, '...and retention keeps them');

// Goal cuts: never on debt, insurance, medical, giving, housing, unknown items or non-cancellable debit orders.
$a = Budget::members($db, $hid)[0]['id'];
$mk = fn($name, $amt, $kw = []) => Budget::create_line($db, $hid, ['member_id' => $a, 'kind' => 'expense', 'name' => $name, 'amount_cents' => $amt * 100, 'start_month' => '2026-01'] + $kw);
Budget::create_line($db, $hid, ['member_id' => $a, 'kind' => 'income', 'name' => 'Salary', 'amount_cents' => 1000000, 'start_month' => '2026-01']);
$mk('Car', 5800); $mk('CC FNB', 3000); $mk('Meds', 2000); $mk('Tithes', 500); $mk('Rent', 9000); $mk('Mystery item', 1500);
$mk('Life cover', 900, ['is_debit_order' => true]); $mk('Netflix', 200, ['is_debit_order' => true]); $mk('Takeout', 2500); $mk('Groceries', 6000);
check(Budget::create_line($db, $hid, ['member_id' => $a, 'kind' => 'expense', 'name' => 'Mystery 2', 'amount_cents' => 100, 'start_month' => '2026-01']) > 0
    && $db->val("SELECT flexibility FROM budget_lines WHERE name = 'Mystery 2'") === 'fixed', 'unrecognised items default to fixed');
\Linen\Goals::save($db, $hid, ['name' => 'G', 'target_cents' => 99999900, 'target_month' => '2027-01']);
$cutNames = array_column(\Linen\Goals::plan_all($db, $hid, '2026-11')[0]['cuts'], 'name');
check(!array_intersect($cutNames, ['Car', 'CC FNB', 'Meds', 'Tithes', 'Rent', 'Mystery item', 'Life cover']), 'no cuts suggested on debts, health, giving, housing, unknown or contract items (' . implode(', ', $cutNames) . ')');
check(in_array('Takeout', $cutNames, true) && in_array('Netflix', $cutNames, true) && in_array('Groceries', $cutNames, true), 'cuts still suggested on takeout, subscriptions and groceries');

// --- Tier 2: amount changes ("that month only" vs "from then on") --------------------------------
$db = fresh(['private_mode' => false]);
$hid = $db->tx(fn($db) => Auth::create_household($db, 'T', ['A']));
$a = Budget::members($db, $hid)[0]['id'];
$series = fn($id) => implode(',', array_map(fn($m) => Budget::amount_on($db, $id, $m) / 100, ['2026-05', '2026-06', '2026-07', '2026-08']));
$l1 = Budget::create_line($db, $hid, ['member_id' => $a, 'kind' => 'expense', 'name' => 'L1', 'amount_cents' => 10000, 'start_month' => '2026-05']);
Budget::set_amount($db, $hid, $l1, '2026-06', 5000, 'once'); Budget::set_amount($db, $hid, $l1, '2026-06', 6000, 'onward');
check($series($l1) === '100,60,60,60', 'onward over a once at the same month sticks (' . $series($l1) . ')');
$l2 = Budget::create_line($db, $hid, ['member_id' => $a, 'kind' => 'expense', 'name' => 'L2', 'amount_cents' => 10000, 'start_month' => '2026-05']);
Budget::set_amount($db, $hid, $l2, '2026-06', 5000, 'once'); Budget::set_amount($db, $hid, $l2, '2026-05', 8000, 'onward');
check($series($l2) === '80,50,80,80', 'onward before a once: the once month stays, later months follow the new amount (' . $series($l2) . ')');
$l3 = Budget::create_line($db, $hid, ['member_id' => $a, 'kind' => 'expense', 'name' => 'L3', 'amount_cents' => 10000, 'start_month' => '2026-07']);
throws(fn() => Budget::set_amount($db, $hid, $l3, '2026-05', 5000, 'once'), \InvalidArgumentException::class, 'once before the start is refused', 'starts in');
Budget::set_amount($db, $hid, $l3, '2026-05', 5000, 'onward');
check($series($l3) === '50,50,50,50', 'onward before the start applies from then on (' . $series($l3) . ')');

// --- Tier 2: goals ------------------------------------------------------------------------------
$db = fresh(['private_mode' => false]);
$hid = $db->tx(fn($db) => Auth::create_household($db, 'T', ['V', 'T']));
[$mv, $mt] = array_column(Budget::members($db, $hid), 'id');
$inc = fn($m, $amt) => Budget::create_line($db, $hid, ['member_id' => $m, 'kind' => 'income', 'name' => 'Salary', 'amount_cents' => $amt, 'start_month' => '2026-01']);
$inc($mv, 1000000); $inc($mt, 500000);
Budget::create_line($db, $hid, ['member_id' => $mv, 'kind' => 'expense', 'name' => 'Rent', 'amount_cents' => 900000, 'start_month' => '2026-01']);
Budget::create_line($db, $hid, ['member_id' => $mt, 'kind' => 'expense', 'name' => 'Takeout', 'amount_cents' => 200000, 'start_month' => '2026-01']);
// spare: V R1 000, T R3 000, household R4 000
$gs = \Linen\Goals::save($db, $hid, ['name' => 'Shared', 'target_cents' => 10000000]);
$gt = \Linen\Goals::save($db, $hid, ['name' => 'T laptop', 'target_cents' => 2000000, 'member_id' => $mt]);
$byName = []; foreach (\Linen\Goals::plan_all($db, $hid, '2026-11') as $pl) { $byName[$pl['goal']['name']] = $pl; }
check($byName['T laptop']['contribution_cents'] === 300000 && $byName['Shared']['contribution_cents'] === 100000,
    'personal goal takes its owner\'s spare money first; shared gets only the rest (no double counting)');
$cutIds = array_merge(...array_map(fn($pl) => array_column($pl['cuts'], 'line_id'), array_values($byName)));
check(count($cutIds) === count(array_unique($cutIds)), 'each cut suggestion is offered to one goal only');
$past = \Linen\Goals::save($db, $hid, ['name' => 'Old', 'target_cents' => 500000, 'target_month' => '2026-06']);
$byName = []; foreach (\Linen\Goals::plan_all($db, $hid, '2026-11') as $pl) { $byName[$pl['goal']['name']] = $pl; }
check($byName['Old']['past_target'] && $byName['Old']['contribution_cents'] === 0 && $byName['Shared']['contribution_cents'] === 100000,
    'a goal past its date is flagged and does not drain the other goals');
$save = Budget::create_line($db, $hid, ['member_id' => $mv, 'kind' => 'saving', 'name' => 'Emergency', 'amount_cents' => 50000, 'start_month' => '2026-01']);
Budget::update_line($db, $hid, $save, ['goal_id' => $gs]);
$byName = []; foreach (\Linen\Goals::plan_all($db, $hid, '2026-11') as $pl) { $byName[$pl['goal']['name']] = $pl; }
check($byName['Shared']['linked_savings_cents'] === 50000 && $byName['Shared']['contribution_cents'] === 50000 + 50000,
    'a saving line linked to a goal counts towards it');
\Linen\Goals::save($db, $hid, ['saved_cents' => 123400], $gt);
$g = $db->one('SELECT * FROM goals WHERE id = ?', [$gt]);
check($g['name'] === 'T laptop' && (int)$g['member_id'] === $mt && (int)$g['saved_cents'] === 123400, 'editing one goal field keeps the others');

// --- Tier 2: debt planner ------------------------------------------------------------------------
$p = \Linen\Debt::compare([['id' => 1, 'name' => 'Card', 'balance_cents' => 5000000, 'apr_bp' => 2100, 'min_payment_cents' => 80000]], 100000);
check($p['baseline']['never_pays_off'] && $p['avalanche']['interest_saved_cents'] === null, 'no "interest saved" against a baseline that never pays off');
check(count($p['warnings']) === 1 && $p['warnings'][0]['interest_cents'] === 87500, 'warns that the R800 minimum is below R875 monthly interest');
$p = \Linen\Debt::compare([
    ['id' => 1, 'name' => 'Card', 'balance_cents' => 2000000, 'apr_bp' => 2100, 'min_payment_cents' => 60000],
    ['id' => 2, 'name' => 'PayJustNow', 'balance_cents' => 90000, 'apr_bp' => 0, 'min_payment_cents' => 30000],
    ['id' => 3, 'name' => 'Car', 'balance_cents' => 15000000, 'apr_bp' => 1325, 'min_payment_cents' => 400000]], 100000);
check($p['avalanche']['target'] === 'Card' && $p['avalanche']['payoff_order'][0]['name'] === 'PayJustNow',
    'advice target is where the extra goes (Card), not the first debt to reach zero (PayJustNow)');

// --- Tier 2: hostile input ------------------------------------------------------------------------
foreach (["\x78", "\x9a\xff\xff\xff\xff", str_repeat("\x81", 5000) . "\x00", "\xbf", "\xa1\x81\x00\x00"] as $i => $bad) {
    throws(fn() => Passkeys::cbor($bad), PasskeyError::class, "malformed CBOR #$i is rejected cleanly");
}
throws(fn() => \Linen\Money::cents(9000000000000000000), \InvalidArgumentException::class, 'huge amounts refused');
throws(fn() => \Linen\Money::cents(1e30), \InvalidArgumentException::class, 'float amounts refused');
throws(fn() => \Linen\Money::parse_amount('-99999999999999999999.00'), \Linen\ParseError::class, 'absurd statement amounts refused');
check(\Linen\Money::cents('150000') === 150000, 'normal amounts still accepted');

// --- Tier 2: statement accounts stay with their person --------------------------------------------
$db = fresh(['private_mode' => false]);
$hid = $db->tx(fn($db) => Auth::create_household($db, 'T', ['V', 'T']));
[$mv, $mt] = array_column(Budget::members($db, $hid), 'id');
$csv = "Date,Amount,Balance,Description\n2026/10/01,-100.00,1,A\n";
Statements::import($db, $hid, $csv, $mv);
Statements::import($db, $hid, "Date,Amount,Balance,Description\n2026/10/02,-50.00,1,B\n", $mt);
check((int)$db->val('SELECT COUNT(*) FROM accounts WHERE household_id = ?', [$hid]) === 2, 'unlabelled statements from two people stay in separate accounts');
throws(fn() => Statements::import($db, $hid, $csv, $mt, 'auto', 'FNB account (V)'), \InvalidArgumentException::class, "can't move one person's account to another", 'already');

// --- FNB PDF statements -----------------------------------------------------------------------------
// Dec to Jan (the year comes from the period), an overdrawn balance with no "Cr", a fee with no description,
// a description that wraps onto a second line, and FNB's RC4 "restrictions only" protection.
$rows = [['29 Dec', 'POS Purchase Woolworths 400000*9999 28 Dec', -45099], ['31 Dec', 'FNB App Payment To Rent', -900000],
    ['31 Dec', '', -1100], ['02 Jan', 'Payshap Credit Salary', 2500000, 'Acme (Pty) Ltd Jan'], ['03 Jan', 'Magtape Debit Gym', -29900]];
$pdf = FakePdf::build(FakePdf::fnbStatement('28 December 2026 to 27 January 2027', 600000, $rows), '');
$st = Statements::parse($pdf);
check(count($st['transactions']) === 5 && $st['account_last4'] === '1234', 'FNB PDF: every row and the account number are read');
check(array_column($st['transactions'], 'posted_on') === ['2026-12-29', '2026-12-31', '2026-12-31', '2027-01-02', '2027-01-03'], 'FNB PDF: dates get the right year across New Year');
check(array_column($st['transactions'], 'amount_cents') === [-45099, -900000, -1100, 2500000, -29900], 'FNB PDF: money in and out, overdraft included');
check($st['transactions'][1]['balance_cents'] === -345099 && $st['transactions'][3]['balance_cents'] === 2153801, 'FNB PDF: an unmarked balance is overdrawn');
check($st['transactions'][2]['description'] === 'FNB transaction fee' && $st['transactions'][3]['description'] === 'Payshap Credit Salary Acme (Pty) Ltd Jan',
    'FNB PDF: blank fee rows are named, wrapped descriptions are joined');
throws(fn() => Statements::parse(FakePdf::build(FakePdf::fnbStatement('28 December 2026 to 27 January 2027', 600000, $rows, 1), '')),
    \Linen\StatementFormatError::class, 'FNB PDF: a balance that does not add up stops the import', 'running balance');
throws(fn() => Statements::parse(FakePdf::build(FakePdf::fnbStatement('28 December 2026 to 27 January 2027', 600000, $rows), 'secret')),
    \Linen\StatementFormatError::class, 'FNB PDF: a password-protected PDF gets a clear message', 'needs a password');
throws(fn() => Statements::parse(FakePdf::build([[[50, 700, 'Capitec Bank statement']]])), \Linen\StatementFormatError::class, 'a non-FNB PDF is refused', 'FNB');
throws(fn() => Statements::parse(FakePdf::build(FakePdf::fnbStatement('1 May 2026 to 31 May 2026', 0, [['02 May', 'X', -100]])), 'capitec'),
    \Linen\StatementFormatError::class, 'choosing Capitec for a PDF says to use CSV', 'CSV');
check(count(Statements::parse(FakePdf::build(FakePdf::fnbStatement('1 May 2026 to 31 May 2026', 0, [['02 May', 'Unencrypted', 5000]])))['transactions']) === 1,
    'FNB PDF without protection reads too');
$db = fresh(['private_mode' => false]);
$hid = $db->tx(fn($db) => Auth::create_household($db, 'T', ['V']));
$r = Statements::import($db, $hid, $pdf, null, 'auto', null, 'transactional', 'jan.pdf');
check($r['rows_added'] === 5 && Statements::import($db, $hid, $pdf)['rows_added'] === 0, 'FNB PDF imports once; importing it again adds nothing');
check(!$db->val("SELECT 1 FROM transactions WHERE description LIKE '%400000%'"), 'FNB PDF: card numbers are masked');

// Central upload: a later statement from a known account goes to the same account and person.
[$mv] = array_column(Budget::members($db, $hid), 'id');
$feb = Statements::parse(FakePdf::build(FakePdf::fnbStatement('28 January 2027 to 27 February 2027', 2097900, [['02 Feb', 'Payshap Credit Salary', 2500000]]), ''));
check(Statements::known_account($db, $hid, $feb) === null || Statements::known_account($db, $hid, $feb)['member_id'] === null, 'the first (joint) import is remembered by account number');
$db->exec('UPDATE accounts SET member_id = ? WHERE household_id = ?', [$mv, $hid]);
$known = Statements::known_account($db, $hid, $feb);
check($known !== null && $known['member_id'] === $mv, "a later statement is matched to the account's person by bank and account number");
$r = Statements::import_parsed($db, $hid, $feb, $known['member_id'], $known['label']);
check($r['rows_added'] === 1 && $r['member'] === 'V' && (int)$db->val('SELECT COUNT(*) FROM accounts WHERE household_id = ?', [$hid]) === 1, '...and lands in that same account');
check(Statements::known_account($db, $hid, ['bank' => 'fnb', 'account_last4' => '9999']) === null, 'an unknown account number is new');
throws(fn() => Statements::parse("PK\x03\x04rest-of-a-zip"), \Linen\StatementFormatError::class, 'an Excel file gets pointed to Import Excel', 'Import Excel');
throws(fn() => Statements::parse("\xFF\xD8\xFF\xE0jpeg"), \Linen\StatementFormatError::class, 'a photo is refused with a clear message', 'photo');

// --- Statements everywhere: coverage, fee averages and a budget drafted from statements ----------------------
// Three FNB statements, 29 Dec to 31 Mar: December is a part-month (29-31), January to March are covered in full.
$db = fresh(['private_mode' => false]);
$hid = $db->tx(fn($db) => Auth::create_household($db, 'T', ['V', 'T']));
[$mv, $mt] = array_column(Budget::members($db, $hid), 'id');
$stmt = fn(string $period, int $open, array $rows) => FakePdf::build(FakePdf::fnbStatement($period, $open, $rows), '');
$bal = 100000;
$jan = [['29 Dec', '', -47500], ['30 Dec', 'POS Purchase Woolworths ****1234 29 Dec', -80000],
    ['02 Jan', 'Payshap Credit Acme Payroll', 3000000], ['05 Jan', 'POS Purchase Netflix.Com ****1234 04 Jan', -19900],
    ['10 Jan', 'POS Purchase Woolworths ****1234 09 Jan', -200000], ['15 Jan', 'Payshap Credit Gift From Gran', 50000],
    ['20 Jan', 'Internal Debit Order Fnblife Ab12Cd34 100001', -45000], ['31 Jan', '', -47500]];
$feb = [['02 Feb', 'Payshap Credit Acme Payroll', 3000000], ['05 Feb', 'POS Purchase Netflix.Com ****1234 04 Feb', -19900],
    ['10 Feb', 'POS Purchase Woolworths ****1234 09 Feb', -250000], ['12 Feb', 'Payment To Investment Holiday', -100000],
    ['20 Feb', 'Internal Debit Order Fnblife Ab12Cd34 100002', -45000], ['28 Feb', '', -47500]];
$mar = [['02 Mar', 'Payshap Credit Acme Payroll', 3100000], ['05 Mar', 'POS Purchase Netflix.Com ****1234 04 Mar', -19900],
    ['10 Mar', 'POS Purchase Woolworths ****1234 09 Mar', -300000], ['12 Mar', 'Payment To Investment Holiday', -100000],
    ['20 Mar', 'Internal Debit Order Fnblife Ab12Cd34 100003', -45000], ['31 Mar', '', -47500]];
foreach ([['29 December 2026 to 31 January 2027', $jan], ['1 February 2027 to 28 February 2027', $feb], ['1 March 2027 to 31 March 2027', $mar]] as [$period, $rows]) {
    Statements::import($db, $hid, $stmt($period, $bal, $rows), $mv);
    $bal += array_sum(array_column($rows, 2));
}
$s = new \Linen\Scope($hid);
check(\Linen\Analysis::complete_months($db, $s) === ['2027-03', '2027-02', '2027-01'], 'a month counts as complete only when statements cover it in full');
check(\Linen\Analysis::summary($db, $s, '2026-12')['partial'] === true && \Linen\Analysis::summary($db, $s, '2027-02')['partial'] === false, 'summary says when a month is only partly covered');
$fees = \Linen\Analysis::fees_and_interest($db, $s, '2027-01');
check($fees['fees_monthly_avg_cents'] === 47500 && $fees['averaged_months'] === ['2027-01'], 'fee average ignores the part-month (29-31 Dec)');
check(\Linen\Analysis::fees_and_interest($db, $s, '2027-03')['fees_monthly_avg_cents'] === 47500, 'fees: R475 a month over three full months');
check(Statements::merchant_key('POS Purchase Netflix.Com ****1234 04 Jan') === Statements::merchant_key('POS Purchase Netflix.Com ****1234 04 Feb'),
    'the date FNB adds to card purchases is not part of the payee');
check(count(array_filter(\Linen\Analysis::recurring($db, $s, '2027-03'), fn($r) => $r['merchant'] === 'NETFLIX COM')) === 1, 'Netflix is found as a regular payment');
check($db->val("SELECT category FROM transactions WHERE description LIKE 'Payment To Investment%' LIMIT 1") === 'Transfers'
    && $db->val("SELECT category FROM transactions WHERE description LIKE '%Fnblife%' LIMIT 1") === 'Insurance', 'FNB investment transfers and FNB Life policies are categorised');
check($db->val("SELECT description FROM transactions WHERE posted_on = '2027-01-31' AND amount_cents = -47500") === 'FNB monthly account fee'
    && \Linen\Analysis::fee_kind('FNB monthly account fee') === 'Monthly account fee', "the fee on a statement's last day is the monthly account fee");
$feb2 = \Linen\Analysis::summary($db, new \Linen\Scope($hid, $mv), '2027-02');
check($feb2['moved_cents'] === 100000 && $feb2['net_cents'] === 3000000 - 19900 - 250000 - 45000 - 47500 - 100000,
    'came in − spent − moved to own accounts = the change in the balance');

$d = Budget::draft_from_statements($db, $hid);
check($d['months'] === ['2027-01', '2027-02', '2027-03'] && $d['members'] === ['V'], 'draft uses the complete months, for the person who owns the account');
foreach (['2027-01', '2027-02', '2027-03'] as $m) {
    $sm = \Linen\Analysis::summary($db, new \Linen\Scope($hid, $mv), $m);
    $h = Budget::month_view($db, $hid, $m, $mv)['household'];
    check($h['income_cents'] === $sm['income_cents'] && $h['expense_cents'] === $sm['spend_cents'] && $h['saving_cents'] === $sm['moved_cents']
        && $h['surplus_cents'] === $sm['net_cents'], "drafted $m matches the statements exactly (left over = change in balance)");
}
$apr = array_column(Budget::month_view($db, $hid, '2027-04', $mv)['lines'], 'amount_cents', 'name');
check(($apr['Acme Payroll'] ?? null) === 3100000 && ($apr['Netflix Com'] ?? null) === 19900 && ($apr['Groceries'] ?? null) === 250000
    && ($apr['Moved to your own accounts'] ?? null) === 66667 && ($apr['Bank fees'] ?? null) === 47500,
    'next month carries typical amounts (latest regular pay, average groceries and own-account moves)');
check(Budget::draft_untouched($db, $hid, $mv), 'a fresh draft counts as untouched (new statements redraft it)');
check(!isset($apr['Gift From Gran']), 'a one-off credit is not planned as ongoing income');
check((int)$db->val("SELECT is_debit_order FROM budget_lines WHERE name = 'Fnblife'") === 1, 'debit orders are flagged');
$gym = Budget::create_line($db, $hid, ['member_id' => $mv, 'kind' => 'expense', 'name' => 'Gym', 'amount_cents' => 50000, 'start_month' => '2027-01']);
$groc = (int)$db->val("SELECT id FROM budget_lines WHERE name = 'Groceries'");
Budget::update_line($db, $hid, $groc, ['name' => 'Food']);
$before = (int)$db->val('SELECT COUNT(*) FROM budget_lines WHERE household_id = ?', [$hid]);
Budget::draft_from_statements($db, $hid);
check((int)$db->val('SELECT COUNT(*) FROM budget_lines WHERE household_id = ?', [$hid]) === $before
    && $db->val('SELECT 1 FROM budget_lines WHERE id = ?', [$gym]) && !$db->val("SELECT 1 FROM budget_lines WHERE name = 'Groceries'"),
    'redrafting keeps added and edited items and never adds an edited one again');
check(Budget::draft_from_statements($db, $hid, $mt)['lines'] === 0, 'someone without statements gets nothing drafted');
// A budget built by hand is never drafted over: its salary and the drafted income would both count.
$db2 = fresh(['private_mode' => false]);
$h2 = $db2->tx(fn($db) => Auth::create_household($db, 'T', ['V']));
[$m2] = array_column(Budget::members($db2, $h2), 'id');
Budget::create_line($db2, $h2, ['member_id' => $m2, 'kind' => 'income', 'name' => 'Salary', 'amount_cents' => 3000000, 'start_month' => '2027-01']);
$bal = 100000;
foreach ([['29 December 2026 to 31 January 2027', $jan], ['1 February 2027 to 28 February 2027', $feb]] as [$period, $rows]) {
    Statements::import($db2, $h2, $stmt($period, $bal, $rows), $m2);
    $bal += array_sum(array_column($rows, 2));
}
check(Budget::draft_from_statements($db2, $h2)['lines'] === 0 && (int)$db2->val('SELECT COUNT(*) FROM budget_lines') === 1, 'a hand-built budget is left alone');

// Review fixes: what people did is kept, payees are recognised, rows are never lost.
check(!Budget::draft_untouched($db, $hid, $mv), 'an edited draft is no longer untouched (new statements leave it alone)');
$fee = (int)$db->val("SELECT id FROM budget_lines WHERE name = 'Bank fees'");
Budget::set_paid($db, $hid, $fee, '2027-03', true);
Budget::draft_from_statements($db, $hid);
check((bool)$db->val('SELECT paid FROM line_status WHERE line_id = ?', [$fee]), 'ticking an item paid makes it theirs: a redraft keeps the tick');
$db3 = fresh(['private_mode' => false]);
$h3 = $db3->tx(fn($db) => Auth::create_household($db, 'T', ['V']));
[$m3] = array_column(Budget::members($db3, $h3), 'id');
$bal = 100000;
foreach ([['29 December 2026 to 31 January 2027', $jan], ['1 February 2027 to 28 February 2027', $feb]] as [$period, $rows]) {
    Statements::import($db3, $h3, $stmt($period, $bal, $rows), $m3);
    $bal += array_sum(array_column($rows, 2));
}
Budget::draft_from_statements($db3, $h3);
Budget::create_line($db3, $h3, ['member_id' => $m3, 'kind' => 'income', 'name' => 'Side gig', 'amount_cents' => 200000, 'start_month' => '2027-01']);
Budget::draft_from_statements($db3, $h3);
check((bool)$db3->val("SELECT 1 FROM budget_lines WHERE name = 'Acme Payroll'"), 'a small income of their own (a side gig) does not drop the drafted salary');
Budget::create_line($db3, $h3, ['member_id' => $m3, 'kind' => 'income', 'name' => 'Salary', 'amount_cents' => 3000000, 'start_month' => '2027-01']);
Budget::draft_from_statements($db3, $h3);
check(!$db3->val("SELECT 1 FROM budget_lines WHERE name = 'Acme Payroll'"), 'their own salary of the same amount replaces the drafted one: never counted twice');
check(Statements::merchant_key('May Fair Spar') === 'MAY FAIR SPAR' && Statements::merchant_key('Payment To Jan Botha') === 'JAN BOTHA'
    && Statements::merchant_key('Magtape Debit Netcash123456 Virgin Active') === 'NETCASH VIRGIN ACTIVE'
    && Statements::merchant_key('FNB App Payment To Landlord Rent Oct') === 'LANDLORD RENT', 'payee names keep real names and drop only dates, references and a trailing month');
check(str_contains(Statements::sanitise('DebiCheck Internal D/O Carfin_Fi1234567890'), '****7890') && !str_contains(Statements::sanitise('Carfin_Fi1234567890'), '123456'),
    'long account numbers are masked even when glued to letters');
$rx = fn(string $m) => \Linen\Categorise::compile(\Linen\Categorise::payee_pattern($m), 'regex');
check(preg_match($rx('APPLE COM BILL'), 'POS PURCHASE APPLE.COM/BILL ****9999') === 1 && preg_match($rx('FNB INSURE'), 'INTERNAL DEBIT ORDER FNB INSURE1234567') === 1
    && preg_match($rx('FNB INSURE'), 'FNB INSURANCE BROKERS') === 0, 'a "remember for this payee" rule matches the payee it was made from');
// FNB repeats the boundary day in both statements: identical fees that day, one in each file, are both kept.
$db4 = fresh(['private_mode' => false]);
$h4 = $db4->tx(fn($db) => Auth::create_household($db, 'T', ['V']));
Statements::import($db4, $h4, $stmt('1 March 2027 to 31 March 2027', 100000, [['31 Mar', '', -47500], ['31 Mar', '', -550]]));
$n = Statements::import($db4, $h4, $stmt('31 March 2027 to 30 April 2027', 51950, [['31 Mar', '', -550], ['02 Apr', 'Payshap Credit Acme Payroll', 100000]]))['rows_added'];
check($n === 2, 'an identical fee on the boundary day in the next statement is a new row, not a duplicate');
throws(fn() => Statements::parse(FakePdf::raw(str_repeat('[', 200) . ' (x) Tj')), \Linen\StatementFormatError::class, 'a PDF nested too deeply gets a clear error', 'too complex');
throws(fn() => Statements::parse(FakePdf::raw("BT /F1 12 Tf (a) (b) (c) (d) (e) (f) Tm (Hello) Tj ET")), \Linen\StatementFormatError::class,
    'odd operands in a PDF are read without warnings', 'FNB');

// --- Upgrading a database from before statements fed everything (schema 4 -> 5) ---------------------------------
$file = sys_get_temp_dir() . '/linen-v4-' . bin2hex(random_bytes(4)) . '.db';
$pdo = new PDO("sqlite:$file");
$pdo->exec(Db::SCHEMA);
$old = new \Linen\Conn($pdo);
\Linen\Categorise::seed_builtin_rules($old);
$pdo->exec(Db::MIGRATIONS[3]);
$pdo->exec(Db::MIGRATIONS[4]);
$h = $old->tx(fn($db) => Auth::create_household($db, 'T', ['V']));
$acct = $old->insert("INSERT INTO accounts (household_id, member_id, bank, label, last4) VALUES (?, NULL, 'fnb', 'FNB 1234', '1234')", [$h]);
$imp = $old->insert('INSERT INTO imports (household_id, account_id, filename, rows_total, rows_added, rows_duplicate) VALUES (?, ?, ?, 5, 5, 0)', [$h, $acct, 'mar.pdf']);
$userRule = $old->insert("INSERT INTO rules (household_id, pattern, match, direction, category, priority, source) VALUES (?, 'APPLE COM BILL MAR', 'word', 'out', 'Entertainment', 1000, 'user')", [$h]);
$shortRule = $old->insert("INSERT INTO rules (household_id, pattern, match, direction, category, priority, source) VALUES (?, 'PAYSHAP CREDIT V', 'word', 'in', 'Income', 1000, 'user')", [$h]);
$feeRule = $old->insert("INSERT INTO rules (household_id, pattern, match, direction, category, priority, source) VALUES (?, 'FNB BANK FEE', 'word', 'out', 'Other', 1000, 'user')", [$h]);
$fuelRule = (int)$old->val("SELECT id FROM rules WHERE household_id = 0 AND pattern = 'FUEL'");
$row = fn(string $on, string $desc, string $merchant, int $amt, int $bal, string $cat, string $src, ?int $rule) => $old->insert(
    'INSERT INTO transactions (household_id, account_id, import_id, posted_on, description, merchant, amount_cents, balance_cents, category, category_source, rule_id, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [$h, $acct, $imp, $on, $desc, $merchant, $amt, $bal, $cat, $src, $rule, bin2hex(random_bytes(8))]);
$tFee = $row('2027-03-31', 'FNB bank fee', 'FNB BANK FEE', -47500, 52500, 'Bank fees', 'rule', null);
$tSmall = $row('2027-03-31', 'FNB bank fee', 'FNB BANK FEE', -550, 51950, 'Bank fees', 'rule', null);
$tApple = $row('2027-03-10', 'POS Purchase Apple.Com/Bill ****9999 09 Mar', 'APPLE COM BILL MAR', -19900, 600000, 'Entertainment', 'rule', $userRule);
$tCar = $row('2027-03-02', 'DebiCheck Internal D/O Carfin_Fi1234567890', 'INTERNAL D O', -500000, 619900, 'Other', 'none', null);
$tFuel = $row('2027-03-05', 'Payment To Investment Fuel', 'INVESTMENT FUEL', -400000, 219900, 'Fuel & transport', 'rule', $fuelRule);
$pdo->exec('PRAGMA user_version = 4');
unset($old, $pdo);
Config::set(['db_path' => $file, 'private_mode' => false, 'env' => 'development']);
$db = Db::connect();
$t = fn(int $id) => $db->one('SELECT * FROM transactions WHERE id = ?', [$id]);
check((int)$db->val('PRAGMA user_version') === Db::SCHEMA_VERSION && $db->one('SELECT period_from, period_to FROM imports')
    === ['period_from' => '2027-03-02', 'period_to' => '2027-03-31'], 'v4 -> v5: schema upgraded, statement periods filled in from the rows');
check($t($tFee)['description'] === 'FNB monthly account fee' && $t($tSmall)['description'] === 'FNB transaction fee', 'v4 -> v5: FNB fee rows renamed like new imports');
check($t($tApple)['category'] === 'Entertainment' && $db->val('SELECT match FROM rules WHERE id = ?', [$userRule]) === 'regex',
    'v4 -> v5: a category someone chose for a payee is kept, and their rule now matches that payee');
check(str_contains($t($tCar)['description'], '****7890') && $t($tCar)['merchant'] === 'CARFIN', 'v4 -> v5: long numbers masked, payee renamed');
check($t($tFuel)['category'] === 'Transfers', 'v4 -> v5: built-in categories reapplied (own investment account = transfer)');
check($t($tFee)['fingerprint'] === Statements::fingerprint($acct, '2027-03-31|-47500|FNB MONTHLY ACCOUNT FEE', 52500, 1),
    'v4 -> v5: fingerprints match a fresh import, so uploading the statement again adds nothing');
$short = \Linen\Categorise::compile($db->val('SELECT pattern FROM rules WHERE id = ?', [$shortRule]), 'regex');
check(preg_match($short, 'PAYSHAP CREDIT V SMITH') === 1 && preg_match($short, 'FNB APP TRANSFER FROM V SAVINGS') === 0,
    'v4 -> v5: a payee rule never becomes broader than before (no catch-all "V")');
$fees = \Linen\Categorise::compile($db->val('SELECT pattern FROM rules WHERE id = ?', [$feeRule]), 'regex');
check(preg_match($fees, 'FNB TRANSACTION FEE') === 1 && preg_match($fees, 'FNB MONTHLY ACCOUNT FEE') === 1, 'v4 -> v5: a rule on the old fee name follows the new fee names');
unset($db);
@unlink($file);

// Transfers between the household's own accounts are paired only when it's unambiguous.
$db = fresh(['private_mode' => false]);
$hid = $db->tx(fn($db) => Auth::create_household($db, 'T', ['V', 'T']));
[$mv, $mt] = array_column(Budget::members($db, $hid), 'id');
Statements::import($db, $hid, "Date,Amount,Balance,Description\n2027/03/02,-50000,1,Payment To Tiara\n2027/03/03,-50000,1,Payment To Gym\n2027/03/04,-123456,1,FNB App Payment To T Savings\n2027/03/05,-30000,1,POS Purchase Shell\n", $mv);
Statements::import($db, $hid, "Date,Amount,Balance,Description\n2027/03/02,50000,1,Payment From V\n2027/03/03,50000,1,Payment From Mom\n2027/03/04,123456,1,Payment From V Savings\n2027/03/05,30000,1,Refund Shell\n", $mt);
$linked = array_column($db->all('SELECT description FROM transactions WHERE is_transfer = 1 ORDER BY id'), 'description');
check($linked === ['FNB App Payment To T Savings', 'Payment From V Savings'], 'a unique matching amount is paired; two R500s and a card purchase are not guessed');
check(!\Linen\Categorise::specific_payee('V') && !\Linen\Categorise::specific_payee('FNB') && \Linen\Categorise::specific_payee('NETFLIX')
    && \Linen\Categorise::specific_payee('MTN SP'), 'payee rules are only made from specific names');
// A month only counts as complete when every account's statement for it is in.
Statements::import($db, $hid, $stmt('1 April 2027 to 30 April 2027', 0, [['02 Apr', 'Payshap Credit Acme Payroll', 100000]]), $mv);
$db->exec("UPDATE imports SET period_from = '2027-03-01', period_to = '2027-03-31' WHERE id <= 2");  // the two March CSVs: full month
$cov = \Linen\Analysis::coverage($db, new \Linen\Scope($hid));
check(($cov['2027-03'] ?? null) === 1.0 && ($cov['2027-04'] ?? null) === 0.0, "a month one account hasn't uploaded yet is not complete for the household");
Statements::import($db, $hid, $stmt('1 July 2027 to 31 July 2027', 100000, [['02 Jul', 'Payshap Credit Acme Payroll', 100000]]), $mv);
$cov = \Linen\Analysis::coverage($db, new \Linen\Scope($hid));
check(($cov['2027-07'] ?? null) === 1.0, 'an account not uploaded for over two months (closed) stops holding later months back');


// --- Undo: small deletes and category choices can be put back from the toast ----------------
$db = fresh(['private_mode' => false]);
$hid = $db->tx(fn($db) => Auth::create_household($db, 'U', ['V', 'T']));
[$mv, $mt] = array_column(Budget::members($db, $hid), 'id');
$goal = \Linen\Goals::save($db, $hid, ['name' => 'Holiday', 'target_cents' => 1000000, 'target_month' => '2027-12']);
$line = Budget::create_line($db, $hid, ['member_id' => $mv, 'kind' => 'saving', 'name' => 'Holiday fund', 'category' => 'Savings & investments',
    'amount_cents' => 50000, 'start_month' => '2027-01']);
$db->exec('UPDATE budget_lines SET goal_id = ? WHERE id = ?', [$goal, $line]);
Budget::set_amount($db, $hid, $line, '2027-03', 60000, 'onward', 'raise');
Budget::set_paid($db, $hid, $line, '2027-02', true);
$tok = Budget::delete_line($db, $hid, $line);
check(is_string($tok) && strlen($tok) === 32 && !$db->val('SELECT 1 FROM budget_lines WHERE id = ?', [$line]), 'deleting a budget item returns an undo token');
$r = \Linen\Undo::restore($db, $hid, $tok);
$back = $db->one('SELECT * FROM budget_lines WHERE id = ?', [$r['id']]);
check($r['kind'] === 'line' && $r['id'] === $line && $back['name'] === 'Holiday fund' && (int)$back['goal_id'] === $goal
    && Budget::amount_on($db, $line, '2027-02') === 50000 && Budget::amount_on($db, $line, '2027-04') === 60000
    && (int)$db->val('SELECT paid FROM line_status WHERE line_id = ? AND month = ?', [$line, '2027-02']) === 1,
    'undo puts the item back with its id, amount history, paid ticks and goal link');
throws(fn() => \Linen\Undo::restore($db, $hid, $tok), \Linen\ApiError::class, 'an undo token only works once', "can't be undone");
throws(fn() => \Linen\Undo::restore($db, $hid, str_repeat('0', 32)), \Linen\ApiError::class, 'an unknown undo token is refused', "can't be undone");
$tok = \Linen\Goals::delete($db, $hid, $goal);
check($db->val('SELECT goal_id FROM budget_lines WHERE id = ?', [$line]) === null, 'deleting a goal unlinks its budget items');
$r = \Linen\Undo::restore($db, $hid, $tok);
check($r['id'] === $goal && (int)$db->val('SELECT goal_id FROM budget_lines WHERE id = ?', [$line]) === $goal, 'undoing a goal delete re-links its budget items');
$other = $db->tx(fn($db) => Auth::create_household($db, 'Other', ['X']));
$tok = Budget::delete_line($db, $hid, $line);
throws(fn() => \Linen\Undo::restore($db, $other, $tok), \Linen\ApiError::class, "another household can't use the token", "can't be undone");
\Linen\Undo::restore($db, $hid, $tok);
$db->exec("UPDATE undo_items SET created_at = datetime('now', '-31 minutes')");
$tok = Budget::delete_line($db, $hid, $line);
check((int)$db->val('SELECT COUNT(*) FROM undo_items') === 1, 'stale snapshots are purged when a new one is taken');
$db->exec("UPDATE undo_items SET created_at = datetime('now', '-31 minutes')");
throws(fn() => \Linen\Undo::restore($db, $hid, $tok), \Linen\ApiError::class, 'an undo token expires after half an hour', "can't be undone");
// Category choices: the merchant's other transactions follow, and undo puts every one of them (and the rule) back.
Statements::import($db, $hid, "Date,Amount,Balance,Description\n2027/03/02,-120.00,1,POS Purchase Zorbas Widgets\n2027/03/09,-90.00,1,POS Purchase Zorbas Widgets\n2027/03/10,-5.00,1,Mr Q\n2027/03/11,300.00,1,Payment From Zorbas Widgets\n", $mv);
$q = \Linen\Categorise::review_queue($db, $hid);
check($q['total'] === 4 && count($q['items']) === 3 && $q['items'][0]['count'] === 2 && $q['items'][0]['total_cents'] === -21000 && $q['items'][0]['remembers'] === true
    && $q['items'][0]['posted_on'] === '2027-03-09', 'the review inbox groups a payee\'s unsorted transactions, outgoing apart from incoming, biggest group first');
$mystery = (int)$db->val("SELECT id FROM transactions WHERE description = 'Mr Q'");
check(count(array_filter($q['items'], fn($i) => $i['id'] === $mystery && $i['remembers'] === false)) === 1, 'a vague payee gets its own card and no rule');
check(\Linen\Categorise::to_review($db, $hid) === 4, 'the unsorted count matches');
$r = \Linen\Categorise::set_category_undoable($db, $hid, $q['items'][0]['id'], 'Eating out');
$sources = $db->all("SELECT category, category_source, rule_id FROM transactions WHERE description = 'POS Purchase Zorbas Widgets' ORDER BY id");
check($r['updated'] === 2 && $r['rule_created'] && strlen($r['undo']) === 32 && $sources[0]['category'] === 'Eating out' && $sources[1]['category'] === 'Eating out'
    && count(array_filter($sources, fn($s) => $s['category_source'] === 'rule' && $s['rule_id'] !== null)) === 1
    && $db->val("SELECT category_source FROM transactions WHERE description = 'Payment From Zorbas Widgets'") === 'none', 'sorting one card sorts the payee\'s other outgoing transactions, not the incoming one');
check(\Linen\Categorise::to_review($db, $hid) === 2, 'the inbox shrinks by the whole group');
$rules = (int)$db->val("SELECT COUNT(*) FROM rules WHERE household_id = ? AND source = 'user'", [$hid]);
\Linen\Undo::restore($db, $hid, $r['undo']);
$sources = $db->all("SELECT category, category_source, rule_id, is_transfer FROM transactions WHERE description = 'POS Purchase Zorbas Widgets'");
check($rules === 1 && (int)$db->val("SELECT COUNT(*) FROM rules WHERE household_id = ? AND source = 'user'", [$hid]) === 0
    && count(array_filter($sources, fn($s) => $s['category'] === 'Other' && $s['category_source'] === 'none' && $s['rule_id'] === null)) === 2
    && \Linen\Categorise::to_review($db, $hid) === 4, 'undoing a category choice restores every transaction it touched and removes the new rule');
$r = \Linen\Categorise::set_category_undoable($db, $hid, $q['items'][0]['id'], 'Groceries');
$r2 = \Linen\Categorise::set_category_undoable($db, $hid, $q['items'][0]['id'], 'Eating out');
\Linen\Undo::restore($db, $hid, $r2['undo']);
check($db->val("SELECT category FROM rules WHERE household_id = ? AND source = 'user'", [$hid]) === 'Groceries'
    && $db->val("SELECT category FROM transactions WHERE id = ?", [$q['items'][0]['id']]) === 'Groceries', 'undoing a re-sort puts the earlier choice and its rule back');
$r = \Linen\Categorise::set_category_undoable($db, $hid, $mystery, 'Transfers');
check(!$r['rule_created'] && (int)$db->val('SELECT is_transfer FROM transactions WHERE id = ?', [$mystery]) === 1, 'a vague payee is sorted alone');
\Linen\Undo::restore($db, $hid, $r['undo']);
check((int)$db->val('SELECT is_transfer FROM transactions WHERE id = ?', [$mystery]) === 0, 'undo clears the transfer flag again');
// Debts
$debt = $db->insert('INSERT INTO debts (household_id, name, balance_cents, apr_bp, min_payment_cents) VALUES (?, ?, ?, ?, ?)', [$hid, 'Card', 500000, 2100, 25000]);
$tok = \Linen\Undo::stash($db, $hid, 'debt', ['debt' => $db->one('SELECT * FROM debts WHERE id = ?', [$debt])]);
$db->exec('DELETE FROM debts WHERE id = ?', [$debt]);
\Linen\Undo::restore($db, $hid, $tok);
check($db->one('SELECT name, balance_cents FROM debts WHERE id = ?', [$debt]) === ['name' => 'Card', 'balance_cents' => 500000], 'a removed debt comes back');
// Drill-down: the "flow" filter selects exactly what each card's figure was summed from.
$db->exec("UPDATE transactions SET category = 'Income', category_source = 'bank' WHERE description = 'Payment From Zorbas Widgets'");
$db->exec("UPDATE transactions SET category = 'Savings & investments', category_source = 'bank' WHERE description = 'Mr Q'");
$s = new \Linen\Scope($hid);
[$in, $spent] = \Linen\Analysis::totals($db, $s, '2027-03');
$sum = fn(string $flow) => (int)$db->val('SELECT COALESCE(SUM(t.amount_cents), 0) FROM transactions t WHERE t.household_id = ? AND substr(t.posted_on, 1, 7) = ? AND '
    . \Linen\Analysis::flow_sql($flow), [$hid, '2027-03']);
check($sum('in') === $in && -$sum('spent') === $spent && -$sum('moved') === \Linen\Analysis::summary($db, $s, '2027-03')['moved_cents'] && $in === 30000 && $spent === 21000,
    'the in / spent / moved drill-downs add up to the figures on the cards');
throws(fn() => \Linen\Analysis::flow_sql('sideways'), \InvalidArgumentException::class, 'an unknown flow is refused');

echo $failures ? "\n$failures of $count checks FAILED\n" : "All $count checks passed\n";
exit($failures ? 1 : 0);
