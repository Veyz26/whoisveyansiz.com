"""Import a household budget workbook kept in Excel, one sheet per month.

Recognises the common hand-built layout:

    <Name> Salary | 48 800
    Type          | Amount | Notes
    Car           | 5 800  |
    Rent          | 15 600 | ...
    Total         | =SUM(...)

with one block per person, an optional section column to the left of the item names
('Fixed Debit Orders', 'Misc', 'Savings'), and sheets named like 'March 26' or 'Aug 25'.
Each item becomes a budget line; amounts that differ between monthly sheets are recorded as
changes from that month; items missing from later sheets end after the last month seen.

Stdlib only (zipfile + XML). Formulas aren't evaluated: Excel's cached values are used.
"""
from __future__ import annotations

import io
import re
import sqlite3
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .budget import amount_on, create_line, default_flexibility, set_amount
from .money import add_months
from .categorise import guess_category
from .db import audit

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_SHEET_MONTH = re.compile(r"^\s*([a-z]{3})[a-z]*\.?\s+'?(\d{2}|\d{4})\s*$", re.I)
_SALARY = re.compile(r"^\s*(.+?)\s+salary\s*$", re.I)
_SAVING = re.compile(r"saving|emergency|holiday|invest|dollar|tfsa|retire", re.I)
_CREDIT = re.compile(r"credit|\bcc\b|loan|payflex|payjustnow|facility", re.I)
_DEBIT_CATS = {"Debt repayments", "Insurance", "Phone & internet", "Subscriptions", "Bank fees", "Housing & utilities",
               "Medical & health", "Fitness & leisure"}
MAX_BYTES = 5 * 1024 * 1024


class WorkbookError(ValueError):
    pass


@dataclass
class Item:
    person: str
    section: str
    name: str
    amount_cents: int
    notes: str | None
    kind: str


@dataclass
class SheetPlan:
    sheet: str
    month: str
    items: list[Item] = field(default_factory=list)


def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def _read_sheets(data: bytes) -> list[tuple[str, dict]]:
    if len(data) > MAX_BYTES:
        raise WorkbookError("That workbook is too large (5 MB max).")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        names = set(z.namelist())
        if sum(i.file_size for i in z.infolist()) > 60 * MAX_BYTES:  # zip-bomb guard
            raise WorkbookError("That workbook expands to an unreasonable size.")
        shared = []
        if "xl/sharedStrings.xml" in names:
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise WorkbookError("That doesn't look like an .xlsx workbook.") from exc

    out = []
    for s in wb.find("m:sheets", NS):
        target = rels.get(s.get(f"{{{NS['r']}}}id"), "")
        path = "xl/" + target.lstrip("/").removeprefix("xl/")
        if path not in names:
            continue
        grid: dict[tuple[int, int], object] = {}
        for row in ET.fromstring(z.read(path)).iter(f"{{{NS['m']}}}row"):
            r = int(row.get("r"))
            for c in row.findall("m:c", NS):
                v = c.find("m:v", NS)
                t = c.get("t")
                if t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
                elif v is None or v.text is None:
                    continue
                elif t == "s":
                    val = shared[int(v.text)]
                elif t in ("str", "e"):
                    val = v.text
                elif t == "b":
                    val = v.text == "1"
                else:
                    try:
                        val = float(v.text)
                    except ValueError:
                        val = v.text
                grid[(r, _col_index(c.get("r")))] = val
        out.append((s.get("name"), grid))
    return out


def _sheet_month(name: str) -> str | None:
    m = _SHEET_MONTH.match(name)
    if not m or m.group(1).lower() not in MONTHS:
        return None
    y = int(m.group(2))
    y = y + 2000 if y < 100 else y
    return f"{y:04d}-{MONTHS[m.group(1).lower()]:02d}"


def _num(v) -> int | None:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return round(v * 100)
    s = re.sub(r"[R\s,]", "", str(v))
    try:
        return round(float(s) * 100)
    except ValueError:
        return None


def _text(v) -> str:
    if v is None or isinstance(v, bool):
        return ""
    if isinstance(v, float):
        return f"{v:g}"
    return str(v).strip()


