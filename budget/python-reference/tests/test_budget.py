"""Run with: python3 -m unittest discover tests"""
from __future__ import annotations

import csv
import io
import json
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path

from budget_app import advice, analysis, auth, billing, budget, db, export, forecast, goals, privacy, xlsx_import
from budget_app.categorise import set_category
from budget_app.debt import Debt, compare, simulate
from budget_app.importer import import_statement, merchant_key, sanitise_description
from budget_app.money import add_months, format_zar, parse_amount, parse_date
from budget_app.parsers import StatementFormatError, detect_bank, parse_statement

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
FNB = (SAMPLES / "fnb_sample.csv").read_text()
CAPITEC = (SAMPLES / "capitec_sample.csv").read_text()
PW = "correct horse battery"


class MoneyTests(unittest.TestCase):
    def test_amounts(self):
        cases = {"-1 234.56": -123456, "1,234.56": 123456, "1234,56": 123456, "150.00 Cr": 15000,
                 "150.00 Dr": -15000, "(99.90)": -9990, "R 99.00": 9900, "0.1": 10, "": None, "1.005": 101}
        for raw, want in cases.items():
            self.assertEqual(parse_amount(raw), want, raw)

    def test_dates(self):
        for raw in ("2026/10/05", "2026-10-05", "05 Oct 2026", "05/10/2026", "2026-10-05 00:00"):
            self.assertEqual(parse_date(raw), date(2026, 10, 5), raw)

    def test_months_and_format(self):
        self.assertEqual(add_months("2026-01", -1), "2025-12")
        self.assertEqual(format_zar(150000), "R1 500")
        self.assertEqual(format_zar(-123456), "-R1 234.56")


class ParserTests(unittest.TestCase):
    def test_detect_and_parse(self):
        self.assertEqual(detect_bank(FNB), "fnb")
        self.assertEqual(detect_bank(CAPITEC), "capitec")
        self.assertEqual(parse_statement(FNB).account_last4, "1234")
        fees = [t for t in parse_statement(CAPITEC).transactions if t.description.startswith("Fee:")]
        self.assertEqual(len(fees), 6)

    def test_rejects_pdf_and_garbage(self):
        with self.assertRaises(StatementFormatError):
            parse_statement("%PDF-1.7")
        with self.assertRaises(StatementFormatError):
            parse_statement("hello,world\n1,2\n")

    def test_card_numbers_masked(self):
        for raw in ("PURCHASE 4512 3456 7890 9921", "PURCHASE 4512 **** **** 9921", "PURCHASE 451234*9921"):
            out = sanitise_description(raw)
            self.assertNotIn("4512", out)
            self.assertIn("9921", out)
        self.assertEqual(merchant_key("POS PURCHASE CHECKERS HAZELWOOD ****9921"), "CHECKERS HAZELWOOD")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "t.db")
        with self.conn:
            self.hid = auth.create_household(self.conn, "Test", ["Veyz", "Tiara"])
        self.v, self.t = [r[0] for r in self.conn.execute(
            "SELECT id FROM members WHERE household_id = ? ORDER BY sort", (self.hid,))]

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def line(self, member, kind, name, rands, start="2026-03", **kw):
        return budget.create_line(self.conn, self.hid, member_id=member, kind=kind, name=name,
                                  amount_cents=int(rands * 100), start_month=start, **kw)


