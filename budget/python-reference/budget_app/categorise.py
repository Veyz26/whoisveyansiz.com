"""Rule-based categorisation, with user overrides becoming rules.

Rules match against the sanitised description. 'word' rules match the pattern as whole
words (so 'RAIN' doesn't match 'TRAINING'); 'regex' rules are case-insensitive regexes.
Highest priority wins: user (1000) > llm (500) > builtin (100-300). Built-in rules live in
household 0 and apply to everyone; user and AI rules belong to one household.
"""
from __future__ import annotations

import re
import sqlite3
from functools import lru_cache

# Category -> budget group, used for the essentials / lifestyle / savings split.
GROUPS = {
    "Housing & utilities": "Essentials", "Groceries": "Essentials", "Fuel & transport": "Essentials",
    "Phone & internet": "Essentials", "Insurance": "Essentials", "Medical & health": "Essentials",
    "Debt repayments": "Essentials", "Bank fees": "Essentials", "Interest charged": "Essentials",
    "Giving": "Essentials",
    "Eating out": "Lifestyle", "Subscriptions": "Lifestyle", "Personal care": "Lifestyle",
    "Fitness & leisure": "Lifestyle", "Shopping": "Lifestyle", "Entertainment": "Lifestyle",
    "Cash withdrawals": "Lifestyle", "Other": "Lifestyle",
    "Savings & investments": "Savings",
    "Income": "Income", "Transfers": "Transfers",
}
CATEGORIES = list(GROUPS)
NON_SPEND = {"Transfers", "Savings & investments"}

USER_PRIORITY = 1000
LLM_PRIORITY = 500

