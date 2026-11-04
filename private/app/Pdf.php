<?php
/**
 * Reads the text of a PDF bank statement, with no libraries, so FNB's PDF statements can be imported.
 *
 * Covers what bank statements use: classic cross-reference tables or object streams, Flate compression,
 * the Standard security handler with an empty user password (RC4 or AES-128: "restrictions only", which is
 * how FNB sends them), simple fonts (WinAnsi) and fonts with a ToUnicode map. Text comes back as lines of
 * positioned pieces, top to bottom, so a statement's columns can be read by their x position.
 */
declare(strict_types=1);

namespace Linen;

final class PdfError extends \InvalidArgumentException {}

final class PdfRef
{
    public function __construct(public int $num, public int $gen) {}
}

final class PdfStr
{
    public function __construct(public string $bytes) {}
}

final class PdfOp
{
    public function __construct(public string $op) {}
}

final class Pdf
{
    private const PAD = "\x28\xBF\x4E\x5E\x4E\x75\x8A\x41\x64\x00\x4E\x56\xFF\xFA\x01\x08\x2E\x2E\x00\xB6\xD0\x68\x3E\x80\x2F\x0C\xA9\xFE\x64\x53\x69\x7A";

    /** @var array<int, array{gen:int, at:int}|array{stm:int, idx:int}> where each object is */
    private array $where = [];
    /** @var array<int, mixed> parsed objects */
    private array $cache = [];
    private ?string $key = null;
    private bool $aes = false;
    /** @var array<string, array> decoded fonts by object number */
    private array $fonts = [];

    private function __construct(private string $d) {}

