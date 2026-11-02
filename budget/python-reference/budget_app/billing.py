"""Subscription plans and access gating.

Payment collection is NOT implemented: plug a provider in at `activate()` (PayFast or
Paystack suit South African cards and debit orders). Until then, `simulate_payment` exists
only in development mode so the flow can be tried end to end.

Gating rule: an expired trial or cancelled plan makes the household read-only. Export and
delete always keep working, because POPIA access and deletion rights don't depend on payment.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import date, timedelta

from .db import audit

# Prices are placeholders for the business owner to set.
PLANS = {
    "household": {"name": "Household", "price_cents": 7900, "interval": "month",
                  "features": ["2 people", "Monthly budget & forecast", "Goals", "Statement import", "Power BI export"]},
    "household_annual": {"name": "Household (annual)", "price_cents": 79000, "interval": "year",
                         "features": ["Everything in Household", "2 months free"]},
}


def dev_mode() -> bool:
    return os.environ.get("BUDGET_ENV", "development") == "development"


def status(conn: sqlite3.Connection, household_id: int) -> dict:
    h = conn.execute("SELECT * FROM households WHERE id = ?", (household_id,)).fetchone()
    today = date.today().isoformat()
    state = h["subscription_status"]
    if state == "trialing" and h["trial_ends_on"] and h["trial_ends_on"] < today:
        state = "expired"
    if state == "active" and h["paid_until"] and h["paid_until"] < today:
        state = "past_due"
    days_left = None
    if state == "trialing" and h["trial_ends_on"]:
        days_left = (date.fromisoformat(h["trial_ends_on"]) - date.today()).days
    return {
        "plan": h["plan"], "plan_info": PLANS.get(h["plan"]), "status": state,
        "trial_ends_on": h["trial_ends_on"], "trial_days_left": days_left, "paid_until": h["paid_until"],
        # A cancelled plan keeps working until the end of the period already paid for.
        "can_write": bool(h["is_demo"]) or state in ("trialing", "active")
                     or (state == "cancelled" and bool(h["paid_until"]) and h["paid_until"] >= today),
        "plans": PLANS, "payments_configured": False, "dev_mode": dev_mode(),
    }


def can_write(conn: sqlite3.Connection, household_id: int) -> bool:
    return status(conn, household_id)["can_write"]


def activate(conn: sqlite3.Connection, household_id: int, plan: str, user_id: int | None, months: int) -> None:
    """Call this from the payment provider's verified webhook once a payment succeeds."""
    if plan not in PLANS:
        raise ValueError("Unknown plan")
    paid_until = (date.today() + timedelta(days=31 * months)).isoformat()
    with conn:
        conn.execute("UPDATE households SET plan = ?, subscription_status = 'active', paid_until = ? WHERE id = ?",
                     (plan, paid_until, household_id))
        audit(conn, household_id, user_id, "subscription.activated", plan)


def simulate_payment(conn: sqlite3.Connection, household_id: int, plan: str, user_id: int | None) -> None:
    if not dev_mode():
        raise PermissionError("Payments aren't configured.")
    activate(conn, household_id, plan, user_id, 12 if PLANS.get(plan, {}).get("interval") == "year" else 1)


def cancel(conn: sqlite3.Connection, household_id: int, user_id: int | None) -> None:
    with conn:
        conn.execute("UPDATE households SET subscription_status = 'cancelled' WHERE id = ?", (household_id,))
        audit(conn, household_id, user_id, "subscription.cancelled", None)
