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
            (d(1), -9500.00, "DEBIT ORDER CITY PROPERTY RENTAL REF 88213"),
            (d(1), -199.00, "#Monthly Account Fee"),
            (d(2), -3200.00, "DEBIT ORDER DISCOVERY HEALTH 4400123"),
            (d(3), -5200.00, "DEBIT ORDER WESBANK VEHICLE FINANCE 7711"),
            (d(3), -499.00, "DEBIT ORDER VODACOM CONTRACT"),
            (d(5), -199.00, "POS PURCHASE NETFLIX.COM 4512 **** **** 9921 05 " + f"{m:02d}"),
            (d(6), -99.00, "POS PURCHASE SHOWMAX 4512*9921"),
            (d(7), -64.99, "POS PURCHASE SPOTIFY P1B2C3 4512*9921"),
            (d(8), -36.00, "#SMS Notification Fee"),
            (d(26), 32000.00, "SALARY ACME SOLUTIONS PTY"),
            (d(26), -3000.00, "FNB App Transfer To Capitec Savings"),
            (d(28), -850.00, "Internet Pmt To Old Mutual Funeral"),
            (d(28), -320.50 - m, "#Interest On Overdraft"),
            (d(20), -400.00, "ATM CASH WITHDRAWAL MENLYN"),
            (d(20), -12.50, "#Cash Withdrawal Fee ATM"),
            (d(12), -400.00, "ATM CASH WITHDRAWAL BROOKLYN"),
            (d(12), -12.50, "#Cash Withdrawal Fee ATM"),
            (d(15), -230.00, "POS PURCHASE LITTLE GECKO TRADING 4512*9921"),
        ]
        for day in (4, 11, 18, 25):
            rows.append((d(day), -round(rng.uniform(650, 1100), 2), "POS PURCHASE CHECKERS HAZELWOOD 4512*9921"))
        for day in (9, 23):
            rows.append((d(day), -round(rng.uniform(700, 900), 2), "POS PURCHASE ENGEN LYNNWOOD 4512*9921"))
        n_eats = 7 if m == 10 else 2  # October spike
        for i in range(n_eats):
            rows.append((d(10 + i * 2), -round(rng.uniform(140, 260), 2), "POS PURCHASE UBER EATS 4512*9921"))
        rows.append((d(19), -round(rng.uniform(200, 900), 2), "POS PURCHASE TAKEALOT.COM 4512*9921"))
    # an identical pair on the same day (must not be treated as duplicates)
    rows.append((date(2026, 10, 14), -35.00, "POS PURCHASE VIDA E CAFFE 4512*9921"))
    rows.append((date(2026, 10, 14), -35.00, "POS PURCHASE VIDA E CAFFE 4512*9921"))
    return sorted(rows, key=lambda r: r[0])


def write_fnb(rows, path: Path) -> None:
    balance = 18200.00
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
            (d(26), 3000.00, None, None, "Payment Received: Own FNB", "Transfer"),
            (d(2), None, 1500.00, None, "Capitec Personal Loan Repayment", "Loans"),
            (d(2), None, 410.00 + m, None, "Personal Loan Interest", "Interest"),
            (d(3), None, 7.50, None, "Monthly Account Admin Fee", "Fees"),
            (d(27), None, 1000.00, None, "Transfer to Savings Pocket", "Investments"),
            (d(16), None, 300.00, 10.00, "Cash Withdrawal Capitec ATM", "Cash Withdrawal"),
            (d(22), None, 300.00, 10.00, "Cash Withdrawal Capitec ATM", "Cash Withdrawal"),
            (d(13), None, round(rng.uniform(300, 600), 2), None, "Pick n Pay Menlyn", "Groceries"),
            (d(21), None, round(rng.uniform(60, 140), 2), None, "Uber Trip", "Transport"),
            (d(24), None, 159.00, None, "Disney Plus", "Digital Subscriptions"),
            (d(17), None, round(rng.uniform(250, 500), 2), None, "Mr Price Menlyn", "Clothing"),
        ]
    return sorted(rows, key=lambda r: r[0])


def write_capitec(rows, path: Path) -> None:
    balance = 6500.00
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
