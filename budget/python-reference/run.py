"""Start the budget app.

    python3 run.py                 # real use: data/budget.db, sign up in the browser
    python3 run.py --demo          # throwaway demo database with a fictional household
    python3 run.py --port 9000

Production settings (behind HTTPS): BUDGET_ENV=production BUDGET_SECURE_COOKIES=1
BUDGET_ALLOWED_HOSTS=app.example.co.za BUDGET_PUBLIC_URL=https://app.example.co.za
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    ap = argparse.ArgumentParser(description="Household budget app")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--demo", action="store_true", help="use a throwaway demo database with sample data")
    args = ap.parse_args()
    if args.demo:
        path = ROOT / "data" / "demo.db"
        for suffix in ("", "-wal", "-shm"):
            Path(f"{path}{suffix}").unlink(missing_ok=True)
        os.environ["BUDGET_DB"] = str(path)
        os.environ["BUDGET_DEMO"] = "1"
        from budget_app import db, demo

        conn = db.connect()
        demo.seed(conn)
        conn.close()
    from budget_app.server import serve

    serve(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
