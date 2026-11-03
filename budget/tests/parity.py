"""Runs the same scenarios through python-reference and the PHP port and compares every output.
Usage (from budget/): python3 tests/parity.py [path/to/workbook.xlsx]"""
import json, math, pathlib, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python-reference"))
from budget_app import analysis, auth, budget, db, debt, demo, forecast, goals, xlsx_import  # noqa: E402
from budget_app.money import add_months  # noqa: E402

def py_dump(scenario, xlsx=None):
    tmp = tempfile.mkdtemp()
    conn = db.connect(pathlib.Path(tmp) / "p.db")
    now = budget.this_month()
    out = {}
    if scenario == "demo":
        demo.SAMPLES = ROOT / "tests"
        hid = demo.seed(conn)
        members = [m["id"] for m in budget.members(conn, hid)]
        for i in range(-5, 8):
            m = add_months(now, i)
            out[f"month_view {m}"] = budget.month_view(conn, hid, m)
        for mid in [None, *members]:
            key = "" if mid is None else mid
            out[f"forecast {key}"] = forecast.forecast(conn, hid, now, mid)
            out[f"debits {key}"] = budget.debit_order_review(conn, hid, now, mid)
            out[f"member_view {key}"] = budget.month_view(conn, hid, now, mid)
            s = analysis.Scope(hid, mid)
            out[f"summary {key}"] = analysis.summary(conn, s, "2026-10")
            out[f"fees {key}"] = analysis.fees_and_interest(conn, s, "2026-10")
            out[f"recurring {key}"] = analysis.recurring(conn, s, "2026-10")
            from budget_app import advice
            out[f"advice {key}"] = advice.top_actions(conn, s, "2026-10")
        out["goals"] = goals.plan_all(conn, hid, now)
        out["debt"] = debt.compare(debt.load_debts(conn, hid), 200000)
    else:
        with conn:
            hid = auth.create_household(conn, "Test", ["Veyz", "Tiara"])
        v, t = [m["id"] for m in budget.members(conn, hid)]
        data = pathlib.Path(xlsx).read_bytes()
        out["preview"] = xlsx_import.preview(data)
        out["import"] = xlsx_import.import_workbook(conn, hid, data, {"Veyz": v, "T": t})
        for m in ["2025-07", "2025-09", "2026-01", "2026-03", "2026-04", "2026-05", "2026-11", "2026-12"]:
            out[f"month_view {m}"] = budget.month_view(conn, hid, m)
            out[f"forecast {m}"] = forecast.forecast(conn, hid, m)
            out[f"debits {m}"] = budget.debit_order_review(conn, hid, m)
        goals.save_goal(conn, hid, {"name": "Emergency fund", "target_cents": 3000000, "target_month": "2027-06"})
        goals.save_goal(conn, hid, {"name": "Laptop", "target_cents": 2000000, "member_id": t})
        out["goals"] = goals.plan_all(conn, hid, "2026-11")
    return json.loads(json.dumps(out, default=str))

IGNORE = {"created_at", "household_id", "sort"}

def diff(a, b, path, errs):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k in IGNORE:
                continue
            if k not in a or k not in b:
                errs.append(f"{path}.{k}: only in {'php' if k in b else 'python'}")
            else:
                diff(a[k], b[k], f"{path}.{k}", errs)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            errs.append(f"{path}: {len(a)} items (python) vs {len(b)} (php)")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", errs)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        if not math.isclose(a, b, abs_tol=1e-9):
            errs.append(f"{path}: {a!r} (python) vs {b!r} (php)")
    elif a != b and not (a in (None, {}, []) and b in (None, {}, [])):
        errs.append(f"{path}: {a!r} (python) vs {b!r} (php)")

def run(scenario, xlsx=None):
    py = py_dump(scenario, xlsx)
    php = json.loads(subprocess.run(["php", str(ROOT / "tests/parity_dump.php"), scenario] + ([xlsx] if xlsx else []),
                                    capture_output=True, text=True, check=True).stdout)
    errs = []
    diff(py, php, scenario, errs)
    print(f"{scenario}: {len(py)} outputs compared, {len(errs)} differences")
    for e in errs[:40]:
        print("  ", e)
    return not errs

ok = run("demo")
if len(sys.argv) > 1:
    ok = run("xlsx", sys.argv[1]) and ok
sys.exit(0 if ok else 1)
