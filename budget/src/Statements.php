<?php
/**
 * FNB and Capitec CSV statements: parse, normalise and import with de-duplication.
 * Mirrors parsers/*.py and importer.py.
 */
declare(strict_types=1);

namespace Linen;

final class StatementFormatError extends \InvalidArgumentException {}

final class Statements
{
    // ------------------------------------------------------------------ parsing
    public static function read_rows(string $content): array
    {
        if (!mb_check_encoding($content, 'UTF-8')) {
            $content = mb_convert_encoding($content, 'UTF-8', 'Windows-1252');
        }
        $content = preg_replace('/^\x{FEFF}/u', '', $content);
        $sample = substr($content, 0, 4096);
        $delims = [',' => substr_count($sample, ','), ';' => substr_count($sample, ';'), "\t" => substr_count($sample, "\t")];
        arsort($delims);
        $delim = array_key_first($delims);
        $h = fopen('php://temp', 'r+');
        fwrite($h, $content);
        rewind($h);
        $rows = [];
        while (($row = fgetcsv($h, null, $delim, '"', '')) !== false) {
            if ($row === [null]) {
                $rows[] = [];
                continue;
            }
            $rows[] = array_map(fn($c) => trim(trim(trim((string)$c), "'\"")), $row);
        }
        fclose($h);
        return $rows;
    }

    private static function norm(string $c): string
    {
        return strtolower(preg_replace('/\s+/', ' ', trim($c)));
    }

    public static function find_header(array $rows): array
    {
        foreach (array_slice($rows, 0, 60, true) as $i => $row) {
            $cells = array_map([self::class, 'norm'], $row);
            $hasDate = (bool)array_filter($cells, fn($c) => str_contains($c, 'date'));
            $hasDesc = (bool)array_intersect($cells, ['description', 'details', 'narrative', 'transaction description']);
            $hasAmt = in_array('amount', $cells, true) || (in_array('money in', $cells, true) && in_array('money out', $cells, true));
            if ($hasDate && $hasDesc && $hasAmt) {
                return [$i, $cells];
            }
        }
        throw new StatementFormatError("Couldn't find a header row with Date, Description and Amount columns.");
    }

    private static function col(array $header, array $names, bool $required = true): ?int
    {
        foreach ($names as $n) {
            $i = array_search($n, $header, true);
            if ($i !== false) {
                return $i;
            }
        }
        if ($required) {
            throw new StatementFormatError("Missing column: {$names[0]}");
        }
        return null;
    }

    private static function cell(array $row, ?int $i): string
    {
        return $i !== null && isset($row[$i]) ? (string)$row[$i] : '';
    }

    private static function last4(?string $raw): ?string
    {
        $d = preg_replace('/\D/', '', $raw ?? '');
        return strlen($d) >= 4 ? substr($d, -4) : null;
    }

    public static function detect_bank(string $content): string
    {
        [, $header] = self::find_header(self::read_rows($content));
        return (in_array('money in', $header, true) || in_array('money out', $header, true)) ? 'capitec' : 'fnb';
    }

    /** @return array{bank:string, transactions:array, account_last4:?string, skipped_rows:int} */
    public static function parse(string $content, string $bank = 'auto'): array
    {
        if (str_starts_with(ltrim($content), '%PDF')) {
            throw new StatementFormatError("PDF statements aren't supported yet. Export CSV from the FNB or Capitec app instead.");
        }
        if ($bank === 'auto') {
            $bank = self::detect_bank($content);
        }
        return match ($bank) {
            'fnb' => self::parse_fnb($content),
            'capitec' => self::parse_capitec($content),
            default => throw new StatementFormatError('Unknown bank'),
        };
    }

