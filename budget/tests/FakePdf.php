<?php
/**
 * Builds small PDFs for tests: positioned text on pages, Flate-compressed, optionally protected with the
 * Standard security handler (RC4-128, revision 3) like FNB's statements. No real statement is ever needed.
 */
declare(strict_types=1);

final class FakePdf
{
    private const PAD = "\x28\xBF\x4E\x5E\x4E\x75\x8A\x41\x64\x00\x4E\x56\xFF\xFA\x01\x08\x2E\x2E\x00\xB6\xD0\x68\x3E\x80\x2F\x0C\xA9\xFE\x64\x53\x69\x7A";

    /**
     * @param list<list<array{0: float, 1: float, 2: string}>> $pages each page: [x, y, text] pieces
     * @param ?string $userPassword null: not encrypted; '': opens without a password (restrictions only)
     */
    public static function build(array $pages, ?string $userPassword = null): string
    {
        $id = md5('fake-pdf-' . count($pages), true);
        [$key, $encDict] = $userPassword === null ? [null, null] : self::security($userPassword, 'owner-secret', $id);
        $objs = [1 => '<< /Type /Catalog /Pages 2 0 R >>', 3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
        $kids = [];
        $n = 4;
        foreach ($pages as $items) {
            $content = '';
            foreach ($items as [$x, $y, $text]) {
                $s = str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], mb_convert_encoding($text, 'Windows-1252', 'UTF-8'));
                $content .= sprintf("BT\n/F1 1 Tf\n6.5 0 0 6.5 %.2f %.2f Tm\n[(%s)]TJ\nET\n", $x, $y, $s);
            }
            $data = gzcompress($content);
            [$page, $stream] = [$n++, $n++];
            if ($key !== null) {
                $data = self::rc4(substr(md5($key . substr(pack('V', $stream), 0, 3) . "\0\0", true), 0, 16), $data);
            }
            $objs[$page] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents $stream 0 R >>";
            $objs[$stream] = '<< /Length ' . strlen($data) . " /Filter /FlateDecode >>\nstream\n$data\nendstream";
            $kids[] = "$page 0 R";
        }
        $objs[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($kids) . ' >>';
        if ($encDict !== null) {
            $objs[$n] = $encDict;
        }
        ksort($objs);
        $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        foreach ($objs as $num => $body) {
            $offsets[$num] = strlen($out);
            $out .= "$num 0 obj\n$body\nendobj\n";
        }
        $xref = strlen($out);
        $out .= "xref\n0 " . ($n + 1) . "\n0000000000 65535 f \n";
        for ($i = 1; $i <= $n; $i++) {
            $out .= isset($offsets[$i]) ? sprintf("%010d 00000 n \n", $offsets[$i]) : "0000000000 65535 f \n";
        }
        $hex = bin2hex($id);
        $out .= "trailer\n<< /Size " . ($n + 1) . " /Root 1 0 R /ID [<$hex> <$hex>]" . ($encDict !== null ? " /Encrypt $n 0 R" : '') . " >>\nstartxref\n$xref\n%%EOF\n";
        return $out;
    }

    /** Standard security handler, revision 3: PDF 1.7 algorithms 2, 3 and 5. */
    private static function security(string $user, string $owner, string $id): array
    {
        $pad = fn(string $pw) => substr($pw . self::PAD, 0, 32);
        $p = -1324;
        $h = md5($pad($owner), true);
        for ($i = 0; $i < 50; $i++) {
            $h = md5($h, true);
        }
        $o = self::rc4($h, $pad($user));
        for ($i = 1; $i <= 19; $i++) {
            $o = self::rc4($h ^ str_repeat(chr($i), 16), $o);
        }
        $k = md5($pad($user) . $o . pack('V', $p & 0xFFFFFFFF) . $id, true);
        for ($i = 0; $i < 50; $i++) {
            $k = md5($k, true);
        }
        $u = self::rc4($k, md5(self::PAD . $id, true));
        for ($i = 1; $i <= 19; $i++) {
            $u = self::rc4($k ^ str_repeat(chr($i), 16), $u);
        }
        $u .= str_repeat("\0", 16);
        return [$k, '<< /Filter /Standard /V 2 /R 3 /Length 128 /P ' . $p . ' /O <' . bin2hex($o) . '> /U <' . bin2hex($u) . '> >>'];
    }

