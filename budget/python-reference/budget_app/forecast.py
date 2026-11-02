"""Next-month projection and the insights shown with it."""
from __future__ import annotations

import sqlite3

from . import analysis
from .budget import DISCRETIONARY_CATS, REDUCIBLE_CATS, debit_order_review, month_view
from .money import add_months, format_zar as R


def _mname(m: str) -> str:
    import calendar
    y, mo = map(int, m.split("-"))
    return f"{calendar.month_name[mo]} {y}"


def _insight(kind: str, tone: str, title: str, detail: str, amount: int | None = None) -> dict:
    return {"kind": kind, "tone": tone, "title": title, "detail": detail, "amount_cents": amount}


def forecast(conn: sqlite3.Connection, household_id: int, month: str, member_id: int | None = None,
             horizon: int = 6) -> dict:
    nxt = add_months(month, 1)
    cur_v = month_view(conn, household_id, month, member_id)
    nxt_v = month_view(conn, household_id, nxt, member_id)
    insights: list[dict] = []

    # 1. Amounts that change next month. Transfers between partners cancel out for the household, so
    # they're only shown in a person's own view; more saving is good news, not a warning.
    incoming = nxt_v["people"][0]["incoming_transfers"] if member_id is not None and nxt_v["people"] else []
    for l in incoming:
        if l["change_cents"] and l["change_cents"] < 0:
            insights.append(_insight("change", "warn", f"Money from {l['member_name']} goes down {R(-l['change_cents'])}",
                                     f"From {_mname(nxt)}: {R(l['prev_amount_cents'])} → {R(l['amount_cents'])}.", l["change_cents"]))
    for l in nxt_v["lines"]:
        if l["kind"] == "transfer" and member_id is None:
            continue
        if l["change_cents"]:
            up = l["change_cents"] > 0
            who = f"{l['member_name']}'s " if member_id is None else ""
            tone = "good" if l["kind"] == "saving" and up else "warn" if up == (l["kind"] != "income") else "good"
            insights.append(_insight(
                "change", tone,
                f"{who}{l['name']} {'goes up' if up else 'goes down'} {R(abs(l['change_cents']))}",
                f"From {_mname(nxt)}: {R(l['prev_amount_cents'])} → {R(l['amount_cents'])}.",
                l["change_cents"] if l["kind"] == "income" else -l["change_cents"]))
        elif l["is_new"]:
            insights.append(_insight("new", "info", f"New: {l['name']}",
                                     f"{R(l['amount_cents'])} a month from {_mname(nxt)}.",
                                     -l["amount_cents"] if l["kind"] != "income" else l["amount_cents"]))

    # 2. Things that end this month free up money
    for l in (cur_v["people"][0]["incoming_transfers"] if member_id is not None and cur_v["people"] else []):
        if l["ends_this_month"]:
            insights.append(_insight("ending", "warn", f"Money from {l['member_name']} ends this month",
                                     f"The last {R(l['amount_cents'])} comes in {_mname(month)}.", -l["amount_cents"]))
    for l in cur_v["lines"]:
        if l["kind"] == "transfer" and member_id is None:
            continue
        if l["ends_this_month"] and l["kind"] in ("expense", "saving", "transfer"):
            insights.append(_insight(
                "ending", "good", f"{l['name']} ends this month",
                f"Its last {R(l['amount_cents'])} payment is in {_mname(month)}, freeing that up from {_mname(nxt)}.",
                l["amount_cents"]))

    # 3. Shortfalls, and whether the other partner can cover them
    if member_id is None and len(nxt_v["people"]) > 1:
        short = [p for p in nxt_v["people"] if p["surplus_cents"] < 0]
        spare = [p for p in nxt_v["people"] if p["surplus_cents"] > 0]
        for p in short:
            helper = max(spare, key=lambda s: s["surplus_cents"], default=None)
            cover = (f" {helper['name']} has {R(helper['surplus_cents'])} spare, so a transfer could cover it."
                     if helper and helper["surplus_cents"] >= -p["surplus_cents"] else "")
            insights.append(_insight("shortfall", "warn", f"{p['name']} is {R(-p['surplus_cents'])} short next month",
                                     f"Planned outgoings are more than {p['name']}'s money in.{cover}",
                                     p["surplus_cents"]))
    hh = nxt_v["household"]
    if hh["surplus_cents"] < 0:
        insights.append(_insight("shortfall", "warn", f"Next month is {R(-hh['surplus_cents'])} short overall",
                                 "Look at the lifestyle items on the Goals page for what could be trimmed.",
                                 hh["surplus_cents"]))

    # 4. Actual spending running above plan (only when statements have been imported)
    scope = analysis.Scope(household_id, member_id)
    latest = analysis.latest_month(conn, scope)
    if latest:
        actual = analysis.average_by_category(conn, scope, min(latest, month))
        planned = {c["category"]: c["planned_cents"] for c in cur_v["by_category"]}
        for cat, avg in sorted(actual.items(), key=lambda kv: -kv[1]):
            if cat not in REDUCIBLE_CATS | DISCRETIONARY_CATS:  # day-to-day spending only
                continue
            plan = planned.get(cat)
            if plan and avg > plan * 1.1 and avg - plan >= 20000:
                insights.append(_insight("overspend", "warn", f"{cat} is running over plan",
                                         f"Statements average {R(avg)} a month against {R(plan)} planned.",
                                         plan - avg))

    # 5. Debit orders creeping up year on year
    for d in debit_order_review(conn, household_id, month, member_id):
        if d["year_change_pct"] and d["year_change_pct"] >= 10 and d["year_change_cents"] >= 10000:
            insights.append(_insight(
                "creep", "info", f"{d['name']} is up {d['year_change_pct']:.0f}% since {_mname(d['since_month'])}",
                f"{R(d['since_amount_cents'])} → {R(d['amount_cents'])}. " + (
                    "Worth getting a competing quote." if d["category"] in ("Insurance", "Medical & health")
                    else "Check you still use all of them." if d["category"] == "Subscriptions"
                    else "Worth checking why it went up."),
                -d["year_change_cents"]))

    # 6. Essentials / lifestyle / savings balance (the 50/30/20 guide)
    income = nxt_v["household"]["income_cents"] + nxt_v["household"].get("transfer_in_cents", 0)
    if income:
        g = nxt_v["by_group"]
        ess, life, sav = (round(100 * g[k] / income) for k in ("Essentials", "Lifestyle", "Savings"))
        if sav < 10:
            insights.append(_insight("balance", "info", f"Savings are {sav}% of income",
                                     f"A common guide is 50% essentials, 30% lifestyle, 20% savings. "
                                     f"You're at {ess}% / {life}% / {sav}%."))

    order = {"warn": 0, "good": 1, "info": 2}
    insights.sort(key=lambda i: (order[i["tone"]], -abs(i["amount_cents"] or 0)))

    projection = []
    for i in range(0, horizon + 1):
        m = add_months(month, i)
        v = cur_v if i == 0 else nxt_v if i == 1 else month_view(conn, household_id, m, member_id)
        projection.append({
            "month": m,
            "household_surplus_cents": v["household"]["surplus_cents"],
            "people": [{"id": p["id"], "name": p["name"], "surplus_cents": p["surplus_cents"]} for p in v["people"]],
        })

    return {
        "month": month, "next_month": nxt,
        "this": {"household": cur_v["household"], "people": [_slim(p) for p in cur_v["people"]]},
        "next": {"household": nxt_v["household"], "people": [_slim(p) for p in nxt_v["people"]],
                 "by_group": nxt_v["by_group"]},
        "insights": insights, "projection": projection,
    }


def _slim(p: dict) -> dict:
    return {k: v for k, v in p.items() if k not in ("sections", "incoming_transfers")}
