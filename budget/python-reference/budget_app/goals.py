"""Financial goals: how long at the current surplus, and what could be cut to get there sooner.

Cuts are suggested from the budget itself: discretionary items first (takeout, subscriptions,
gym, date nights) at up to half, then reducible ones (groceries, fuel, utilities) at 10%.
Fixed commitments (rent, car, insurance) are never suggested. Avoidable bank fees found in
imported statements are added as a free win.
"""
from __future__ import annotations

import math
import sqlite3

from . import analysis
from .budget import CANCELLABLE_DEBIT_CATS, NEVER_CUT_CATS, active_lines, members, month_view, valid_month
from .money import add_months

CUT_SHARE = {"discretionary": 0.5, "reducible": 0.1}


def months_between(a: str, b: str) -> int:
    ya, ma = map(int, a.split("-"))
    yb, mb = map(int, b.split("-"))
    return (yb - ya) * 12 + (mb - ma)


def list_goals(conn: sqlite3.Connection, household_id: int) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM goals WHERE household_id = ? ORDER BY created_at, id", (household_id,))]


def save_goal(conn: sqlite3.Connection, household_id: int, data: dict, goal_id: int | None = None) -> int:
    if goal_id is not None:  # an edit only changes the fields it sends
        old = conn.execute("SELECT * FROM goals WHERE id = ? AND household_id = ?", (goal_id, household_id)).fetchone()
        if not old:
            raise LookupError("Goal not found")
        data = {k: data[k] if k in data else old[k] for k in ("name", "target_cents", "saved_cents", "target_month", "member_id")}
    name = str(data.get("name", "")).strip()[:80]
    try:
        target = int(data["target_cents"])
        saved = int(data.get("saved_cents") or 0)
    except (KeyError, TypeError, ValueError):
        raise ValueError("Target amount is required")
    if not name or target <= 0 or saved < 0:
        raise ValueError("Give the goal a name and a target above zero")
    target_month = data.get("target_month") or None
    if target_month:
        valid_month(target_month)
    member_id = data.get("member_id") or None
    if member_id is not None and member_id not in {m["id"] for m in members(conn, household_id)}:
        raise ValueError("Unknown person")
    with conn:
        if goal_id is None:
            cur = conn.execute(
                "INSERT INTO goals (household_id, member_id, name, target_cents, saved_cents, target_month) "
                "VALUES (?, ?, ?, ?, ?, ?)", (household_id, member_id, name, target, saved, target_month))
            return cur.lastrowid
        cur = conn.execute(
            "UPDATE goals SET member_id = ?, name = ?, target_cents = ?, saved_cents = ?, target_month = ? "
            "WHERE id = ? AND household_id = ?", (member_id, name, target, saved, target_month, goal_id, household_id))
        if not cur.rowcount:
            raise LookupError("Goal not found")
        return goal_id


def delete_goal(conn: sqlite3.Connection, household_id: int, goal_id: int) -> None:
    with conn:
        conn.execute("DELETE FROM goals WHERE id = ? AND household_id = ?", (goal_id, household_id))


def _cut_candidates(view: dict) -> list[dict]:
    out = []
    for l in view["lines"]:
        share = CUT_SHARE.get(l["flexibility"])
        if l["kind"] != "expense" or not share or l["amount_cents"] < 5000:
            continue
        if l["category"] in NEVER_CUT_CATS or (l["is_debit_order"] and l["category"] not in CANCELLABLE_DEBIT_CATS):
            continue
        cut = int(l["amount_cents"] * share) // 1000 * 1000  # round down to R10
        if cut:
            out.append({"line_id": l["id"], "name": l["name"], "member_name": l["member_name"],
                        "category": l["category"], "flexibility": l["flexibility"],
                        "current_cents": l["amount_cents"], "cut_cents": cut,
                        "new_cents": l["amount_cents"] - cut})
    # Biggest discretionary cuts first; reducible ones after.
    out.sort(key=lambda c: (c["flexibility"] != "discretionary", -c["cut_cents"]))
    return out


def _fee_win(conn, household_id: int, member_id: int | None, month: str) -> int:
    scope = analysis.Scope(household_id, member_id)
    latest = analysis.latest_month(conn, scope)
    if not latest:
        return 0
    f = analysis.fees_and_interest(conn, scope, min(latest, month))
    return sum(k["monthly_avg_cents"] for k in f["fee_kinds"] if k["avoidable"])


def linked_savings(conn: sqlite3.Connection, household_id: int, goal_id: int, month: str) -> int:
    """Budgeted saving lines that go towards this goal (already counted as money going out)."""
    return sum(l["amount_cents"] for l in active_lines(conn, household_id, month)
               if l["kind"] == "saving" and l.get("goal_id") == goal_id)