def _parse_sheet(name: str, month: str, grid: dict) -> SheetPlan:
    plan = SheetPlan(name, month)
    max_row = max((r for r, _ in grid), default=0)
    salary_rows = []
    for (r, c), v in sorted(grid.items()):
        if isinstance(v, str) and _SALARY.match(v):
            salary_rows.append((r, c, _SALARY.match(v).group(1).strip()))

    for idx, (srow, lcol, person) in enumerate(salary_rows):
        end_row = salary_rows[idx + 1][0] if idx + 1 < len(salary_rows) else max_row + 1
        # Header row ('Type | Amount | Amount | Notes') decides which column holds this month's amounts.
        header_row, amount_col = None, lcol + 1
        for r in range(srow + 1, min(srow + 5, end_row)):
            if _text(grid.get((r, lcol))).lower().startswith("type"):
                header_row = r
                c = lcol + 1
                while _text(grid.get((r, c))).lower().startswith("amount"):
                    amount_col = c
                    c += 1
                break
        salary = _num(grid.get((srow, amount_col))) or _num(grid.get((srow, lcol + 1)))
        if salary:
            plan.items.append(Item(person, "Income", f"{person} salary", salary, None, "income"))
        notes_col = amount_col + 1
        section = "Monthly"
        for r in range(header_row + 1 if header_row else srow + 1, end_row):
            label = _text(grid.get((r, lcol)))
            if lcol > 1 and _text(grid.get((r, lcol - 1))):
                section = _text(grid.get((r, lcol - 1)))[:40]
            if not label:
                continue
            low = label.lower()
            if low.startswith("total"):
                break
            if low.startswith("type") or _SALARY.match(label):
                continue
            amount = _num(grid.get((r, amount_col)))
            if amount is None or amount < 0:
                continue
            note = grid.get((r, notes_col))
            note = _text(note) if isinstance(note, str) else None
            if note is not None and len(note) <= 2:  # ticks and initials from a "done" column aren't notes
                note = None
            is_saving = _SAVING.search(label) or section.lower().startswith("saving")
            kind = "saving" if is_saving and not _CREDIT.search(label) else "expense"
            plan.items.append(Item(person, section, label[:80], amount, note, kind))
    return plan


def parse_workbook(data: bytes) -> list[SheetPlan]:
    plans = []
    for name, grid in _read_sheets(data):
        month = _sheet_month(name)
        if month:
            p = _parse_sheet(name, month, grid)
            if p.items:
                plans.append(p)
    if not plans:
        raise WorkbookError("No monthly sheets found. Sheets should be named like 'March 26' and have "
                            "'<Name> Salary' rows with items underneath.")
    plans.sort(key=lambda p: p.month)
    # Keep the latest sheet when two sheets map to the same month.
    dedup = {p.month: p for p in plans}
    return [dedup[m] for m in sorted(dedup)]


def preview(data: bytes) -> dict:
    plans = parse_workbook(data)
    people = []
    for p in plans:
        for i in p.items:
            if i.person not in people:
                people.append(i.person)
    return {"sheets": [{"sheet": p.sheet, "month": p.month, "items": len(p.items)} for p in plans],
            "people": people}


def _norm_name(name: str) -> str:
    return re.sub(r"\W+", " ", name.lower()).strip()


def _classify(it: Item) -> tuple[str, bool]:
    """(category, is_debit_order) for a workbook item, from its name and section."""
    if it.kind == "income":
        return "Income", False
    cat = guess_category(it.name)
    if it.kind == "saving" and cat == "Other":
        cat = "Savings & investments"
    return cat, ("debit" in it.section.lower()) or (it.section == "Monthly" and cat in _DEBIT_CATS)