    private static function parse_fnb(string $content): array
    {
        $rows = self::read_rows($content);
        [$h, $header] = self::find_header($rows);
        $st = ['bank' => 'fnb', 'transactions' => [], 'account_last4' => null, 'skipped_rows' => 0];
        foreach (array_slice($rows, 0, $h) as $row) {
            $joined = strtolower(implode(' ', $row));
            if (str_contains($joined, 'account') && preg_match_all('/\d[\d\s]{3,}/', $joined, $m)) {
                $st['account_last4'] = self::last4(end($m[0]));
            }
        }
        $cDate = self::col($header, ['date', 'transaction date', 'posting date']);
        $cAmt = self::col($header, ['amount']);
        $cBal = self::col($header, ['balance'], false);
        $cDesc = self::col($header, ['description', 'details', 'narrative']);
        $cRef = self::col($header, ['reference'], false);
        foreach (array_slice($rows, $h + 1) as $row) {
            if (!array_filter($row, fn($c) => $c !== '')) {
                continue;
            }
            try {
                $amount = Money::parse_amount(self::cell($row, $cAmt));
                $date = Money::parse_date(self::cell($row, $cDate));
            } catch (ParseError) {
                $st['skipped_rows']++;
                continue;
            }
            if ($amount === null) {
                $st['skipped_rows']++;
                continue;
            }
            $desc = self::cell($row, $cDesc);
            $extra = self::cell($row, $cRef);
            if ($extra !== '' && !str_contains(strtolower($desc), strtolower($extra))) {
                $desc = "$desc $extra";
            }
            $st['transactions'][] = ['posted_on' => $date, 'description' => $desc, 'amount_cents' => $amount,
                'balance_cents' => $cBal !== null ? Money::parse_amount(self::cell($row, $cBal)) : null, 'bank_category' => null];
        }
        if (!$st['transactions']) {
            throw new StatementFormatError('No transactions found in FNB file.');
        }
        return $st;
    }

    private static function parse_capitec(string $content): array
    {
        $rows = self::read_rows($content);
        [$h, $header] = self::find_header($rows);
        $st = ['bank' => 'capitec', 'transactions' => [], 'account_last4' => null, 'skipped_rows' => 0];
        $cDate = self::col($header, ['transaction date', 'posting date', 'date']);
        $cDesc = self::col($header, ['description', 'original description']);
        $cOrig = self::col($header, ['original description'], false);
        $cCat = self::col($header, ['category'], false);
        $cIn = self::col($header, ['money in'], false);
        $cOut = self::col($header, ['money out'], false);
        $cAmt = self::col($header, ['amount'], false);
        $cFee = self::col($header, ['fee', 'fees'], false);
        $cBal = self::col($header, ['balance'], false);
        $cAcct = self::col($header, ['account'], false);
        if ($cAmt === null && ($cIn === null || $cOut === null)) {
            throw new StatementFormatError('Capitec file needs Money In/Money Out or Amount columns.');
        }
        foreach (array_slice($rows, $h + 1) as $row) {
            if (!array_filter($row, fn($c) => $c !== '')) {
                continue;
            }
            try {
                $date = Money::parse_date(self::cell($row, $cDate));
                if ($cAmt !== null && self::cell($row, $cAmt) !== '') {
                    $amount = Money::parse_amount(self::cell($row, $cAmt)) ?? 0;
                } else {
                    $amount = abs(Money::parse_amount(self::cell($row, $cIn)) ?? 0) - abs(Money::parse_amount(self::cell($row, $cOut)) ?? 0);
                }
                $fee = $cFee !== null ? Money::parse_amount(self::cell($row, $cFee)) : null;
            } catch (ParseError) {
                $st['skipped_rows']++;
                continue;
            }
            if ($st['account_last4'] === null && $cAcct !== null) {
                $st['account_last4'] = self::last4(self::cell($row, $cAcct));
            }
            $desc = self::cell($row, $cDesc) ?: self::cell($row, $cOrig);
            $cat = self::cell($row, $cCat) ?: null;
            $bal = $cBal !== null ? Money::parse_amount(self::cell($row, $cBal)) : null;
            if ($amount) {
                $st['transactions'][] = ['posted_on' => $date, 'description' => $desc, 'amount_cents' => $amount, 'balance_cents' => $bal, 'bank_category' => $cat];
            }
            if ($fee) {
                $st['transactions'][] = ['posted_on' => $date, 'description' => "Fee: $desc", 'amount_cents' => -abs($fee), 'balance_cents' => null, 'bank_category' => 'Fees'];
            }
            if (!$amount && !$fee) {
                $st['skipped_rows']++;
            }
        }
        if (!$st['transactions']) {
            throw new StatementFormatError('No transactions found in Capitec file.');
        }
        return $st;
    }