# (category, priority, direction, patterns). 'regex:' prefix marks a regex rule.
BUILTIN_RULES: list[tuple[str, int, str, list[str]]] = [
    ("Bank fees", 300, "out", [
        "regex:^#", "regex:^FEE:", "MONTHLY ACCOUNT FEE", "MONTHLY FEE", "SERVICE FEE", "ADMIN FEE",
        "ACCOUNT FEE", "NOTIFICATION FEE", "SMS NOTIFICATION", "INAPP NOTIFICATION", "CASH DEPOSIT FEE",
        "ATM FEE", "WITHDRAWAL FEE", "BANK CHARGES", "DECLINED FEE", "UNPAID FEE", "CARD FEE",
        "regex:\\bFEE\\b", "BANK FEES",
    ]),
    ("Interest charged", 300, "out", [
        "INTEREST", "FINANCE CHARGE", "FINANCE CHARGES", "INT ON DEBIT", "OVERDRAFT INTEREST",
        "DEBIT INTEREST",
    ]),
    ("Income", 290, "in", [
        "SALARY", "SAL", "PAYROLL", "WAGES", "INTEREST", "CREDIT INTEREST", "EBUCKS", "CASHBACK",
        "REWARDS", "SASSA",
    ]),
    # Money back for something bought: it lowers spending instead of counting as income.
    ("Other", 290, "in", ["REFUND", "REVERSAL", "REVERSED"]),
    ("Eating out", 250, "out", [
        "UBER EATS", "UBEREATS", "MR D", "MRD", "KFC", "MCDONALDS", "MCDONALD'S", "MCD", "NANDOS",
        "NANDO'S", "STEERS", "WIMPY", "SPUR", "DEBONAIRS", "ROMANS PIZZA", "STARBUCKS", "VIDA E CAFFE",
        "MUGG & BEAN", "MUGG AND BEAN", "OCEAN BASKET", "BURGER KING", "FISHAWAYS", "CHICKEN LICKEN",
        "PIZZA", "RESTAURANT", "CAFE", "COFFEE", "TAKEOUT", "TAKE-OUT", "TAKEAWAY", "TAKEAWAYS", "DATE NIGHT",
        "DATE-DAY",
    ]),
    ("Cash withdrawals", 200, "out", ["ATM", "CASH WITHDRAWAL", "CASH WDL", "CASHSEND"]),
    ("Groceries", 200, "out", [
        "CHECKERS", "SIXTY60", "PICK N PAY", "PNP", "WOOLWORTHS", "SPAR", "SUPERSPAR", "KWIKSPAR",
        "SHOPRITE", "FOOD LOVER", "FOOD LOVERS", "BOXER", "USAVE", "OK FOODS", "FRUIT & VEG", "GROCERIES", "FOOD",
    ]),
    ("Fuel & transport", 200, "out", [
        "ENGEN", "SHELL", "BP", "SASOL", "CALTEX", "TOTALENERGIES", "ASTRON", "UBER", "BOLT",
        "GAUTRAIN", "E-TOLL", "SANRAL", "PARKING", "TOLL", "PUTCO", "MYCITI", "FUEL", "PETROL",
    ]),
    ("Phone & internet", 200, "any", [
        "VODACOM", "MTN", "CELL C", "TELKOM", "RAIN", "AFRIHOST", "WEBAFRICA", "VUMATEL", "OPENSERVE",
        "COOL IDEAS", "AIRTIME", "DATA BUNDLE", "PREPAID AIRTIME", "PREPAID DATA", "FIBRE", "FIBER", "CELLPHONE",
    ]),
    ("Subscriptions", 200, "out", [
        "NETFLIX", "SHOWMAX", "SPOTIFY", "DSTV", "MULTICHOICE", "YOUTUBE", "regex:YOUTUBE ?PREM", "LINKEDIN",
        "APPLE.COM", "APPLE COM BILL",
        "ICLOUD", "DISNEY", "PRIME VIDEO", "PRIMEVIDEO", "AMAZON PRIME", "MICROSOFT", "ADOBE", "OPENAI",
        "CHATGPT", "ANTHROPIC", "CLAUDE.AI", "GOOGLE ONE", "AUDIBLE", "DEEZER", "BOX OFFICE", "SUBS",
        "SUBSCRIPTIONS", "STREAMING",
    ]),
    ("Fitness & leisure", 200, "out", [
        "VIRGIN ACTIVE", "regex:VIRGIN ACT", "PLANET FITNESS", "GYM", "WORLD OF GOLF", "GOLF", "PARKRUN",
    ]),
    ("Housing & utilities", 200, "out", [
        "ESKOM", "PREPAID ELEC", "PREPAID ELECTRICITY", "ELECTRICITY", "CITY OF", "MUNICIPALITY",
        "MUNICIPAL", "RENT", "RENTAL", "LEVY", "LEVIES", "BODY CORPORATE", "WATER", "HOME LOAN", "BOND",
        "UTILITIES", "HOME SHORTFALL",
    ]),
    ("Insurance", 200, "out", [
        "MOMENTUM", "OLD MUTUAL", "SANLAM", "OUTSURANCE", "SANTAM", "HOLLARD", "MIWAY", "KING PRICE",
        "BUDGET INSURANCE", "1LIFE", "CLIENTELE", "INSURANCE", "ASSURANCE", "FUNERAL", "LIFE COVER",
        # FNB's own policies, often run together with a policy number ("Fnbfuneral Ab1234...").
        "regex:FNB ?LIFE", "regex:FNB ?FUNERAL", "regex:FNB ?INSURE",
    ]),
    ("Medical & health", 210, "out", [
        "DISCOVERY HEALTH", "MEDICAL AID", "BONITAS", "GEMS", "MEDSHIELD", "DIS-CHEM", "DISCHEM",
        "PHARMACY", "DOCTOR", "DENTIST", "LANCET", "PATHCARE", "AMPATH", "OPTOMETRIST", "SPEC-SAVERS",
        "SPECSAVERS", "MEDIWALLET", "MEDS", "MEDICATION", "VITAMINS", "GLASSES",
    ]),
    ("Personal care", 190, "out", [
        "CLICKS", "SALON", "BARBER", "HAIRCUT", "NAIL", "SUGARING", "WAX", "SORBET", "TOILETRIES",
    ]),
    ("Giving", 190, "out", ["TITHE", "TITHES", "CHURCH", "DONATION", "GIFT OF THE GIVERS"]),
    ("Shopping", 150, "out", [
        "TAKEALOT", "MR PRICE", "MRP", "MRPRICEH", "EDGARS", "TRUWORTHS", "PEP", "ACKERMANS", "H&M", "ZARA",
        "SUPERBALIST", "AMAZON", "MAKRO", "GAME", "INCREDIBLE CONNECTION", "BUILDERS", "CASHBUILD",
        "LEROY MERLIN", "SHEIN", "TEMU", "CNA", "SPORTSCENE", "TOTALSPORTS", "CAPE UNION MART", "@HOME",
    ]),
    ("Entertainment", 150, "out", [
        "STER KINEKOR", "NU METRO", "COMPUTICKET", "QUICKET", "STEAM", "PLAYSTATION", "XBOX",
        "BETWAY", "HOLLYWOODBETS", "SUPABETS", "LOTTO", "ITHUBA",
    ]),
    # FNB words its own-account moves as "Transfer" (payments to others are "Payment To"), and "Payment To
    # Investment ..." goes to the account holder's own FNB investment account: both are moves between their own
    # accounts, in either direction (money comes back from them too). These beat keyword rules such as
    # SAL (Income) or FUEL, which would otherwise read "Transfer From Savings Sal" as salary.
    ("Transfers", 295, "any", ["FNB APP TRANSFER"]),
    ("Transfers", 295, "out", ["PAYMENT TO INVESTMENT"]),
    # A card repayment, even when its reference says what the card was used for ("... Credit Card Groceries").
    ("Debt repayments", 260, "out", ["CREDIT CARD", "CRED CARD", "CC PAYMENT"]),
    ("Debt repayments", 180, "out", [
        "VEHICLE FINANCE", "WESBANK", "MFC", "PERSONAL LOAN",
        "STUDENT LOAN", "LOAN", "RCS", "TFG", "DIRECTAXIS", "ABSA VAF", "BUDGET FACILITY", "PAYJUSTNOW",
        "PAYFLEX",
    ]),
    ("Savings & investments", 180, "out", [
        "TFSA", "TAX FREE", "TAX-FREE", "EASYEQUITIES", "EASY EQUITIES", "SATRIX", "ALLAN GRAY",
        "10X", "NOTICE DEPOSIT", "FIXED DEPOSIT", "SAVINGS POCKET", "UNIT TRUST", "RETIREMENT ANNUITY",
        "MONEY MARKET",
    ]),
    ("Transfers", 160, "any", [
        "TRANSFER", "TRF", "INTER ACC", "INTER-ACCOUNT", "OWN ACCOUNT", "OWN ACC", "SAVINGS TRANSFER",
    ]),
]

