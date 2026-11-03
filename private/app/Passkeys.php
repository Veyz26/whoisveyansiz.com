<?php
/**
 * Passkeys (WebAuthn): sign in with Face ID / Touch ID / Windows Hello / an Android screen lock.
 *
 * The private key never leaves the device (iCloud Keychain syncs it between your Apple devices).
 * The server stores only the public key and checks, per W3C WebAuthn Level 2 §7:
 *   challenge (single use, 5 minutes) · origin · RP ID hash · user present + user verified
 *   (biometric/PIN) · signature over authenticatorData ‖ SHA-256(clientDataJSON) · signature counter.
 * Passkeys with user verification are multi-factor by themselves: something you have (the device)
 * plus something you are (Face ID) or know (the device PIN).
 *
 * Attestation is 'none' (we don't need to know the device make), so the attestation statement is
 * not verified. Algorithms: ES256 (-7, Apple/Google/most) and RS256 (-257, some Windows Hello).
 */
declare(strict_types=1);

namespace Linen;

final class PasskeyError extends \RuntimeException {}

final class Passkeys
{
    private const CHALLENGE_TTL = '-5 minutes';
    private const FLAG_UP = 0x01;
    private const FLAG_UV = 0x04;
    private const FLAG_AT = 0x40;

    // ------------------------------------------------------------------ encoding helpers
    public static function b64u(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    public static function unb64u(string $s): string
    {
        $bin = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
        if ($bin === false) {
            throw new PasskeyError('Malformed passkey data.');
        }
        return $bin;
    }

    /** Minimal CBOR (RFC 8949) decoder: enough for WebAuthn attestation objects and COSE keys. */
    public static function cbor(string $data, int &$pos = 0, int $depth = 0): mixed
    {
        if ($depth > 16) {  // WebAuthn structures are shallow; deep nesting is an attack
            throw new PasskeyError('Malformed passkey data.');
        }
        if ($pos >= strlen($data)) {
            throw new PasskeyError('Truncated passkey data.');
        }
        $need = function (int $n) use (&$pos, $data): bool { // by reference: $pos moves as we read
            if ($pos + $n > strlen($data)) {
                throw new PasskeyError('Truncated passkey data.');
            }
            return true;
        };
        $ib = ord($data[$pos++]);
        $major = $ib >> 5;
        $info = $ib & 0x1f;
        $len = match (true) {
            $info < 24 => $info,
            $info === 24 => $need(1) ? ord($data[$pos++]) : 0,
            $info === 25 => $need(2) ? unpack('n', substr($data, ($pos += 2) - 2, 2))[1] : 0,
            $info === 26 => $need(4) ? unpack('N', substr($data, ($pos += 4) - 4, 4))[1] : 0,
            $info === 27 => $need(8) ? unpack('J', substr($data, ($pos += 8) - 8, 8))[1] : 0,
            default => throw new PasskeyError('Unsupported passkey encoding.'),
        };
        if (($major === 4 || $major === 5) && $len > 256) {
            throw new PasskeyError('Malformed passkey data.');
        }
        switch ($major) {
            case 0:
                return $len;
            case 1:
                return -1 - $len;
            case 2:
            case 3:
                if ($pos + $len > strlen($data)) {
                    throw new PasskeyError('Truncated passkey data.');
                }
                $s = substr($data, $pos, $len);
                $pos += $len;
                return $s;
            case 4:
                $a = [];
                for ($i = 0; $i < $len; $i++) {
                    $a[] = self::cbor($data, $pos, $depth + 1);
                }
                return $a;
            case 5:
                $m = [];
                for ($i = 0; $i < $len; $i++) {
                    $k = self::cbor($data, $pos, $depth + 1);
                    if (!is_int($k) && !is_string($k)) {
                        throw new PasskeyError('Malformed passkey data.');
                    }
                    $m[$k] = self::cbor($data, $pos, $depth + 1);
                }
                return $m;
            case 6:
                return self::cbor($data, $pos, $depth + 1); // tag: ignore, return the tagged item
            case 7:
                return match ($info) { 20 => false, 21 => true, 22, 23 => null, default => throw new PasskeyError('Unsupported passkey value.') };
        }
        throw new PasskeyError('Unsupported passkey encoding.');
    }

    private static function der_len(int $n): string
    {
        if ($n < 0x80) {
            return chr($n);
        }
        $b = ltrim(pack('N', $n), "\0");
        return chr(0x80 | strlen($b)) . $b;
    }

    private static function der(int $tag, string $body): string
    {
        return chr($tag) . self::der_len(strlen($body)) . $body;
    }

    private static function der_uint(string $bytes): string
    {
        $bytes = ltrim($bytes, "\0");
        if ($bytes === '' || ord($bytes[0]) & 0x80) {
            $bytes = "\0" . $bytes;
        }
        return self::der(0x02, $bytes);
    }

    /** COSE_Key → [PEM public key, alg]. */
    public static function cose_to_pem(array $k): array
    {
        $kty = $k[1] ?? null;
        $alg = $k[3] ?? null;
        if ($kty === 2 && $alg === -7 && ($k[-1] ?? null) === 1 && strlen($k[-2] ?? '') === 32 && strlen($k[-3] ?? '') === 32) {
            // P-256 SubjectPublicKeyInfo: fixed prefix + uncompressed point
            $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . "\x04" . $k[-2] . $k[-3];
        } elseif ($kty === 3 && $alg === -257 && is_string($k[-1] ?? null) && is_string($k[-2] ?? null)) {
            $rsaKey = self::der(0x30, self::der_uint($k[-1]) . self::der_uint($k[-2]));
            $algId = self::der(0x30, self::der(0x06, hex2bin('2a864886f70d010101')) . "\x05\x00");
            $der = self::der(0x30, $algId . self::der(0x03, "\x00" . $rsaKey));
        } else {
            throw new PasskeyError("This device's passkey type isn't supported.");
        }
        $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
        if (!openssl_pkey_get_public($pem)) {
            throw new PasskeyError('Invalid passkey public key.');
        }
        return [$pem, $alg];
    }

    // ------------------------------------------------------------------ relying party
    /** @return array{id:string, origin:string, name:string} */
    public static function rp(string $baseUrl): array
    {
        $u = parse_url($baseUrl);
        $origin = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
        return ['id' => Config::get('rp_id') ?: $u['host'], 'origin' => $origin, 'name' => Config::get('rp_name') ?: Config::get('app_name')];
    }

    private static function new_challenge(Conn $db, string $purpose, ?int $uid): string
    {
        $c = random_bytes(32);
        $db->exec("DELETE FROM webauthn_challenges WHERE created_at < datetime('now', ?)", [self::CHALLENGE_TTL]);
        $db->exec('INSERT INTO webauthn_challenges (challenge_hash, purpose, user_id) VALUES (?, ?, ?)', [hash('sha256', $c), $purpose, $uid]);
        return self::b64u($c);
    }

    /** Checks clientDataJSON and consumes its challenge. */
    private static function check_client_data(Conn $db, string $clientDataJSON, string $type, string $purpose, string $origin, ?int $uid): void
    {
        $cd = json_decode($clientDataJSON, true);
        if (!is_array($cd) || ($cd['type'] ?? '') !== $type) {
            throw new PasskeyError('Unexpected passkey response.');
        }
        if (($cd['origin'] ?? '') !== $origin) {
            throw new PasskeyError('This passkey response came from a different website.');
        }
        if (!empty($cd['crossOrigin'])) {
            throw new PasskeyError('Cross-origin passkey use is not allowed.');
        }
        if (!is_string($cd['challenge'] ?? null) || !is_string($cd['origin'] ?? null)) {
            throw new PasskeyError('Unexpected passkey response.');
        }
        $hash = hash('sha256', self::unb64u($cd['challenge']));
        $row = $db->one("SELECT * FROM webauthn_challenges WHERE challenge_hash = ? AND purpose = ? AND created_at > datetime('now', ?)",
            [$hash, $purpose, self::CHALLENGE_TTL]);
        $db->exec('DELETE FROM webauthn_challenges WHERE challenge_hash = ?', [$hash]);
        if (!$row || ($uid !== null && (int)$row['user_id'] !== $uid)) {
            throw new PasskeyError('The passkey request expired. Please try again.');
        }
    }

    /** @return array{flags:int, count:int, credId:?string, cose:?array} */
    private static function parse_auth_data(string $ad, string $rpId): array
    {
        if (strlen($ad) < 37) {
            throw new PasskeyError('Truncated passkey data.');
        }
        if (!hash_equals(hash('sha256', $rpId, true), substr($ad, 0, 32))) {
            throw new PasskeyError('This passkey belongs to a different website.');
        }
        $flags = ord($ad[32]);
        if (!($flags & self::FLAG_UP) || !($flags & self::FLAG_UV)) {
            throw new PasskeyError('Face ID / Touch ID (or your device PIN) is required.');
        }
        $out = ['flags' => $flags, 'count' => unpack('N', substr($ad, 33, 4))[1], 'credId' => null, 'cose' => null];
        if ($flags & self::FLAG_AT) {
            if (strlen($ad) < 55) {
                throw new PasskeyError('Truncated passkey data.');
            }
            $len = unpack('n', substr($ad, 53, 2))[1];
            if (strlen($ad) < 55 + $len + 1) {
                throw new PasskeyError('Truncated passkey data.');
            }
            $out['credId'] = substr($ad, 55, $len);
            $pos = 55 + $len;
            $out['cose'] = self::cbor($ad, $pos);
        }
        return $out;
    }

    // ------------------------------------------------------------------ registration
    public static function user_handle(Conn $db, int $uid): string
    {
        $h = $db->val('SELECT webauthn_handle FROM users WHERE id = ?', [$uid]);
        if (!$h) {
            $h = self::b64u(random_bytes(16)); // random, so it reveals nothing about the user
            $db->exec('UPDATE users SET webauthn_handle = ? WHERE id = ?', [$h, $uid]);
        }
        return $h;
    }

    public static function register_options(Conn $db, int $uid, string $baseUrl): array
    {
        $u = $db->one('SELECT email, name FROM users WHERE id = ?', [$uid]);
        $rp = self::rp($baseUrl);
        return [
            'challenge' => self::new_challenge($db, 'register', $uid),
            'rp' => ['id' => $rp['id'], 'name' => $rp['name']],
            'user' => ['id' => self::user_handle($db, $uid), 'name' => $u['email'], 'displayName' => $u['name']],
            'pubKeyCredParams' => [['type' => 'public-key', 'alg' => -7], ['type' => 'public-key', 'alg' => -257]],
            'timeout' => 120000,
            'attestation' => 'none',
            // Save it on this device (iCloud Keychain, Google Password Manager, Windows Hello), not on a phone
            // reached through a QR code or a security key: each device gets its own passkey.
            'authenticatorSelection' => ['authenticatorAttachment' => 'platform', 'residentKey' => 'required',
                'requireResidentKey' => true, 'userVerification' => 'required'],
            'hints' => ['client-device'],
            'excludeCredentials' => array_map(fn($c) => ['type' => 'public-key', 'id' => $c],
                array_column($db->all('SELECT credential_id FROM passkeys WHERE user_id = ?', [$uid]), 'credential_id')),
        ];
    }

    /** Verifies a navigator.credentials.create() result and stores the passkey. Returns the passkey id. */
    public static function register_verify(Conn $db, int $uid, array $cred, string $baseUrl, string $name): int
    {
        $rp = self::rp($baseUrl);
        $clientData = self::unb64u((string)($cred['response']['clientDataJSON'] ?? ''));
        self::check_client_data($db, $clientData, 'webauthn.create', 'register', $rp['origin'], $uid);
        $att = self::cbor(self::unb64u((string)($cred['response']['attestationObject'] ?? '')));
        if (!is_array($att) || !is_string($att['authData'] ?? null)) {
            throw new PasskeyError('Unexpected passkey response.');
        }
        $ad = self::parse_auth_data($att['authData'], $rp['id']);
        if (!$ad['credId'] || !is_array($ad['cose'])) {
            throw new PasskeyError('The device did not create a passkey.');
        }
        $credId = self::b64u($ad['credId']);
        if (($cred['id'] ?? '') !== $credId) {
            throw new PasskeyError('Unexpected passkey response.');
        }
        if ($db->val('SELECT 1 FROM passkeys WHERE credential_id = ?', [$credId])) {
            throw new PasskeyError('That passkey is already registered.');
        }
        [$pem, $alg] = self::cose_to_pem($ad['cose']);
        $transports = array_values(array_filter((array)($cred['transports'] ?? []), 'is_string'));
        return $db->insert('INSERT INTO passkeys (user_id, credential_id, public_key_pem, alg, sign_count, transports, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$uid, $credId, $pem, $alg, $ad['count'], json_encode($transports), mb_substr(trim($name) ?: 'Passkey', 0, 40)]);
    }

    // ------------------------------------------------------------------ sign-in
    public static function login_options(Conn $db, string $baseUrl): array
    {
        // No allowCredentials: the device offers its passkeys for this site (usernameless sign-in).
        // The hint asks browsers to offer this device's passkeys before a phone's QR code.
        return ['challenge' => self::new_challenge($db, 'login', null), 'rpId' => self::rp($baseUrl)['id'],
            'timeout' => 120000, 'userVerification' => 'required', 'hints' => ['client-device']];
    }

    /** Verifies a navigator.credentials.get() result. Returns the user id. */
    public static function login_verify(Conn $db, array $cred, string $baseUrl): int
    {
        $rp = self::rp($baseUrl);
        $credId = (string)($cred['id'] ?? '');
        $pk = $db->one('SELECT p.*, u.webauthn_handle FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.credential_id = ?', [$credId]);
        $r = (array)($cred['response'] ?? []);
        $clientData = self::unb64u((string)($r['clientDataJSON'] ?? ''));
        // Consume the challenge even if the passkey is unknown, so a challenge can't be replayed.
        self::check_client_data($db, $clientData, 'webauthn.get', 'login', $rp['origin'], null);
        if (!$pk) {
            throw new PasskeyError("This passkey isn't registered here. Sign in with your password and add Face ID again.");
        }
        if (!empty($r['userHandle']) && !hash_equals((string)$pk['webauthn_handle'], (string)$r['userHandle'])) {
            throw new PasskeyError('This passkey belongs to a different account.');
        }
        $authData = self::unb64u((string)($r['authenticatorData'] ?? ''));
        $ad = self::parse_auth_data($authData, $rp['id']);
        $ok = openssl_verify($authData . hash('sha256', $clientData, true), self::unb64u((string)($r['signature'] ?? '')),
            $pk['public_key_pem'], OPENSSL_ALGO_SHA256);
        if ($ok !== 1) {
            throw new PasskeyError("The passkey signature didn't check out.");
        }
        // Synced passkeys (iCloud) always report 0; a hardware key's counter must keep increasing.
        if ($ad['count'] !== 0 || (int)$pk['sign_count'] !== 0) {
            if ($ad['count'] <= (int)$pk['sign_count']) {
                $db->audit(null, (int)$pk['user_id'], 'passkey.counter_mismatch', $credId);
                throw new PasskeyError('This passkey may have been copied. Remove it in Settings and add it again.');
            }
        }
        $db->exec('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?', [$ad['count'], Auth::now(), $pk['id']]);
        return (int)$pk['user_id'];
    }

    // ------------------------------------------------------------------ management & recovery
    public static function count(Conn $db, int $uid): int
    {
        return (int)$db->val('SELECT COUNT(*) FROM passkeys WHERE user_id = ?', [$uid]);
    }

    public static function list(Conn $db, int $uid): array
    {
        return $db->all('SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY id', [$uid]);
    }

    public static function delete(Conn $db, int $uid, int $id): void
    {
        $db->exec('DELETE FROM passkeys WHERE id = ? AND user_id = ?', [$id, $uid]);
    }

    /** New set of 10 one-time recovery codes (old ones stop working). Returns them in plain text, once. */
    public static function new_recovery_codes(Conn $db, int $uid): array
    {
        $codes = [];
        $db->tx(function (Conn $db) use ($uid, &$codes) {
            $db->exec('DELETE FROM recovery_codes WHERE user_id = ?', [$uid]);
            for ($i = 0; $i < 10; $i++) {
                $raw = strtoupper(bin2hex(random_bytes(5)));             // 10 hex chars, 40 bits
                $code = substr($raw, 0, 5) . '-' . substr($raw, 5);
                $codes[] = $code;
                $db->exec('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', [$uid, password_hash($raw, PASSWORD_DEFAULT)]);
            }
        });
        return $codes;
    }

    public static function use_recovery_code(Conn $db, int $uid, string $code): bool
    {
        $raw = strtoupper(preg_replace('/[^0-9A-Fa-f]/', '', $code));
        if (strlen($raw) !== 10) {
            return false;
        }
        foreach ($db->all('SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [$uid]) as $r) {
            if (password_verify($raw, $r['code_hash'])) {
                $db->exec('UPDATE recovery_codes SET used_at = ? WHERE id = ?', [Auth::now(), $r['id']]);
                return true;
            }
        }
        return false;
    }

    public static function recovery_left(Conn $db, int $uid): int
    {
        return (int)$db->val('SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [$uid]);
    }
}