    // ------------------------------------------------------------------ normalising
    private const CARDLIKE = '/(?<![\dA-Za-z])(?:\d{4}[ -]?[\d*xX•]{4}[ -]?[\d*xX•]{4}[ -]?\d{1,7}|\d{4,6}[*xX•]+\d{4}|\d{9,})(?![\dA-Za-z])/u';
    private const NOISE = ['POS PURCHASE', 'CARD PURCHASE', 'PURCHASE', 'POS', 'DEBIT ORDER', 'DEBICHECK',
        'FNB APP PAYMENT TO', 'FNB APP TRANSFER TO', 'FNB APP TRANSFER FROM', 'FNB APP PREPAID',
        'PAYMENT TO', 'PAYMENT FROM', 'PAYMENT RECEIVED', 'INTERNET PMT TO', 'SETTLEMENT',
        'RECURRING CARD PURCHASE', 'ONLINE PURCHASE', 'FEE:', 'MAGTAPE DEBIT', 'MAGTAPE CREDIT'];

    /** Card numbers (masked or not) and other long digit runs keep only their last 4 digits. */
    public static function sanitise(string $desc): string
    {
        $desc = preg_replace_callback(self::CARDLIKE, function ($m) {
            $d = preg_replace('/\D/', '', $m[0]);
            return strlen($d) >= 4 ? '****' . substr($d, -4) : '****';
        }, $desc);
        return trim(preg_replace('/\s+/u', ' ', $desc));
    }

    public static function merchant_key(string $desc): string
    {
        $s = trim(ltrim(mb_strtoupper($desc), '#'));
        do {
            $changed = false;
            foreach (self::NOISE as $p) {
                if (str_starts_with($s, "$p ") || str_starts_with($s, "$p:") || $s === $p) {
                    $s = trim(substr($s, strlen($p)), " -:");
                    $changed = true;
                }
            }
        } while ($changed);
        $s = preg_replace('/\*{2,}\d{0,4}/', ' ', $s);
        $s = preg_replace('/\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b/', ' ', $s);
        $s = preg_replace('/\b[A-Z]*\d[A-Z\d]*\b/', ' ', $s);
        $s = preg_replace("/[^A-Z&' ]/", ' ', $s);
        $words = preg_split('/\s+/', trim($s), -1, PREG_SPLIT_NO_EMPTY);
        return $words ? implode(' ', array_slice($words, 0, 3)) : mb_substr(mb_strtoupper($desc), 0, 24);
    }

