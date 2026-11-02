"""The monthly budget: each person's income, debit orders, monthly items and savings.

Lines carry forward month to month. Amounts have a history (budget_amounts): the amount
for a month is the latest change effective on or before it, so a debit-order increase is
recorded once, from the month it starts, and earlier months keep their old amount.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import date

from .categorise import CATEGORIES, GROUPS, guess_category
from .money import add_months

KINDS = ("income", "expense", "saving", "transfer")
FLEX = ("fixed", "reducible", "discretionary")
# "Other" is deliberately NOT discretionary: an item we don't recognise could be a loan instalment or medication.
DISCRETIONARY_CATS = {"Eating out", "Subscriptions", "Fitness & leisure", "Shopping", "Entertainment"}
# Never suggested as cuts, whatever their flexibility: contracts, minimum repayments, health, giving, housing.
NEVER_CUT_CATS = {"Debt repayments", "Insurance", "Medical & health", "Giving", "Housing & utilities", "Bank fees",
                  "Interest charged", "Other"}
CANCELLABLE_DEBIT_CATS = {"Subscriptions", "Fitness & leisure"}
REDUCIBLE_CATS = {"Groceries", "Fuel & transport", "Personal care", "Cash withdrawals"}
_REDUCIBLE_NAMES = re.compile(r"UTILIT|ELECTRIC|WATER|FUEL|PETROL|FOOD|GROCER|TOILETR|DATE|CLEAN", re.I)
_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def this_month() -> str:
    return date.today().isoformat()[:7]


def valid_month(m: str | None) -> str:
    if not m or not _MONTH.match(m):
        raise ValueError("Month must be YYYY-MM")
    return m


def default_flexibility(category: str, name: str) -> str:
    if category in REDUCIBLE_CATS or (category == "Other" and _REDUCIBLE_NAMES.search(name)):
        return "reducible"
    if category in DISCRETIONARY_CATS:
        return "discretionary"
    if _REDUCIBLE_NAMES.search(name):
        return "reducible"
    return "fixed"


def members(conn: sqlite3.Connection, household_id: int) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT id, name, user_id FROM members WHERE household_id = ? ORDER BY sort, id", (household_id,))]


def _member_ok(conn, household_id: int, member_id: int | None) -> bool:
    return member_id is not None and conn.execute(
        "SELECT 1 FROM members WHERE id = ? AND household_id = ?", (member_id, household_id)).fetchone() is not None


def _line(conn, household_id: int, line_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM budget_lines WHERE id = ? AND household_id = ?",
                       (line_id, household_id)).fetchone()
    if not row:
        raise LookupError("Budget line not found")
    return row


def create_line(conn: sqlite3.Connection, household_id: int, *, member_id: int, kind: str, name: str,
                amount_cents: int, start_month: str, section: str | None = None, category: str | None = None,
                is_debit_order: bool = False, flexibility: str | None = None, notes: str | None = None,
                end_month: str | None = None, to_member_id: int | None = None) -> int:
    name = (name or "").strip()[:80]
    if not name:
        raise ValueError("Give the item a name")
    if kind not in KINDS:
        raise ValueError("Unknown kind")
    if not _member_ok(conn, household_id, member_id):
        raise ValueError("Unknown person")
    if kind == "transfer" and (not _member_ok(conn, household_id, to_member_id) or to_member_id == member_id):
        raise ValueError("A transfer needs a different person to receive it")
    if amount_cents < 0:
        raise ValueError("Amount can't be negative")
    valid_month(start_month)
    if end_month:
        valid_month(end_month)
        if end_month < start_month:
            raise ValueError("End month is before the start month")
    if kind == "income":
        category = "Income"
    elif kind == "transfer":
        category = "Transfers"
    elif kind == "saving":
        category = category or "Savings & investments"
    category = category if category in CATEGORIES else guess_category(name)
    if flexibility not in FLEX:
        flexibility = default_flexibility(category, name)
        if is_debit_order and category == "Other":  # an unrecognised debit order is a commitment
            flexibility = "fixed"
    section = (section or {"income": "Income", "saving": "Savings", "transfer": "Transfers"}.get(kind)
               or ("Debit orders" if is_debit_order else "Monthly"))[:40]
    sort = conn.execute("SELECT COALESCE(MAX(sort), 0) + 1 FROM budget_lines WHERE household_id = ?",
                        (household_id,)).fetchone()[0]
    with conn:
        cur = conn.execute(
            """INSERT INTO budget_lines (household_id, member_id, to_member_id, kind, section, name, category,
                   is_debit_order, flexibility, notes, start_month, end_month, sort)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (household_id, member_id, to_member_id if kind == "transfer" else None, kind, section, name, category,
             int(bool(is_debit_order)), flexibility, (notes or "").strip()[:200] or None, start_month, end_month, sort),
        )
        conn.execute("INSERT INTO budget_amounts (line_id, effective_month, amount_cents) VALUES (?, ?, ?)",
                     (cur.lastrowid, start_month, amount_cents))
    return cur.lastrowid


