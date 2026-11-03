"""Money and date helpers. All money is integer cents (ZAR); never floats."""
from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


class ParseError(ValueError):
    pass


_AMOUNT_JUNK = re.compile(r"[R\s '’]")


def parse_amount(raw: str | None) -> int | None:
    """Parse a bank-export amount into signed cents.

    Handles '-1 234.56', '1,234.56', '1234,56', '150.00 Cr', '150.00 Dr', '(150.00)', 'R 99.00'.
    Returns None for empty cells.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in {"-", "--"}:
        return None

    sign = 1
    low = s.lower()
    if low.endswith("cr"):
        s = s[:-2]
    elif low.endswith("dr"):
        s, sign = s[:-2], -1
    if s.startswith("(") and s.endswith(")"):
        s, sign = s[1:-1], -sign

    s = _AMOUNT_JUNK.sub("", s)
    if s.startswith("-"):
        s, sign = s[1:], -sign
    elif s.endswith("-"):
        s, sign = s[:-1], -sign
    s = s.lstrip("+")

    if "," in s and "." in s:
        s = s.replace(",", "")  # comma is a thousands separator
    elif "," in s:
        head, _, tail = s.rpartition(",")
        s = f"{head.replace(',', '')}.{tail}" if len(tail) in (1, 2) else s.replace(",", "")

    try:
        value = Decimal(s)
    except InvalidOperation as exc:
        raise ParseError(f"Not an amount: {raw!r}") from exc
    cents = (value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return sign * int(cents)


_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_MONTHS["sept"] = 9
_FULL = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]


def parse_date(raw: str) -> date:
    """Year-first (2026/10/05, 2026-10-05, 20261005) or South African day-first (05/10/2026, 05.10.26,
    05 Oct 2026, 5-October-26). Two-digit years mean 20xx; years outside 2000..next year are rejected."""
    s = re.sub(r"\s+", " ", str(raw).strip()).split("T")[0]
    s = re.sub(r" \d{1,2}:\d{2}(:\d{2})?$", "", s)
    m = re.match(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$", s) or re.match(r"^(\d{4})(\d{2})(\d{2})$", s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    elif m := re.match(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$", s):
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
    elif m := re.match(r"^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2}|\d{4})$", s):
        name = m[2].lower()
        mo = _MONTHS.get(name) or _MONTHS.get(name[:3], 0)
        if mo and len(name) > 4 and _FULL[mo - 1] != name:
            mo = 0
        d, y = int(m[1]), int(m[3])
    else:
        raise ParseError(f"Unrecognised date: {raw!r}")
    if y < 100:
        y += 2000
    try:
        out = date(y, mo, d)
    except ValueError:
        raise ParseError(f"Unrecognised date: {raw!r}") from None
    if y < 2000 or y > date.today().year + 1:
        raise ParseError(f"Unrecognised date: {raw!r}")
    return out


def format_zar(cents: int, *, signed: bool = False) -> str:
    """R1 234.56, or R1 234 when there are no cents."""
    sign = "-" if cents < 0 else ("+" if signed and cents > 0 else "")
    rands, c = divmod(abs(cents), 100)
    return (f"{sign}R{rands:,}" + (f".{c:02d}" if c else "")).replace(",", "\u00a0")


def month_key(d: date | str) -> str:
    return (d.isoformat() if isinstance(d, date) else d)[:7]


def add_months(month: str, delta: int) -> str:
    y, m = map(int, month.split("-"))
    idx = y * 12 + (m - 1) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"
