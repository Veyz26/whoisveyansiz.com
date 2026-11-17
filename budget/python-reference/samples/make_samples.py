"""Generate synthetic FNB and Capitec CSV exports (Aug-Oct 2026) for demos and tests.

These mimic the export layouts; none of the data is real. Run: python samples/make_samples.py
"""
from __future__ import annotations

import csv
import random
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
MONTHS = [(2026, 8), (2026, 9), (2026, 10)]


def fnb_rows(rng: random.Random) -> list[tuple[date, float, str]]:
    rows = []
    for y, m in MONTHS:
        d = lambda day: date(y, m, day)  # noqa: E731
        rows += [
            (d(1), -8750.00, "DEBIT ORDER OAKRIDGE RENTALS REF 40117"),
            (d(1), -175.00, "#Monthly Account Fee"),
            (d(2), -2850.00, "DEBIT ORDER BONITAS MEDICAL AID 5510872"),
            (d(3), -4650.00, "DEBIT ORDER AUTOFIN VEHICLE FINANCE 3390"),
            (d(3), -459.00, "DEBIT ORDER MTN CONTRACT"),
            (d(5), -199.00, "POS PURCHASE NETFLIX.COM 5287 **** **** 0417 05 " + f"{m:02d}"),
            (d(6), -99.00, "POS PURCHASE SHOWMAX 5287*0417"),
            (d(7), -79.99, "POS PURCHASE SPOTIFY P1B2C3 5287*0417"),
            (d(8), -31.50, "#SMS Notification Fee"),
            (d(26), 29400.00, "SALARY NORTHWIND LOGISTICS PTY"),
            (d(26), -2500.00, "FNB App Transfer To Capitec Savings"),
            (d(28), -640.00, "Internet Pmt To Sanlam Funeral Plan"),
            (d(28), -284.20 - m, "#Interest On Overdraft"),
            (d(20), -500.00, "ATM CASH WITHDRAWAL ELMWOOD"),
            (d(20), -12.50, "#Cash Withdrawal Fee ATM"),
            (d(12), -300.00, "ATM CASH WITHDRAWAL STONEBRIDGE"),
            (d(12), -12.50, "#Cash Withdrawal Fee ATM"),
            (d(15), -185.00, "POS PURCHASE LANTERN AND QUILL TRADING 5287*0417"),
        ]
        for day in (4, 11, 18, 25):
            rows.append((d(day), -round(rng.uniform(540, 980), 2), "POS PURCHASE WOOLWORTHS ELMWOOD 5287*0417"))
        for day in (9, 23):
            rows.append((d(day), -round(rng.uniform(620, 840), 2), "POS PURCHASE SHELL STONEBRIDGE 5287*0417"))
        n_eats = 7 if m == 10 else 2  # October spike
        for i in range(n_eats):
            rows.append((d(10 + i * 2), -round(rng.uniform(120, 240), 2), "POS PURCHASE MR D FOOD 5287*0417"))
        rows.append((d(19), -round(rng.uniform(180, 760), 2), "POS PURCHASE TAKEALOT.COM 5287*0417"))
    # an identical pair on the same day (must not be treated as duplicates)
    rows.append((date(2026, 10, 14), -42.00, "POS PURCHASE VIDA E CAFFE 5287*0417"))
    rows.append((date(2026, 10, 14), -42.00, "POS PURCHASE VIDA E CAFFE 5287*0417"))
    return sorted(rows, key=lambda r: r[0])


def write_fnb(rows, path: Path) -> None:
    balance = 15400.00
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ACCOUNT TRANSACTION HISTORY"])
        w.writerow(["Name:", "DEMO USER"])
        w.writerow(["Account:", "62000001234"])
        w.writerow(["Statement period:", "2026/08/01 - 2026/10/31"])
        w.writerow([])
        w.writerow(["Date", "Amount", "Balance", "Description"])
        for d, amt, desc in rows:
            balance += amt
            w.writerow([d.strftime("%Y/%m/%d"), f"{amt:.2f}", f"{balance:.2f}", desc])


def capitec_rows(rng: random.Random):
    rows = []
    for y, m in MONTHS:
        d = lambda day: date(y, m, day)  # noqa: E731
        rows += [
            (d(26), 2500.00, None, None, "Payment Received: Own FNB", "Transfer"),
            (d(2), None, 1250.00, None, "Capitec Personal Loan Repayment", "Loans"),
            (d(2), None, 352.00 + m, None, "Personal Loan Interest", "Interest"),
            (d(3), None, 7.50, None, "Monthly Account Admin Fee", "Fees"),
            (d(27), None, 1200.00, None, "Transfer to Savings Pocket", "Investments"),
            (d(16), None, 200.00, 10.00, "Cash Withdrawal Capitec ATM", "Cash Withdrawal"),
            (d(22), None, 400.00, 10.00, "Cash Withdrawal Capitec ATM", "Cash Withdrawal"),
            (d(13), None, round(rng.uniform(280, 560), 2), None, "Spar Elmwood", "Groceries"),
            (d(21), None, round(rng.uniform(55, 130), 2), None, "Bolt Trip", "Transport"),
            (d(24), None, 159.00, None, "Disney Plus", "Digital Subscriptions"),
            (d(17), None, round(rng.uniform(220, 470), 2), None, "Pep Stonebridge", "Clothing"),
        ]
    return sorted(rows, key=lambda r: r[0])


def write_capitec(rows, path: Path) -> None:
    balance = 5200.00
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Nr", "Account", "Posting Date", "Transaction Date", "Description", "Original Description",
                    "Parent Category", "Category", "Money In", "Money Out", "Fee", "Balance"])
        for i, (d, money_in, money_out, fee, desc, cat) in enumerate(rows, 1):
            balance += (money_in or 0) - (money_out or 0) - (fee or 0)
            w.writerow([
                i, "1234567890", d.strftime("%d/%m/%Y"), d.strftime("%d/%m/%Y"), desc, desc.upper(), "", cat,
                f"{money_in:.2f}" if money_in else "", f"-{money_out:.2f}" if money_out else "",
                f"-{fee:.2f}" if fee else "", f"{balance:.2f}",
            ])


if __name__ == "__main__":
    rng = random.Random(42)
    write_fnb(fnb_rows(rng), HERE / "fnb_sample.csv")
    write_capitec(capitec_rows(rng), HERE / "capitec_sample.csv")
    print("Wrote", HERE / "fnb_sample.csv", "and", HERE / "capitec_sample.csv")