def update_line(conn: sqlite3.Connection, household_id: int, line_id: int, **fields) -> None:
    line = _line(conn, household_id, line_id)
    allowed = {"name", "section", "category", "is_debit_order", "flexibility", "notes", "end_month", "member_id",
               "kind", "to_member_id", "goal_id"}
    kind = fields.get("kind", line["kind"])
    if kind not in KINDS:
        raise ValueError("Unknown kind")
    if kind == "transfer":
        payer = fields.get("member_id", line["member_id"])
        to = fields.get("to_member_id", line["to_member_id"])
        if not _member_ok(conn, household_id, to) or to == payer:
            raise ValueError("A transfer needs a different person to receive it")
        fields["category"] = "Transfers"
    else:
        fields["to_member_id"] = None
    if kind != "saving" and line["goal_id"] is not None:
        fields["goal_id"] = None
        if kind == "income":
            fields["category"] = "Income"
        elif line["kind"] in ("income", "transfer") and fields.get("category") in (None, "Income", "Transfers"):
            fields["category"] = "Savings & investments" if kind == "saving" else guess_category(
                fields.get("name", line["name"]))
    sets, params = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "name":
            v = (v or "").strip()[:80]
            if not v:
                raise ValueError("Give the item a name")
        if k == "category" and v not in CATEGORIES:
            raise ValueError("Unknown category")
        if k == "flexibility" and v not in FLEX:
            raise ValueError("Unknown flexibility")
        if k == "end_month" and v:
            valid_month(v)
            if v < line["start_month"]:
                raise ValueError("End month is before the start month")
        if k == "member_id" and not _member_ok(conn, household_id, v):
            raise ValueError("Unknown person")
        if k == "to_member_id" and v is not None and not _member_ok(conn, household_id, v):
            raise ValueError("Unknown person")
        if k == "goal_id":
            if kind != "saving":
                v = None  # only saving lines fund goals
            elif v is not None and not conn.execute("SELECT 1 FROM goals WHERE id = ? AND household_id = ?",
                                                    (v, household_id)).fetchone():
                raise ValueError("Unknown goal")
        if k == "is_debit_order":
            v = int(bool(v))
        if k == "notes":
            v = (v or "").strip()[:200] or None
        sets.append(f"{k} = ?")
        params.append(v or None if k == "end_month" else v)
    if sets:
        with conn:
            conn.execute(f"UPDATE budget_lines SET {', '.join(sets)} WHERE id = ?", params + [line_id])


def delete_line(conn: sqlite3.Connection, household_id: int, line_id: int) -> None:
    _line(conn, household_id, line_id)
    with conn:
        conn.execute("DELETE FROM budget_lines WHERE id = ?", (line_id,))


