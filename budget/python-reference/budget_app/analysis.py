"""Read-only aggregates over imported bank transactions (actual spending)."""
from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from statistics import median

from .categorise import NON_SPEND
from .money import add_months

_NON_SPEND_SQL = ",".join(f"'{c}'" for c in NON_SPEND)
COUNTED = f"t.is_transfer = 0 AND t.category NOT IN ({_NON_SPEND_SQL})"


@dataclass(frozen=True)
class Scope:
    """Which data a query sees: one household, optionally one person in it."""
    household_id: int
    member_id: int | None = None

    def sql(self, alias: str = "t") -> tuple[str, list]:
        clause, params = f"{alias}.household_id = ?", [self.household_id]
        if self.member_id is not None:
            clause += f" AND {alias}.account_id IN (SELECT id FROM accounts WHERE member_id = ?)"
            params.append(self.member_id)
        return clause, params


def months(conn: sqlite3.Connection, scope: Scope) -> list[str]:
    w, p = scope.sql()
    return [r[0] for r in conn.execute(
        f"SELECT DISTINCT substr(t.posted_on, 1, 7) AS m FROM transactions t WHERE {w} ORDER BY m DESC", p)]


def latest_month(conn: sqlite3.Connection, scope: Scope) -> str | None:
    ms = months(conn, scope)
    return ms[0] if ms else None


def category_totals(conn: sqlite3.Connection, scope: Scope, month: str) -> dict[str, int]:
    w, p = scope.sql()
    rows = conn.execute(
        f"""SELECT t.category, -SUM(t.amount_cents) AS spend FROM transactions t
            WHERE {w} AND substr(t.posted_on, 1, 7) = ? AND t.amount_cents < 0 AND {COUNTED}
            GROUP BY t.category""", p + [month],
    )
    return {r["category"]: r["spend"] for r in rows}


def totals(conn: sqlite3.Connection, scope: Scope, month: str) -> tuple[int, int]:
    w, p = scope.sql()
    r = conn.execute(
        f"""SELECT COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents END), 0) AS income,
                   COALESCE(-SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents END), 0) AS spend
            FROM transactions t WHERE {w} AND substr(t.posted_on, 1, 7) = ? AND {COUNTED}""", p + [month],
    ).fetchone()
    return r["income"], r["spend"]


def prior_months(conn: sqlite3.Connection, scope: Scope, month: str, n: int = 3) -> list[str]:
    have = set(months(conn, scope))
    return [m for m in (add_months(month, -i) for i in range(1, n + 1)) if m in have]


def average_by_category(conn: sqlite3.Connection, scope: Scope, month: str, n: int = 3) -> dict[str, int]:
    """Average monthly actual spend per category over the n months up to and including `month`
    that have data."""
    have = set(months(conn, scope))
    ms = [m for m in (add_months(month, -i) for i in range(n)) if m in have]
    if not ms:
        return {}
    sums: dict[str, int] = defaultdict(int)
    for m in ms:
        for c, v in category_totals(conn, scope, m).items():
            sums[c] += v
    return {c: round(v / len(ms)) for c, v in sums.items()}


def summary(conn: sqlite3.Connection, scope: Scope, month: str) -> dict:
    income, spend = totals(conn, scope, month)
    cats = category_totals(conn, scope, month)
    priors = prior_months(conn, scope, month)
    prior_cats = [category_totals(conn, scope, m) for m in priors]
    prior_totals = [totals(conn, scope, m) for m in priors]

    def avg(values: list[int]) -> int | None:
        return round(sum(values) / len(values)) if values else None

    by_category = []
    for cat in set(cats) | {c for pc in prior_cats for c in pc}:
        by_category.append({"category": cat, "spend_cents": cats.get(cat, 0),
                            "prior_avg_cents": avg([pc.get(cat, 0) for pc in prior_cats])})
    by_category.sort(key=lambda c: -c["spend_cents"])

    w, p = scope.sql()
    savings = conn.execute(
        f"SELECT COALESCE(-SUM(t.amount_cents), 0) FROM transactions t WHERE {w} "
        "AND substr(t.posted_on, 1, 7) = ? AND t.category = 'Savings & investments' AND t.amount_cents < 0",
        p + [month],
    ).fetchone()[0]
    uncategorised = conn.execute(
        f"SELECT COUNT(*) FROM transactions t WHERE {w} AND substr(t.posted_on, 1, 7) = ? AND t.category = 'Other'",
        p + [month],
    ).fetchone()[0]
    return {
        "month": month, "income_cents": income, "spend_cents": spend, "net_cents": income - spend,
        "saved_cents": savings, "prior_months": priors,
        "prior_spend_avg_cents": avg([s for _, s in prior_totals]),
        "prior_income_avg_cents": avg([i for i, _ in prior_totals]),
        "by_category": by_category, "uncategorised": uncategorised,
    }


# --- Leaks: fees, interest, recurring costs -------------------------------------------

