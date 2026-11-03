"""Accounts, sessions, invites and consent records.

- Passwords: scrypt (stdlib hashlib), per-user random salt, constant-time compare.
- Sessions and invite/API tokens: random 256-bit values; only their SHA-256 is stored, so a
  leaked database can't be used to log in.
- Lockout after repeated failed logins; per-IP throttling lives in the server.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .db import audit

PRIVACY_VERSION = "2026-11"
SESSION_DAYS = 14
SESSION_IDLE_HOURS = 12
MAX_FAILED = 5
LOCK_MINUTES = 15
TRIAL_DAYS = 30
CONSENT_PURPOSES = ("service", "ai_categorisation", "product_updates")
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")


class AuthError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _parse(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt$16384$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                             dklen=len(base64.b64decode(dk)))
        return hmac.compare_digest(got, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


def check_password_strength(password: str) -> None:
    if len(password) < 10:
        raise AuthError("Use at least 10 characters for your password.")
    if password.lower() in {"password123", "1234567890", "qwertyuiop"} or len(set(password)) < 5:
        raise AuthError("That password is too easy to guess.")


@dataclass
class Session:
    user_id: int | None
    household_id: int
    role: str
    csrf_token: str
    user_name: str
    email: str | None
    is_demo: bool


def _record_consents(conn, user_id: int, consents: dict) -> None:
    for purpose in CONSENT_PURPOSES:
        if purpose in consents:
            conn.execute("INSERT INTO consents (user_id, purpose, version, granted) VALUES (?, ?, ?, ?)",
                         (user_id, purpose, PRIVACY_VERSION, int(bool(consents[purpose]))))


def current_consents(conn: sqlite3.Connection, user_id: int) -> dict:
    rows = conn.execute(
        """SELECT purpose, granted, version, created_at FROM consents c
           WHERE user_id = ? AND id = (SELECT MAX(id) FROM consents WHERE user_id = c.user_id AND purpose = c.purpose)""",
        (user_id,)).fetchall()
    return {r["purpose"]: {"granted": bool(r["granted"]), "version": r["version"], "at": r["created_at"]} for r in rows}


def set_consent(conn: sqlite3.Connection, user_id: int, household_id: int, purpose: str, granted: bool) -> None:
    if purpose not in CONSENT_PURPOSES or purpose == "service":
        raise AuthError("That consent can't be changed here. Delete your account to withdraw it.")
    with conn:
        _record_consents(conn, user_id, {purpose: granted})
        audit(conn, household_id, user_id, "consent.changed", f"{purpose}={'yes' if granted else 'no'}")


def create_household(conn: sqlite3.Connection, name: str, member_names: list[str], is_demo: bool = False) -> int:
    trial_end = (_now() + timedelta(days=TRIAL_DAYS)).date().isoformat()
    cur = conn.execute("INSERT INTO households (name, trial_ends_on, is_demo) VALUES (?, ?, ?)",
                       (name[:80], trial_end, int(is_demo)))
    hid = cur.lastrowid
    for i, m in enumerate(n for n in member_names if n.strip()):
        conn.execute("INSERT INTO members (household_id, name, sort) VALUES (?, ?, ?)", (hid, m.strip()[:40], i))
    return hid


def signup(conn: sqlite3.Connection, *, email: str, name: str, password: str, partner_name: str | None,
           consents: dict, invite_token: str | None = None) -> int:
    email = (email or "").strip().lower()
    name = (name or "").strip()[:60]
    if not _EMAIL.match(email):
        raise AuthError("Enter a valid email address.")
    if not name:
        raise AuthError("Enter your name.")
    check_password_strength(password or "")
    if not consents.get("service"):
        raise AuthError("You need to accept the privacy notice to create an account.")
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise AuthError("An account with that email already exists. Sign in instead.")

    with conn:
        invite = None
        if invite_token:
            invite = conn.execute(
                "SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
                (token_hash(invite_token), _ts(_now()))).fetchone()
            if not invite:
                raise AuthError("This invite link has expired or was already used. Ask for a new one.")
        cur = conn.execute("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
                           (email, name, hash_password(password)))
        uid = cur.lastrowid
        _record_consents(conn, uid, consents)
        if invite:
            hid = invite["household_id"]
            conn.execute("UPDATE invites SET used_at = ? WHERE token_hash = ?", (_ts(_now()), invite["token_hash"]))
            conn.execute("INSERT INTO memberships (user_id, household_id, role) VALUES (?, ?, 'partner')", (uid, hid))
            # Link to the matching person in the budget if there is one, else add one.
            m = conn.execute("SELECT id FROM members WHERE household_id = ? AND user_id IS NULL "
                             "AND lower(name) = lower(?)", (hid, name.split()[0])).fetchone()
            if m:
                conn.execute("UPDATE members SET user_id = ? WHERE id = ?", (uid, m["id"]))
            else:
                n = conn.execute("SELECT COUNT(*) FROM members WHERE household_id = ?", (hid,)).fetchone()[0]
                conn.execute("INSERT INTO members (household_id, name, user_id, sort) VALUES (?, ?, ?, ?)",
                             (hid, name.split()[0], uid, n))
            audit(conn, hid, uid, "user.joined", email)
        else:
            people = [name.split()[0]] + ([partner_name] if partner_name and partner_name.strip() else [])
            hid = create_household(conn, f"{name.split()[0]}'s household", people)
            conn.execute("INSERT INTO memberships (user_id, household_id, role) VALUES (?, ?, 'owner')", (uid, hid))
            conn.execute("UPDATE members SET user_id = ? WHERE household_id = ? AND sort = 0", (uid, hid))
            audit(conn, hid, uid, "user.signup", email)
    return uid


def login(conn: sqlite3.Connection, email: str, password: str) -> int:
    user = conn.execute("SELECT * FROM users WHERE email = ?", ((email or "").strip().lower(),)).fetchone()
    generic = AuthError("Email or password is incorrect.")
    if not user:
        hash_password(password or "x")  # same work either way, so timing doesn't reveal accounts
        raise generic
    if user["locked_until"] and _parse(user["locked_until"]) > _now():
        raise AuthError("Too many attempts. Try again in a few minutes.")
    if not verify_password(password or "", user["password_hash"]):
        failed = user["failed_logins"] + 1
        locked = _ts(_now() + timedelta(minutes=LOCK_MINUTES)) if failed >= MAX_FAILED else None
        with conn:
            conn.execute("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?",
                         (0 if locked else failed, locked, user["id"]))
            audit(conn, None, user["id"], "login.failed", "locked" if locked else None)
        raise generic
    with conn:
        conn.execute("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",
                     (_ts(_now()), user["id"]))
    return user["id"]


def start_session(conn: sqlite3.Connection, user_id: int | None, household_id: int | None = None) -> str:
    if household_id is None:
        row = conn.execute("SELECT household_id FROM memberships WHERE user_id = ? ORDER BY role = 'owner' DESC",
                           (user_id,)).fetchone()
        if not row:
            raise AuthError("This account isn't part of a household.")
        household_id = row["household_id"]
    token = secrets.token_urlsafe(32)
    with conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_ts(_now()),))
        conn.execute("INSERT INTO sessions (token_hash, user_id, household_id, csrf_token, expires_at) "
                     "VALUES (?, ?, ?, ?, ?)",
                     (token_hash(token), user_id, household_id, secrets.token_urlsafe(24),
                      _ts(_now() + timedelta(days=SESSION_DAYS))))
        audit(conn, household_id, user_id, "login", None)
    return token


def get_session(conn: sqlite3.Connection, token: str | None) -> Session | None:
    if not token:
        return None
    row = conn.execute(
        """SELECT s.*, u.name AS user_name, u.email, h.is_demo, m.role AS role
           FROM sessions s JOIN households h ON h.id = s.household_id
           LEFT JOIN users u ON u.id = s.user_id
           LEFT JOIN memberships m ON m.user_id = s.user_id AND m.household_id = s.household_id
           WHERE s.token_hash = ?""", (token_hash(token),)).fetchone()
    if not row:
        return None
    now = _now()
    if _parse(row["expires_at"]) < now or _parse(row["last_seen_at"]) < now - timedelta(hours=SESSION_IDLE_HOURS):
        with conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (row["token_hash"],))
        return None
    role = row["role"] or ("owner" if row["user_id"] is None and row["is_demo"] else None)
    if role is None:  # no longer a member of this household
        return None
    if _parse(row["last_seen_at"]) < now - timedelta(minutes=5):
        with conn:
            conn.execute("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (_ts(now), row["token_hash"]))
    return Session(row["user_id"], row["household_id"], role, row["csrf_token"],
                   row["user_name"] or "Demo", row["email"], bool(row["is_demo"]))


def end_session(conn: sqlite3.Connection, token: str) -> None:
    with conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))


def end_all_sessions(conn: sqlite3.Connection, user_id: int) -> None:
    with conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def change_password(conn: sqlite3.Connection, user_id: int, household_id: int, old: str, new: str) -> None:
    user = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user or not verify_password(old or "", user["password_hash"]):
        raise AuthError("Your current password is incorrect.")
    check_password_strength(new or "")
    with conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new), user_id))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        audit(conn, household_id, user_id, "password.changed", None)


def create_invite(conn: sqlite3.Connection, household_id: int, user_id: int) -> str:
    token = secrets.token_urlsafe(24)
    with conn:
        conn.execute("INSERT INTO invites (token_hash, household_id, created_by, expires_at) VALUES (?, ?, ?, ?)",
                     (token_hash(token), household_id, user_id, _ts(_now() + timedelta(days=7))))
        audit(conn, household_id, user_id, "invite.created", None)
    return token


def create_api_token(conn: sqlite3.Connection, household_id: int, user_id: int, name: str) -> str:
    token = "bt_" + secrets.token_urlsafe(32)
    with conn:
        conn.execute("INSERT INTO api_tokens (household_id, name, token_hash, prefix, created_by) VALUES (?, ?, ?, ?, ?)",
                     (household_id, (name or "Power BI").strip()[:60], token_hash(token), token[:9], user_id))
        audit(conn, household_id, user_id, "api_token.created", name)
    return token


def check_api_token(conn: sqlite3.Connection, token: str | None) -> int | None:
    if not token or not token.startswith("bt_"):
        return None
    row = conn.execute("SELECT id, household_id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL",
                       (token_hash(token),)).fetchone()
    if not row:
        return None
    with conn:
        conn.execute("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", (_ts(_now()), row["id"]))
    return row["household_id"]


def revoke_api_token(conn: sqlite3.Connection, household_id: int, user_id: int, token_id: int) -> None:
    with conn:
        conn.execute("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND household_id = ?",
                     (_ts(_now()), token_id, household_id))
        audit(conn, household_id, user_id, "api_token.revoked", str(token_id))
