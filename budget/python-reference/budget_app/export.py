"""Power BI / Excel export: a small star schema as CSV files.

dim_person, dim_category, dim_month  +  fact_budget, fact_transactions, fact_goals, fact_debts

Amounts are written in rands with two decimals (what Power BI and Excel expect) next to the
integer cents. Two ways in:
- download a ZIP and use Get Data > Folder (or Text/CSV) in Power BI Desktop;
- live feed: /api/powerbi/<table>.csv with a read-only API token, refreshable in the
  Power BI service (Web connector, Anonymous auth, token in the Authorization header).
"""
from __future__ import annotations

import csv
import io
import sqlite3
import zipfile
from datetime import date

from .budget import active_lines, members
from .categorise import GROUPS
from .money import add_months

TABLES = ("dim_person", "dim_category", "dim_month", "fact_budget", "fact_transactions", "fact_goals", "fact_debts")


def _rands(cents: int | None) -> str:
    if cents is None:
        return ""
    sign = "-" if cents < 0 else ""
    return f"{sign}{abs(cents) // 100}.{abs(cents) % 100:02d}"


def _month_range(conn, household_id: int) -> list[str]:
    row = conn.execute(
        """SELECT MIN(m), MAX(m) FROM (
             SELECT start_month AS m FROM budget_lines WHERE household_id = :h
             UNION ALL SELECT substr(posted_on, 1, 7) FROM transactions WHERE household_id = :h)""",
        {"h": household_id}).fetchone()
    today = date.today().isoformat()[:7]
    first = row[0] or today
    last = max(row[1] or today, add_months(today, 6))
    out, m = [], first
    while m <= last and len(out) < 240:
        out.append(m)
        m = add_months(m, 1)
    return out


def table_rows(conn: sqlite3.Connection, household_id: int, table: str) -> tuple[list[str], list[list]]:
    people = {p["id"]: p["name"] for p in members(conn, household_id)}
    if table == "dim_person":
        return ["person_id", "person"], [[k, v] for k, v in people.items()] + [[0, "Joint"]]
    if table == "dim_category":
        return ["category", "group"], [[c, g] for c, g in GROUPS.items()]
    if table == "dim_month":
        rows = []
        for m in _month_range(conn, household_id):
            y, mo = map(int, m.split("-"))
            rows.append([m, f"{m}-01", y, mo, date(y, mo, 1).strftime("%b %Y"), f"Q{(mo - 1) // 3 + 1}"])
        return ["month", "month_start", "year", "month_number", "month_label", "quarter"], rows
    if table == "fact_budget":
        rows = []
        for m in _month_range(conn, household_id):
            for l in active_lines(conn, household_id, m):
                rows.append([m, l["member_id"], l["to_member_id"] or "", l["id"], l["name"], l["kind"], l["section"],
                             l["category"], GROUPS.get(l["category"], ""), int(l["is_debit_order"]), l["flexibility"],
                             _rands(l["amount_cents"]), l["amount_cents"], _rands(l["change_cents"]), int(l["paid"])])
        return ["month", "person_id", "to_person_id", "line_id", "item", "kind", "section", "category", "group",
                "is_debit_order", "flexibility", "amount", "amount_cents", "change_vs_prior_month", "paid"], rows
    if table == "fact_transactions":
        rows = [[r["posted_on"], r["posted_on"][:7], r["member_id"] or 0, r["account"], r["bank"], r["description"],
                 r["category"], GROUPS.get(r["category"], ""), int(r["is_transfer"]), _rands(r["amount_cents"]),
                 r["amount_cents"]]
                for r in conn.execute(
                    """SELECT t.*, a.label AS account, a.bank, a.member_id FROM transactions t
                       JOIN accounts a ON a.id = t.account_id WHERE t.household_id = ? ORDER BY t.posted_on""",
                    (household_id,))]
        return ["date", "month", "person_id", "account", "bank", "description", "category", "group", "is_transfer",
                "amount", "amount_cents"], rows
    if table == "fact_goals":
        rows = [[g["id"], g["name"], g["member_id"] or 0, _rands(g["target_cents"]), _rands(g["saved_cents"]),
                 g["target_month"] or ""] for g in conn.execute("SELECT * FROM goals WHERE household_id = ?", (household_id,))]
        return ["goal_id", "goal", "person_id", "target", "saved", "target_month"], rows
    if table == "fact_debts":
        rows = [[d["id"], d["name"], d["member_id"] or 0, _rands(d["balance_cents"]), d["apr_bp"] / 100,
                 _rands(d["min_payment_cents"])] for d in conn.execute("SELECT * FROM debts WHERE household_id = ?", (household_id,))]
        return ["debt_id", "debt", "person_id", "balance", "interest_rate_pct", "minimum_payment"], rows
    raise KeyError(table)


def table_csv(conn: sqlite3.Connection, household_id: int, table: str) -> bytes:
    header, rows = table_rows(conn, household_id, table)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        # Neutralise spreadsheet formula injection in free-text cells.
        w.writerow([f"'{c}" if isinstance(c, str) and c[:1] in ("=", "+", "-", "@") and not _numeric(c) else c
                    for c in r])
    return ("﻿" + buf.getvalue()).encode("utf-8")  # BOM so Excel reads UTF-8


def _numeric(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


README = """Budget export for Power BI / Excel
====================================

Load in Power BI Desktop: Get Data > Folder > select this unzipped folder > Combine & Transform,
or Get Data > Text/CSV for each file.

Relationships (Model view):
  fact_budget[month]        -> dim_month[month]
  fact_transactions[month]  -> dim_month[month]
  fact_budget[person_id]    -> dim_person[person_id]
  fact_transactions[person_id] -> dim_person[person_id]
  fact_budget[category]     -> dim_category[category]
  fact_transactions[category] -> dim_category[category]

Amounts: 'amount' is in rands (negative = money out for transactions); '*_cents' are exact integers.
fact_budget has one row per budget item per month, including future months, so it doubles as a forecast.

Starter measures (DAX):
  Planned out = CALCULATE(SUM(fact_budget[amount]), fact_budget[kind] IN {"expense","saving"})
  Income = CALCULATE(SUM(fact_budget[amount]), fact_budget[kind] = "income")
  Surplus = [Income] - [Planned out]
  Actual spend = -CALCULATE(SUM(fact_transactions[amount]), fact_transactions[amount] < 0, fact_transactions[is_transfer] = 0)
"""


def zip_export(conn: sqlite3.Connection, household_id: int) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for t in TABLES:
            z.writestr(f"{t}.csv", table_csv(conn, household_id, t))
        z.writestr("README.txt", README)
    return buf.getvalue()


def power_query(base_url: str, table: str) -> str:
    return f'''let
    Source = Csv.Document(
        Web.Contents("{base_url}/api/powerbi/{table}.csv",
            [Headers = [Authorization = "Bearer " & ApiToken]]),
        [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true])
in
    Promoted'''