def import_workbook(conn: sqlite3.Connection, household_id: int, data: bytes, person_map: dict[str, int],
                    user_id: int | None = None, from_month: str | None = None) -> dict:
    """person_map: name found in the workbook -> member id in this household.

    Idempotent: items already in the budget (same person, same name) are updated, not duplicated.
    An item missing from a sheet ends the month before that sheet; if it reappears it resumes, with R0
    for the months it was missing. Later sheets update an item's section, debit-order flag and (if it
    was unrecognised) its category."""
    plans = [p for p in parse_workbook(data) if not from_month or p.month >= from_month]
    if not plans:
        raise WorkbookError("No sheets on or after that month.")
    valid = {r[0] for r in conn.execute("SELECT id FROM members WHERE household_id = ?", (household_id,))}
    existing = {}
    for r in conn.execute("SELECT * FROM budget_lines WHERE household_id = ? ORDER BY id", (household_id,)):
        existing[(r["member_id"], _norm_name(r["name"]))] = r
    lines: dict[tuple[int, str], dict] = {}
    created = changes = 0
    prev_month = None
    for p in plans:
        seen = set()
        for it in p.items:
            mid = person_map.get(it.person)
            if mid not in valid:
                continue
            key = (mid, _norm_name(it.name))
            if key in seen:
                key = (mid, key[1] + f" #{len([k for k in seen if k[0] == mid])}")
            seen.add(key)
            cat, is_do = _classify(it)
            if key not in lines and key in existing:
                r = existing[key]
                if r["start_month"] > p.month and it.amount_cents == 0:
                    continue  # still R0 before it started: nothing to back-date
                lines[key] = {"id": r["id"], "amount": amount_on(conn, r["id"], p.month), "last": None, "ended": None,
                              "notes": r["notes"], "section": r["section"], "category": r["category"],
                              "debit": bool(r["is_debit_order"]), "name": r["name"]}
                if r["start_month"] > p.month:
                    conn.execute("UPDATE budget_lines SET start_month = ? WHERE id = ?", (p.month, r["id"]))
            if key not in lines:
                if it.amount_cents == 0:
                    continue
                line_id = create_line(
                    conn, household_id, member_id=mid, kind=it.kind, name=it.name, amount_cents=it.amount_cents,
                    start_month=p.month, section=it.section if it.kind != "income" else "Income", category=cat,
                    is_debit_order=is_do, notes=it.notes)
                lines[key] = {"id": line_id, "amount": it.amount_cents, "last": p.month, "ended": None, "notes": it.notes,
                              "section": it.section if it.kind != "income" else "Income", "category": cat, "debit": is_do,
                              "name": it.name}
                created += 1
                continue
            ln = lines[key]
            if ln["ended"]:  # came back after missing from one or more sheets
                set_amount(conn, household_id, ln["id"], add_months(ln["ended"], 1), 0, "onward", note="not in the workbook")
                ln["amount"], ln["ended"] = 0, None
                conn.execute("UPDATE budget_lines SET end_month = NULL WHERE id = ?", (ln["id"],))
            if it.amount_cents != amount_on(conn, ln["id"], p.month):  # compare with what's stored, so re-imports are no-ops
                set_amount(conn, household_id, ln["id"], p.month, it.amount_cents, "onward", note=f"from sheet '{p.sheet}'")
                ln["amount"] = it.amount_cents
                changes += 1
            updates = {}
            section = it.section if it.kind != "income" else "Income"
            if section != ln["section"]:
                updates["section"] = section
            if is_do != ln["debit"]:
                updates["is_debit_order"] = int(is_do)
            if ln["category"] == "Other" and cat != "Other":
                updates["category"] = cat
                updates["flexibility"] = default_flexibility(cat, ln["name"])
            if it.notes and it.notes != ln["notes"]:
                updates["notes"] = it.notes[:200]
            if updates:
                conn.execute(f"UPDATE budget_lines SET {', '.join(f'{k} = ?' for k in updates)} WHERE id = ?",
                             [*updates.values(), ln["id"]])
                ln.update({"section": updates.get("section", ln["section"]), "debit": bool(updates.get("is_debit_order", ln["debit"])),
                           "category": updates.get("category", ln["category"]), "notes": updates.get("notes", ln["notes"])})
            ln["last"] = p.month
        # Items in the previous sheet but not this one end the month before this sheet.
        if prev_month:
            for key, ln in lines.items():
                if key not in seen and not ln["ended"] and ln["last"] == prev_month:
                    ln["ended"] = add_months(p.month, -1)
                    conn.execute("UPDATE budget_lines SET end_month = ? WHERE id = ?", (ln["ended"], ln["id"]))
        prev_month = p.month
    last_month = plans[-1].month
    with conn:
        for ln in lines.values():
            if ln["last"] == last_month:
                conn.execute("UPDATE budget_lines SET end_month = NULL WHERE id = ?", (ln["id"],))
        audit(conn, household_id, user_id, "workbook.imported",
              f"{len(plans)} sheets, {created} items, {changes} amount changes")
    return {"sheets": [p.sheet for p in plans], "items_created": created, "amount_changes": changes,
            "from_month": plans[0].month, "to_month": last_month}