# Capitec exports their own category per row; use it when no rule matched.
BANK_CATEGORY_MAP = {
    "groceries": "Groceries", "takeaways": "Eating out", "restaurants": "Eating out",
    "fuel": "Fuel & transport", "transport": "Fuel & transport", "cellphone": "Phone & internet",
    "internet": "Phone & internet", "digital subscriptions": "Subscriptions",
    "subscriptions": "Subscriptions", "electricity": "Housing & utilities", "rent": "Housing & utilities",
    "insurance": "Insurance", "medical": "Medical & health", "pharmacy": "Medical & health",
    "clothing": "Shopping", "online store": "Shopping", "entertainment": "Entertainment",
    "cash withdrawal": "Cash withdrawals", "fees": "Bank fees", "interest": "Interest charged",
    "salary": "Income", "transfer": "Transfers", "investments": "Savings & investments",
    "loans": "Debt repayments", "personal care": "Personal care", "donations": "Giving",
}


def seed_builtin_rules(conn: sqlite3.Connection) -> None:
    rows = []
    for category, priority, direction, patterns in BUILTIN_RULES:
        for p in patterns:
            match, pattern = ("regex", p[6:]) if p.startswith("regex:") else ("word", p)
            rows.append((pattern, match, direction, category, priority))
    with conn:
        conn.executemany(
            "INSERT OR IGNORE INTO rules (household_id, pattern, match, direction, category, priority, source) "
            "VALUES (0, ?, ?, ?, ?, ?, 'builtin')", rows,
        )


def guess_category(name: str, amount_sign: int = -1) -> str:
    """Best guess for a budget line typed by hand ('Netflix', 'Rent'), using the same rules."""
    for category, _, direction, patterns in sorted(BUILTIN_RULES, key=lambda r: -r[1]):
        if (direction == "in" and amount_sign < 0) or (direction == "out" and amount_sign > 0):
            continue
        for p in patterns:
            if p.startswith("regex:"):
                continue
            if _compile(p, "word").search(name.upper()):
                return category
    return "Other"


@lru_cache(maxsize=8192)
def _compile(pattern: str, match: str) -> re.Pattern:
    if match == "regex":
        return re.compile(pattern, re.IGNORECASE)
    return re.compile(r"(?<![A-Z0-9])" + re.escape(pattern.upper()) + r"(?![A-Z0-9])")


def _load_rules(conn: sqlite3.Connection, household_id: int) -> list[sqlite3.Row]:
    # Longer patterns first within a priority, so 'UBER EATS' beats 'UBER'.
    return conn.execute(
        "SELECT * FROM rules WHERE household_id IN (0, ?) ORDER BY priority DESC, length(pattern) DESC, id",
        (household_id,),
    ).fetchall()


def match_rule(rules: list[sqlite3.Row], description: str, amount_cents: int) -> sqlite3.Row | None:
    text = description.upper()
    for r in rules:
        if r["direction"] == "in" and amount_cents < 0:
            continue
        if r["direction"] == "out" and amount_cents > 0:
            continue
        if _compile(r["pattern"], r["match"]).search(text):
            return r
    return None


