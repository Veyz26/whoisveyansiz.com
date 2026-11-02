<?php
/** Money and date helpers. All money is integer cents (ZAR); never floats. Mirrors money.py. */
declare(strict_types=1);

namespace Linen;

final class ParseError extends \InvalidArgumentException {}

final class Money
{
    /** Signed cents from '-1 234.56', '1,234.56', '1234,56', '150.00 Cr', '150.00 Dr', '(150.00)', 'R 99.00'. */
    public static function parse_amount(?string $raw): ?int
    {
        if ($raw === null) {
            return null;
        }
        $s = trim($raw);
        if ($s === '' || $s === '-' || $s === '--') {
            return null;
        }
        $sign = 1;
        $low = strtolower($s);
        if (str_ends_with($low, 'cr')) {
            $s = substr($s, 0, -2);
        } elseif (str_ends_with($low, 'dr')) {
            $s = substr($s, 0, -2);
            $sign = -1;
        }
        if (str_starts_with($s, '(') && str_ends_with($s, ')')) {
            $s = substr($s, 1, -1);
            $sign = -$sign;
        }
        $s = preg_replace("/[R\\s\u{00a0}'’]/u", '', $s);
        if (str_starts_with($s, '-')) {
            $s = substr($s, 1);
            $sign = -$sign;
        } elseif (str_ends_with($s, '-')) {
            $s = substr($s, 0, -1);
            $sign = -$sign;
        }
        $s = ltrim($s, '+');
        if (str_contains($s, ',') && str_contains($s, '.')) {
            $s = str_replace(',', '', $s);
        } elseif (str_contains($s, ',')) {
            $pos = strrpos($s, ',');
            $tail = substr($s, $pos + 1);
            $head = str_replace(',', '', substr($s, 0, $pos));
            $s = (strlen($tail) === 1 || strlen($tail) === 2) ? "$head.$tail" : str_replace(',', '', $s);
        }
        if (!preg_match('/^\d{0,12}(\.\d*)?$/', $s) || $s === '' || $s === '.') {  // at most R999 999 999 999
            throw new ParseError("Not an amount: $raw");
        }
        // Exact decimal → cents, rounding half up on the third decimal (no floats).
        [$int, $frac] = array_pad(explode('.', $s, 2), 2, '');
        $frac = str_pad($frac, 3, '0');
        $cents = (int)($int === '' ? '0' : $int) * 100 + (int)substr($frac, 0, 2);
        if ((int)$frac[2] >= 5) {
            $cents += 1;
        }
        return $sign * $cents;
    }

    private const MONTHS = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8,
        'sep' => 9, 'sept' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];

    /**
     * Returns YYYY-MM-DD. Accepts year-first (2026/10/05, 2026-10-05, 20261005) and South African
     * day-first dates (05/10/2026, 05.10.26, 05 Oct 2026, 5-October-26). Two-digit years mean 20xx.
     * Years outside 2000..next year are rejected rather than stored, so a misread can't be silently
     * purged by retention later.
     */
    public static function parse_date(string $raw): string
    {
        $s = preg_replace('/\s+/', ' ', trim($raw));
        $s = explode('T', $s)[0];
        $s = preg_replace('/ \d{1,2}:\d{2}(:\d{2})?$/', '', $s);
        if (preg_match('/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/', $s, $m) || preg_match('/^(\d{4})(\d{2})(\d{2})$/', $s, $m)) {
            [$y, $mo, $d] = [(int)$m[1], (int)$m[2], (int)$m[3]];
        } elseif (preg_match('/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/', $s, $m)) {
            [$d, $mo, $y] = [(int)$m[1], (int)$m[2], (int)$m[3]];
        } elseif (preg_match('/^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2}|\d{4})$/', $s, $m)) {
            $name = strtolower($m[2]);
            $mo = self::MONTHS[$name] ?? self::MONTHS[substr($name, 0, 3)] ?? 0;
            if ($mo && strlen($name) > 4 && strtolower(date('F', mktime(0, 0, 0, $mo, 1))) !== $name) {
                $mo = 0; // a long name must be the full month name
            }
            [$d, $y] = [(int)$m[1], (int)$m[3]];
        } else {
            throw new ParseError("Unrecognised date: $raw");
        }
        if ($y < 100) {
            $y += 2000;
        }
        if (!$mo || !checkdate($mo, $d, $y) || $y < 2000 || $y > (int)date('Y') + 1) {
            throw new ParseError("Unrecognised date: $raw");
        }
        return sprintf('%04d-%02d-%02d', $y, $mo, $d);
    }

    /** Validates a cents amount from user input: a whole number between $min and R10 billion. */
    public static function cents(mixed $v, int $min = 0): int
    {
        if (!(is_int($v) || (is_string($v) && preg_match('/^-?\d{1,13}$/', $v))) || (int)$v < $min || (int)$v > 1_000_000_000_000) {
            throw new \InvalidArgumentException('Amounts must be whole cents between R0 and R10 billion');
        }
        return (int)$v;
    }

    /** R1 234.56, or R1 234 when there are no cents. */
    public static function format_zar(int $cents, bool $signed = false): string
    {
        $sign = $cents < 0 ? '-' : ($signed && $cents > 0 ? '+' : '');
        $abs = abs($cents);
        $rands = intdiv($abs, 100);
        $c = $abs % 100;
        return $sign . 'R' . number_format($rands, 0, '.', "\u{00a0}") . ($c ? sprintf('.%02d', $c) : '');
    }

    public static function add_months(string $month, int $delta): string
    {
        [$y, $m] = array_map('intval', explode('-', $month));
        $idx = $y * 12 + ($m - 1) + $delta;
        return sprintf('%04d-%02d', intdiv($idx, 12), $idx % 12 + 1);
    }

    /** Python-compatible round (half to even), so results match the reference implementation. */
    public static function rnd(float|int $x): int
    {
        return (int)round($x, 0, PHP_ROUND_HALF_EVEN);
    }

    public static function this_month(): string
    {
        return date('Y-m');
    }

    public static function month_name(string $m): string
    {
        [$y, $mo] = array_map('intval', explode('-', $m));
        return date('F', mktime(0, 0, 0, $mo, 1, $y)) . " $y";
    }

    public static function median(array $xs): float
    {
        sort($xs);
        $n = count($xs);
        return $n % 2 ? (float)$xs[intdiv($n, 2)] : ($xs[$n / 2 - 1] + $xs[$n / 2]) / 2;
    }
}