    /**
     * @return list<array{page:int, y:float, items:list<array{x:float, text:string}>}> lines, top to bottom per page
     */
    public static function lines(string $data): array
    {
        if (!str_starts_with(ltrim(substr($data, 0, 1024)), '%PDF')) {
            throw new PdfError("This isn't a PDF file.");
        }
        $pdf = new self($data);
        $pdf->index();
        $trailer = $pdf->trailer();
        if (isset($trailer['Encrypt'])) {
            $pdf->decryptKey($pdf->resolve($trailer['Encrypt']), $trailer);
        }
        $pdf->indexObjectStreams();  // after the key: object streams are encrypted too
        $out = [];
        foreach ($pdf->pages($pdf->resolve($trailer['Root'] ?? null)) as $n => $page) {
            $items = [];
            $pdf->runContent($pdf->pageContent($page), $pdf->resources($page), [1, 0, 0, 1, 0, 0], $items, 0);
            foreach (self::toLines($items) as $line) {
                $out[] = ['page' => $n + 1] + $line;
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ objects
    private function index(): void
    {
        // Scanning for "n g obj" finds every top-level object, also in files with a broken or updated xref.
        preg_match_all('/(?<![0-9])(\d{1,7})\s+(\d{1,5})\s+obj\b/', $this->d, $m, PREG_OFFSET_CAPTURE);
        foreach ($m[0] as $i => $whole) {
            $this->where[(int)$m[1][$i][0]] = ['gen' => (int)$m[2][$i][0], 'at' => $whole[1] + strlen($whole[0])];
        }
    }

    /** Objects inside object streams (PDF 1.5+). */
    private function indexObjectStreams(): void
    {
        foreach (array_keys($this->where) as $num) {
            $at = $this->where[$num]['at'] ?? null;
            if ($at === null || !preg_match('#\G\s*<<[^>]*?/Type\s*/ObjStm#', $this->d, $_, 0, $at)) {
                continue;
            }
            $stm = $this->get($num);
            $data = $this->streamData($stm, $num);
            $first = (int)$stm['dict']['First'];
            $nums = preg_split('/\s+/', trim(substr($data, 0, $first)));
            for ($i = 0; $i + 1 < count($nums); $i += 2) {
                $this->where[(int)$nums[$i]] ??= ['stm' => $num, 'idx' => $i / 2];
            }
        }
    }

    private function trailer(): array
    {
        $t = [];
        // Classic trailers, last one wins (incremental updates)...
        if (preg_match_all('/trailer\s*(<<)/', $this->d, $m, PREG_OFFSET_CAPTURE)) {
            foreach ($m[1] as $hit) {
                $t = (new PdfLexer($this->d, $hit[1]))->value() + $t;
            }
        }
        // ...or cross-reference streams.
        foreach ($this->where as $num => $w) {
            if (isset($w['at']) && preg_match('#\G\s*<<[^>]*?/Type\s*/XRef#', $this->d, $_, 0, $w['at'])) {
                $x = $this->get($num);
                $t = $x['dict'] + $t;
            }
        }
        if (!isset($t['Root'])) {
            throw new PdfError("This PDF couldn't be read (no document catalogue).");
        }
        return $t;
    }

    private function get(int $num): mixed
    {
        if (array_key_exists($num, $this->cache)) {
            return $this->cache[$num];
        }
        $this->cache[$num] = null;  // guards against reference loops
        $w = $this->where[$num] ?? null;
        if ($w === null) {
            return null;
        }
        if (isset($w['stm'])) {
            $stm = $this->get($w['stm']);
            $data = $this->streamData($stm, $w['stm']);
            $first = (int)$stm['dict']['First'];
            $nums = preg_split('/\s+/', trim(substr($data, 0, $first)));
            $off = (int)($nums[$w['idx'] * 2 + 1] ?? 0);
            return $this->cache[$num] = (new PdfLexer($data, $first + $off))->value();
        }
        $lx = new PdfLexer($this->d, $w['at']);
        $v = $lx->value();
        if (is_array($v) && $lx->streamStart() !== null) {
            $start = $lx->streamStart();
            $len = $this->resolve($v['Length'] ?? null);
            $raw = is_int($len) && $start + $len <= strlen($this->d) && preg_match('/\G\s*endstream/', $this->d, $_, 0, $start + $len)
                ? substr($this->d, $start, $len)
                : substr($this->d, $start, max(0, (int)strpos($this->d, 'endstream', $start) - $start));
            $v = ['dict' => $v, 'raw' => $raw, 'gen' => $w['gen']];
        } elseif ($v instanceof PdfStr && $this->key !== null) {
            $v = new PdfStr($this->decrypt($v->bytes, $num, $w['gen']));
        }
        return $this->cache[$num] = $v;
    }

    private function resolve(mixed $v): mixed
    {
        for ($i = 0; $v instanceof PdfRef && $i < 32; $i++) {
            $v = $this->get($v->num);
        }
        return $v;
    }

    /** A stream's decoded bytes. */
    private function streamData(mixed $s, int $num): string
    {
        if (!is_array($s) || !isset($s['raw'])) {
            return '';
        }
        $raw = $s['raw'];
        $isXref = ($s['dict']['Type'] ?? '') === '/XRef';
        if ($this->key !== null && !$isXref) {
            $raw = $this->decrypt($raw, $num, $s['gen']);
        }
        $filters = $this->resolve($s['dict']['Filter'] ?? []);
        foreach ((array)(is_string($filters) ? [$filters] : $filters) as $f) {
            $f = $this->resolve($f);
            if ($f === '/FlateDecode' || $f === '/Fl') {
                $out = @gzuncompress($raw);
                if ($out === false) {
                    $out = @gzinflate(substr($raw, 2));  // tolerate a damaged checksum at the end
                }
                if ($out === false) {
                    throw new PdfError("Part of this PDF couldn't be decompressed.");
                }
                $raw = $out;
            } elseif ($f === '/DCTDecode' || $f === '/JPXDecode') {
                return '';  // images: no text in them
            } else {
                throw new PdfError('This PDF uses a compression this app does not read (' . ltrim((string)$f, '/') . ').');
            }
        }
        return $raw;
    }

    // ------------------------------------------------------------------ encryption
    private function decryptKey(mixed $enc, array $trailer): void
    {
        if (!is_array($enc) || ($enc['Filter'] ?? '') !== '/Standard') {
            throw new PdfError('This PDF is protected in a way this app cannot open. Save or print it as a new PDF first.');
        }
        $v = (int)($enc['V'] ?? 0);
        $r = (int)($enc['R'] ?? 0);
        $id = $this->resolve($trailer['ID'] ?? []);
        $id = is_array($id) && ($id[0] ?? null) instanceof PdfStr ? $id[0]->bytes : '';
        $o = $enc['O'] instanceof PdfStr ? $enc['O']->bytes : '';
        $u = $enc['U'] instanceof PdfStr ? $enc['U']->bytes : '';
        $p = (int)($enc['P'] ?? 0);
        if ($v === 4) {
            $cf = $this->resolve($enc['CF'] ?? []);
            $this->aes = (($cf['StdCF']['CFM'] ?? '') === '/AESV2');
        } elseif ($v !== 1 && $v !== 2) {
            throw new PdfError('This PDF uses a newer kind of protection. Save or print it as a new PDF first.');
        }
        $n = $r >= 3 ? intdiv((int)($enc['Length'] ?? 128), 8) : 5;
        // Algorithm 2 (PDF 1.7, 7.6.3.3) with the empty user password.
        $h = md5(substr(self::PAD, 0, 32) . $o . pack('V', $p & 0xFFFFFFFF) . $id
            . ($r >= 4 && ($enc['EncryptMetadata'] ?? true) === false ? "\xFF\xFF\xFF\xFF" : ''), true);
        if ($r >= 3) {
            for ($i = 0; $i < 50; $i++) {
                $h = md5(substr($h, 0, $n), true);
            }
        }
        $key = substr($h, 0, $n);
        // Algorithms 4/5: the key must reproduce /U, or the PDF needs a password to open.
        if ($r >= 3) {
            $x = self::rc4($key, md5(self::PAD . $id, true));
            for ($i = 1; $i <= 19; $i++) {
                $x = self::rc4($key ^ str_repeat(chr($i), $n), $x);
            }
            $ok = substr($x, 0, 16) === substr($u, 0, 16);
        } else {
            $ok = self::rc4($key, self::PAD) === $u;
        }
        if (!$ok) {
            throw new PdfError('This PDF needs a password to open. Open it, then save or print it as a new PDF without a password.');
        }
        $this->key = $key;
    }

    private function decrypt(string $data, int $num, int $gen): string
    {
        $k = md5($this->key . substr(pack('V', $num), 0, 3) . substr(pack('V', $gen), 0, 2) . ($this->aes ? 'sAlT' : ''), true);
        $k = substr($k, 0, min(strlen($this->key) + 5, 16));
        if ($this->aes) {
            if (strlen($data) < 32) {
                return '';
            }
            $out = openssl_decrypt(substr($data, 16), 'aes-128-cbc', $k, OPENSSL_RAW_DATA, substr($data, 0, 16));
            return $out === false ? '' : $out;
        }
        return self::rc4($k, $data);
    }

    private static function rc4(string $key, string $data): string
    {
        $s = range(0, 255);
        $kl = strlen($key);
        for ($i = 0, $j = 0; $i < 256; $i++) {
            $j = ($j + $s[$i] + ord($key[$i % $kl])) & 255;
            [$s[$i], $s[$j]] = [$s[$j], $s[$i]];
        }
        $out = '';
        $len = strlen($data);
        for ($i = 0, $j = 0, $n = 0; $n < $len; $n++) {
            $i = ($i + 1) & 255;
            $j = ($j + $s[$i]) & 255;
            [$s[$i], $s[$j]] = [$s[$j], $s[$i]];
            $out .= chr(ord($data[$n]) ^ $s[($s[$i] + $s[$j]) & 255]);
        }
        return $out;
    }

    // ------------------------------------------------------------------ pages
    private function pages(mixed $catalog): array
    {
        $out = [];
        $walk = function (mixed $node, array $inherited, int $depth) use (&$walk, &$out): void {
            $node = $this->resolve($node);
            if (!is_array($node) || $depth > 32 || count($out) > 500) {
                return;
            }
            if (isset($node['Resources'])) {
                $inherited['Resources'] = $node['Resources'];
            }
            if (($node['Type'] ?? '') === '/Pages' || isset($node['Kids'])) {
                foreach ((array)$this->resolve($node['Kids'] ?? []) as $kid) {
                    $walk($kid, $inherited, $depth + 1);
                }
            } else {
                $out[] = $node + $inherited;
            }
        };
        $walk(is_array($catalog) ? ($catalog['Pages'] ?? null) : null, [], 0);
        if (!$out) {
            throw new PdfError("This PDF couldn't be read (no pages found).");
        }
        return $out;
    }

    private function resources(array $page): array
    {
        $r = $this->resolve($page['Resources'] ?? []);
        return is_array($r) ? $r : [];
    }

    private function pageContent(array $page): string
    {
        $c = $this->resolve($page['Contents'] ?? null);
        $parts = is_array($c) && !isset($c['raw']) ? $c : [$page['Contents'] ?? null];
        $out = '';
        foreach ($parts as $ref) {
            if ($ref instanceof PdfRef) {
                $out .= $this->streamData($this->get($ref->num), $ref->num) . "\n";
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ text
    /** Runs a content stream, collecting [x, y, size, text] for every piece of text shown. */
    private function runContent(string $content, array $res, array $ctm, array &$items, int $depth): void
    {
        $lx = new PdfLexer($content, 0);
        $stack = [];
        $gs = [];
        $tm = $lm = [1, 0, 0, 1, 0, 0];
        $font = null;
        $size = 0.0;
        $leading = 0.0;
        $joinNext = false;
        while (!$lx->done()) {
            $t = $lx->value();  // operands can be arrays (TJ) and dictionaries (marked content)
            if (!$t instanceof PdfOp) {
                if ($t !== null) {
                    $stack[] = $t;
                }
                continue;
            }
            $a = $stack;
            $stack = [];
            switch ($t->op) {
                case 'q': $gs[] = $ctm; break;
                case 'Q': $ctm = array_pop($gs) ?? $ctm; break;
                case 'cm': if (count($a) === 6) { $ctm = self::mul(array_map('floatval', $a), $ctm); } break;
                case 'BT': $tm = $lm = [1, 0, 0, 1, 0, 0]; $joinNext = false; break;
                case 'Tf': $font = $this->font($res, $a[0] ?? ''); $size = (float)($a[1] ?? 0); break;
                case 'TL': $leading = (float)($a[0] ?? 0); break;
                case 'Tm': if (count($a) === 6) { $tm = $lm = array_map('floatval', $a); } $joinNext = false; break;
                case 'TD': $leading = -(float)($a[1] ?? 0); // fall through: TD is TL + Td
                case 'Td': $lm = self::mul([1, 0, 0, 1, (float)($a[0] ?? 0), (float)($a[1] ?? 0)], $lm); $tm = $lm; $joinNext = false; break;
                case 'T*': $lm = self::mul([1, 0, 0, 1, 0, -$leading], $lm); $tm = $lm; $joinNext = false; break;
                case "'": case '"':
                    $lm = self::mul([1, 0, 0, 1, 0, -$leading], $lm); $tm = $lm; $joinNext = false;
                    $a = [end($a)];
                    // fall through
                case 'Tj': case 'TJ':
                    $text = '';
                    foreach ($t->op === 'TJ' ? (array)($a[0] ?? []) : [$a[0] ?? null] as $part) {
                        if ($part instanceof PdfStr) {
                            $text .= $this->decodeText($font, $part->bytes);
                        } elseif (is_numeric($part) && $part < -250) {
                            $text .= ' ';  // a wide kerning gap is a space
                        }
                    }
                    if ($text === '') {
                        break;
                    }
                    $m = self::mul($tm, $ctm);
                    $fs = $size * sqrt($m[0] * $m[0] + $m[1] * $m[1]);
                    if ($joinNext && $items) {
                        $items[count($items) - 1][3] .= $text;  // shown right after the previous piece
                    } else {
                        $items[] = [$m[4], $m[5], $fs, $text];
                    }
                    $joinNext = true;
                    break;
                case 'Do':
                    $ref = $this->resolve($res['XObject'] ?? [])[ltrim((string)($a[0] ?? ''), '/')] ?? null;
                    $xo = $this->resolve($ref);
                    if (is_array($xo) && ($xo['dict']['Subtype'] ?? '') === '/Form' && $depth < 4 && $ref instanceof PdfRef) {
                        $mx = $this->resolve($xo['dict']['Matrix'] ?? [1, 0, 0, 1, 0, 0]);
                        $xres = $this->resolve($xo['dict']['Resources'] ?? null);
                        $this->runContent($this->streamData($xo, $ref->num), is_array($xres) ? $xres : $res,
                            self::mul(array_map('floatval', (array)$mx), $ctm), $items, $depth + 1);
                    }
                    break;
            }
        }
    }

    private static function mul(array $a, array $b): array
    {
        return [$a[0] * $b[0] + $a[1] * $b[2], $a[0] * $b[1] + $a[1] * $b[3],
            $a[2] * $b[0] + $a[3] * $b[2], $a[2] * $b[1] + $a[3] * $b[3],
            $a[4] * $b[0] + $a[5] * $b[2] + $b[4], $a[4] * $b[1] + $a[5] * $b[3] + $b[5]];
    }

    /** @return array{map: array<string,string>, bytes: int, diffs: array<int,string>} */
    private function font(array $res, string $name): array
    {
        $ref = $this->resolve($res['Font'] ?? [])[ltrim($name, '/')] ?? null;
        $key = $ref instanceof PdfRef ? (string)$ref->num : $name;
        if (isset($this->fonts[$key])) {
            return $this->fonts[$key];
        }
        $f = $this->resolve($ref);
        $font = ['map' => [], 'bytes' => 1, 'diffs' => []];
        if (is_array($f)) {
            if (($f['Subtype'] ?? '') === '/Type0') {
                $font['bytes'] = 2;
            }
            $enc = $this->resolve($f['Encoding'] ?? null);
            if (is_array($enc)) {
                $code = 0;
                foreach ((array)$this->resolve($enc['Differences'] ?? []) as $d) {
                    if (is_int($d)) {
                        $code = $d;
                    } elseif (is_string($d)) {
                        $font['diffs'][$code++] = substr($d, 1);
                    }
                }
            }
            $tu = $f['ToUnicode'] ?? null;
            if ($tu instanceof PdfRef) {
                $font = self::cmap($this->streamData($this->get($tu->num), $tu->num)) + $font;
            }
        }
        return $this->fonts[$key] = $font;
    }

    /** Parses a ToUnicode CMap (bfchar and bfrange). */
    private static function cmap(string $s): array
    {
        $map = [];
        $bytes = 1;
        if (preg_match('/begincodespacerange\s*<([0-9A-Fa-f]+)>/', $s, $m)) {
            $bytes = max(1, intdiv(strlen($m[1]), 2));
        }
        $utf = fn(string $hex) => mb_convert_encoding(hex2bin(strlen($hex) % 4 ? str_pad($hex, 4, '0', STR_PAD_LEFT) : $hex), 'UTF-8', 'UTF-16BE');
        if (preg_match_all('/beginbfchar(.*?)endbfchar/s', $s, $blocks)) {
            foreach ($blocks[1] as $b) {
                preg_match_all('/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/', $b, $m, PREG_SET_ORDER);
                foreach ($m as $x) {
                    $map[hex2bin(str_pad($x[1], strlen($x[1]) + strlen($x[1]) % 2, '0', STR_PAD_LEFT))] = $x[2] === '' ? '' : $utf($x[2]);
                }
            }
        }
        if (preg_match_all('/beginbfrange(.*?)endbfrange/s', $s, $blocks)) {
            foreach ($blocks[1] as $b) {
                preg_match_all('/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/', $b, $m, PREG_SET_ORDER);
                foreach ($m as $x) {
                    [$lo, $hi, $w] = [hexdec($x[1]), hexdec($x[2]), strlen($x[1])];
                    if ($hi - $lo > 65535) {
                        continue;
                    }
                    $targets = $x[3][0] === '[' ? (preg_match_all('/<([0-9A-Fa-f]*)>/', $x[3], $t) ? $t[1] : []) : null;
                    $base = $targets === null ? hexdec(substr($x[3], 1, -1)) : 0;
                    for ($c = $lo; $c <= $hi; $c++) {
                        $code = hex2bin(str_pad(dechex($c), $w, '0', STR_PAD_LEFT));
                        $map[$code] = $targets === null
                            ? mb_convert_encoding(pack('n', $base + $c - $lo), 'UTF-8', 'UTF-16BE')
                            : (isset($targets[$c - $lo]) ? $utf($targets[$c - $lo]) : '');
                    }
                }
            }
        }
        return ['map' => $map, 'bytes' => $bytes];
    }

    private const GLYPHS = ['space' => ' ', 'hyphen' => '-', 'minus' => '-', 'endash' => '–', 'emdash' => '—', 'quoteright' => '’',
        'quoteleft' => '‘', 'quotedblleft' => '“', 'quotedblright' => '”', 'bullet' => '•', 'period' => '.', 'comma' => ',',
        'slash' => '/', 'ampersand' => '&', 'parenleft' => '(', 'parenright' => ')', 'colon' => ':', 'asterisk' => '*'];

    private function decodeText(?array $font, string $bytes): string
    {
        if ($font === null) {
            return mb_convert_encoding($bytes, 'UTF-8', 'Windows-1252');
        }
        $out = '';
        $step = $font['bytes'];
        for ($i = 0, $n = strlen($bytes); $i < $n; $i += $step) {
            $code = substr($bytes, $i, $step);
            if (isset($font['map'][$code])) {
                $out .= $font['map'][$code];
            } elseif ($step === 1 && isset($font['diffs'][ord($code)])) {
                $g = $font['diffs'][ord($code)];
                $out .= self::GLYPHS[$g] ?? (strlen($g) === 1 ? $g : (preg_match('/^(?:uni|u)([0-9A-F]{4})$/', $g, $m)
                    ? mb_convert_encoding(hex2bin($m[1]), 'UTF-8', 'UTF-16BE') : ''));
            } elseif ($step === 1) {
                $out .= mb_convert_encoding($code, 'UTF-8', 'Windows-1252');
            }
        }
        return $out;
    }

    /** Groups text pieces into lines (same baseline), top to bottom, pieces left to right. */
    private static function toLines(array $items): array
    {
        usort($items, fn($a, $b) => [$b[1], $a[0]] <=> [$a[1], $b[0]]);
        $lines = [];
        foreach ($items as [$x, $y, $fs, $text]) {
            $text = preg_replace('/\s+/u', ' ', $text);
            if (trim($text) === '') {
                continue;
            }
            $last = count($lines) - 1;
            if ($last >= 0 && abs($lines[$last]['y'] - $y) <= max(1.5, $fs * 0.35)) {
                $lines[$last]['items'][] = ['x' => round($x, 1), 'text' => trim($text)];
            } else {
                $lines[] = ['y' => round($y, 1), 'items' => [['x' => round($x, 1), 'text' => trim($text)]]];
            }
        }
        foreach ($lines as &$l) {
            usort($l['items'], fn($a, $b) => $a['x'] <=> $b['x']);
        }
        return $lines;
    }
}

/** Tokens and values of PDF syntax (objects and content streams). */
final class PdfLexer
{
    private int $len;
    private ?int $stream = null;

    public function __construct(private string $s, private int $i)
    {
        $this->len = strlen($s);
    }

    public function done(): bool
    {
        return $this->i >= $this->len;
    }

    /** Where the stream data starts, if the value just read was a stream dictionary. */
    public function streamStart(): ?int
    {
        return $this->stream;
    }

    public function value(): mixed
    {
        $t = $this->token();
        if ($t === '<<') {
            $d = [];
            while (($k = $this->token()) !== '>>' && $k !== null) {
                if (is_string($k) && str_starts_with($k, '/')) {
                    $d[substr($k, 1)] = $this->value();
                }
            }
            if (preg_match('/\G\s*stream\r?\n/', $this->s, $m, 0, $this->i)) {
                $this->stream = $this->i + strlen($m[0]);
            }
            return $d;
        }
        if ($t === '[') {
            $a = [];
            while (($v = $this->value()) !== ']' && $this->i < $this->len) {
                $a[] = $v;
            }
            return $a;
        }
        if (is_int($t)) {
            // "12 0 R" is a reference.
            if (preg_match('/\G\s+(\d+)\s+R(?![A-Za-z])/', $this->s, $m, 0, $this->i)) {
                $this->i += strlen($m[0]);
                return new PdfRef($t, (int)$m[1]);
            }
        }
        return $t;
    }

    public function token(): mixed
    {
        $s = $this->s;
        while ($this->i < $this->len) {
            $c = $s[$this->i];
            if (ctype_space($c) || $c === "\0") {
                $this->i++;
            } elseif ($c === '%') {
                $nl = strcspn($s, "\r\n", $this->i);
                $this->i += $nl;
            } else {
                break;
            }
        }
        if ($this->i >= $this->len) {
            return null;
        }
        $c = $s[$this->i];
        if ($c === '(') {
            return new PdfStr($this->literal());
        }
        if ($c === '<') {
            if (($s[$this->i + 1] ?? '') === '<') {
                $this->i += 2;
                return '<<';
            }
            $end = strpos($s, '>', $this->i);
            $end = $end === false ? $this->len : $end;
            $hex = preg_replace('/[^0-9A-Fa-f]/', '', substr($s, $this->i + 1, $end - $this->i - 1));
            $this->i = $end + 1;
            return new PdfStr(hex2bin(strlen($hex) % 2 ? $hex . '0' : $hex) ?: '');
        }
        if ($c === '>' && ($s[$this->i + 1] ?? '') === '>') {
            $this->i += 2;
            return '>>';
        }
        if ($c === '[' || $c === ']' || $c === '{' || $c === '}') {
            $this->i++;
            return $c;
        }
        $n = strcspn($s, " \t\r\n\f\0()<>[]{}/%", $this->i + 1) + 1;
        $word = substr($s, $this->i, $n);
        $this->i += $n;
        if ($c === '/') {
            return preg_replace_callback('/#([0-9A-Fa-f]{2})/', fn($m) => chr(hexdec($m[1])), $word);
        }
        if (preg_match('/^[+-]?\d+$/', $word)) {
            return (int)$word;
        }
        if (preg_match('/^[+-]?(\d*\.\d*)$/', $word)) {
            return (float)$word;
        }
        if ($word === 'true' || $word === 'false') {
            return $word === 'true';
        }
        if ($word === 'null') {
            return null;
        }
        if ($word === 'BI') {  // inline image: skip to its end
            $end = strpos($s, 'EI', $this->i);
            while ($end !== false && !(ctype_space($s[$end - 1] ?? ' ') && ctype_space($s[$end + 2] ?? ' '))) {
                $end = strpos($s, 'EI', $end + 2);
            }
            $this->i = $end === false ? $this->len : $end + 2;
            return $this->token();
        }
        return new PdfOp($word);
    }

    private function literal(): string
    {
        $s = $this->s;
        $this->i++;
        $out = '';
        $depth = 1;
        while ($this->i < $this->len) {
            $c = $s[$this->i++];
            if ($c === '\\') {
                $e = $s[$this->i++] ?? '';
                if ($e >= '0' && $e <= '7') {
                    $oct = $e;
                    while (strlen($oct) < 3 && ($s[$this->i] ?? '') >= '0' && ($s[$this->i] ?? '') <= '7') {
                        $oct .= $s[$this->i++];
                    }
                    $out .= chr(octdec($oct) & 255);
                } elseif ($e === "\r") {
                    if (($s[$this->i] ?? '') === "\n") {
                        $this->i++;
                    }
                } elseif ($e !== "\n") {
                    $out .= ['n' => "\n", 'r' => "\r", 't' => "\t", 'b' => "\x08", 'f' => "\f"][$e] ?? $e;
                }
            } elseif ($c === '(') {
                $depth++;
                $out .= $c;
            } elseif ($c === ')') {
                if (--$depth === 0) {
                    break;
                }
                $out .= $c;
            } else {
                $out .= $c;
            }
        }
        return $out;
    }
}