def amount_on(conn: sqlite3.Connection, line_id: int, month: str) -> int | None:
    row = conn.execute(
        "SELECT amount_cents FROM budget_amounts WHERE line_id = ? AND effective_month <= ? "
        "ORDER BY effective_month DESC LIMIT 1", (line_id, month)).fetchone()
    return row[0] if row else None


def set_amount(conn: sqlite3.Connection, household_id: int, line_id: int, month: str, amount_cents: int,
               mode: str = "onward", note: str | None = None) -> dict:
    """Change an amount from `month` onwards, or for `month` only (the previous amount resumes
    the month after)."""
    line = _line(conn, household_id, line_id)
    valid_month(month)
    if amount_cents < 0:
        raise ValueError("Amount can't be negative")
    if mode not in ("onward", "once"):
        raise ValueError("mode must be 'onward' or 'once'")
    if mode == "once" and month < line["start_month"]:
        raise ValueError(f"This item starts in {line['start_month']}. For a one-off amount before then, add a separate item.")
    before = amount_on(conn, line_id, month)
    nxt = add_months(month, 1)
    with conn:
        if month < line["start_month"]:  # 'from then on' before the start: it now starts here, at this amount
            conn.execute("DELETE FROM budget_amounts WHERE line_id = ? AND effective_month = ?", (line_id, line["start_month"]))
            conn.execute("UPDATE budget_lines SET start_month = ? WHERE id = ?", (month, line_id))
        if mode == "onward":  # replaces a one-month change made for this same month
            conn.execute("DELETE FROM budget_amounts WHERE line_id = ? AND effective_month = ? AND note = 'back to usual'",
                         (line_id, nxt))
        if mode == "once" and before is not None:
            has_next = conn.execute("SELECT 1 FROM budget_amounts WHERE line_id = ? AND effective_month = ?",
                                    (line_id, nxt)).fetchone()
            if not has_next:
                conn.execute("INSERT INTO budget_amounts (line_id, effective_month, amount_cents, note) "
                             "VALUES (?, ?, ?, 'back to usual')", (line_id, nxt, amount_on(conn, line_id, nxt)))
        conn.execute(
            """INSERT INTO budget_amounts (line_id, effective_month, amount_cents, note) VALUES (?, ?, ?, ?)
               ON CONFLICT (line_id, effective_month) DO UPDATE SET amount_cents = excluded.amount_cents,
                   note = excluded.note, created_at = datetime('now')""",
            (line_id, month, amount_cents, (note or "").strip()[:120] or None),
        )
        if mode == "onward":  # later one-month changes now return to the new amount, not the old one
            for r in conn.execute("SELECT effective_month FROM budget_amounts WHERE line_id = ? AND effective_month > ? "
                                  "AND note = 'back to usual'", (line_id, nxt)).fetchall():
                usual = amount_on(conn, line_id, add_months(r["effective_month"], -2))
                if usual is not None:
                    conn.execute("UPDATE budget_amounts SET amount_cents = ? WHERE line_id = ? AND effective_month = ?",
                                 (usual, line_id, r["effective_month"]))
        # Drop redundant history rows (same amount as the row before), keeping the start row.
        rows = conn.execute("SELECT effective_month, amount_cents FROM budget_amounts WHERE line_id = ? "
                            "ORDER BY effective_month", (line_id,)).fetchall()
        for prev, cur in zip(rows, rows[1:]):
            if prev["amount_cents"] == cur["amount_cents"]:
                conn.execute("DELETE FROM budget_amounts WHERE line_id = ? AND effective_month = ?",
                             (line_id, cur["effective_month"]))
    return {"before_cents": before, "after_cents": amount_cents, "month": month, "mode": mode}


def history(conn: sqlite3.Connection, household_id: int, line_id: int) -> list[dict]:
    _line(conn, household_id, line_id)
    rows = conn.execute("SELECT effective_month, amount_cents, note FROM budget_amounts WHERE line_id = ? "
                        "ORDER BY effective_month", (line_id,)).fetchall()
    out, prev = [], None
    for r in rows:
        out.append({"month": r["effective_month"], "amount_cents": r["amount_cents"], "note": r["note"],
                    "change_cents": None if prev is None else r["amount_cents"] - prev})
        prev = r["amount_cents"]
    return out