def categorise_one(rules, description: str, amount_cents: int, bank_category: str | None):
    """Returns (category, source, rule_id)."""
    rule = match_rule(rules, description, amount_cents)
    if rule:
        return rule["category"], ("llm" if rule["source"] == "llm" else "rule"), rule["id"]
    if bank_category:
        mapped = BANK_CATEGORY_MAP.get(bank_category.strip().lower())
        if mapped:
            return mapped, "bank", None
    if amount_cents > 0:
        return "Income", "none", None
    return "Other", "none", None


def apply_rules(conn: sqlite3.Connection, household_id: int, ids: list[int] | None = None) -> int:
    """(Re)categorise transactions, never touching manual ('user') choices or linked transfers."""
    rules = _load_rules(conn, household_id)
    sql = ("SELECT id, description, amount_cents, bank_category FROM transactions "
           "WHERE household_id = ? AND category_source != 'user' AND is_transfer = 0")
    params: list = [household_id]
    if ids is not None:
        if not ids:
            return 0
        sql += f" AND id IN ({','.join('?' * len(ids))})"
        params += ids
    changed = 0
    for t in conn.execute(sql, params).fetchall():
        category, source, rule_id = categorise_one(rules, t["description"], t["amount_cents"], t["bank_category"])
        conn.execute(
            "UPDATE transactions SET category = ?, category_source = ?, rule_id = ? WHERE id = ?",
            (category, source, rule_id, t["id"]),
        )
        changed += 1
    return changed


def payee_pattern(merchant: str) -> str:
    """A rule that recognises a payee from its key: the key's words in order, letters-only boundaries (so
    "FNB INSURE" matches "FNB Insure1234567"), anything between them ("APPLE COM BILL" matches "Apple.Com/Bill")."""
    return ".*?".join(rf"(?<![A-Z]){re.escape(w)}(?![A-Z])" for w in merchant.split())


def specific_payee(merchant: str) -> bool:
    """Whether a payee key is specific enough for a rule ("V" or "FNB" would catch far too much)."""
    letters = len(re.sub(r"[^A-Z]", "", merchant.upper()))
    return letters >= 5 or (letters >= 4 and len(merchant.split()) >= 2)


def set_category(conn: sqlite3.Connection, household_id: int, txn_id: int, category: str,
                 make_rule: bool = True) -> dict:
    """Manual override. With make_rule, existing and future transactions from the same
    merchant follow it too (except other manual choices)."""
    if category not in CATEGORIES:
        raise ValueError(f"Unknown category {category!r}")
    txn = conn.execute("SELECT * FROM transactions WHERE id = ? AND household_id = ?",
                       (txn_id, household_id)).fetchone()
    if not txn:
        raise LookupError("Transaction not found")
    affected = 1
    with conn:
        conn.execute(
            "UPDATE transactions SET category = ?, category_source = 'user', is_transfer = ? WHERE id = ?",
            (category, int(category == "Transfers"), txn_id),
        )
        make_rule = make_rule and specific_payee(txn["merchant"])
        if make_rule:
            direction = "in" if txn["amount_cents"] > 0 else "out"
            cur = conn.execute(
                """INSERT INTO rules (household_id, pattern, match, direction, category, priority, source)
                   VALUES (?, ?, 'regex', ?, ?, ?, 'user')
                   ON CONFLICT (household_id, pattern, match, direction)
                   DO UPDATE SET category = excluded.category, priority = excluded.priority, source = 'user'
                   RETURNING id""",
                (household_id, payee_pattern(txn["merchant"]), direction, category, USER_PRIORITY),
            )
            rule_id = cur.fetchone()["id"]
            sign = ">" if direction == "in" else "<"
            cur = conn.execute(
                f"""UPDATE transactions
                    SET category = ?, category_source = 'rule', rule_id = ?, is_transfer = ?
                    WHERE household_id = ? AND merchant = ? AND id != ? AND category_source != 'user'
                      AND amount_cents {sign} 0""",
                (category, rule_id, int(category == "Transfers"), household_id, txn["merchant"], txn_id),
            )
            affected += cur.rowcount
    return {"updated": affected, "rule_created": bool(make_rule)}


def unknown_merchants(conn: sqlite3.Connection, household_id: int, limit: int = 80) -> list[dict]:
    rows = conn.execute(
        """SELECT merchant, MIN(description) AS example, COUNT(*) AS n,
                  SUM(CASE WHEN amount_cents < 0 THEN 1 ELSE 0 END) AS n_out
           FROM transactions
           WHERE household_id = ? AND category_source = 'none' AND is_transfer = 0
           GROUP BY merchant ORDER BY n DESC LIMIT ?""", (household_id, limit),
    ).fetchall()
    return [dict(r) for r in rows]
