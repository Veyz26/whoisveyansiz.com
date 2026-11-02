"""Debt payoff planner: avalanche (highest rate first) vs snowball (smallest balance first).

Monthly model, integer cents: interest accrues on the opening balance at APR/12, then
every debt gets its minimum, then the extra budget (plus minimums freed up by debts
already paid off) goes to the target debt.
"""
from __future__ import annotations

from dataclasses import dataclass

MAX_MONTHS = 600


@dataclass
class Debt:
    name: str
    balance_cents: int
    apr_bp: int  # basis points: 21.75% -> 2175
    min_payment_cents: int
    id: int | None = None


def _interest(balance: int, apr_bp: int) -> int:
    # balance * apr / 12, rounded half-up, in integer arithmetic
    return (balance * apr_bp + 60_000) // 120_000


def simulate(debts: list[Debt], extra_cents: int = 0, strategy: str = "avalanche", rollover: bool = True) -> dict:
    if strategy == "avalanche":
        order = sorted(range(len(debts)), key=lambda i: (-debts[i].apr_bp, debts[i].balance_cents))
    elif strategy == "snowball":
        order = sorted(range(len(debts)), key=lambda i: (debts[i].balance_cents, -debts[i].apr_bp))
    elif strategy == "minimum":
        order, extra_cents, rollover = list(range(len(debts))), 0, False
    else:
        raise ValueError(strategy)

    bal = [d.balance_cents for d in debts]
    paid_off_month: list[int | None] = [None if b > 0 else 0 for b in bal]
    interest_by_debt = [0] * len(debts)
    budget = sum(d.min_payment_cents for d in debts) + extra_cents
    balances_by_month = [sum(bal)]
    month = 0

    while any(b > 0 for b in bal) and month < MAX_MONTHS:
        month += 1
        for i, d in enumerate(debts):
            if bal[i] > 0:
                charge = _interest(bal[i], d.apr_bp)
                bal[i] += charge
                interest_by_debt[i] += charge

        available = budget if rollover else None
        for i, d in enumerate(debts):
            if bal[i] > 0:
                pay = min(bal[i], d.min_payment_cents)
                bal[i] -= pay
                if available is not None:
                    available -= pay
        if available is None:
            available = extra_cents
        for i in order:
            if available <= 0:
                break
            if bal[i] > 0:
                pay = min(bal[i], available)
                bal[i] -= pay
                available -= pay

        for i in range(len(debts)):
            if bal[i] == 0 and paid_off_month[i] is None:
                paid_off_month[i] = month
        balances_by_month.append(sum(bal))

    stuck = any(b > 0 for b in bal)
    return {
        "strategy": strategy,
        # where extra money goes first: the first debt in this strategy's order that has a balance
        "target": None if strategy == "minimum" else next((debts[i].name for i in order if debts[i].balance_cents > 0), None),
        "months": None if stuck else month,
        "never_pays_off": stuck,
        "total_interest_cents": sum(interest_by_debt),
        "monthly_budget_cents": budget,
        "payoff_order": [
            {"name": debts[i].name, "paid_off_month": paid_off_month[i], "interest_cents": interest_by_debt[i]}
            for i in sorted(range(len(debts)), key=lambda i: (paid_off_month[i] is None, paid_off_month[i] or 0))
        ],
        "balances_by_month": balances_by_month,
    }


def compare(debts: list[Debt], extra_cents: int) -> dict:
    if not debts:
        return {"debts": 0}
    baseline = simulate(debts, 0, "minimum")
    avalanche = simulate(debts, extra_cents, "avalanche")
    snowball = simulate(debts, extra_cents, "snowball")
    for plan in (avalanche, snowball):
        # Against a baseline that never pays off, "interest saved" would be meaningless (it runs for 50 years).
        plan["interest_saved_cents"] = (None if baseline["never_pays_off"]
                                        else baseline["total_interest_cents"] - plan["total_interest_cents"])
        plan["months_saved"] = (
            baseline["months"] - plan["months"]
            if baseline["months"] is not None and plan["months"] is not None else None
        )
    warnings = [{"name": d.name, "interest_cents": _interest(d.balance_cents, d.apr_bp), "min_payment_cents": d.min_payment_cents}
                for d in debts if d.balance_cents > 0 and d.min_payment_cents <= _interest(d.balance_cents, d.apr_bp)]
    best = "avalanche" if avalanche["total_interest_cents"] <= snowball["total_interest_cents"] else "snowball"
    return {
        "debts": len(debts),
        "extra_cents": extra_cents,
        "baseline": baseline,
        "avalanche": avalanche,
        "snowball": snowball,
        "recommended": best,
        "avalanche_vs_snowball_cents": snowball["total_interest_cents"] - avalanche["total_interest_cents"],
        "warnings": warnings,  # minimums that don't cover the monthly interest: the balance grows
    }


def load_debts(conn, household_id: int) -> list[Debt]:
    return [Debt(r["name"], r["balance_cents"], r["apr_bp"], r["min_payment_cents"], r["id"])
            for r in conn.execute("SELECT * FROM debts WHERE household_id = ? ORDER BY id", (household_id,))]