def set_paid(conn: sqlite3.Connection, household_id: int, line_id: int, month: str, paid: bool) -> None:
    _line(conn, household_id, line_id)
    valid_month(month)
    with conn:
        conn.execute("INSERT INTO line_status (line_id, month, paid) VALUES (?, ?, ?) "
                     "ON CONFLICT (line_id, month) DO UPDATE SET paid = excluded.paid",
                     (line_id, month, int(bool(paid))))


def active_lines(conn: sqlite3.Connection, household_id: int, month: str) -> list[dict]:
    rows = conn.execute(
        """SELECT l.*,
              (SELECT amount_cents FROM budget_amounts a WHERE a.line_id = l.id AND a.effective_month <= ?
               ORDER BY a.effective_month DESC LIMIT 1) AS amount_cents,
              (SELECT amount_cents FROM budget_amounts a WHERE a.line_id = l.id AND a.effective_month <= ?
               ORDER BY a.effective_month DESC LIMIT 1) AS prev_amount_cents,
              (SELECT paid FROM line_status s WHERE s.line_id = l.id AND s.month = ?) AS paid
           FROM budget_lines l
           WHERE l.household_id = ? AND l.start_month <= ? AND (l.end_month IS NULL OR l.end_month >= ?)
           ORDER BY l.sort, l.id""",
        (month, add_months(month, -1), month, household_id, month, month),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        if d["amount_cents"] is None:
            continue
        prev_active = r["start_month"] <= add_months(month, -1)
        d["prev_amount_cents"] = d["prev_amount_cents"] if prev_active else None
        d["change_cents"] = (d["amount_cents"] - d["prev_amount_cents"]) if d["prev_amount_cents"] is not None else None
        d["is_new"] = r["start_month"] == month
        d["ends_this_month"] = r["end_month"] == month
        d["paid"] = bool(d["paid"])
        d["group"] = GROUPS.get(d["category"], "Lifestyle")
        d["is_debit_order"] = bool(d["is_debit_order"])
        out.append(d)
    return out


def _totals(lines: list[dict], member_id: int) -> dict:
    t = {"income_cents": 0, "expense_cents": 0, "saving_cents": 0, "transfer_in_cents": 0, "transfer_out_cents": 0}
    for l in lines:
        a = l["amount_cents"]
        if l["kind"] == "transfer":
            if l["member_id"] == member_id:
                t["transfer_out_cents"] += a
            if l["to_member_id"] == member_id:
                t["transfer_in_cents"] += a
        elif l["member_id"] == member_id:
            t[f"{l['kind']}_cents"] += a
    t["money_in_cents"] = t["income_cents"] + t["transfer_in_cents"]
    t["money_out_cents"] = t["expense_cents"] + t["saving_cents"] + t["transfer_out_cents"]
    t["surplus_cents"] = t["money_in_cents"] - t["money_out_cents"]
    return t


def month_view(conn: sqlite3.Connection, household_id: int, month: str, member_id: int | None = None) -> dict:
    valid_month(month)
    people = members(conn, household_id)
    lines = active_lines(conn, household_id, month)
    names = {p["id"]: p["name"] for p in people}
    for l in lines:
        l["member_name"] = names.get(l["member_id"])
        l["to_member_name"] = names.get(l["to_member_id"])

    per_person = []
    for p in people:
        if member_id is not None and p["id"] != member_id:
            continue
        own = [l for l in lines if l["member_id"] == p["id"]]
        sections: dict[str, list] = {}
        for l in own:
            sections.setdefault(l["section"], []).append(l)
        incoming = [l for l in lines if l["kind"] == "transfer" and l["to_member_id"] == p["id"]]
        per_person.append({**p, **_totals(lines, p["id"]),
                           "sections": [{"name": k, "lines": v} for k, v in sections.items()],
                           "incoming_transfers": incoming})

    scoped = lines if member_id is None else [l for l in lines if l["member_id"] == member_id]
    household = {
        "income_cents": sum(l["amount_cents"] for l in scoped if l["kind"] == "income"),
        "expense_cents": sum(l["amount_cents"] for l in scoped if l["kind"] == "expense"),
        "saving_cents": sum(l["amount_cents"] for l in scoped if l["kind"] == "saving"),
    }
    if member_id is None:
        household["surplus_cents"] = household["income_cents"] - household["expense_cents"] - household["saving_cents"]
    else:
        household["surplus_cents"] = per_person[0]["surplus_cents"] if per_person else 0
        household["transfer_in_cents"] = per_person[0]["transfer_in_cents"] if per_person else 0
        household["transfer_out_cents"] = per_person[0]["transfer_out_cents"] if per_person else 0

    by_group: dict[str, int] = {"Essentials": 0, "Lifestyle": 0, "Savings": 0}
    by_category: dict[str, int] = {}
    for l in scoped:
        if l["kind"] in ("expense", "saving"):
            g = "Savings" if l["kind"] == "saving" else l["group"]
            by_group[g if g in by_group else "Lifestyle"] += l["amount_cents"]
            by_category[l["category"]] = by_category.get(l["category"], 0) + l["amount_cents"]

    paid = [l for l in scoped if l["kind"] != "income"]
    return {
        "month": month, "people": per_person, "household": household,
        "by_group": by_group,
        "by_category": sorted(({"category": k, "planned_cents": v} for k, v in by_category.items()),
                              key=lambda x: -x["planned_cents"]),
        "progress": {"paid": sum(1 for l in paid if l["paid"]), "total": len(paid),
                     "paid_cents": sum(l["amount_cents"] for l in paid if l["paid"]),
                     "total_cents": sum(l["amount_cents"] for l in paid)},
        "changes": [l for l in scoped if l["change_cents"] or l["is_new"]],
        "lines": scoped,
    }


def debit_order_review(conn: sqlite3.Connection, household_id: int, month: str,
                       member_id: int | None = None) -> list[dict]:
    """Debit orders active in `month`, with how they've moved over the past year."""
    names = {p["id"]: p["name"] for p in members(conn, household_id)}
    out = []
    for l in active_lines(conn, household_id, month):
        if not l["is_debit_order"] or (member_id is not None and l["member_id"] != member_id):
            continue
        hist = conn.execute("SELECT effective_month, amount_cents FROM budget_amounts WHERE line_id = ? "
                            "ORDER BY effective_month", (l["id"],)).fetchall()
        year_ago = amount_on(conn, l["id"], add_months(month, -12)) or hist[0]["amount_cents"]
        since = add_months(month, -12) if amount_on(conn, l["id"], add_months(month, -12)) else hist[0]["effective_month"]
        changes = [h for h in hist if h["effective_month"] <= month]
        out.append({
            "id": l["id"], "name": l["name"], "member_id": l["member_id"], "member_name": names.get(l["member_id"]),
            "category": l["category"], "notes": l["notes"], "amount_cents": l["amount_cents"],
            "change_cents": l["change_cents"], "since_month": since, "since_amount_cents": year_ago,
            "year_change_cents": l["amount_cents"] - year_ago,
            "year_change_pct": round(100 * (l["amount_cents"] - year_ago) / year_ago, 1) if year_ago else None,
            "end_month": l["end_month"],
            "history": [{"month": h["effective_month"], "amount_cents": h["amount_cents"]} for h in changes],
            "upcoming": [{"month": h["effective_month"], "amount_cents": h["amount_cents"]}
                         for h in hist if h["effective_month"] > month],
        })
    out.sort(key=lambda d: -d["amount_cents"])
    return out
