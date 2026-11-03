"""Optional LLM-assisted categorisation for merchants no rule recognises.

Privacy: only the masked merchant key and one masked example description per merchant
are sent, plus whether money went in or out. No amounts, dates, balances or account
details. Results are saved as 'llm' rules, so each merchant is only ever asked about once
and the user can override any of them (user rules outrank llm rules).

Requires `pip install anthropic` and credentials (ANTHROPIC_API_KEY or `ant auth login`).
"""
from __future__ import annotations

import json
import os
import sqlite3

from .categorise import CATEGORIES, LLM_PRIORITY, apply_rules, unknown_merchants

MODEL = os.environ.get("BUDGET_LLM_MODEL", "claude-opus-5-5")

SYSTEM = (
    "You categorise South African bank-statement counterparties for a personal budget app. "
    "Descriptions come from FNB and Capitec exports and may be truncated or abbreviated. "
    "Pick the single best category from the allowed list. If you can't tell what the "
    "merchant is, answer 'Other' with low confidence rather than guessing."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "merchant": {"type": "string"},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["merchant", "category", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
}


class LLMUnavailable(RuntimeError):
    pass


def available() -> tuple[bool, str]:
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False, "Install the optional 'anthropic' package to enable AI categorisation."
    return True, ""


def categorise_unknowns(conn: sqlite3.Connection, household_id: int, limit: int = 80) -> dict:
    ok, why = available()
    if not ok:
        raise LLMUnavailable(why)
    import anthropic

    unknown = unknown_merchants(conn, household_id, limit)
    if not unknown:
        return {"asked": 0, "rules_created": 0, "transactions_updated": 0}

    lines = [
        {"merchant": u["merchant"], "example": u["example"],
         "direction": "out" if u["n_out"] >= u["n"] - u["n_out"] else "in"}
        for u in unknown
    ]
    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=8000,
            system=SYSTEM,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{
                "role": "user",
                "content": "Categorise each merchant. Return one result per merchant, using the "
                           "merchant string exactly as given.\n\n" + json.dumps(lines, ensure_ascii=False),
            }],
        )
    except anthropic.AuthenticationError as exc:
        raise LLMUnavailable("No valid Anthropic credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.") from exc
    except anthropic.RateLimitError as exc:
        raise LLMUnavailable("Rate limited by the API; try again in a minute.") from exc
    except anthropic.APIStatusError as exc:
        raise LLMUnavailable(f"API error ({exc.status_code}): {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise LLMUnavailable("Couldn't reach the Anthropic API.") from exc

    if response.stop_reason == "refusal":
        raise LLMUnavailable("The model declined this request.")
    if response.stop_reason == "max_tokens":
        raise LLMUnavailable("Response was cut off; try again with fewer merchants.")
    text = next(b.text for b in response.content if b.type == "text")
    results = json.loads(text)["results"]

    asked = {u["merchant"] for u in unknown}
    created = 0
    with conn:
        for r in results:
            # Low-confidence and 'Other' answers stay uncategorised for the user to decide.
            if r["merchant"] not in asked or r["category"] == "Other" or r["confidence"] == "low":
                continue
            cur = conn.execute(
                "INSERT OR IGNORE INTO rules (household_id, pattern, match, direction, category, priority, source) "
                "VALUES (?, ?, 'word', 'any', ?, ?, 'llm')",
                (household_id, r["merchant"], r["category"], LLM_PRIORITY),
            )
            created += cur.rowcount
        ids = [row["id"] for row in conn.execute(
            "SELECT id FROM transactions WHERE household_id = ? AND category_source = 'none' AND is_transfer = 0",
            (household_id,))]
        apply_rules(conn, household_id, ids)
        still_unknown = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE household_id = ? AND category_source = 'none' AND is_transfer = 0",
            (household_id,)).fetchone()[0]
        updated = len(ids) - still_unknown
    return {"asked": len(unknown), "rules_created": created, "transactions_updated": updated}