class StatementTests(Base):
    def test_reimport_idempotent_and_scoped(self):
        first = import_statement(self.conn, self.hid, FNB, member_id=self.v, account_label="FNB")
        again = import_statement(self.conn, self.hid, FNB, member_id=self.v, account_label="FNB")
        self.assertEqual(again.rows_added, 0)
        self.assertEqual(again.rows_duplicate, first.rows_total)
        with self.conn:
            other = auth.create_household(self.conn, "Other", ["X"])
        self.assertEqual(analysis.months(self.conn, analysis.Scope(other)), [])

    def test_transfers_linked_and_categories(self):
        import_statement(self.conn, self.hid, FNB, member_id=self.v, account_label="FNB")
        import_statement(self.conn, self.hid, CAPITEC, member_id=self.t, account_label="Capitec")
        n = self.conn.execute("SELECT COUNT(*) FROM transactions WHERE is_transfer = 1 AND abs(amount_cents) = 300000").fetchone()[0]
        self.assertEqual(n, 6)
        cat = lambda m: self.conn.execute("SELECT DISTINCT category FROM transactions WHERE merchant = ?", (m,)).fetchone()[0]
        self.assertEqual(cat("UBER EATS"), "Eating out")
        self.assertEqual(cat("UBER TRIP"), "Fuel & transport")
        self.assertEqual(cat("DISCOVERY HEALTH"), "Medical & health")

    def test_member_scope(self):
        import_statement(self.conn, self.hid, FNB, member_id=self.v, account_label="FNB")
        import_statement(self.conn, self.hid, CAPITEC, member_id=self.t, account_label="Capitec")
        both = analysis.totals(self.conn, analysis.Scope(self.hid), "2026-10")[1]
        v = analysis.totals(self.conn, analysis.Scope(self.hid, self.v), "2026-10")[1]
        t = analysis.totals(self.conn, analysis.Scope(self.hid, self.t), "2026-10")[1]
        self.assertEqual(both, v + t)

    def test_override_rule_is_per_household(self):
        import_statement(self.conn, self.hid, FNB, member_id=self.v, account_label="FNB")
        tid = self.conn.execute("SELECT id FROM transactions WHERE merchant = 'LITTLE GECKO TRADING'").fetchone()[0]
        self.assertEqual(set_category(self.conn, self.hid, tid, "Shopping")["updated"], 3)
        with self.conn:
            other = auth.create_household(self.conn, "Other", ["X"])
        import_statement(self.conn, other, FNB, account_label="FNB")
        cats = {r[0] for r in self.conn.execute(
            "SELECT category FROM transactions WHERE household_id = ? AND merchant = 'LITTLE GECKO TRADING'", (other,))}
        self.assertEqual(cats, {"Other"})

    def test_advice_still_works(self):
        import_statement(self.conn, self.hid, FNB, member_id=self.v, account_label="FNB")
        a = advice.top_actions(self.conn, analysis.Scope(self.hid), "2026-10")
        self.assertEqual(len(a["actions"]), 3)


class BudgetTests(Base):
    def test_amount_history_onward_and_once(self):
        rent = self.line(self.v, "expense", "Rent", 15000, is_debit_order=True)
        budget.set_amount(self.conn, self.hid, rent, "2026-05", 1620000)
        budget.set_amount(self.conn, self.hid, rent, "2026-07", 2000000, mode="once")
        self.assertEqual(budget.amount_on(self.conn, rent, "2026-04"), 1500000)
        self.assertEqual(budget.amount_on(self.conn, rent, "2026-06"), 1620000)
        self.assertEqual(budget.amount_on(self.conn, rent, "2026-07"), 2000000)
        self.assertEqual(budget.amount_on(self.conn, rent, "2026-08"), 1620000)
        hist = budget.history(self.conn, self.hid, rent)
        self.assertEqual([h["change_cents"] for h in hist], [None, 120000, 380000, -380000])

    def test_month_view_matches_spreadsheet_math(self):
        self.line(self.v, "income", "Veyz salary", 48800)
        self.line(self.v, "expense", "Rent", 15600)
        self.line(self.v, "expense", "Car", 5800, is_debit_order=True)
        self.line(self.t, "income", "Tiara salary", 19700)
        self.line(self.t, "expense", "Food", 8000)
        self.line(self.t, "transfer", "To Veyz", 1500, to_member_id=self.v)
        v = budget.month_view(self.conn, self.hid, "2026-11")
        people = {p["name"]: p for p in v["people"]}
        self.assertEqual(people["Veyz"]["surplus_cents"], (48800 + 1500 - 15600 - 5800) * 100)
        self.assertEqual(people["Tiara"]["surplus_cents"], (19700 - 8000 - 1500) * 100)
        # Transfers cancel out at household level.
        self.assertEqual(v["household"]["surplus_cents"], sum(p["surplus_cents"] for p in v["people"]))
        only_t = budget.month_view(self.conn, self.hid, "2026-11", self.t)
        self.assertEqual([p["name"] for p in only_t["people"]], ["Tiara"])

    def test_end_month_and_defaults(self):
        dentist = self.line(self.v, "expense", "Dentist", 3000, start="2026-09", end_month="2026-11")
        self.assertIn(dentist, [l["id"] for l in budget.active_lines(self.conn, self.hid, "2026-11")])
        self.assertNotIn(dentist, [l["id"] for l in budget.active_lines(self.conn, self.hid, "2026-12")])
        food = self.conn.execute("SELECT category, flexibility FROM budget_lines WHERE id = ?",
                                 (self.line(self.t, "expense", "Food", 8000),)).fetchone()
        self.assertEqual(tuple(food), ("Groceries", "reducible"))
        car = self.conn.execute("SELECT flexibility FROM budget_lines WHERE id = ?",
                                (self.line(self.v, "expense", "Car", 5800, is_debit_order=True),)).fetchone()[0]
        self.assertEqual(car, "fixed")

    def test_other_household_cannot_touch_lines(self):
        rent = self.line(self.v, "expense", "Rent", 15000)
        with self.conn:
            other = auth.create_household(self.conn, "Other", ["X"])
        with self.assertRaises(LookupError):
            budget.set_amount(self.conn, other, rent, "2026-05", 1)
        with self.assertRaises(ValueError):
            budget.create_line(self.conn, other, member_id=self.v, kind="expense", name="x", amount_cents=1,
                               start_month="2026-05")