def plan_goal(conn: sqlite3.Connection, household_id: int, goal: dict, month: str,
              contribution_cents: int | None = None, used_lines: set | None = None, fee_available: bool = True) -> dict:
    """How long the goal takes and what would get it there by its target month.
    used_lines: cut suggestions already given to another goal (each cut is only counted once)."""
    remaining = max(0, goal["target_cents"] - goal["saved_cents"])
    nxt = add_months(month, 1)
    view = month_view(conn, household_id, nxt, goal.get("member_id"))
    surplus_raw = view["household"]["surplus_cents"]
    surplus = max(0, surplus_raw)
    linked = linked_savings(conn, household_id, goal["id"], nxt) if goal.get("id") else 0
    capacity = (surplus if contribution_cents is None else max(0, contribution_cents)) + linked
    past = bool(goal.get("target_month")) and goal["target_month"] <= month

    def months_at(per_month: int) -> int | None:
        return math.ceil(remaining / per_month) if per_month > 0 else None

    result = {
        "goal": goal, "remaining_cents": remaining, "progress_pct": round(100 * goal["saved_cents"] / goal["target_cents"], 1),
        "monthly_surplus_cents": surplus, "contribution_cents": capacity, "linked_savings_cents": linked,
        "months_needed": 0 if remaining == 0 else months_at(capacity),
        "required_monthly_cents": None, "months_left": None, "gap_cents": 0, "past_target": past and remaining > 0,
        "on_track": remaining == 0, "cuts": [], "fee_win_cents": 0,
    }
    if result["months_needed"] is not None:
        result["eta_month"] = add_months(month, result["months_needed"])

    if goal.get("target_month") and not past:
        left = max(1, months_between(month, goal["target_month"]))
        required = math.ceil(remaining / left)
        result.update(months_left=left, required_monthly_cents=required, gap_cents=max(0, required - capacity),
                      on_track=capacity >= required)
    elif past:
        result["on_track"] = remaining == 0  # past its date: needs a new one
    else:
        result["on_track"] = remaining == 0 or capacity > 0  # no deadline: on track while money goes in

    # Suggest cuts: enough to close the gap, or (no deadline) the best few to speed things up.
    target_extra = result["gap_cents"] if goal.get("target_month") and not past else None
    used = used_lines if used_lines is not None else set()
    fee = _fee_win(conn, household_id, goal.get("member_id"), month) if fee_available else 0
    picked, total = [], 0
    if fee:
        result["fee_win_cents"] = fee
        total += fee
    for c in _cut_candidates(view):
        if c["line_id"] in used:
            continue
        if target_extra is not None and total >= target_extra:
            break
        if target_extra is None and len(picked) >= 4:
            break
        picked.append(c)
        total += c["cut_cents"]
    if remaining and (target_extra is None or target_extra > 0):
        used.update(c["line_id"] for c in picked)
        result["cuts"] = picked
        result["cuts_total_cents"] = total
        # A shortfall next month uses up the first part of any cuts.
        result["months_with_cuts"] = months_at(capacity + total + min(0, surplus_raw))
        if result["months_with_cuts"] is not None:
            result["eta_with_cuts"] = add_months(month, result["months_with_cuts"])
        if target_extra is not None:
            result["cuts_close_gap"] = total + min(0, surplus_raw) >= target_extra
    return result


def plan_all(conn: sqlite3.Connection, household_id: int, month: str) -> list[dict]:
    """Plans for every goal, sharing out spare money so no rand is counted twice.

    Personal goals are funded first from that person's spare money; shared goals get what's left of
    the household's. Within a pool, goals with a deadline get what they need first (earliest first),
    then open-ended goals split the rest. Goals past their date get nothing until given a new date.
    Each suggested cut (and the bank-fee saving) is offered to one goal only, in the same order."""
    all_goals = list_goals(conn, household_id)
    nxt = add_months(month, 1)
    contributions: dict[int, int] = {}

    def allocate(goals: list[dict], pool: int) -> int:
        live = [g for g in goals if g["saved_cents"] < g["target_cents"] and not (g["target_month"] and g["target_month"] <= month)]
        for g in sorted((g for g in live if g["target_month"]), key=lambda g: g["target_month"]):
            need = max(0, math.ceil((g["target_cents"] - g["saved_cents"]) / max(1, months_between(month, g["target_month"])))
                       - linked_savings(conn, household_id, g["id"], nxt))
            contributions[g["id"]] = min(need, pool)
            pool -= contributions[g["id"]]
        open_goals = [g for g in live if not g["target_month"]]
        for g in open_goals:
            contributions[g["id"]] = pool // len(open_goals)
        return sum(contributions.get(g["id"], 0) for g in goals)

    personal_total = 0
    for member_id in sorted({g["member_id"] for g in all_goals if g["member_id"] is not None}):
        pool = max(0, month_view(conn, household_id, nxt, member_id)["household"]["surplus_cents"])
        personal_total += allocate([g for g in all_goals if g["member_id"] == member_id], pool)
    household = max(0, month_view(conn, household_id, nxt)["household"]["surplus_cents"])
    allocate([g for g in all_goals if g["member_id"] is None], max(0, household - personal_total))

    def priority(g):
        past = bool(g["target_month"]) and g["target_month"] <= month
        return (past, g["target_month"] is None, g["target_month"] or "", g["id"])

    used: set = set()
    plans, fee_given = {}, False
    for g in sorted(all_goals, key=priority):
        plans[g["id"]] = plan_goal(conn, household_id, g, month, contributions.get(g["id"], 0), used, not fee_given)
        fee_given = fee_given or bool(plans[g["id"]]["fee_win_cents"])
    return [plans[g["id"]] for g in all_goals]
