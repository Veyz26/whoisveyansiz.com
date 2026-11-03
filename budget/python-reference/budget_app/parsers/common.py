from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date


class StatementFormatError(ValueError):
    pass


@dataclass
class RawTxn:
    posted_on: date
    description: str
    amount_cents: int  # negative = money out
    balance_cents: int | None = None
    bank_category: str | None = None


@dataclass
class ParsedStatement:
    bank: str
    transactions: list[RawTxn] = field(default_factory=list)
    account_last4: str | None = None
    skipped_rows: int = 0


def read_rows(content: str) -> list[list[str]]:
    content = content.lstrip("﻿")
    sample = content[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return [[c.strip().strip("'\"").strip() for c in row] for row in csv.reader(io.StringIO(content), dialect)]


def _norm(cell: str) -> str:
    return re.sub(r"\s+", " ", cell.strip().lower())


def find_header(rows: list[list[str]]) -> tuple[int, list[str]]:
    """Locate the column-header row: needs a date column, a description column and amounts."""
    for i, row in enumerate(rows[:60]):
        cells = [_norm(c) for c in row]
        has_date = any("date" in c for c in cells)
        has_desc = any(c in ("description", "details", "narrative", "transaction description") for c in cells)
        has_amount = "amount" in cells or ("money in" in cells and "money out" in cells)
        if has_date and has_desc and has_amount:
            return i, cells
    raise StatementFormatError("Couldn't find a header row with Date, Description and Amount columns.")


def col(header: list[str], *names: str, required: bool = True) -> int | None:
    for name in names:
        if name in header:
            return header.index(name)
    if required:
        raise StatementFormatError(f"Missing column: {names[0]}")
    return None


def last4(raw: str | None) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    return digits[-4:] if len(digits) >= 4 else None


def cell(row: list[str], idx: int | None) -> str:
    return row[idx] if idx is not None and idx < len(row) else ""
