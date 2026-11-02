"""FNB CSV export (online banking / app 'Download transactions').

FNB exports vary by channel, so this is tolerant:
- optional preamble lines (Name, Account, period) before the header;
- header row containing Date, Amount, Balance, Description (some exports prefix a
  record-type column, e.g. '5,Date,Amount,...'; columns are located by name);
- amounts signed with '-' or suffixed 'Cr'/'Dr' (credit card exports).
FNB prefixes fee lines with '#', which categorisation relies on.
"""
from __future__ import annotations

import re

from ..money import ParseError, parse_amount, parse_date
from .common import ParsedStatement, RawTxn, StatementFormatError, cell, col, find_header, last4, read_rows


def parse(content: str) -> ParsedStatement:
    rows = read_rows(content)
    h_idx, header = find_header(rows)
    stmt = ParsedStatement(bank="fnb")

    for row in rows[:h_idx]:
        joined = " ".join(row).lower()
        if "account" in joined and re.search(r"\d{4,}", joined):
            stmt.account_last4 = last4(re.findall(r"\d[\d\s]{3,}", joined)[-1])

    c_date = col(header, "date", "transaction date", "posting date")
    c_amount = col(header, "amount")
    c_bal = col(header, "balance", required=False)
    c_desc = col(header, "description", "details", "narrative")
    c_desc2 = col(header, "reference", required=False)

    for row in rows[h_idx + 1:]:
        if not any(row):
            continue
        try:
            amount = parse_amount(cell(row, c_amount))
            posted = parse_date(cell(row, c_date))
        except ParseError:
            stmt.skipped_rows += 1  # totals, footers, opening balance lines
            continue
        if amount is None:
            stmt.skipped_rows += 1
            continue
        desc = cell(row, c_desc)
        extra = cell(row, c_desc2)
        if extra and extra.lower() not in desc.lower():
            desc = f"{desc} {extra}"
        stmt.transactions.append(RawTxn(
            posted_on=posted,
            description=desc,
            amount_cents=amount,
            balance_cents=parse_amount(cell(row, c_bal)) if c_bal is not None else None,
        ))

    if not stmt.transactions:
        raise StatementFormatError("No transactions found in FNB file.")
    return stmt