class ForecastGoalTests(Base):
    def setUp(self):
        super().setUp()
        self.line(self.v, "income", "Veyz salary", 30000)
        self.gym = self.line(self.v, "expense", "Gym", 750, is_debit_order=True)
        self.line(self.v, "expense", "Mediwallet", 1700, end_month="2026-11")
        self.line(self.v, "expense", "Takeout", 2500)
        self.line(self.v, "expense", "Rent", 20000)
        budget.set_amount(self.conn, self.hid, self.gym, "2026-12", 109000)

    def test_insights(self):
        f = forecast.forecast(self.conn, self.hid, "2026-11")
        titles = " | ".join(i["title"] for i in f["insights"])
        self.assertIn("Gym goes up R340", titles)
        self.assertIn("Mediwallet ends this month", titles)
        self.assertEqual(f["projection"][1]["household_surplus_cents"] - f["projection"][0]["household_surplus_cents"],
                         170000 - 34000)

    def test_goal_plan_and_cuts(self):
        gid = goals.save_goal(self.conn, self.hid, {"name": "Holiday", "target_cents": 4000000, "target_month": "2027-05"})
        g = goals.plan_all(self.conn, self.hid, "2026-11")[0]
        self.assertEqual(g["goal"]["id"], gid)
        self.assertEqual(g["required_monthly_cents"], 666667)  # R40 000 over 6 months; R6 410 spare
        self.assertGreater(g["gap_cents"], 0)
        names = [c["name"] for c in g["cuts"]]
        self.assertIn("Takeout", names)
        self.assertNotIn("Rent", names)

    def test_goals_share_surplus(self):
        goals.save_goal(self.conn, self.hid, {"name": "A", "target_cents": 600000, "target_month": "2027-05"})
        goals.save_goal(self.conn, self.hid, {"name": "B", "target_cents": 9000000})
        plans = goals.plan_all(self.conn, self.hid, "2026-11")
        surplus = budget.month_view(self.conn, self.hid, "2026-12")["household"]["surplus_cents"]
        self.assertEqual(sum(p["contribution_cents"] for p in plans), surplus)


