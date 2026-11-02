"""A fictional demo household (Alex & Sam) so the app can be explored without real data."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from .auth import create_household
from .budget import create_line, set_amount, set_paid, this_month
from .importer import import_statement
from .money import add_months

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


def seed(conn: sqlite3.Connection) -> int:
    with conn:
        hid = create_household(conn, "Alex & Sam", ["Alex", "Sam"], is_demo=True)
    alex, sam = [r[0] for r in conn.execute("SELECT id FROM members WHERE household_id = ? ORDER BY sort", (hid,))]
    now = this_month()
    start = add_months(now, -5)

    def line(member, kind, name, rands, section=None, **kw):
        return create_line(conn, hid, member_id=member, kind=kind, name=name, amount_cents=int(rands * 100),
                           start_month=kw.pop("start", start), section=section, **kw)

    # Alex
    line(alex, "income", "Alex salary", 46200)
    car = line(alex, "expense", "Car finance", 5800, "Debit orders", is_debit_order=True, category="Debt repayments")
    rent = line(alex, "expense", "Rent", 15000, "Debit orders", is_debit_order=True)
    line(alex, "expense", "Utilities", 1800, "Debit orders", is_debit_order=True, category="Housing & utilities",
         notes="Gas, electricity, water")
    line(alex, "expense", "Fibre", 1000, "Debit orders", is_debit_order=True)
    ins = line(alex, "expense", "Car & home insurance", 2600, "Debit orders", is_debit_order=True, category="Insurance")
    line(alex, "expense", "Life & funeral cover", 1063, "Debit orders", is_debit_order=True, category="Insurance",
         notes="R747 + R186 + R130")
    subs = line(alex, "expense", "Streaming subscriptions", 680, "Debit orders", is_debit_order=True,
                category="Subscriptions", notes="Netflix R199 + Showmax R99 + Spotify R65 + iCloud R317")
    line(alex, "expense", "Bank fees", 455, "Debit orders", is_debit_order=True, category="Bank fees")
    gym = line(alex, "expense", "Gym", 750, "Debit orders", is_debit_order=True, category="Fitness & leisure")
    line(alex, "expense", "Medical aid gap cover", 1700, "Debit orders", is_debit_order=True,
         category="Medical & health")
    line(alex, "expense", "Fuel", 4000, "Monthly", category="Fuel & transport")
    line(alex, "expense", "Toiletries", 1000, "Monthly", category="Personal care")
    line(alex, "expense", "Golf", 1300, "Personal", category="Fitness & leisure")
    line(alex, "expense", "Haircut", 400, "Personal", category="Personal care")
    line(alex, "expense", "Dentist (3 payments)", 3000, "Monthly", category="Medical & health",
         start=add_months(now, -2), end_month=now, notes="R9 000 over 3 months")
    line(alex, "saving", "Emergency fund", 1000, "Savings")

    # Sam
    line(sam, "income", "Sam salary", 18800)
    line(sam, "expense", "Groceries", 8000, "Household", category="Groceries")
    line(sam, "expense", "Date night", 2500, "Household", category="Eating out")
    line(sam, "expense", "Takeout", 1500, "Household", category="Eating out")
    line(sam, "expense", "Wax & beauty", 1600, "Personal", category="Personal care")
    line(sam, "expense", "Medication", 1400, "Personal", category="Medical & health")
    line(sam, "expense", "Tithes", 500, "Personal", category="Giving")
    line(sam, "transfer", "Contribution to rent", 1500, "Transfers", to_member_id=alex)
    line(sam, "saving", "Tax-free savings", 1000, "Savings", category="Savings & investments",
         start=add_months(now, -3))

    # Changes over time, like real debit orders
    set_amount(conn, hid, rent, add_months(now, -2), 15600_00, note="Annual escalation")
    set_amount(conn, hid, ins, add_months(now, -3), 2900_00, note="Premium increase")
    set_amount(conn, hid, ins, now, 3050_00, note="Premium increase")
    set_amount(conn, hid, subs, add_months(now, -1), 850_00, note="Added YouTube Premium")
    set_amount(conn, hid, gym, add_months(now, 1), 1090_00, note="Contract renewal")
    conn.execute("UPDATE budget_lines SET end_month = ? WHERE id = ?", (add_months(now, 6), car))  # last instalment
    conn.execute("UPDATE budget_lines SET end_month = ? WHERE household_id = ? AND name = 'Medical aid gap cover'",
                 (now, hid))
    conn.commit()

    for lid in [r[0] for r in conn.execute(
            "SELECT id FROM budget_lines WHERE household_id = ? AND kind != 'income' ORDER BY sort LIMIT 9", (hid,))]:
        set_paid(conn, hid, lid, now, True)

    with conn:
        conn.execute("INSERT INTO goals (household_id, member_id, name, target_cents, saved_cents, target_month) "
                     "VALUES (?, NULL, 'Emergency fund (3 months)', 6000000, 850000, ?)", (hid, add_months(now, 18)))
        conn.execute("INSERT INTO goals (household_id, member_id, name, target_cents, saved_cents, target_month) "
                     "VALUES (?, NULL, 'Mauritius holiday', 4500000, 600000, ?)", (hid, add_months(now, 10)))
        conn.execute("INSERT INTO goals (household_id, member_id, name, target_cents, saved_cents) "
                     "VALUES (?, ?, 'New laptop', 2200000, 300000)", (hid, sam))
        conn.executemany("INSERT INTO debts (household_id, name, balance_cents, apr_bp, min_payment_cents) "
                         "VALUES (?, ?, ?, ?, ?)",
                         [(hid, "Car finance", 3480000, 1325, 580000),
                          (hid, "Credit card", 1420000, 2075, 70000),
                          (hid, "Store account", 380000, 2400, 45000)])

    for name, label, member in (("fnb_sample.csv", "FNB Cheque", alex), ("capitec_sample.csv", "Capitec Everyday", sam)):
        path = SAMPLES / name
        if path.exists():
            import_statement(conn, hid, path.read_text(), member_id=member, account_label=label, filename=name)
    return hid
