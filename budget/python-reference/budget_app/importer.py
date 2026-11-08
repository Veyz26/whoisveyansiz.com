"""Normalise parsed statements into the transactions table, de-duplicating on re-import."""
from __future__ import annotations

import hashlib
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta

from .categorise import apply_rules
from .parsers import RawTxn, parse_statement

# Card numbers (masked or not) and other long digit runs: keep only the last 4.
_CARDLIKE = re.compile(
    r"(?<![\dA-Za-z])(?:"
    r"\d{4}[ -]?[\d*xX•]{4}[ -]?[\d*xX•]{4}[ -]?\d{1,7}"  # card numbers, masked or not
    r"|\d{4,6}[*xX•]+\d{4}"                                # short masked cards: 4512*9921
    r")(?![\dA-Za-z])"
    r"|(?<!\d)\d{9,}(?!\d)"                                 # account / long reference numbers, also glued to letters
)

_NOISE_PREFIXES = (
    # Longer prefixes first: "SEND MONEY APP DR SEND ACME CAR WASH" must lose all of its prefix.
    "SEND MONEY APP DR SEND", "INTERNAL DEBIT ORDER", "INTERNAL D/O", "PAYSHAP ACCOUNT OFF-US", "PAYSHAP CREDIT",
    "POS PURCHASE", "CARD PURCHASE", "PURCHASE", "POS", "DEBIT ORDER", "DEBICHECK",
    "FNB APP PAYMENT TO", "FNB APP TRANSFER TO", "FNB APP TRANSFER FROM", "FNB APP PREPAID",
    "PAYMENT TO", "PAYMENT FROM", "PAYMENT RECEIVED", "INTERNET PMT TO", "SETTLEMENT",
    "RECURRING CARD PURCHASE", "ONLINE PURCHASE", "FEE:", "MAGTAPE DEBIT", "MAGTAPE CREDIT",
)


def sanitise_description(desc: str) -> str:
    def mask(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group(0))
        return f"****{digits[-4:]}" if len(digits) >= 4 else "****"

    desc = _CARDLIKE.sub(mask, desc)
    return re.sub(r"\s+", " ", desc).strip()


_MONTHS = ("JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER"
           "|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC")


def merchant_key(desc: str) -> str:
    """Stable, human-readable key for a counterparty: noise prefixes, card masks,
    dates and reference numbers removed; first three words kept."""
    s = desc.upper().lstrip("#").strip().replace("_", " ")
    changed = True
    while changed:
        changed = False
        for p in _NOISE_PREFIXES:
            if s.startswith((p + " ", p + ":")) or s == p:
                s = s[len(p):].strip(" -:")
                changed = True
    s = re.sub(r"[A-Z]*\*{2,}\d{0,4}", " ", s)  # masked numbers, with any letters glued on ("FI****1234")
    s = re.sub(r"\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b", " ", s)  # dates
    s = re.sub(rf"\b\d{{1,2}} (?:{_MONTHS})\b", " ", s)               # "23 SEP": the date FNB adds to card purchases
    s = re.sub(r"\b([A-Z]{4,})\d[A-Z\d]*\b", r"\1", s)              # "INSURE1234567": keep the name, drop the ref
    s = re.sub(r"\b[A-Z]*\d[A-Z\d]*\b", " ", s)                    # refs with digits
    s = re.sub(r"[^A-Z&' ]", " ", s)
    words = s.split()
    while len(words) > 1 and re.fullmatch(_MONTHS, words[-1]):          # "RENT OCT": the month a payment is for
        words.pop()
    return " ".join(words[:3]) or desc.upper()[:24]


def fingerprint(account_id: int, t: RawTxn, occurrence: int) -> str:
    """Identifies a row across files. The running balance tells apart identical rows on the same day even when
    they come from different statements (FNB repeats the boundary day); without it, the occurrence in the file."""
    base = f"{account_id}|{t.posted_on.isoformat()}|{t.amount_cents}|{sanitise_description(t.description).upper()}"
    raw = f"{base}|b{t.balance_cents}" if t.balance_cents is not None else f"{base}|{occurrence}"
    return hashlib.sha256(raw.encode()).hexdigest()


@dataclass
class ImportResult:
    account_id: int
    bank: str
    rows_total: int
    rows_added: int
    rows_duplicate: int
    skipped_rows: int
    first_date: str | None
    last_date: str | None

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def get_or_create_account(conn: sqlite3.Connection, household_id: int, bank: str, label: str,
                          last4: str | None, kind: str, member_id: int | None) -> int:
    row = conn.execute("SELECT id, last4, member_id FROM accounts WHERE household_id = ? AND bank = ? AND label = ?",
                       (household_id, bank, label)).fetchone()
    if row:
        if last4 and not row["last4"]:
            conn.execute("UPDATE accounts SET last4 = ? WHERE id = ?", (last4, row["id"]))
        if row["member_id"] != member_id:  # never move someone's account (and its history) to someone else
            raise ValueError(f'"{label}" already belongs to someone else. Choose that person, or use a different account name.')
        return row["id"]
    cur = conn.execute(
        "INSERT INTO accounts (household_id, member_id, bank, label, last4, kind) VALUES (?, ?, ?, ?, ?, ?)",
        (household_id, member_id, bank, label, last4, kind),
    )
    return cur.lastrowid


