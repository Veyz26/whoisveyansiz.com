<?php
/**
 * PHP tests for what only the PHP version has (private mode, allowlist, Microsoft sign-in checks)
 * plus security basics. Business logic parity with the Python reference is covered by tests/parity.py.
 * Usage (from budget/): php tests/run.php
 */
declare(strict_types=1);

use Linen\{Auth, AuthError, Billing, Budget, Config, Db, Export, Microsoft, NeedsRecoveryCode, Passkeys, PasskeyError, Privacy, Statements};

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
$rows = [['29 Dec', 'POS Purchase Woolworths 431835*1642 28 Dec', -45099], ['31 Dec', 'FNB App Payment To Rent', -900000],
    ['31 Dec', '', -1100], ['02 Jan', 'Payshap Credit Salary', 2500000, 'Acme (Pty) Ltd Jan'], ['03 Jan', 'Magtape Debit Gym', -29900]];
$pdf = FakePdf::build(FakePdf::fnbStatement('28 December 2026 to 27 January 2027', 600000, $rows), '');
$st = Statements::parse($pdf);
check(count($st['transactions']) === 5 && $st['account_last4'] === '1234', 'FNB PDF: every row and the account number are read');
check(array_column($st['transactions'], 'posted_on') === ['2026-12-29', '2026-12-31', '2026-12-31', '2027-01-02', '2027-01-03'], 'FNB PDF: dates get the right year across New Year');
check(array_column($st['transactions'], 'amount_cents') === [-45099, -900000, -1100, 2500000, -29900], 'FNB PDF: money in and out, overdraft included');
check($st['transactions'][1]['balance_cents'] === -345099 && $st['transactions'][3]['balance_cents'] === 2153801, 'FNB PDF: an unmarked balance is overdrawn');
check($st['transactions'][2]['description'] === 'FNB bank fee' && $st['transactions'][3]['description'] === 'Payshap Credit Salary Acme (Pty) Ltd Jan',
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
check(!$db->val("SELECT 1 FROM transactions WHERE description LIKE '%431835%'"), 'FNB PDF: card numbers are masked');

echo $failures ? "\n$failures of $count checks FAILED\n" : "All $count checks passed\n";
exit($failures ? 1 : 0);