    private static function rc4(string $key, string $data): string
    {
        $s = range(0, 255);
        for ($i = 0, $j = 0; $i < 256; $i++) {
            $j = ($j + $s[$i] + ord($key[$i % strlen($key)])) & 255;
            [$s[$i], $s[$j]] = [$s[$j], $s[$i]];
        }
        $out = '';
        for ($i = 0, $j = 0, $n = 0; $n < strlen($data); $n++) {
            $i = ($i + 1) & 255;
            $j = ($j + $s[$i]) & 255;
            [$s[$i], $s[$j]] = [$s[$j], $s[$i]];
            $out .= chr(ord($data[$n]) ^ $s[($s[$i] + $s[$j]) & 255]);
        }
        return $out;
    }

    /**
     * An FNB-style statement page set. Rows: [day-month, description, amount (+ in, - out), ?wrapped second line].
     * Balances, totals and layout follow FNB's PDF; $tamper adds R1 to one printed balance.
     */
    public static function fnbStatement(string $period, int $openingCents, array $rows, ?int $tamperRow = null): array
    {
        $fmt = fn(int $c) => number_format(abs($c) / 100, 2);
        $sfx = fn(int $c) => $c >= 0 ? 'Cr' : 'Dr';
        $bal = $openingCents;
        $body = [];
        [$in, $out, $nIn, $nOut] = [0, 0, 0, 0];
        foreach ($rows as $i => $r) {
            $bal += $r[2];
            $r[2] > 0 ? [$in += $r[2], $nIn++] : [$out -= $r[2], $nOut++];
            $printed = $bal + ($i === $tamperRow ? 100 : 0);
            $body[] = array_values(array_filter([[12.2, 0, $r[0]], $r[1] === '' ? null : [37.7, 0, $r[1]], [452.6, 0, $fmt($r[2])],
                $r[2] > 0 ? [472.8, 0, 'Cr'] : null, [511.0, 0, $fmt($printed)], $printed >= 0 ? [536.9, 0, 'Cr'] : null]));
            if (isset($r[3])) {
                $body[] = [[37.7, 0, $r[3]]];
            }
        }
        $page = [[60, 712, 'MR TEST PERSON'], [410.4, 567, 'FNB Fusion Private Clients Acc : 10000001234'],
            [383, 544, "Statement Period : $period"], [19.7, 510, 'Opening Balance'], [179.8, 510, $fmt($openingCents) . $sfx($openingCents)],
            [19.7, 501, 'Closing Balance'], [179.8, 501, $fmt($bal) . $sfx($bal)],
            [16.1, 434, 'Date'], [208.6, 434, 'Description'], [436.8, 434, 'Amount'], [498.7, 434, 'Balance'], [554.2, 434, 'Bank'], [548.2, 425, 'Charges']];
        $y = 411.6;
        foreach ($body as $line) {
            foreach ($line as $piece) {
                $page[] = [$piece[0], $y, $piece[2]];
            }
            $y -= 9.85;
        }
        $y -= 14;
        array_push($page, [45.4, $y, 'Closing Balance'], [504.7, $y, $fmt($bal) . $sfx($bal)],
            [103.9, $y - 28, "No. Credit Transactions $nIn"], [452.4, $y - 28, $fmt($in) . 'Cr'],
            [103.9, $y - 37, "No. Debit Transactions $nOut"], [452.4, $y - 37, $fmt($out) . 'Dr'],
            [12.7, 120, 'First National Bank - a division of FirstRand Bank Limited.']);
        return [$page];
    }
}