    // ------------------------------------------------------------------ importing
    public static function import(Conn $db, int $householdId, string $content, ?int $memberId = null, string $bank = 'auto',
                                  ?string $accountLabel = null, string $kind = 'transactional', ?string $filename = null): array
    {
        $st = self::parse($content, $bank);
        return $db->tx(function (Conn $db) use ($st, $householdId, $memberId, $accountLabel, $kind, $filename) {
            $who = null;
            if ($memberId !== null) {
                $who = $db->val('SELECT name FROM members WHERE id = ? AND household_id = ?', [$memberId, $householdId]);
                if ($who === null) {
                    throw new \InvalidArgumentException('Unknown person');
                }
            }
            // Without a name, include the person so two people's unlabelled statements don't merge.
            $label = trim((string)$accountLabel) ?: strtoupper($st['bank']) . ' ' . ($st['account_last4'] ?? 'account') . ($who ? " ($who)" : '');
            $label = mb_substr($label, 0, 40);
            $acct = $db->one('SELECT id, last4, member_id FROM accounts WHERE household_id = ? AND bank = ? AND label = ?',
                [$householdId, $st['bank'], $label]);
            if ($acct) {
                $accountId = (int)$acct['id'];
                if ($st['account_last4'] && !$acct['last4']) {
                    $db->exec('UPDATE accounts SET last4 = ? WHERE id = ?', [$st['account_last4'], $accountId]);
                }
                $owner = $acct['member_id'] === null ? null : (int)$acct['member_id'];
                if ($owner !== $memberId) { // never move someone's account (and its history) to someone else
                    $ownerName = $owner === null ? 'joint' : $db->val('SELECT name FROM members WHERE id = ?', [$owner]) . "'s";
                    throw new \InvalidArgumentException("\"$label\" is already $ownerName account. Choose that person, or use a different account name.");
                }
            } else {
                $accountId = $db->insert('INSERT INTO accounts (household_id, member_id, bank, label, last4, kind) VALUES (?, ?, ?, ?, ?, ?)',
                    [$householdId, $memberId, $st['bank'], $label, $st['account_last4'], $kind]);
            }
            $importId = $db->insert('INSERT INTO imports (household_id, account_id, filename, rows_total, rows_added, rows_duplicate) VALUES (?, ?, ?, ?, 0, 0)',
                [$householdId, $accountId, $filename, count($st['transactions'])]);

            // Identical rows in one file (two R35 coffees on one day) are told apart by occurrence number,
            // so re-importing the same or an overlapping file is idempotent.
            $seen = [];
            $added = [];
            foreach ($st['transactions'] as $t) {
                $desc = self::sanitise($t['description']);
                $base = $t['posted_on'] . '|' . $t['amount_cents'] . '|' . mb_strtoupper($desc);
                $seen[$base] = ($seen[$base] ?? 0) + 1;
                $fp = hash('sha256', "$accountId|$base|{$seen[$base]}");
                $n = $db->exec('INSERT OR IGNORE INTO transactions (household_id, account_id, import_id, posted_on, description, merchant,
                                amount_cents, balance_cents, bank_category, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$householdId, $accountId, $importId, $t['posted_on'], $desc, self::merchant_key($desc), $t['amount_cents'],
                     $t['balance_cents'], $t['bank_category'], $fp]);
                if ($n) {
                    $added[] = (int)$db->pdo->lastInsertId();
                }
            }
            $dupes = count($st['transactions']) - count($added);
            $db->exec('UPDATE imports SET rows_added = ?, rows_duplicate = ? WHERE id = ?', [count($added), $dupes, $importId]);
            Categorise::apply_rules($db, $householdId, $added);
            self::link_transfers($db, $householdId);
            $dates = array_column($st['transactions'], 'posted_on');
            sort($dates);
            return ['account_id' => $accountId, 'bank' => $st['bank'], 'rows_total' => count($st['transactions']),
                'rows_added' => count($added), 'rows_duplicate' => $dupes, 'skipped_rows' => $st['skipped_rows'],
                'first_date' => $dates[0] ?? null, 'last_date' => end($dates) ?: null];
        });
    }

    /** Pair money moving between the household's own accounts and mark both legs as transfers. */
    public static function link_transfers(Conn $db, int $householdId, int $windowDays = 3): int
    {
        $outs = $db->all("SELECT id, account_id, posted_on, amount_cents FROM transactions
                          WHERE household_id = ? AND amount_cents < 0 AND is_transfer = 0 AND category_source != 'user'", [$householdId]);
        $linked = 0;
        foreach ($outs as $o) {
            $d = new \DateTimeImmutable($o['posted_on']);
            $match = $db->one("SELECT id FROM transactions
                WHERE household_id = ? AND amount_cents = ? AND account_id != ? AND is_transfer = 0
                  AND category_source != 'user' AND posted_on BETWEEN ? AND ?
                ORDER BY abs(julianday(posted_on) - julianday(?)) LIMIT 1",
                [$householdId, -$o['amount_cents'], $o['account_id'], $d->modify("-$windowDays days")->format('Y-m-d'),
                 $d->modify("+$windowDays days")->format('Y-m-d'), $o['posted_on']]);
            if ($match) {
                $db->exec("UPDATE transactions SET is_transfer = 1, category = 'Transfers', category_source = 'rule' WHERE id IN (?, ?)",
                    [$o['id'], $match['id']]);
                $linked++;
            }
        }
        return $linked;
    }
}
