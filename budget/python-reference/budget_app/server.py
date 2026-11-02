"""Web server: JSON API + static UI. Stdlib only.

Security model
- Session cookie: random token, HttpOnly, SameSite=Strict, Secure when BUDGET_SECURE_COOKIES=1.
- CSRF: every state-changing request needs the session's token in X-CSRF-Token and a JSON body.
- Tenant isolation: the household comes from the session, never from the request.
- Host allow-list (BUDGET_ALLOWED_HOSTS) against DNS rebinding; strict CSP and other headers.
- Login/signup throttled per IP; accounts lock after repeated failures (see auth.py).

For production run it behind a TLS-terminating reverse proxy (Caddy/nginx) and set
BUDGET_ENV=production, BUDGET_SECURE_COOKIES=1, BUDGET_ALLOWED_HOSTS=<your domain>.
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import sqlite3
import threading
import time
from collections import defaultdict, deque
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import (advice, analysis, auth, billing, budget, categorise, db, debt, export, forecast, goals, llm,
               privacy, xlsx_import)
from .importer import import_statement
from .parsers import StatementFormatError

WEB = Path(__file__).resolve().parent.parent / "web"
MAX_BODY = 12 * 1024 * 1024
ALLOWED_HOSTS = {h.strip().lower() for h in os.environ.get(
    "BUDGET_ALLOWED_HOSTS", "127.0.0.1,localhost,[::1]").split(",") if h.strip()}
SECURE_COOKIES = os.environ.get("BUDGET_SECURE_COOKIES") == "1"
DEMO_ENABLED = os.environ.get("BUDGET_DEMO") == "1"
PUBLIC_URL = os.environ.get("BUDGET_PUBLIC_URL", "")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Raw:
    """A non-JSON response (downloads)."""
    def __init__(self, body: bytes, content_type: str, filename: str | None = None):
        self.body, self.content_type, self.filename = body, content_type, filename


class Ctx:
    def __init__(self, conn, sess: auth.Session | None, query: dict, body: dict, handler):
        self.conn, self.sess, self.q, self.body, self.handler = conn, sess, query, body, handler
        self.set_cookie: str | None = None

    @property
    def hid(self) -> int:
        return self.sess.household_id

    @property
    def uid(self) -> int | None:
        return self.sess.user_id

    def arg(self, name: str, default=None):
        return (self.q.get(name) or [default])[0]

    def month(self, name: str = "month") -> str:
        m = self.arg(name) or budget.this_month()
        try:
            return budget.valid_month(m)
        except ValueError as e:
            raise ApiError(400, str(e))

    def member(self) -> int | None:
        m = self.arg("member")
        if not m or m == "all":
            return None
        try:
            mid = int(m)
        except ValueError:
            raise ApiError(400, "member must be a number")
        if mid not in {p["id"] for p in budget.members(self.conn, self.hid)}:
            raise ApiError(404, "Unknown person")
        return mid

    def int(self, key: str, required: bool = True, default=None) -> int | None:
        v = self.body.get(key, default)
        if v is None or v == "":
            if required:
                raise ApiError(400, f"{key} is required")
            return default
        try:
            return int(v)
        except (TypeError, ValueError):
            raise ApiError(400, f"{key} must be a whole number")


ROUTES: list[tuple[str, re.Pattern, callable, dict]] = []


def route(method: str, pattern: str, *, public: bool = False, write: bool = False, owner: bool = False):
    def deco(fn):
        ROUTES.append((method, re.compile(f"^{pattern}$"), fn, {"public": public, "write": write, "owner": owner}))
        return fn
    return deco


# --- rate limiting ---------------------------------------------------------------------
_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def throttle(key: str, limit: int = 10, per: float = 60.0) -> None:
    now = time.monotonic()
    with _hits_lock:
        q = _hits[key]
        while q and q[0] < now - per:
            q.popleft()
        if len(q) >= limit:
            raise ApiError(429, "Too many attempts. Wait a minute and try again.")
        q.append(now)


def _session_cookie(token: str, max_age: int) -> str:
    return (f"sid={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}"
            + ("; Secure" if SECURE_COOKIES else ""))


# --- auth ---------------------------------------------------------------------------
@route("POST", "/api/auth/signup", public=True)
def signup(c: Ctx):
    throttle(f"signup:{c.handler.client_ip}", 5, 600)
    try:
        uid = auth.signup(c.conn, email=c.body.get("email"), name=c.body.get("name"), password=c.body.get("password"),
                          partner_name=c.body.get("partner_name"), consents=c.body.get("consents") or {},
                          invite_token=c.body.get("invite"))
        token = auth.start_session(c.conn, uid)
    except auth.AuthError as e:
        raise ApiError(400, str(e))
    c.set_cookie = _session_cookie(token, auth.SESSION_DAYS * 86400)
    return {"ok": True}


@route("POST", "/api/auth/login", public=True)
def login(c: Ctx):
    throttle(f"login:{c.handler.client_ip}", 10, 60)
    try:
        uid = auth.login(c.conn, c.body.get("email"), c.body.get("password"))
        token = auth.start_session(c.conn, uid)
    except auth.AuthError as e:
        raise ApiError(401, str(e))
    c.set_cookie = _session_cookie(token, auth.SESSION_DAYS * 86400)
    return {"ok": True}


@route("POST", "/api/auth/demo", public=True)
def demo_login(c: Ctx):
    if not DEMO_ENABLED:
        raise ApiError(404, "Not found")
    row = c.conn.execute("SELECT id FROM households WHERE is_demo = 1 ORDER BY id LIMIT 1").fetchone()
    if not row:
        raise ApiError(404, "No demo household")
    c.set_cookie = _session_cookie(auth.start_session(c.conn, None, row["id"]), 4 * 3600)
    return {"ok": True}


@route("POST", "/api/auth/logout")
def logout(c: Ctx):
    auth.end_session(c.conn, c.handler.cookie_token)
    c.set_cookie = _session_cookie("", 0)
    return {"ok": True}


@route("POST", "/api/auth/logout-all")
def logout_all(c: Ctx):
    if c.uid:
        auth.end_all_sessions(c.conn, c.uid)
    c.set_cookie = _session_cookie("", 0)
    return {"ok": True}


@route("POST", "/api/auth/password")
def change_password(c: Ctx):
    if not c.uid:
        raise ApiError(400, "Not available in the demo")
    throttle(f"pw:{c.uid}", 5, 600)
    try:
        auth.change_password(c.conn, c.uid, c.hid, c.body.get("old"), c.body.get("new"))
    except auth.AuthError as e:
        raise ApiError(400, str(e))
    c.set_cookie = _session_cookie("", 0)
    return {"ok": True}


@route("GET", "/api/config", public=True)
def config(c: Ctx):
    return {"demo": DEMO_ENABLED, "privacy_version": auth.PRIVACY_VERSION, "plans": billing.PLANS}


@route("GET", "/api/me")
def me(c: Ctx):
    h = c.conn.execute("SELECT id, name, retention_months, is_demo FROM households WHERE id = ?", (c.hid,)).fetchone()
    ok, why = llm.available()
    consents = auth.current_consents(c.conn, c.uid) if c.uid else {}
    return {
        "user": {"id": c.uid, "name": c.sess.user_name, "email": c.sess.email, "role": c.sess.role},
        "household": dict(h), "members": budget.members(c.conn, c.hid), "csrf": c.sess.csrf_token,
        "billing": billing.status(c.conn, c.hid), "consents": consents,
        "categories": categorise.CATEGORIES, "groups": categorise.GROUPS, "this_month": budget.this_month(),
        "statement_months": analysis.months(c.conn, analysis.Scope(c.hid)),
        "llm": {"available": ok and consents.get("ai_categorisation", {}).get("granted", False),
                "installed": ok, "reason": why},
    }


# --- household ------------------------------------------------------------------------
@route("PATCH", "/api/household", owner=True)
def update_household(c: Ctx):
    name = (c.body.get("name") or "").strip()[:80]
    retention = c.int("retention_months", required=False)
    with c.conn:
        if name:
            c.conn.execute("UPDATE households SET name = ? WHERE id = ?", (name, c.hid))
        if retention is not None:
            if not 6 <= retention <= 120:
                raise ApiError(400, "Keep statements for 6 to 120 months")
            c.conn.execute("UPDATE households SET retention_months = ? WHERE id = ?", (retention, c.hid))
            db.audit(c.conn, c.hid, c.uid, "retention.changed", f"{retention} months")
    privacy.purge_old_transactions(c.conn)
    return {"ok": True}


@route("POST", "/api/members", owner=True, write=True)
def add_member(c: Ctx):
    name = (c.body.get("name") or "").strip()[:40]
    if not name:
        raise ApiError(400, "Enter a name")
    n = c.conn.execute("SELECT COUNT(*) FROM members WHERE household_id = ?", (c.hid,)).fetchone()[0]
    if n >= 6:
        raise ApiError(400, "A household can have up to 6 people")
    with c.conn:
        cur = c.conn.execute("INSERT INTO members (household_id, name, sort) VALUES (?, ?, ?)", (c.hid, name, n))
    return {"id": cur.lastrowid}


@route("PATCH", r"/api/members/(\d+)", write=True)
def rename_member(c: Ctx, mid):
    name = (c.body.get("name") or "").strip()[:40]
    if not name:
        raise ApiError(400, "Enter a name")
    with c.conn:
        cur = c.conn.execute("UPDATE members SET name = ? WHERE id = ? AND household_id = ?", (name, int(mid), c.hid))
    if not cur.rowcount:
        raise ApiError(404, "Unknown person")
    return {"ok": True}


@route("POST", "/api/invites", owner=True)
def invite(c: Ctx):
    if not c.uid:
        raise ApiError(400, "Not available in the demo")
    return {"token": auth.create_invite(c.conn, c.hid, c.uid), "expires_in_days": 7}


# --- budget ------------------------------------------------------------------------------
@route("GET", "/api/budget")
def get_budget(c: Ctx):
    return budget.month_view(c.conn, c.hid, c.month(), c.member())


def _line_fields(c: Ctx) -> dict:
    b = c.body
    out = {k: b[k] for k in ("name", "section", "category", "flexibility", "notes", "kind") if k in b}
    if "is_debit_order" in b:
        out["is_debit_order"] = bool(b["is_debit_order"])
    for k in ("member_id", "to_member_id"):
        if k in b:
            out[k] = c.int(k, required=False)
    if "end_month" in b:
        out["end_month"] = b["end_month"] or None
    return out


@route("POST", "/api/budget/lines", write=True)
def create_line(c: Ctx):
    try:
        f = _line_fields(c)
        lid = budget.create_line(
            c.conn, c.hid, member_id=c.int("member_id"), kind=c.body.get("kind", "expense"), name=c.body.get("name"),
            amount_cents=c.int("amount_cents"), start_month=c.body.get("start_month") or c.month(),
            section=f.get("section"), category=f.get("category"), is_debit_order=f.get("is_debit_order", False),
            flexibility=f.get("flexibility"), notes=f.get("notes"), end_month=f.get("end_month"),
            to_member_id=f.get("to_member_id"))
    except ValueError as e:
        raise ApiError(400, str(e))
    return {"id": lid}


@route("PATCH", r"/api/budget/lines/(\d+)", write=True)
def update_line(c: Ctx, lid):
    try:
        budget.update_line(c.conn, c.hid, int(lid), **_line_fields(c))
    except ValueError as e:
        raise ApiError(400, str(e))
    except LookupError as e:
        raise ApiError(404, str(e))
    return {"ok": True}


@route("DELETE", r"/api/budget/lines/(\d+)", write=True)
def delete_line(c: Ctx, lid):
    try:
        budget.delete_line(c.conn, c.hid, int(lid))
    except LookupError as e:
        raise ApiError(404, str(e))
    return {"ok": True}


@route("POST", r"/api/budget/lines/(\d+)/amount", write=True)
def set_amount(c: Ctx, lid):
    try:
        r = budget.set_amount(c.conn, c.hid, int(lid), c.body.get("month") or c.month(), c.int("amount_cents"),
                              c.body.get("mode", "onward"), c.body.get("note"))
    except ValueError as e:
        raise ApiError(400, str(e))
    except LookupError as e:
        raise ApiError(404, str(e))
    with c.conn:
        db.audit(c.conn, c.hid, c.uid, "budget.amount_changed", f"line {lid} from {r['month']} ({r['mode']})")
    return r


@route("GET", r"/api/budget/lines/(\d+)/history")
def line_history(c: Ctx, lid):
    try:
        return budget.history(c.conn, c.hid, int(lid))
    except LookupError as e:
        raise ApiError(404, str(e))


@route("POST", r"/api/budget/lines/(\d+)/paid", write=True)
def set_paid(c: Ctx, lid):
    try:
        budget.set_paid(c.conn, c.hid, int(lid), c.body.get("month") or c.month(), bool(c.body.get("paid")))
    except (ValueError, LookupError) as e:
        raise ApiError(400, str(e))
    return {"ok": True}


@route("GET", "/api/debit-orders")
def debit_orders(c: Ctx):
    return budget.debit_order_review(c.conn, c.hid, c.month(), c.member())


@route("GET", "/api/forecast")
def get_forecast(c: Ctx):
    return forecast.forecast(c.conn, c.hid, c.month(), c.member())


# --- goals -------------------------------------------------------------------------------
@route("GET", "/api/goals")
def list_goals(c: Ctx):
    return goals.plan_all(c.conn, c.hid, c.month())


@route("POST", "/api/goals", write=True)
def add_goal(c: Ctx):
    try:
        return {"id": goals.save_goal(c.conn, c.hid, c.body)}
    except ValueError as e:
        raise ApiError(400, str(e))


@route("PATCH", r"/api/goals/(\d+)", write=True)
def edit_goal(c: Ctx, gid):
    try:
        return {"id": goals.save_goal(c.conn, c.hid, c.body, int(gid))}
    except ValueError as e:
        raise ApiError(400, str(e))
    except LookupError as e:
        raise ApiError(404, str(e))


@route("DELETE", r"/api/goals/(\d+)", write=True)
def remove_goal(c: Ctx, gid):
    goals.delete_goal(c.conn, c.hid, int(gid))
    return {"ok": True}


@route("GET", r"/api/goals/(\d+)/plan")
def goal_plan(c: Ctx, gid):
    g = c.conn.execute("SELECT * FROM goals WHERE id = ? AND household_id = ?", (int(gid), c.hid)).fetchone()
    if not g:
        raise ApiError(404, "Goal not found")
    contrib = c.arg("contribution_cents")
    return goals.plan_goal(c.conn, c.hid, dict(g), c.month(), int(contrib) if contrib not in (None, "") else None)


# --- statements --------------------------------------------------------------------------
@route("GET", "/api/transactions")
def transactions(c: Ctx):
    scope = analysis.Scope(c.hid, c.member())
    w, p = scope.sql()
    sql = (f"SELECT t.id, t.posted_on, t.description, t.amount_cents, t.category, t.category_source, t.is_transfer, "
           f"a.label AS account FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE {w}")
    if c.arg("month"):
        sql += " AND substr(t.posted_on, 1, 7) = ?"
        p.append(c.month())
    if c.arg("category"):
        sql += " AND t.category = ?"
        p.append(c.arg("category"))
    if c.arg("q"):
        sql += " AND t.description LIKE ?"
        p.append(f"%{c.arg('q')[:60]}%")
    if c.arg("unknown"):
        sql += " AND t.category_source = 'none' AND t.is_transfer = 0"
    sql += " ORDER BY t.posted_on DESC, t.id DESC LIMIT 1000"
    return [dict(r) for r in c.conn.execute(sql, p)]


@route("POST", r"/api/transactions/(\d+)/category", write=True)
def set_category(c: Ctx, tid):
    try:
        return categorise.set_category(c.conn, c.hid, int(tid), c.body.get("category", ""),
                                       bool(c.body.get("make_rule", True)))
    except ValueError as e:
        raise ApiError(400, str(e))
    except LookupError as e:
        raise ApiError(404, str(e))


@route("POST", "/api/import", write=True)
def do_import(c: Ctx):
    content = c.body.get("content") or ""
    if not content.strip():
        raise ApiError(400, "Empty file")
    try:
        r = import_statement(c.conn, c.hid, content, member_id=c.int("member_id", required=False),
                             bank=c.body.get("bank", "auto"), account_label=c.body.get("account_label"),
                             filename=(c.body.get("filename") or "")[:120])
    except (StatementFormatError, ValueError) as e:
        raise ApiError(422, str(e))
    with c.conn:
        db.audit(c.conn, c.hid, c.uid, "statement.imported", f"{r.rows_added} new rows")
    return r.as_dict()


@route("POST", "/api/categorise/ai", write=True)
def categorise_ai(c: Ctx):
    consents = auth.current_consents(c.conn, c.uid) if c.uid else {}
    if not consents.get("ai_categorisation", {}).get("granted"):
        raise ApiError(403, "Turn on AI categorisation under Settings → Privacy first.")
    try:
        r = llm.categorise_unknowns(c.conn, c.hid)
    except llm.LLMUnavailable as e:
        raise ApiError(503, str(e))
    with c.conn:
        db.audit(c.conn, c.hid, c.uid, "ai.categorised", f"{r['asked']} merchant names sent")
    return r


@route("GET", "/api/actuals")
def actuals(c: Ctx):
    scope = analysis.Scope(c.hid, c.member())
    m = c.arg("month") or analysis.latest_month(c.conn, scope)
    if not m:
        return {"has_data": False}
    try:
        m = budget.valid_month(m)
    except ValueError as e:
        raise ApiError(400, str(e))
    return {"has_data": True, "summary": analysis.summary(c.conn, scope, m),
            "fees": analysis.fees_and_interest(c.conn, scope, m), "recurring": analysis.recurring(c.conn, scope, m),
            "advice": advice.top_actions(c.conn, scope, m)}


# --- debts ---------------------------------------------------------------------------
@route("GET", "/api/debts")
def list_debts(c: Ctx):
    return [d.__dict__ for d in debt.load_debts(c.conn, c.hid)]


@route("POST", "/api/debts", write=True)
def add_debt(c: Ctx):
    name = str(c.body.get("name", "")).strip()[:60]
    bal, apr, mn = c.int("balance_cents"), c.int("apr_bp"), c.int("min_payment_cents")
    if not name or bal < 0 or not 0 <= apr <= 10000 or mn < 0:
        raise ApiError(400, "Check the values: balance and payment can't be negative, rate is 0-100%.")
    with c.conn:
        cur = c.conn.execute("INSERT INTO debts (household_id, name, balance_cents, apr_bp, min_payment_cents) "
                             "VALUES (?, ?, ?, ?, ?)", (c.hid, name, bal, apr, mn))
    return {"id": cur.lastrowid}


@route("DELETE", r"/api/debts/(\d+)", write=True)
def delete_debt(c: Ctx, did):
    with c.conn:
        c.conn.execute("DELETE FROM debts WHERE id = ? AND household_id = ?", (int(did), c.hid))
    return {"ok": True}


@route("GET", "/api/debts/plan")
def debt_plan(c: Ctx):
    try:
        extra = max(0, int(c.arg("extra_cents", "0")))
    except ValueError:
        raise ApiError(400, "extra_cents must be a whole number")
    return debt.compare(debt.load_debts(c.conn, c.hid), extra)


# --- workbook import ---------------------------------------------------------------------
def _xlsx_bytes(c: Ctx) -> bytes:
    try:
        return base64.b64decode(c.body.get("content_b64") or "", validate=True)
    except ValueError:
        raise ApiError(400, "Upload an .xlsx file")


@route("POST", "/api/workbook/preview", write=True)
def workbook_preview(c: Ctx):
    try:
        return xlsx_import.preview(_xlsx_bytes(c))
    except xlsx_import.WorkbookError as e:
        raise ApiError(422, str(e))


@route("POST", "/api/workbook/import", write=True)
def workbook_import(c: Ctx):
    mapping = {}
    for k, v in (c.body.get("person_map") or {}).items():
        try:
            mapping[str(k)] = int(v)
        except (TypeError, ValueError):
            continue
    try:
        return xlsx_import.import_workbook(c.conn, c.hid, _xlsx_bytes(c), mapping, c.uid,
                                           c.body.get("from_month") or None)
    except (xlsx_import.WorkbookError, ValueError) as e:
        raise ApiError(422, str(e))


# --- exports & Power BI ---------------------------------------------------------------------
@route("GET", "/api/export/powerbi.zip")
def powerbi_zip(c: Ctx):
    with c.conn:
        db.audit(c.conn, c.hid, c.uid, "export.powerbi", None)
    return Raw(export.zip_export(c.conn, c.hid), "application/zip", "budget-powerbi.zip")


@route("GET", r"/api/export/(\w+)\.csv")
def table_csv_session(c: Ctx, table):
    if table not in export.TABLES:
        raise ApiError(404, "Unknown table")
    return Raw(export.table_csv(c.conn, c.hid, table), "text/csv; charset=utf-8", f"{table}.csv")


@route("GET", r"/api/powerbi/(\w+)\.csv", public=True)
def table_csv_token(c: Ctx, table):
    header = c.handler.headers.get("Authorization") or ""
    hid = auth.check_api_token(c.conn, header.removeprefix("Bearer ").strip())
    if not hid:
        throttle(f"token:{c.handler.client_ip}", 20, 60)
        raise ApiError(401, "Missing or invalid API token")
    if table not in export.TABLES:
        raise ApiError(404, "Unknown table")
    return Raw(export.table_csv(c.conn, hid, table), "text/csv; charset=utf-8")


@route("GET", "/api/tokens")
def list_tokens(c: Ctx):
    base = PUBLIC_URL or f"http://{c.handler.headers.get('Host')}"
    return {"tokens": [dict(r) for r in c.conn.execute(
        "SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE household_id = ? AND revoked_at IS NULL "
        "ORDER BY id DESC", (c.hid,))],
        "tables": list(export.TABLES), "query_template": export.power_query(base, "fact_budget"), "base_url": base}


@route("POST", "/api/tokens", owner=True)
def new_token(c: Ctx):
    if not c.uid:
        raise ApiError(400, "Not available in the demo")
    return {"token": auth.create_api_token(c.conn, c.hid, c.uid, c.body.get("name") or "Power BI")}


@route("DELETE", r"/api/tokens/(\d+)", owner=True)
def revoke_token(c: Ctx, tid):
    auth.revoke_api_token(c.conn, c.hid, c.uid, int(tid))
    return {"ok": True}


# --- privacy (POPIA) --------------------------------------------------------------------
@route("GET", "/api/privacy/export")
def privacy_export(c: Ctx):
    data = privacy.export_household(c.conn, c.hid, c.uid)
    return Raw(json.dumps(data, indent=2, default=str).encode(), "application/json", "my-budget-data.json")


@route("POST", "/api/privacy/consent")
def privacy_consent(c: Ctx):
    if not c.uid:
        raise ApiError(400, "Not available in the demo")
    try:
        auth.set_consent(c.conn, c.uid, c.hid, c.body.get("purpose"), bool(c.body.get("granted")))
    except auth.AuthError as e:
        raise ApiError(400, str(e))
    return {"ok": True}


@route("GET", "/api/privacy/audit")
def privacy_audit(c: Ctx):
    return privacy.audit_entries(c.conn, c.hid)


def _confirm_password(c: Ctx) -> None:
    throttle(f"confirm:{c.uid}", 5, 600)
    row = c.conn.execute("SELECT password_hash FROM users WHERE id = ?", (c.uid,)).fetchone()
    if not row or not auth.verify_password(c.body.get("password") or "", row["password_hash"]):
        raise ApiError(403, "Password is incorrect")


@route("POST", "/api/privacy/delete-household", owner=True)
def privacy_delete(c: Ctx):
    if c.sess.is_demo:
        raise ApiError(400, "The demo can't be deleted")
    _confirm_password(c)
    privacy.delete_household(c.conn, c.hid)
    c.set_cookie = _session_cookie("", 0)
    return {"ok": True}


@route("POST", "/api/privacy/leave")
def privacy_leave(c: Ctx):
    if c.sess.role == "owner":
        raise ApiError(400, "The owner can't leave; delete the household instead.")
    _confirm_password(c)
    privacy.leave_household(c.conn, c.hid, c.uid)
    c.set_cookie = _session_cookie("", 0)
    return {"ok": True}


# --- billing ------------------------------------------------------------------------------
@route("GET", "/api/billing")
def billing_status(c: Ctx):
    return billing.status(c.conn, c.hid)


@route("POST", "/api/billing/simulate", owner=True)
def billing_simulate(c: Ctx):
    try:
        billing.simulate_payment(c.conn, c.hid, c.body.get("plan", "household"), c.uid)
    except PermissionError as e:
        raise ApiError(403, str(e))
    except ValueError as e:
        raise ApiError(400, str(e))
    return billing.status(c.conn, c.hid)


@route("POST", "/api/billing/cancel", owner=True)
def billing_cancel(c: Ctx):
    billing.cancel(c.conn, c.hid, c.uid)
    return billing.status(c.conn, c.hid)


# --- HTTP plumbing ----------------------------------------------------------------------
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                                "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
                                "base-uri 'none'; form-action 'self'"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "Budget"
    sys_version = ""

    def log_message(self, fmt, *args):  # no request logging: URLs can carry months/filters
        pass

    @property
    def client_ip(self) -> str:
        return self.client_address[0]

    @property
    def cookie_token(self) -> str | None:
        c = SimpleCookie(self.headers.get("Cookie") or "")
        return c["sid"].value if "sid" in c else None

    def _send(self, status: int, payload, set_cookie: str | None = None):
        if isinstance(payload, Raw):
            data, ctype = payload.body, payload.content_type
        elif isinstance(payload, bytes):
            data, ctype = payload, "text/plain; charset=utf-8"
        else:
            data, ctype = json.dumps(payload, default=str).encode(), "application/json; charset=utf-8"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        if SECURE_COOKIES:
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if isinstance(payload, Raw) and payload.filename:
            self.send_header("Content-Disposition", f'attachment; filename="{payload.filename}"')
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        if host.startswith("["):  # IPv6 literal, e.g. [::1]:8765
            host = host[: host.find("]") + 1]
        else:
            host = host.split(":", 1)[0]
        return host in ALLOWED_HOSTS

    def _handle(self, method: str):
        if not self._host_ok():
            return self._send(403, {"error": "Forbidden host"})
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return self._static(url.path) if method in ("GET", "HEAD") else self._send(405, {"error": "Not allowed"})

        body: dict = {}
        if method in ("POST", "PATCH", "DELETE"):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self._send(413, {"error": "File too large"})
            if length:
                if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                    return self._send(415, {"error": "Use application/json"})
                try:
                    body = json.loads(self.rfile.read(length))
                except json.JSONDecodeError:
                    return self._send(400, {"error": "Invalid JSON"})
                if not isinstance(body, dict):
                    return self._send(400, {"error": "Invalid JSON"})

        for m, pattern, fn, opts in ROUTES:
            match = pattern.match(url.path)
            if m != method or not match:
                continue
            conn = db.connect()
            try:
                sess = auth.get_session(conn, self.cookie_token)
                if not opts["public"]:
                    if not sess:
                        raise ApiError(401, "Please sign in")
                    if method != "GET" and self.headers.get("X-CSRF-Token") != sess.csrf_token:
                        raise ApiError(403, "Your session expired. Refresh the page.")
                    if opts["owner"] and sess.role != "owner":
                        raise ApiError(403, "Only the household owner can do that")
                    if opts["write"] and not billing.can_write(conn, sess.household_id):
                        raise ApiError(402, "Your trial has ended. Choose a plan to keep editing; "
                                            "you can still view, export or delete your data.")
                ctx = Ctx(conn, sess, parse_qs(url.query), body, self)
                result = fn(ctx, *match.groups())
                return self._send(200, result, ctx.set_cookie)
            except ApiError as e:
                return self._send(e.status, {"error": str(e)})
            except sqlite3.Error:
                return self._send(500, {"error": "Something went wrong saving that. Please try again."})
            finally:
                conn.close()
        return self._send(404, {"error": "Not found"})

    def _static(self, path: str):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        file = (WEB / rel).resolve()
        if WEB not in file.parents or not file.is_file():
            return self._send(404, b"Not found")
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript") or ctype.endswith("svg+xml"):
            ctype += "; charset=utf-8"
        return self._send(200, Raw(file.read_bytes(), ctype))

    def do_GET(self):
        self._handle("GET")

    def do_HEAD(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PATCH(self):
        self._handle("PATCH")

    def do_DELETE(self):
        self._handle("DELETE")


def _retention_loop():
    while True:
        try:
            conn = db.connect()
            privacy.purge_old_transactions(conn)
            conn.close()
        except Exception:  # never let housekeeping take the server down
            pass
        time.sleep(24 * 3600)


def serve(host: str = "127.0.0.1", port: int = 8765) -> None:
    db.connect().close()
    threading.Thread(target=_retention_loop, daemon=True).start()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Budget running at http://{'localhost' if host == '127.0.0.1' else host}:{port}  (database: {db.db_path()})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
