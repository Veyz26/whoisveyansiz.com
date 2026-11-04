"""Read-only aggregates over imported bank transactions (actual spending)."""
from __future__ import annotations

import calendar
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
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


def coverage(conn: sqlite3.Connection, scope: Scope) -> dict[str, float]:
    """How much of each month the statements cover (0..1), from each import's period. Each account counts
    from its first statement to the newest month any account has, so a month it has no statement for (a gap,
    or a month not uploaded yet) counts as 0; with several accounts the least-covered one counts, so a month
    is only complete when every account's statements cover it."""
    sql = ("SELECT i.account_id, i.period_from, i.period_to FROM imports i JOIN accounts a ON a.id = i.account_id "
           "WHERE i.household_id = ? AND i.period_from IS NOT NULL AND i.period_to IS NOT NULL")
    params: list = [scope.household_id]
    if scope.member_id is not None:
        sql += " AND a.member_id = ?"
        params.append(scope.member_id)
    ranges: dict[int, list[tuple[date, date]]] = defaultdict(list)
    for r in conn.execute(sql + " ORDER BY i.account_id, i.period_from", params):
        ranges[r["account_id"]].append((date.fromisoformat(r["period_from"]), date.fromisoformat(r["period_to"])))
    cov: dict[str, float] = {}
    per_account: list[dict[str, int]] = []
    for lst in ranges.values():
        merged: list[list[date]] = []  # overlapping or back-to-back statements merged first
        for a, b in lst:
            if merged and a <= merged[-1][1] + timedelta(days=1):
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        days: dict[str, int] = defaultdict(int)
        for a, b in merged:
            d = a
            while d <= b:
                end = min(b, date(d.year, d.month, calendar.monthrange(d.year, d.month)[1]))
                days[d.isoformat()[:7]] += (end - d).days + 1
                d = end + timedelta(days=1)
        per_account.append(days)
    newest = max((max(d) for d in per_account), default=None)
    for days in per_account:
        # An account with nothing for over two months before the newest month is closed or no longer
        # uploaded: it counts up to its last statement only, so it doesn't make every later month incomplete.
        until = newest if max(days) >= add_months(newest, -2) else max(days)
        m = min(days)
        while m <= until:
            y, mo = int(m[:4]), int(m[5:])
            cov[m] = min(cov.get(m, 1.0), days.get(m, 0) / calendar.monthrange(y, mo)[1])
            m = add_months(m, 1)
    return dict(sorted(cov.items(), reverse=True))


def complete_months(conn: sqlite3.Connection, scope: Scope) -> list[str]:
    """Months the statements cover (almost) fully: at least 90% of the days, newest first."""
    return [m for m, f in coverage(conn, scope).items() if f >= 0.9]


def category_totals(conn: sqlite3.Connection, scope: Scope, month: str) -> dict[str, int]:
    w, p = scope.sql()
    rows = conn.execute(
        f"""SELECT t.category, -SUM(t.amount_cents) AS spend FROM transactions t
            WHERE {w} AND substr(t.posted_on, 1, 7) = ? AND t.category != 'Income' AND {COUNTED}
            GROUP BY t.category HAVING spend > 0""", p + [month],
    )
    return {r["category"]: r["spend"] for r in rows}


def totals(conn: sqlite3.Connection, scope: Scope, month: str) -> tuple[int, int]:
    w, p = scope.sql()
    r = conn.execute(
        f"""SELECT COALESCE(SUM(CASE WHEN t.category = 'Income' AND t.amount_cents > 0 THEN t.amount_cents END), 0) AS income,
                   COALESCE(-SUM(CASE WHEN t.category != 'Income' THEN t.amount_cents END), 0) AS spend
            FROM transactions t WHERE {w} AND substr(t.posted_on, 1, 7) = ? AND {COUNTED}""", p + [month],
    ).fetchone()
    return r["income"], r["spend"]


def prior_months(conn: sqlite3.Connection, scope: Scope, month: str, n: int = 3) -> list[str]:
    """Up to n complete months before `month` (a part-month would drag comparisons down)."""
    have = set(complete_months(conn, scope))
    return [m for m in (add_months(month, -i) for i in range(1, n + 1)) if m in have]


def average_by_category(conn: sqlite3.Connection, scope: Scope, month: str, n: int = 3) -> dict[str, int]:
    """Average monthly actual spend per category over the n months up to and including `month`
    that statements cover in full (with none yet, the months that have any data)."""
    have = set(complete_months(conn, scope) or months(conn, scope))
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
    # Money moved to (net of money back from) the household's own accounts: savings, investments and transfers.
    # What came in, minus spending, minus this, is how much the balance changed.
    moved = conn.execute(
        f"SELECT COALESCE(-SUM(t.amount_cents), 0) FROM transactions t WHERE {w} AND substr(t.posted_on, 1, 7) = ? "
        f"AND NOT ({COUNTED})", p + [month],
    ).fetchone()[0]
    uncategorised = conn.execute(
        f"SELECT COUNT(*) FROM transactions t WHERE {w} AND substr(t.posted_on, 1, 7) = ? AND t.category = 'Other'",
        p + [month],
    ).fetchone()[0]
    cov = coverage(conn, scope).get(month)
    return {
        "month": month, "coverage": None if cov is None else round(cov, 2), "partial": cov is not None and cov < 0.9,
        "income_cents": income, "spend_cents": spend, "moved_cents": moved, "net_cents": income - spend - moved,
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
    for r in rows:
        per_month[r["posted_on"][:7]]["fees_cents" if r["category"] == "Bank fees" else "interest_cents"] -= r["amount_cents"]

    # Averages over the months in the window that statements cover in full (a statement starting on the
    # 28th must not count as a whole month of fees); with none, over the months that have any data.
    complete = set(complete_months(conn, scope))
    use = [m for m in ms if m in complete] or [m for m in ms if m in set(months(conn, scope))]
    n_months = max(1, len(use))
    kinds: dict[str, dict] = defaultdict(lambda: {"count": 0, "total_cents": 0})
    interest: dict[str, int] = defaultdict(int)
    for r in rows:
        if r["posted_on"][:7] not in use:
            continue
        if r["category"] == "Bank fees":
            k = kinds[fee_kind(r["description"])]
            k["count"] += 1
            k["total_cents"] += -r["amount_cents"]
        else:
            interest[r["account"]] += -r["amount_cents"]
    fee_kinds = sorted(
        ({"kind": k, **v, "monthly_avg_cents": round(v["total_cents"] / n_months),
          "avoidable": k in AVOIDABLE_FEE_KINDS} for k, v in kinds.items()),
        key=lambda x: -x["total_cents"],
    )
    return {
        "months": ms, "averaged_months": use,
        "per_month": [{"month": m, **per_month[m]} for m in ms],
        "fee_kinds": fee_kinds,
        "interest_by_account": [{"account": a, "total_cents": c, "monthly_avg_cents": round(c / n_months)}
                                for a, c in sorted(interest.items(), key=lambda x: -x[1])],
        "fees_monthly_avg_cents": round(sum(per_month[m]["fees_cents"] for m in use) / n_months),
        "interest_monthly_avg_cents": round(sum(per_month[m]["interest_cents"] for m in use) / n_months),
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
        is_debit_order = "DEBIT ORDER" in desc or "DEBICHECK" in desc or "MAGTAPE DEBIT" in desc
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
