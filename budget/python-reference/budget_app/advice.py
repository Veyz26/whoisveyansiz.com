"""Monthly 'top 3 actions'.

Each rule looks at the month (and the few before it) and may propose one action with
an estimated monthly impact in cents. Actions are ranked by that impact. Estimates are
deliberately conservative and always shown with the evidence behind them.
"""
from __future__ import annotations

import sqlite3

from . import analysis
from .debt import compare, load_debts
from .money import format_zar as R

STREAMING = {"NETFLIX", "SHOWMAX", "DISNEY", "PRIME VIDEO", "PRIMEVIDEO", "AMAZON PRIME", "DSTV",
             "YOUTUBE", "APPLE TV", "BOX OFFICE"}


def _action(kind: str, title: str, detail: str, impact: int | None, evidence: list[str]) -> dict:
    return {"kind": kind, "title": title, "detail": detail, "monthly_impact_cents": impact, "evidence": evidence}


def _fees(conn, scope, month) -> dict | None:
    f = analysis.fees_and_interest(conn, scope, month)
    avoidable = [k for k in f["fee_kinds"] if k["avoidable"]]
    avoidable_avg = sum(k["monthly_avg_cents"] for k in avoidable)
    account_fee = next((k for k in f["fee_kinds"] if k["kind"] == "Monthly account fee"), None)
    if avoidable_avg < 2000 and not (account_fee and account_fee["monthly_avg_cents"] > 15000):
        return None
    tips = []
    for k in avoidable:
        if k["kind"].startswith("ATM"):
            tips.append("draw cash less often in bigger amounts, or use cash-back at till points")
        elif k["kind"] == "Notification fees":
            tips.append("switch SMS notifications to free in-app notifications")
        elif k["kind"] == "Cash deposit fees":
            tips.append("deposit cash less often or ask payers to pay by EFT")
        elif k["kind"] == "Declined / unpaid fees":
            tips.append("move debit orders to just after payday so they don't bounce")
    if account_fee and account_fee["monthly_avg_cents"] > 15000:
        tips.append("check whether a cheaper account tier covers how you actually bank")
    return _action(
        "fees",
        f"Cut avoidable bank fees (~{R(avoidable_avg)}/month)" if avoidable_avg else "Review your account fee",
        "You could " + "; ".join(tips) + ".",
        avoidable_avg or None,
        [f"{k['kind']}: {k['count']}× in 3 months, {R(k['total_cents'])}" for k in f["fee_kinds"]],
    )