_FEE_KINDS = [
    ("ATM / cash withdrawal fees", r"ATM|CASH WITHDRAWAL|CASH WDL|WITHDRAWAL FEE"),
    ("Notification fees", r"NOTIFICATION|SMS"),
    ("Cash deposit fees", r"CASH DEP"),
    ("Declined / unpaid fees", r"DECLINED|UNPAID|INSUFFICIENT|DISHONOUR"),
    ("Monthly account fee", r"MONTHLY|ACCOUNT FEE|SERVICE FEE|ADMIN FEE|MANAGEMENT FEE"),
]
AVOIDABLE_FEE_KINDS = {k for k, _ in _FEE_KINDS if k != "Monthly account fee"}


def fee_kind(description: str) -> str:
    d = description.upper()
    for kind, pattern in _FEE_KINDS:
        if re.search(pattern, d):
            return kind
    return "Other fees"


def window(month: str, n: int = 3) -> list[str]:
    return [add_months(month, -i) for i in range(n - 1, -1, -1)]


def fees_and_interest(conn: sqlite3.Connection, scope: Scope, month: str, n: int = 3) -> dict:
    ms = window(month, n)
    w, p = scope.sql()
    rows = conn.execute(
        f"""SELECT t.posted_on, t.description, t.amount_cents, t.category, a.label AS account
            FROM transactions t JOIN accounts a ON a.id = t.account_id
            WHERE {w} AND t.category IN ('Bank fees', 'Interest charged') AND t.amount_cents < 0
              AND substr(t.posted_on, 1, 7) IN ({','.join('?' * len(ms))})
            ORDER BY t.posted_on DESC""", p + ms,
    ).fetchall()

    per_month = {m: {"fees_cents": 0, "interest_cents": 0} for m in ms}
    kinds: dict[str, dict] = defaultdict(lambda: {"count": 0, "total_cents": 0})
    interest: dict[str, int] = defaultdict(int)
    for r in rows:
        m = r["posted_on"][:7]
        if r["category"] == "Bank fees":
            per_month[m]["fees_cents"] += -r["amount_cents"]
            k = kinds[fee_kind(r["description"])]
            k["count"] += 1
            k["total_cents"] += -r["amount_cents"]
        else:
            per_month[m]["interest_cents"] += -r["amount_cents"]
            interest[r["account"]] += -r["amount_cents"]

    have = set(months(conn, scope))
    n_months = max(1, len([m for m in ms if m in have]))
    fee_kinds = sorted(
        ({"kind": k, **v, "monthly_avg_cents": round(v["total_cents"] / n_months),
          "avoidable": k in AVOIDABLE_FEE_KINDS} for k, v in kinds.items()),
        key=lambda x: -x["total_cents"],
    )
    return {
        "months": ms,
        "per_month": [{"month": m, **per_month[m]} for m in ms],
        "fee_kinds": fee_kinds,
        "interest_by_account": [{"account": a, "total_cents": c, "monthly_avg_cents": round(c / n_months)}
                                for a, c in sorted(interest.items(), key=lambda x: -x[1])],
        "fees_monthly_avg_cents": round(sum(v["fees_cents"] for v in per_month.values()) / n_months),
        "interest_monthly_avg_cents": round(sum(v["interest_cents"] for v in per_month.values()) / n_months),
    }


DISCRETIONARY = {"Groceries", "Fuel & transport", "Eating out", "Shopping", "Entertainment", "Other"}


def recurring(conn: sqlite3.Connection, scope: Scope, month: str, lookback: int = 6) -> list[dict]:
    """Money-out merchants seen in at least 2 of the last `lookback` months at a
    similar amount (within 10% of the median) - subscriptions, debit orders, insurance."""
    ms = window(month, lookback)
    w, p = scope.sql()
    rows = conn.execute(
        f"""SELECT t.merchant, t.category, t.description, t.posted_on, t.amount_cents FROM transactions t
            WHERE {w} AND t.amount_cents < 0 AND t.is_transfer = 0
              AND t.category NOT IN ('Transfers', 'Bank fees', 'Interest charged', 'Cash withdrawals')
              AND substr(t.posted_on, 1, 7) IN ({','.join('?' * len(ms))})
            ORDER BY t.posted_on""", p + ms,
    ).fetchall()

    by_merchant: dict[str, list] = defaultdict(list)
    for r in rows:
        by_merchant[r["merchant"]].append(r)

    out = []
    for merchant, txns in by_merchant.items():
        per_month: dict[str, int] = defaultdict(int)
        for t in txns:
            per_month[t["posted_on"][:7]] += -t["amount_cents"]
        if len(per_month) < 2:
            continue
        amounts = list(per_month.values())
        typical = round(median(amounts))
        if typical <= 0 or any(abs(a - typical) > 0.1 * typical for a in amounts):
            continue
        desc = txns[-1]["description"].upper()
        is_debit_order = "DEBIT ORDER" in desc or "DEBICHECK" in desc
        if txns[-1]["category"] in DISCRETIONARY and not is_debit_order:
            continue
        kind = ("debit order" if is_debit_order
                else "subscription" if txns[-1]["category"] == "Subscriptions" else "recurring")
        out.append({
            "merchant": merchant, "category": txns[-1]["category"], "kind": kind,
            "monthly_cents": typical, "annual_cents": typical * 12, "months_seen": len(per_month),
            "last_seen": txns[-1]["posted_on"], "active": txns[-1]["posted_on"][:7] >= add_months(month, -1),
        })
    out.sort(key=lambda r: -r["monthly_cents"])
    return out