def import_statement(
    conn: sqlite3.Connection,
    household_id: int,
    content: str,
    *,
    member_id: int | None = None,
    bank: str = "auto",
    account_label: str | None = None,
    account_kind: str = "transactional",
    filename: str | None = None,
) -> ImportResult:
    stmt = parse_statement(content, bank)
    who = None
    if member_id is not None:
        row = conn.execute("SELECT name FROM members WHERE id = ? AND household_id = ?", (member_id, household_id)).fetchone()
        who = row["name"] if row else None
    # Without a name, include the person so two people's unlabelled statements don't merge.
    label = (account_label or "").strip() or f"{stmt.bank.upper()} {stmt.account_last4 or 'account'}" + (f" ({who})" if who else "")
    label = label[:40]

    with conn:
        if member_id is not None and not conn.execute(
                "SELECT 1 FROM members WHERE id = ? AND household_id = ?", (member_id, household_id)).fetchone():
            raise ValueError("Unknown person")
        account_id = get_or_create_account(conn, household_id, stmt.bank, label, stmt.account_last4,
                                           account_kind, member_id)
        # The dates this statement covers: its stated period widened to any rows outside it, or the first
        # and last row. Averages only use months that statements cover in full.
        # A stated period is only trusted when it's about a month long; a longer one would mark empty months covered.
        dates = [t.posted_on for t in stmt.transactions]
        period = (min(dates), max(dates)) if dates else (None, None)
        if dates and stmt.period and (stmt.period[1] - stmt.period[0]).days <= 35:
            period = (min(period[0], stmt.period[0]), max(period[1], stmt.period[1]))
        cur = conn.execute(
            "INSERT INTO imports (household_id, account_id, filename, rows_total, rows_added, rows_duplicate, "
            "period_from, period_to) VALUES (?, ?, ?, ?, 0, 0, ?, ?)",
            (household_id, account_id, filename, len(stmt.transactions),
             period[0].isoformat() if period[0] else None, period[1].isoformat() if period[1] else None),
        )
        import_id = cur.lastrowid

        # Identical rows in one file (two R35 coffees on one day) are told apart by
        # occurrence number, so re-importing the same or an overlapping file is idempotent.
        seen: Counter = Counter()
        added_ids: list[int] = []
        for t in stmt.transactions:
            base = (t.posted_on, t.amount_cents, sanitise_description(t.description).upper())
            seen[base] += 1
            fp = fingerprint(account_id, t, seen[base])
            desc = sanitise_description(t.description)
            cur = conn.execute(
                """INSERT OR IGNORE INTO transactions
                   (household_id, account_id, import_id, posted_on, description, merchant, amount_cents,
                    balance_cents, bank_category, fingerprint)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (household_id, account_id, import_id, t.posted_on.isoformat(), desc, merchant_key(desc),
                 t.amount_cents, t.balance_cents, t.bank_category, fp),
            )
            if cur.rowcount:
                added_ids.append(cur.lastrowid)

        dupes = len(stmt.transactions) - len(added_ids)
        conn.execute("UPDATE imports SET rows_added = ?, rows_duplicate = ? WHERE id = ?",
                     (len(added_ids), dupes, import_id))
        apply_rules(conn, household_id, added_ids)
        link_transfers(conn, household_id)

    dates = sorted(t.posted_on for t in stmt.transactions)
    return ImportResult(
        account_id=account_id, bank=stmt.bank, rows_total=len(stmt.transactions),
        rows_added=len(added_ids), rows_duplicate=dupes, skipped_rows=stmt.skipped_rows,
        first_date=dates[0].isoformat() if dates else None,
        last_date=dates[-1].isoformat() if dates else None,
    )


# Card purchases, debit orders, cash and fees are never one leg of a move between the household's own accounts.
_NOT_A_TRANSFER = ("description NOT LIKE '%POS PURCHASE%' AND description NOT LIKE '%CARD PURCHASE%' "
                   "AND description NOT LIKE '%DEBIT ORDER%' AND description NOT LIKE '%DEBICHECK%' AND description NOT LIKE '%MAGTAPE%' "
                   "AND description NOT LIKE '%ATM%' AND description NOT LIKE '#%' AND description NOT LIKE '%FEE%'")


def link_transfers(conn: sqlite3.Connection, household_id: int, window_days: int = 3) -> int:
    """Pair money moving between the user's own accounts (same amount, opposite sign,
    different account, within a few days) and mark both legs as transfers so they
    don't count as spend or income."""
    outs = conn.execute(
        "SELECT id, account_id, posted_on, amount_cents FROM transactions "
        "WHERE household_id = ? AND amount_cents < 0 AND is_transfer = 0 AND category_source != 'user' AND " + _NOT_A_TRANSFER,
        (household_id,),
    ).fetchall()
    linked = 0
    for o in outs:
        d = date.fromisoformat(o["posted_on"])
        # Only an unambiguous pair: exactly one row of that amount in another account within the window,
        # so round amounts (two R500 payments) aren't paired by guesswork.
        cands = conn.execute(
            f"""SELECT id FROM transactions
               WHERE household_id = ? AND amount_cents = ? AND account_id != ? AND is_transfer = 0
                 AND category_source != 'user' AND posted_on BETWEEN ? AND ? AND {_NOT_A_TRANSFER} LIMIT 2""",
            (household_id, -o["amount_cents"], o["account_id"], (d - timedelta(days=window_days)).isoformat(),
             (d + timedelta(days=window_days)).isoformat()),
        ).fetchall()
        match = cands[0] if len(cands) == 1 else None
        if match:
            conn.execute(
                "UPDATE transactions SET is_transfer = 1, category = 'Transfers', category_source = 'rule' "
                "WHERE id IN (?, ?)", (o["id"], match["id"]),
            )
            linked += 1
    return linked