def _interest_and_surplus(conn, scope, month, s) -> list[dict]:
    out = []
    f = analysis.fees_and_interest(conn, scope, month)
    interest_avg = f["interest_monthly_avg_cents"]
    debts = load_debts(conn, scope.household_id)
    # What's realistically spare: half of an average positive net over recent months.
    nets = [s["net_cents"]] + [
        analysis.summary(conn, scope, m)["net_cents"] for m in s["prior_months"][:2]
    ]
    avg_net = round(sum(nets) / len(nets))
    spare = max(0, avg_net // 2 // 10000 * 10000)  # round down to R100

    if debts and spare:
        plan = compare(debts, spare)
        best = plan[plan["recommended"]]
        saved = best["interest_saved_cents"]
        months = best["months_saved"]
        method = "highest rate first" if plan["recommended"] == "avalanche" else "smallest balance first"
        if saved is None:  # at the minimums some debt never clears
            title = f"Paying an extra {R(spare)}/month towards {best['target']} first would help clear your debt"
            detail = ("At the minimum payments, some of your debt never gets paid off because the minimum doesn't cover "
                      f"the interest. With the extra, it's cleared in about {best['months']} months ({method}).")
            impact = None
        else:
            title = f"Paying an extra {R(spare)}/month towards {best['target']} first would save about {R(saved)} in interest"
            detail = (f"That's the {plan['recommended']} method ({method})"
                      + (f", and you'd be debt-free {months} months sooner" if months else "") + ".")
            impact = round(saved / best["months"]) if best["months"] else None
        out.append(_action("debt", title, detail, impact,
                           [f"Average monthly surplus: {R(avg_net)}", f"Interest charged: ~{R(interest_avg)}/month"]))
    elif interest_avg > 5000:
        out.append(_action(
            "debt",
            f"You're paying ~{R(interest_avg)}/month in interest",
            "Add your loans and cards on the Debt plan page to see which to pay first and how much "
            "interest an extra payment saves.",
            interest_avg,
            [f"{i['account']}: {R(i['total_cents'])} interest in 3 months" for i in f["interest_by_account"]],
        ))
    elif spare >= 50000 and s["saved_cents"] < spare:
        out.append(_action(
            "save",
            f"You've had about {R(spare)} left over on average",
            "Setting up a transfer to savings on payday is one way to stop it being spent by default.",
            None,
            [f"Average monthly surplus: {R(avg_net)}", f"Saved this month: {R(s['saved_cents'])}"],
        ))
    return out


def _subscriptions(conn, scope, month) -> dict | None:
    rec = [r for r in analysis.recurring(conn, scope, month) if r["active"] and r["category"] in
           ("Subscriptions", "Entertainment", "Phone & internet")]
    subs = [r for r in rec if r["category"] == "Subscriptions"]
    if not subs:
        return None
    total = sum(r["monthly_cents"] for r in subs)
    streaming = [r for r in subs if any(s in r["merchant"] for s in STREAMING)]
    if len(streaming) >= 2:
        cheapest = min(streaming, key=lambda r: r["monthly_cents"])
        return _action(
            "subscriptions",
            f"Rotate streaming services (save ~{R(cheapest['monthly_cents'])}/month)",
            f"You pay for {len(streaming)} streaming services. Keep one at a time and switch when you've "
            "finished what you're watching.",
            cheapest["monthly_cents"],
            [f"{r['merchant'].title()}: {R(r['monthly_cents'])}/month" for r in subs],
        )
    smallest = min(subs, key=lambda r: r["monthly_cents"])
    return _action(
        "subscriptions",
        f"Review {len(subs)} subscriptions ({R(total)}/month)",
        f"That's {R(total * 12)} a year. Cancel any you haven't used in the last month.",
        smallest["monthly_cents"] if len(subs) > 1 else None,
        [f"{r['merchant'].title()}: {R(r['monthly_cents'])}/month" for r in subs],
    )


def _spikes(s) -> list[dict]:
    out = []
    for c in s["by_category"]:
        prior = c["prior_avg_cents"]
        if c["category"] in ("Bank fees", "Interest charged", "Debt repayments", "Housing & utilities",
                             "Insurance", "Medical & health", "Other") or not prior:
            continue
        diff = c["spend_cents"] - prior
        if diff >= 30000 and c["spend_cents"] >= prior * 1.25:
            out.append(_action(
                "spike",
                f"{c['category']} is up {R(diff)} on usual",
                f"You spent {R(c['spend_cents'])} vs a {R(prior)} average. Bringing it back to normal frees "
                f"up {R(diff)} a month.",
                diff,
                [f"This month: {R(c['spend_cents'])}", f"Previous average: {R(prior)}"],
            ))
    return out


def _rewards(conn, scope, month) -> dict | None:
    w, p = scope.sql()
    rows = conn.execute(
        f"""SELECT a.bank, SUM(-t.amount_cents) AS spend FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           WHERE {w} AND substr(t.posted_on, 1, 7) = ? AND t.amount_cents < 0
             AND t.category IN ('Groceries', 'Fuel & transport') GROUP BY a.bank""", p + [month],
    ).fetchall()
    spend = {r["bank"]: r["spend"] for r in rows}
    if spend.get("fnb", 0) >= 200000:
        return _action(
            "rewards",
            "Check your eBucks reward level",
            f"You put {R(spend['fnb'])} of groceries and fuel through FNB this month. eBucks earn rates depend "
            "on your reward level, so check in the FNB app which qualifying criteria you're missing.",
            None, [f"FNB groceries + fuel: {R(spend['fnb'])}"],
        )
    if spend.get("capitec", 0) >= 200000:
        return _action(
            "rewards",
            "Check Capitec Live Better cashback",
            f"You put {R(spend['capitec'])} of groceries and fuel through Capitec this month. See in the "
            "Capitec app whether Live Better cashback is on for your card spend.",
            None, [f"Capitec groceries + fuel: {R(spend['capitec'])}"],
        )
    return None


def top_actions(conn: sqlite3.Connection, scope: analysis.Scope, month: str, n: int = 3) -> dict:
    """Statement-based actions (needs imported transactions)."""
    s = analysis.summary(conn, scope, month)
    candidates = [a for a in (
        _fees(conn, scope, month), *_interest_and_surplus(conn, scope, month, s), _subscriptions(conn, scope, month),
        *_spikes(s), _rewards(conn, scope, month),
    ) if a]
    # Quantified actions first, biggest impact first; unquantified ones fill remaining slots.
    candidates.sort(key=lambda a: (a["monthly_impact_cents"] is None, -(a["monthly_impact_cents"] or 0)))
    # At most one spike in the top list so it doesn't crowd out structural fixes.
    picked, spikes = [], 0
    for a in candidates:
        if a["kind"] == "spike":
            if spikes:
                continue
            spikes += 1
        picked.append(a)
        if len(picked) == n:
            break
    return {"month": month, "actions": picked, "total_candidates": len(candidates)}
