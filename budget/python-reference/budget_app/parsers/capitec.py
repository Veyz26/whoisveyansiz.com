"""Capitec CSV export (app / online banking 'Export transactions').

Expected columns (order may vary): Nr, Account, Posting Date, Transaction Date,
Description, Original Description, Parent Category, Category, Money In, Money Out,
Fee, Balance.

Capitec puts the fee for a transaction in its own column on the same row. We split it
into a separate 'Fee: <description>' transaction so the fee finder can see it.
"""
from __future__ import annotations

from ..money import ParseError, parse_amount, parse_date
from .common import ParsedStatement, RawTxn, StatementFormatError, cell, col, find_header, last4, read_rows


def parse(content: str) -> ParsedStatement:
    rows = read_rows(content)
    h_idx, header = find_header(rows)
    stmt = ParsedStatement(bank="capitec")

    c_date = col(header, "transaction date", "posting date", "date")
    c_desc = col(header, "description", "original description")
    c_orig = col(header, "original description", required=False)
    c_cat = col(header, "category", required=False)
    c_in = col(header, "money in", required=False)
    c_out = col(header, "money out", required=False)
    c_amount = col(header, "amount", required=False)
    c_fee = col(header, "fee", "fees", required=False)
    c_bal = col(header, "balance", required=False)
    c_acct = col(header, "account", required=False)
    if c_amount is None and (c_in is None or c_out is None):
        raise StatementFormatError("Capitec file needs Money In/Money Out or Amount columns.")

    for row in rows[h_idx + 1:]:
        if not any(row):
            continue
        try:
            posted = parse_date(cell(row, c_date))
            if c_amount is not None and cell(row, c_amount):
                amount = parse_amount(cell(row, c_amount)) or 0
            else:
                money_in = parse_amount(cell(row, c_in)) or 0
                money_out = parse_amount(cell(row, c_out)) or 0
                amount = abs(money_in) - abs(money_out)
            fee = parse_amount(cell(row, c_fee)) if c_fee is not None else None
        except ParseError:
            stmt.skipped_rows += 1
            continue

        if stmt.account_last4 is None and c_acct is not None:
            stmt.account_last4 = last4(cell(row, c_acct))

        desc = cell(row, c_desc) or cell(row, c_orig)
        bank_cat = cell(row, c_cat) or None
        balance = parse_amount(cell(row, c_bal)) if c_bal is not None else None
        if amount:
            stmt.transactions.append(RawTxn(posted, desc, amount, balance, bank_cat))
        if fee:
            stmt.transactions.append(RawTxn(posted, f"Fee: {desc}", -abs(fee), None, "Fees"))
        if not amount and not fee:
            stmt.skipped_rows += 1

    if not stmt.transactions:
        raise StatementFormatError("No transactions found in Capitec file.")
    return stmt