class WorkbookTests(Base):
    @staticmethod
    def make_xlsx(sheets: dict[str, list[list]]) -> bytes:
        def col(i):
            return chr(64 + i)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                       'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                       + "".join(f'<sheet name="{n}" sheetId="{i}" r:id="rId{i}"/>' for i, n in enumerate(sheets, 1))
                       + "</sheets></workbook>")
            z.writestr("xl/_rels/workbook.xml.rels",
                       '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                       + "".join(f'<Relationship Id="rId{i}" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1))
                       + "</Relationships>")
            for i, rows in enumerate(sheets.values(), 1):
                xml = []
                for r, row in enumerate(rows, 1):
                    cells = []
                    for c, v in enumerate(row, 1):
                        if v is None:
                            continue
                        ref = f"{col(c)}{r}"
                        cells.append(f'<c r="{ref}"><v>{v}</v></c>' if isinstance(v, (int, float))
                                     else f'<c r="{ref}" t="inlineStr"><is><t>{v}</t></is></c>')
                    xml.append(f'<row r="{r}">{"".join(cells)}</row>')
                z.writestr(f"xl/worksheets/sheet{i}.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/'
                           f'spreadsheetml/2006/main"><sheetData>{"".join(xml)}</sheetData></worksheet>')
        return buf.getvalue()

    def sheet(self, rent, extra=True):
        rows = [[None, "Veyz Salary", 48800], [None, "Type", "Amount", "Notes"],
                ["Fixed Debit Orders", "Rent", rent], [None, "Car", 5800, "R5800"]]
        if extra:
            rows.append(["Misc", "Mediwallet", 1700, "Last month to pay"])
        rows += [[None, "Total", 0], [None, "T Salary", 19700], [None, "Type", "Amount"], [None, "Food", 8000],
                 [None, "Total", 0]]
        return rows

    def test_import_builds_history(self):
        data = self.make_xlsx({"March 26": self.sheet(15000), "May 26": self.sheet(16200, extra=False),
                               "Sheet3": [["junk"]]})
        p = xlsx_import.preview(data)
        self.assertEqual(p["people"], ["Veyz", "T"])
        r = xlsx_import.import_workbook(self.conn, self.hid, data, {"Veyz": self.v, "T": self.t})
        self.assertEqual(r["amount_changes"], 1)
        rent = self.conn.execute("SELECT id, is_debit_order, section FROM budget_lines WHERE name = 'Rent'").fetchone()
        self.assertEqual(budget.amount_on(self.conn, rent["id"], "2026-04"), 1500000)
        self.assertEqual(budget.amount_on(self.conn, rent["id"], "2026-05"), 1620000)
        self.assertEqual((rent["is_debit_order"], rent["section"]), (1, "Fixed Debit Orders"))
        medi = self.conn.execute("SELECT end_month, notes FROM budget_lines WHERE name = 'Mediwallet'").fetchone()
        # Missing from the May sheet: it ends the month before (April), not straight after March.
        self.assertEqual(tuple(medi), ("2026-04", "Last month to pay"))
        v = budget.month_view(self.conn, self.hid, "2026-05")
        self.assertEqual({p["name"]: p["surplus_cents"] for p in v["people"]},
                         {"Veyz": (48800 - 16200 - 5800) * 100, "Tiara": (19700 - 8000) * 100})

    def test_reimport_is_idempotent_and_reclassifies(self):
        march = self.sheet(15000)
        march[3] = ["Monthly", "Car", 5800]  # first seen outside the debit-order section
        may = self.sheet(16200, extra=False)
        data = self.make_xlsx({"March 26": march, "May 26": may})
        first = xlsx_import.import_workbook(self.conn, self.hid, data, {"Veyz": self.v, "T": self.t})
        n = self.conn.execute("SELECT COUNT(*) FROM budget_lines").fetchone()[0]
        again = xlsx_import.import_workbook(self.conn, self.hid, data, {"Veyz": self.v, "T": self.t})
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM budget_lines").fetchone()[0], n)
        self.assertEqual((again["items_created"], again["amount_changes"]), (0, 0))
        car = self.conn.execute("SELECT section, is_debit_order FROM budget_lines WHERE name = 'Car'").fetchone()
        self.assertEqual(tuple(car), ("Fixed Debit Orders", 1))  # updated by the later sheet
        self.assertGreater(first["items_created"], 0)

    def test_rejects_non_workbook(self):
        with self.assertRaises(xlsx_import.WorkbookError):
            xlsx_import.preview(b"not a zip")


class AuthPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "t.db")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def signup(self, email="a@example.test", **kw):
        return auth.signup(self.conn, email=email, name="Veyz", password=PW, partner_name="Tiara",
                           consents={"service": True, **kw.pop("consents", {})}, **kw)

    def test_password_hash_and_login(self):
        h = auth.hash_password(PW)
        self.assertNotIn(PW, h)
        self.assertTrue(auth.verify_password(PW, h))
        self.assertFalse(auth.verify_password("wrong password", h))
        uid = self.signup()
        self.assertEqual(auth.login(self.conn, "A@Example.test", PW), uid)
        with self.assertRaises(auth.AuthError):
            auth.login(self.conn, "a@example.test", "nope")

    def test_signup_requires_consent_and_strength(self):
        with self.assertRaises(auth.AuthError):
            auth.signup(self.conn, email="b@example.test", name="B", password=PW, partner_name=None, consents={})
        with self.assertRaises(auth.AuthError):
            auth.signup(self.conn, email="b@example.test", name="B", password="short", partner_name=None,
                        consents={"service": True})

    def test_lockout(self):
        self.signup()
        for _ in range(auth.MAX_FAILED):
            with self.assertRaises(auth.AuthError):
                auth.login(self.conn, "a@example.test", "bad password!")
        with self.assertRaisesRegex(auth.AuthError, "Too many"):
            auth.login(self.conn, "a@example.test", PW)

    def test_sessions_store_only_hashes(self):
        uid = self.signup()
        token = auth.start_session(self.conn, uid)
        self.assertIsNone(self.conn.execute("SELECT 1 FROM sessions WHERE token_hash = ?", (token,)).fetchone())
        s = auth.get_session(self.conn, token)
        self.assertEqual((s.user_id, s.role), (uid, "owner"))
        auth.end_session(self.conn, token)
        self.assertIsNone(auth.get_session(self.conn, token))

    def test_invite_joins_partner(self):
        uid = self.signup()
        hid = self.conn.execute("SELECT household_id FROM memberships WHERE user_id = ?", (uid,)).fetchone()[0]
        token = auth.create_invite(self.conn, hid, uid)
        pid = auth.signup(self.conn, email="t@example.test", name="Tiara", password=PW, partner_name=None,
                          consents={"service": True}, invite_token=token)
        s = auth.get_session(self.conn, auth.start_session(self.conn, pid))
        self.assertEqual((s.household_id, s.role), (hid, "partner"))
        linked = self.conn.execute("SELECT user_id FROM members WHERE household_id = ? AND name = 'Tiara'", (hid,)).fetchone()[0]
        self.assertEqual(linked, pid)
        with self.assertRaises(auth.AuthError):  # single use
            auth.signup(self.conn, email="x@example.test", name="X", password=PW, partner_name=None,
                        consents={"service": True}, invite_token=token)

    def test_export_and_delete(self):
        uid = self.signup()
        hid = self.conn.execute("SELECT household_id FROM memberships WHERE user_id = ?", (uid,)).fetchone()[0]
        mid = self.conn.execute("SELECT id FROM members WHERE household_id = ? LIMIT 1", (hid,)).fetchone()[0]
        budget.create_line(self.conn, hid, member_id=mid, kind="expense", name="Rent", amount_cents=1, start_month="2026-01")
        import_statement(self.conn, hid, FNB, account_label="FNB")
        data = privacy.export_household(self.conn, hid, uid)
        self.assertEqual(data["users"][0]["email"], "a@example.test")
        self.assertNotIn("password_hash", json.dumps(data))
        privacy.delete_household(self.conn, hid)
        for table in ("transactions", "budget_lines", "members", "accounts", "sessions"):
            self.assertEqual(self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0, table)
        self.assertIsNone(self.conn.execute("SELECT 1 FROM users WHERE id = ?", (uid,)).fetchone())

    def test_billing_gate(self):
        uid = self.signup()
        hid = self.conn.execute("SELECT household_id FROM memberships WHERE user_id = ?", (uid,)).fetchone()[0]
        self.assertTrue(billing.can_write(self.conn, hid))
        self.conn.execute("UPDATE households SET trial_ends_on = '2020-01-01' WHERE id = ?", (hid,))
        self.assertEqual(billing.status(self.conn, hid)["status"], "expired")
        self.assertFalse(billing.can_write(self.conn, hid))
        billing.simulate_payment(self.conn, hid, "household", uid)
        self.assertTrue(billing.can_write(self.conn, hid))


class ExportTests(Base):
    def test_csv_and_formula_injection(self):
        self.line(self.v, "expense", "=HYPERLINK(\"x\")", 100)
        rows = list(csv.reader(io.StringIO(export.table_csv(self.conn, self.hid, "fact_budget").decode("utf-8-sig"))))
        self.assertEqual(rows[0][:3], ["month", "person_id", "to_person_id"])
        self.assertTrue(all(not r[4].startswith("=") for r in rows[1:]))
        z = zipfile.ZipFile(io.BytesIO(export.zip_export(self.conn, self.hid)))
        self.assertIn("README.txt", z.namelist())
        self.assertEqual(len([n for n in z.namelist() if n.endswith(".csv")]), len(export.TABLES))

    def test_api_token(self):
        token = auth.create_api_token(self.conn, self.hid, None, "PBI")
        self.assertEqual(auth.check_api_token(self.conn, token), self.hid)
        tid = self.conn.execute("SELECT id FROM api_tokens").fetchone()[0]
        auth.revoke_api_token(self.conn, self.hid, None, tid)
        self.assertIsNone(auth.check_api_token(self.conn, token))


class DebtTests(unittest.TestCase):
    def test_amortisation_and_strategies(self):
        r = simulate([Debt("x", 1_000_000, 1200, 100_000)], 0, "minimum")
        self.assertEqual(r["months"], 11)
        p = compare([Debt("Car", 18_500_000, 1325, 520_000), Debt("Loan", 2_400_000, 2475, 150_000),
                     Debt("Overdraft", 1_500_000, 2150, 50_000)], 200_000)
        self.assertLessEqual(p["avalanche"]["total_interest_cents"], p["snowball"]["total_interest_cents"])
        self.assertTrue(simulate([Debt("x", 1_000_000, 3600, 20_000)], 0, "minimum")["never_pays_off"])


if __name__ == "__main__":
    unittest.main()
