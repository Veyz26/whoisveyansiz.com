"""POPIA data-subject rights and retention.

- Access (s23): export_household() returns everything held about the household.
- Correction (s24): every record is editable in the app.
- Deletion (s24): delete_household() hard-deletes the household and all its data;
  leave_household() removes a partner's access and account.
- Retention (s14): purge_old_transactions() drops statement lines older than the
  household's retention setting; run on startup and daily.
"""
from __future__ import annotations

import sqlite3
from datetime import date

from .db import audit
from .money import add_months

EXPORT_TABLES = {
    "household": "SELECT id, name, created_at, plan, subscription_status, trial_ends_on, paid_until, retention_months "
                 "FROM households WHERE id = :h",
    "members": "SELECT id, name, sort FROM members WHERE household_id = :h",
    "users": "SELECT u.id, u.email, u.name, u.created_at, u.last_login_at, m.role FROM users u "
             "JOIN memberships m ON m.user_id = u.id WHERE m.household_id = :h",
    "consents": "SELECT c.user_id, c.purpose, c.version, c.granted, c.created_at FROM consents c "
                "JOIN memberships m ON m.user_id = c.user_id WHERE m.household_id = :h",
    "budget_lines": "SELECT * FROM budget_lines WHERE household_id = :h",
    "budget_amounts": "SELECT a.* FROM budget_amounts a JOIN budget_lines l ON l.id = a.line_id WHERE l.household_id = :h",
    "line_status": "SELECT s.* FROM line_status s JOIN budget_lines l ON l.id = s.line_id WHERE l.household_id = :h",
    "goals": "SELECT * FROM goals WHERE household_id = :h",
    "accounts": "SELECT id, member_id, bank, label, last4, kind, created_at FROM accounts WHERE household_id = :h",
    "transactions": "SELECT id, account_id, posted_on, description, amount_cents, category, category_source, "
                    "is_transfer FROM transactions WHERE household_id = :h",
    "rules": "SELECT pattern, match, direction, category, source, created_at FROM rules WHERE household_id = :h",
    "debts": "SELECT * FROM debts WHERE household_id = :h",
    "api_tokens": "SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_tokens WHERE household_id = :h",
    "audit_log": "SELECT user_id, action, detail, created_at FROM audit_log WHERE household_id = :h",
}


def export_household(conn: sqlite3.Connection, household_id: int, user_id: int | None) -> dict:
    data = {name: [dict(r) for r in conn.execute(sql, {"h": household_id})] for name, sql in EXPORT_TABLES.items()}
    with conn:
        audit(conn, household_id, user_id, "data.exported", None)
    data["_about"] = {
        "exported_on": date.today().isoformat(),
        "note": "All personal information this service holds for your household. Amounts are in cents (ZAR). "
                "Passwords are stored only as one-way hashes and are not included.",
    }
    return data


def delete_household(conn: sqlite3.Connection, household_id: int) -> None:
    """Hard delete. Cascades remove every row tied to the household; users who belong to no
    other household are deleted too."""
    with conn:
        user_ids = [r[0] for r in conn.execute("SELECT user_id FROM memberships WHERE household_id = ?", (household_id,))]
        conn.execute("DELETE FROM rules WHERE household_id = ?", (household_id,))
        conn.execute("DELETE FROM households WHERE id = ?", (household_id,))
        for uid in user_ids:
            if not conn.execute("SELECT 1 FROM memberships WHERE user_id = ?", (uid,)).fetchone():
                conn.execute("DELETE FROM users WHERE id = ?", (uid,))
        # Keep a content-free record that a deletion happened (accountability, s8).
        audit(conn, None, None, "household.deleted", f"household #{household_id}")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.execute("VACUUM")  # don't leave deleted pages readable in the file


def leave_household(conn: sqlite3.Connection, household_id: int, user_id: int) -> None:
    with conn:
        conn.execute("UPDATE members SET user_id = NULL WHERE household_id = ? AND user_id = ?", (household_id, user_id))
        conn.execute("DELETE FROM memberships WHERE household_id = ? AND user_id = ?", (household_id, user_id))
        if not conn.execute("SELECT 1 FROM memberships WHERE user_id = ?", (user_id,)).fetchone():
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        audit(conn, household_id, None, "user.left", None)


def purge_old_transactions(conn: sqlite3.Connection) -> int:
    today = date.today().isoformat()[:7]
    removed = 0
    with conn:
        for h in conn.execute("SELECT id, retention_months FROM households").fetchall():
            cutoff = add_months(today, -h["retention_months"]) + "-01"
            cur = conn.execute("DELETE FROM transactions WHERE household_id = ? AND posted_on < ?", (h["id"], cutoff))
            if cur.rowcount:
                audit(conn, h["id"], None, "retention.purged", f"{cur.rowcount} transactions before {cutoff}")
                removed += cur.rowcount
    return removed


def audit_entries(conn: sqlite3.Connection, household_id: int, limit: int = 60) -> list[dict]:
    return [dict(r) for r in conn.execute(
        """SELECT a.action, a.detail, a.created_at, u.name AS user_name FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id WHERE a.household_id = ? ORDER BY a.id DESC LIMIT ?""",
        (household_id, limit))]
