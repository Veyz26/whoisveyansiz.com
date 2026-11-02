<?php
/**
 * A software stand-in for Face ID / Touch ID: holds a real P-256 key pair and produces the same
 * WebAuthn structures a phone does (CBOR attestation object, authenticator data, DER signature).
 * Used by tests/run.php and tests/e2e_http.py (via `php tests/FakeAuthenticator.php ...`).
 */
declare(strict_types=1);

final class FakeAuthenticator
{
    public \OpenSSLAsymmetricKey $key;
    public string $credId;
    public string $userHandle = '';
    public int $counter = 0;

    public function __construct(public string $rpId, public string $origin, bool $syncedCounter = true)
    {
        $this->key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        $this->credId = random_bytes(16);
        $this->counter = $syncedCounter ? 0 : 1;
    }

    public static function b64u(string $b): string
    {
        return rtrim(strtr(base64_encode($b), '+/', '-_'), '=');
    }

    public static function cbor(mixed $v): string
    {
        $head = function (int $major, int $n): string {
            if ($n < 24) {
                return chr($major << 5 | $n);
            }
            if ($n < 256) {
                return chr($major << 5 | 24) . chr($n);
            }
            if ($n < 65536) {
                return chr($major << 5 | 25) . pack('n', $n);
            }
            return chr($major << 5 | 26) . pack('N', $n);
        };
        if (is_int($v)) {
            return $v >= 0 ? $head(0, $v) : $head(1, -1 - $v);
        }
        if ($v instanceof Bytes) {
            return $head(2, strlen($v->b)) . $v->b;
        }
        if (is_string($v)) {
            return $head(3, strlen($v)) . $v;
        }
        if (is_array($v)) {
            $s = $head(5, count($v));
            foreach ($v as $k => $x) {
                $s .= self::cbor($k) . self::cbor($x);
            }
            return $s;
        }
        throw new \LogicException('cbor');
    }

    private function authData(int $flags, bool $withCred): string
    {
        $ad = hash('sha256', $this->rpId, true) . chr($flags) . pack('N', $this->counter);
        if ($withCred) {
            $d = openssl_pkey_get_details($this->key)['ec'];
            $cose = [1 => 2, 3 => -7, -1 => 1, -2 => new Bytes(str_pad($d['x'], 32, "\0", STR_PAD_LEFT)), -3 => new Bytes(str_pad($d['y'], 32, "\0", STR_PAD_LEFT))];
            $ad .= str_repeat("\0", 16) . pack('n', strlen($this->credId)) . $this->credId . self::cbor($cose);
        }
        return $ad;
    }

    /** What navigator.credentials.create() returns (already JSON-encoded the way app.js sends it). */
    public function create(array $options, int $flags = 0x45, ?string $origin = null): array
    {
        $this->userHandle = $options['user']['id'];
        $cd = json_encode(['type' => 'webauthn.create', 'challenge' => $options['challenge'], 'origin' => $origin ?? $this->origin, 'crossOrigin' => false]);
        $att = self::cbor(['fmt' => 'none', 'attStmt' => [], 'authData' => new Bytes($this->authData($flags, true))]);
        return ['id' => self::b64u($this->credId), 'rawId' => self::b64u($this->credId), 'type' => 'public-key', 'transports' => ['internal', 'hybrid'],
            'response' => ['clientDataJSON' => self::b64u($cd), 'attestationObject' => self::b64u($att)]];
    }

    /** What navigator.credentials.get() returns. */
    public function get(array $options, int $flags = 0x05, ?string $origin = null, ?string $rpId = null): array
    {
        if ($this->counter > 0) {
            $this->counter++;
        }
        $cd = json_encode(['type' => 'webauthn.get', 'challenge' => $options['challenge'], 'origin' => $origin ?? $this->origin, 'crossOrigin' => false]);
        $saved = $this->rpId;
        $this->rpId = $rpId ?? $this->rpId;
        $ad = $this->authData($flags, false);
        $this->rpId = $saved;
        openssl_sign($ad . hash('sha256', $cd, true), $sig, $this->key, OPENSSL_ALGO_SHA256);
        return ['id' => self::b64u($this->credId), 'rawId' => self::b64u($this->credId), 'type' => 'public-key',
            'response' => ['clientDataJSON' => self::b64u($cd), 'authenticatorData' => self::b64u($ad), 'signature' => self::b64u($sig),
                'userHandle' => $this->userHandle]];
    }
}

final class Bytes
{
    public function __construct(public string $b) {}
}

// CLI bridge for the Python HTTP test: keeps the key in a file between calls.
//   php tests/FakeAuthenticator.php create <state-file> <rpId> <origin>   (options JSON on stdin)
//   php tests/FakeAuthenticator.php get    <state-file>                   (options JSON on stdin)
if (PHP_SAPI === 'cli' && realpath($argv[0] ?? '') === __FILE__) {
    [, $cmd, $state] = $argv;
    $opts = json_decode(stream_get_contents(STDIN), true);
    if ($cmd === 'create') {
        $a = new FakeAuthenticator($argv[3], $argv[4]);
        $out = $a->create($opts);
    } else {
        $s = json_decode(file_get_contents($state), true);
        $a = new FakeAuthenticator($s['rpId'], $s['origin']);
        $a->key = openssl_pkey_get_private($s['pem']);
        $a->credId = base64_decode($s['credId']);
        $a->userHandle = $s['userHandle'];
        $out = $a->get($opts);
    }
    openssl_pkey_export($a->key, $pem);
    file_put_contents($state, json_encode(['rpId' => $a->rpId, 'origin' => $a->origin, 'pem' => $pem, 'credId' => base64_encode($a->credId), 'userHandle' => $a->userHandle]));
    echo json_encode($out);
}
