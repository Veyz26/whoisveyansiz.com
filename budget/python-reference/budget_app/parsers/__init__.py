"""Statement parsers. Each returns a ParsedStatement of bank-neutral RawTxn rows."""
from __future__ import annotations

from .common import ParsedStatement, RawTxn, StatementFormatError, read_rows, find_header
from . import capitec, fnb

PARSERS = {"fnb": fnb.parse, "capitec": capitec.parse}


def detect_bank(content: str) -> str:
    rows = read_rows(content)
    _, header = find_header(rows)
    cols = set(header)
    if {"money in", "money out"} & cols:
        return "capitec"
    return "fnb"


def parse_statement(content: str, bank: str = "auto") -> ParsedStatement:
    if content.lstrip().startswith("%PDF"):
        raise StatementFormatError(
            "PDF statements aren't supported yet. Export CSV from the FNB or Capitec app instead."
        )
    if bank == "auto":
        bank = detect_bank(content)
    if bank not in PARSERS:
        raise StatementFormatError(f"Unknown bank {bank!r}")
    return PARSERS[bank](content)


__all__ = ["ParsedStatement", "RawTxn", "StatementFormatError", "parse_statement", "detect_bank"]
