<?php
declare(strict_types=1);

namespace Linen;

/**
 * Snapshots taken right before a small destructive change (a delete, a category choice), so the toast's
 * "Undo" can put it back without the app having to ask "Are you sure?" first. Snapshots expire after half an hour.
 */
final class Undo
{
    public const TTL = '-30 minutes';

    public static function stash(Conn $db, int $hid, string $kind, array $payload): string
    {
        $db->exec("DELETE FROM undo_items WHERE created_at < datetime('now', ?)", [self::TTL]);
        $token = bin2hex(random_bytes(16));
        $db->insert('INSERT INTO undo_items (household_id, token, kind, payload) VALUES (?, ?, ?, ?)',
            [$hid, $token, $kind, json_encode($payload, JSON_THROW_ON_ERROR)]);
        return $token;
    }

    /** Puts the snapshot back. Each token works once. */
    public static function restore(Conn $db, int $hid, string $token): array
    {
        return $db->tx(function (Conn $db) use ($hid, $token) {
            $row = $db->one("SELECT * FROM undo_items WHERE token = ? AND household_id = ? AND created_at >= datetime('now', ?)",
                [$token, $hid, self::TTL]);
            if (!$row) {
                throw new ApiError(410, "That can't be undone any more.");
            }
            $db->exec('DELETE FROM undo_items WHERE id = ?', [$row['id']]);
            $p = json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR);
            try {
                return match ($row['kind']) {
                    'line' => self::restore_line($db, $hid, $p),
                    'goal' => self::restore_goal($db, $hid, $p),
                    'debt' => self::restore_debt($db, $hid, $p),
                    'category' => self::restore_category($db, $hid, $p),
                    default => throw new ApiError(410, "That can't be undone any more."),
                };
            } catch (\PDOException) {
                // Something it depended on (a person, an account) is gone.
                throw new ApiError(409, "That can't be undone any more.");
            }
        });
    }

    private static function restore_line(Conn $db, int $hid, array $p): array
    {
        $line = $p['line'];
        $line['household_id'] = $hid;
        if ($line['goal_id'] !== null && !$db->val('SELECT 1 FROM goals WHERE id = ? AND household_id = ?', [$line['goal_id'], $hid])) {
            $line['goal_id'] = null;
        }
        $id = self::insert_row($db, 'budget_lines', $line);
        foreach ($p['amounts'] as $a) {
            $a['line_id'] = $id;
            self::insert_row($db, 'budget_amounts', $a);
        }
        foreach ($p['status'] as $s) {
            $s['line_id'] = $id;
            self::insert_row($db, 'line_status', $s);
        }
        return ['kind' => 'line', 'id' => $id];
    }

    private static function restore_goal(Conn $db, int $hid, array $p): array
    {
        $goal = $p['goal'];
        $goal['household_id'] = $hid;
        $id = self::insert_row($db, 'goals', $goal);
        if ($p['line_ids']) {
            $in = implode(',', array_fill(0, count($p['line_ids']), '?'));
            $db->exec("UPDATE budget_lines SET goal_id = ? WHERE household_id = ? AND goal_id IS NULL AND id IN ($in)",
                [$id, $hid, ...array_map('intval', $p['line_ids'])]);
        }
        return ['kind' => 'goal', 'id' => $id];
    }

    private static function restore_debt(Conn $db, int $hid, array $p): array
    {
        $debt = $p['debt'];
        $debt['household_id'] = $hid;
        return ['kind' => 'debt', 'id' => self::insert_row($db, 'debts', $debt)];
    }

    private static function restore_category(Conn $db, int $hid, array $p): array
    {
        $rules = [];
        foreach ($p['txns'] as $t) {
            $rid = $t['rule_id'];
            if ($rid !== null) {
                $rules[$rid] ??= (bool)$db->val('SELECT 1 FROM rules WHERE id = ?', [$rid]);
                $rid = $rules[$rid] ? $rid : null;
            }
            $db->exec('UPDATE transactions SET category = ?, category_source = ?, rule_id = ?, is_transfer = ? WHERE id = ? AND household_id = ?',
                [$t['category'], $t['category_source'], $rid, (int)$t['is_transfer'], (int)$t['id'], $hid]);
        }
        $r = $p['rule'];
        if ($r && $r['prev'] === null) {
            $db->exec('DELETE FROM rules WHERE id = ? AND household_id = ?', [$r['id'], $hid]);
        } elseif ($r) {
            $db->exec('UPDATE rules SET category = ?, priority = ?, source = ? WHERE id = ? AND household_id = ?',
                [$r['prev']['category'], $r['prev']['priority'], $r['prev']['source'], $r['id'], $hid]);
        }
        return ['kind' => 'category', 'updated' => count($p['txns'])];
    }

    /** Re-inserts a row as it was, keeping its id when nothing has taken it since. */
    private static function insert_row(Conn $db, string $table, array $row): int
    {
        if (isset($row['id']) && $db->val("SELECT 1 FROM $table WHERE id = ?", [$row['id']])) {
            unset($row['id']);
        }
        $cols = array_keys($row);
        return (int)$db->insert("INSERT INTO $table (" . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')',
            array_values($row));
    }
}
