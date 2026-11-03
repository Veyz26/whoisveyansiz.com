"""Regenerate src/RuleData.php from the Python reference rules: python3 dev/gen_rules.py (run from budget/)."""
import pathlib, runpy, sys
root = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "python-reference"))
from budget_app.categorise import BUILTIN_RULES, GROUPS, BANK_CATEGORY_MAP  # noqa: E402

def php(v):
    if isinstance(v, str): return "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'"
    if isinstance(v, int): return str(v)
    if isinstance(v, list): return "[" + ", ".join(php(x) for x in v) + "]"
    if isinstance(v, dict): return "[" + ", ".join(f"{php(k)} => {php(x)}" for k, x in v.items()) + "]"

out = ["<?php", "/** GENERATED from python-reference/budget_app/categorise.py by dev/gen_rules.py. Don't edit by hand. */",
       "declare(strict_types=1);", "", "namespace Linen;", "", "final class RuleData", "{",
       "    public const GROUPS = " + php(GROUPS) + ";",
       "    public const BANK_CATEGORY_MAP = " + php(BANK_CATEGORY_MAP) + ";",
       "    /** [category, priority, direction, patterns]; 'regex:' prefix marks a regex rule. */",
       "    public const BUILTIN = ["]
out += [f"        [{php(c)}, {p}, {php(d)}, {php(pats)}]," for c, p, d, pats in BUILTIN_RULES]
out += ["    ];", "}"]
(root / "src" / "RuleData.php").write_text("\n".join(out) + "\n")
print("wrote src/RuleData.php")
