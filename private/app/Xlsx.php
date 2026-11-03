<?php
/**
 * Import a household budget workbook kept in Excel, one sheet per month. Mirrors xlsx_import.py.
 *
 *     <Name> Salary | 48 800
 *     Type          | Amount | Notes
 *     Car           | 5 800  |
 *     Total         | =SUM(...)
 *
 * One block per person, an optional section column left of the item names, sheets named like
 * 'March 26'. Amounts that differ between sheets become dated changes; items missing from later
 * sheets end after the last month seen. Formulas aren't evaluated: Excel's cached values are used.
 */
declare(strict_types=1);

namespace Linen;

final class WorkbookError extends \InvalidArgumentException {}

final class Xlsx
{
    private const MAX_BYTES = 5 * 1024 * 1024;
    private const MONTHS = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];
    private const SALARY = '/^\s*(.+?)\s+salary\s*$/i';
    private const SAVING = '/saving|emergency|holiday|invest|dollar|tfsa|retire/i';
    private const CREDIT = '/credit|\bcc\b|loan|payflex|payjustnow|facility/i';
    private const DEBIT_CATS = ['Debt repayments', 'Insurance', 'Phone & internet', 'Subscriptions', 'Bank fees', 'Housing & utilities', 'Medical & health', 'Fitness & leisure'];

    private static function col_index(string $ref): int
    {
        preg_match('/^[A-Z]+/', $ref, $m);
        $n = 0;
        foreach (str_split($m[0]) as $ch) {
            $n = $n * 26 + (ord($ch) - 64);
        }
        return $n;
    }

    /** @return list<array{0:string,1:array<string,mixed>}> sheet name, grid keyed "row:col" */
    private static function read(string $data): array
    {
        if (strlen($data) > self::MAX_BYTES) {
            throw new WorkbookError('That workbook is too large (5 MB max).');
        }
        if (!class_exists(\ZipArchive::class)) {
            throw new WorkbookError('The PHP zip extension is needed to read Excel files.');
        }
        $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
        file_put_contents($tmp, $data);
        $z = new \ZipArchive();
        if ($z->open($tmp) !== true) {
            unlink($tmp);
            throw new WorkbookError("That doesn't look like an .xlsx workbook.");
        }
        try {
            $total = 0;
            for ($i = 0; $i < $z->numFiles; $i++) {
                $total += $z->statIndex($i)['size'];
            }
            if ($total > 60 * self::MAX_BYTES) {
                throw new WorkbookError('That workbook expands to an unreasonable size.');
            }
            $xml = function (string $name) use ($z) {
                $s = $z->getFromName($name);
                if ($s === false) {
                    throw new WorkbookError("That doesn't look like an .xlsx workbook.");
                }
                $x = simplexml_load_string($s, 'SimpleXMLElement', LIBXML_NONET);
                if ($x === false) {
                    throw new WorkbookError('The workbook is damaged.');
                }
                return $x;
            };
            $shared = [];
            if ($z->locateName('xl/sharedStrings.xml') !== false) {
                foreach ($xml('xl/sharedStrings.xml')->si as $si) {
                    $shared[] = self::text_of($si);
                }
            }
            $wb = $xml('xl/workbook.xml');
            $rels = [];
            foreach ($xml('xl/_rels/workbook.xml.rels')->Relationship as $r) {
                $rels[(string)$r['Id']] = (string)$r['Target'];
            }
            $out = [];
            foreach ($wb->sheets->sheet as $s) {
                $rid = (string)$s->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
                $target = $rels[$rid] ?? '';
                $path = 'xl/' . preg_replace('#^/?(xl/)?#', '', $target);
                if ($z->locateName($path) === false) {
                    continue;
                }
                $grid = [];
                foreach ($xml($path)->sheetData->row as $row) {
                    $r = (int)$row['r'];
                    foreach ($row->c as $c) {
                        $t = (string)$c['t'];
                        $v = isset($c->v) ? (string)$c->v : null;
                        if ($t === 'inlineStr') {
                            $val = self::text_of($c->is);
                        } elseif ($v === null) {
                            continue;
                        } elseif ($t === 's') {
                            $val = $shared[(int)$v] ?? '';
                        } elseif ($t === 'str' || $t === 'e') {
                            $val = $v;
                        } elseif ($t === 'b') {
                            $val = $v === '1';
                        } else {
                            $val = is_numeric($v) ? (float)$v : $v;
                        }
                        $grid[$r . ':' . self::col_index((string)$c['r'])] = $val;
                    }
                }
                $out[] = [(string)$s['name'], $grid];
            }
            return $out;
        } finally {
            $z->close();
            unlink($tmp);
        }
    }

    private static function text_of(\SimpleXMLElement $el): string
    {
        $s = '';
        foreach ($el->xpath('.//*[local-name()="t"]') as $t) {
            $s .= (string)$t;
        }
        return $s;
    }

    private static function sheet_month(string $name): ?string
    {
        if (!preg_match("/^\s*([a-z]{3})[a-z]*\.?\s+'?(\d{2}|\d{4})\s*$/i", $name, $m) || !isset(self::MONTHS[strtolower($m[1])])) {
            return null;
        }
        $y = (int)$m[2];
        $y = $y < 100 ? $y + 2000 : $y;
        return sprintf('%04d-%02d', $y, self::MONTHS[strtolower($m[1])]);
    }

    private static function num(mixed $v): ?int
    {
        if (is_bool($v) || $v === null) {
            return null;
        }
        if (is_float($v) || is_int($v)) {
            return Money::rnd($v * 100);
        }
        $s = preg_replace('/[R\s,]/', '', (string)$v);
        return is_numeric($s) ? Money::rnd((float)$s * 100) : null;
    }

    private static function text(mixed $v): string
    {
        if ($v === null || is_bool($v)) {
            return '';
        }
        if (is_float($v)) {
            return rtrim(rtrim(sprintf('%.6F', $v), '0'), '.');
        }
        return self::strip((string)$v);
    }

    /** Like Python's str.strip(): also removes non-breaking and other Unicode spaces Excel leaves in cells. */
    public static function strip(string $s): string
    {
        return preg_replace('/^[\s\x{00A0}\x{2000}-\x{200B}\x{3000}\x{FEFF}]+|[\s\x{00A0}\x{2000}-\x{200B}\x{3000}\x{FEFF}]+$/u', '', $s);
    }

    private static function parse_sheet(string $name, string $month, array $grid): array
    {
        $items = [];
        $maxRow = 0;
        $cells = [];
        foreach ($grid as $k => $v) {
            [$r, $c] = array_map('intval', explode(':', $k));
            $cells[] = [$r, $c, $v];
            $maxRow = max($maxRow, $r);
        }
        usort($cells, fn($a, $b) => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
        $salaryRows = [];
        foreach ($cells as [$r, $c, $v]) {
            if (is_string($v) && preg_match(self::SALARY, self::strip($v), $m)) {
                $salaryRows[] = [$r, $c, self::strip($m[1])];
            }
        }
        $g = fn(int $r, int $c) => $grid["$r:$c"] ?? null;
        foreach ($salaryRows as $i => [$srow, $lcol, $person]) {
            $endRow = $salaryRows[$i + 1][0] ?? $maxRow + 1;
            $headerRow = null;
            $amountCol = $lcol + 1;
            for ($r = $srow + 1; $r < min($srow + 5, $endRow); $r++) {
                if (str_starts_with(strtolower(self::text($g($r, $lcol))), 'type')) {
                    $headerRow = $r;
                    for ($c = $lcol + 1; str_starts_with(strtolower(self::text($g($r, $c))), 'amount'); $c++) {
                        $amountCol = $c;
                    }
                    break;
                }
            }
            $salary = self::num($g($srow, $amountCol)) ?: self::num($g($srow, $lcol + 1));
            if ($salary) {
                $items[] = ['person' => $person, 'section' => 'Income', 'name' => "$person salary", 'amount' => $salary, 'notes' => null, 'kind' => 'income'];
            }
            $section = 'Monthly';
            for ($r = ($headerRow ? $headerRow + 1 : $srow + 1); $r < $endRow; $r++) {
                $label = self::text($g($r, $lcol));
                if ($lcol > 1 && self::text($g($r, $lcol - 1)) !== '') {
                    $section = mb_substr(self::text($g($r, $lcol - 1)), 0, 40);
                }
                if ($label === '') {
                    continue;
                }
                $low = strtolower($label);
                if (str_starts_with($low, 'total')) {
                    break;
                }
                if (str_starts_with($low, 'type') || preg_match(self::SALARY, $label)) {
                    continue;
                }
                $amount = self::num($g($r, $amountCol));
                if ($amount === null || $amount < 0) {
                    continue;
                }
                $note = $g($r, $amountCol + 1);
                $note = is_string($note) ? self::text($note) : null;
                if ($note !== null && mb_strlen($note) <= 2) {  // ticks and initials from a "done" column aren't notes
                    $note = null;
                }
                $isSaving = preg_match(self::SAVING, $label) || str_starts_with(strtolower($section), 'saving');
                $items[] = ['person' => $person, 'section' => $section, 'name' => mb_substr($label, 0, 80), 'amount' => $amount,
                    'notes' => $note, 'kind' => $isSaving && !preg_match(self::CREDIT, $label) ? 'saving' : 'expense'];
            }
        }
        return ['sheet' => $name, 'month' => $month, 'items' => $items];
    }

    public static function parse(string $data): array
    {
        $plans = [];
        foreach (self::read($data) as [$name, $grid]) {
            $m = self::sheet_month($name);
            if ($m) {
                $p = self::parse_sheet($name, $m, $grid);
                if ($p['items']) {
                    $plans[$m] = $p; // the later sheet wins when two map to the same month
                }
            }
        }
        if (!$plans) {
            throw new WorkbookError("No monthly sheets found. Sheets should be named like 'March 26' and have '<Name> Salary' rows with items underneath.");
        }
        ksort($plans);
        return array_values($plans);
    }

    public static function preview(string $data): array
    {
        $plans = self::parse($data);
        $people = [];
        foreach ($plans as $p) {
            foreach ($p['items'] as $it) {
                if (!in_array($it['person'], $people, true)) {
                    $people[] = $it['person'];
                }
            }
        }
        return ['sheets' => array_map(fn($p) => ['sheet' => $p['sheet'], 'month' => $p['month'], 'items' => count($p['items'])], $plans), 'people' => $people];
    }

    private static function norm_name(string $name): string
    {
        return trim(preg_replace('/\W+/u', ' ', mb_strtolower($name)));
    }

    /** @return array{0:string,1:bool} category, is_debit_order */
    private static function classify(array $it): array
    {
        if ($it['kind'] === 'income') {
            return ['Income', false];
        }
        $cat = Categorise::guess_category($it['name']);
        if ($it['kind'] === 'saving' && $cat === 'Other') {
            $cat = 'Savings & investments';
        }
        return [$cat, str_contains(strtolower($it['section']), 'debit') || ($it['section'] === 'Monthly' && in_array($cat, self::DEBIT_CATS, true))];
    }

    /**
     * @param array<string,int> $personMap name in the workbook → member id
     * Idempotent: items already in the budget (same person, same name) are updated, not duplicated.
     * An item missing from a sheet ends the month before that sheet; if it reappears it resumes, with R0
     * for the months it was missing. Later sheets update an item's section, debit-order flag and (if it
     * was unrecognised) its category. Mirrors xlsx_import.import_workbook.
     */
    public static function import(Conn $db, int $hid, string $data, array $personMap, ?int $uid = null, ?string $fromMonth = null): array
    {
        $plans = array_values(array_filter(self::parse($data), fn($p) => !$fromMonth || $p['month'] >= $fromMonth));
        if (!$plans) {
            throw new WorkbookError('No sheets on or after that month.');
        }
        $valid = array_column(Budget::members($db, $hid), 'id');
        return $db->tx(function (Conn $db) use ($plans, $personMap, $valid, $hid, $uid) {
            $existing = [];
            foreach ($db->all('SELECT * FROM budget_lines WHERE household_id = ? ORDER BY id', [$hid]) as $r) {
                $existing[$r['member_id'] . '|' . self::norm_name($r['name'])] = $r;
            }
            $lines = [];
            $created = $changes = 0;
            $prevMonth = null;
            foreach ($plans as $p) {
                $seen = [];
                foreach ($p['items'] as $it) {
                    $mid = $personMap[$it['person']] ?? null;
                    if (!in_array($mid, $valid, true)) {
                        continue;
                    }
                    $key = $mid . '|' . self::norm_name($it['name']);
                    if (isset($seen[$key])) {
                        $key .= ' #' . count(array_filter(array_keys($seen), fn($k) => str_starts_with($k, "$mid|")));
                    }
                    $seen[$key] = true;
                    [$cat, $isDo] = self::classify($it);
                    $section = $it['kind'] === 'income' ? 'Income' : $it['section'];
                    if (!isset($lines[$key]) && isset($existing[$key])) {
                        $r = $existing[$key];
                        if ($r['start_month'] > $p['month'] && $it['amount'] === 0) {
                            continue; // still R0 before it started: nothing to back-date
                        }
                        $lines[$key] = ['id' => (int)$r['id'], 'last' => null, 'ended' => null, 'notes' => $r['notes'], 'section' => $r['section'],
                            'category' => $r['category'], 'debit' => (bool)$r['is_debit_order'], 'name' => $r['name']];
                        if ($r['start_month'] > $p['month']) {
                            $db->exec('UPDATE budget_lines SET start_month = ? WHERE id = ?', [$p['month'], $r['id']]);
                        }
                    }
                    if (!isset($lines[$key])) {
                        if ($it['amount'] === 0) {
                            continue;
                        }
                        $id = Budget::create_line($db, $hid, ['member_id' => $mid, 'kind' => $it['kind'], 'name' => $it['name'],
                            'amount_cents' => $it['amount'], 'start_month' => $p['month'], 'section' => $section, 'category' => $cat,
                            'is_debit_order' => $isDo, 'notes' => $it['notes']]);
                        $lines[$key] = ['id' => $id, 'last' => $p['month'], 'ended' => null, 'notes' => $it['notes'], 'section' => $section,
                            'category' => $cat, 'debit' => $isDo, 'name' => $it['name']];
                        $created++;
                        continue;
                    }
                    $ln = &$lines[$key];
                    if ($ln['ended']) { // came back after missing from one or more sheets
                        Budget::set_amount($db, $hid, $ln['id'], Money::add_months($ln['ended'], 1), 0, 'onward', 'not in the workbook');
                        $ln['ended'] = null;
                        $db->exec('UPDATE budget_lines SET end_month = NULL WHERE id = ?', [$ln['id']]);
                    }
                    if ($it['amount'] !== Budget::amount_on($db, $ln['id'], $p['month'])) { // compare with what's stored
                        Budget::set_amount($db, $hid, $ln['id'], $p['month'], $it['amount'], 'onward', "from sheet '{$p['sheet']}'");
                        $changes++;
                    }
                    $upd = [];
                    if ($section !== $ln['section']) {
                        $upd['section'] = $section;
                    }
                    if ($isDo !== $ln['debit']) {
                        $upd['is_debit_order'] = (int)$isDo;
                    }
                    if ($ln['category'] === 'Other' && $cat !== 'Other') {
                        $upd['category'] = $cat;
                        $upd['flexibility'] = Budget::default_flexibility($cat, $ln['name']);
                    }
                    if ($it['notes'] && $it['notes'] !== $ln['notes']) {
                        $upd['notes'] = mb_substr($it['notes'], 0, 200);
                    }
                    if ($upd) {
                        $db->exec('UPDATE budget_lines SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($upd))) . ' WHERE id = ?',
                            [...array_values($upd), $ln['id']]);
                        $ln['section'] = $upd['section'] ?? $ln['section'];
                        $ln['debit'] = isset($upd['is_debit_order']) ? (bool)$upd['is_debit_order'] : $ln['debit'];
                        $ln['category'] = $upd['category'] ?? $ln['category'];
                        $ln['notes'] = $upd['notes'] ?? $ln['notes'];
                    }
                    $ln['last'] = $p['month'];
                    unset($ln);
                }
                // Items in the previous sheet but not this one end the month before this sheet.
                if ($prevMonth) {
                    foreach ($lines as $key => &$ln) {
                        if (!isset($seen[$key]) && !$ln['ended'] && $ln['last'] === $prevMonth) {
                            $ln['ended'] = Money::add_months($p['month'], -1);
                            $db->exec('UPDATE budget_lines SET end_month = ? WHERE id = ?', [$ln['ended'], $ln['id']]);
                        }
                    }
                    unset($ln);
                }
                $prevMonth = $p['month'];
            }
            $last = end($plans)['month'];
            foreach ($lines as $ln) {
                if ($ln['last'] === $last) {
                    $db->exec('UPDATE budget_lines SET end_month = NULL WHERE id = ?', [$ln['id']]);
                }
            }
            $db->audit($hid, $uid, 'workbook.imported', count($plans) . " sheets, $created items, $changes amount changes");
            return ['sheets' => array_column($plans, 'sheet'), 'items_created' => $created, 'amount_changes' => $changes,
                'from_month' => $plans[0]['month'], 'to_month' => $last];
        });
    }
}
