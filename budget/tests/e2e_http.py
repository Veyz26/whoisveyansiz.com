"""End-to-end HTTP test against a running dev server (dev/serve.sh). Uses throwaway localhost accounts.
Usage (from budget/): python3 tests/e2e_http.py [workbook.xlsx]"""
import base64, http.cookiejar, json, os, secrets, subprocess, sys, tempfile, urllib.error, urllib.parse, urllib.request

BASE = "http://localhost:8766/private"
# Must match setup_codes in dev/config.php
SETUP = {"veyz@example.test": "VEYZ-DEV-0001", "tiara@example.test": "TIARA-DEV-0002"}
HERE = os.path.dirname(os.path.abspath(__file__))

def authenticator(cmd, state, options):
    """Software Face ID (tests/FakeAuthenticator.php) answering a WebAuthn challenge."""
    args = ["php", os.path.join(HERE, "FakeAuthenticator.php"), cmd, state] + (["localhost", "http://localhost:8766"] if cmd == "create" else [])
    return json.loads(subprocess.run(args, input=json.dumps(options), capture_output=True, text=True, check=True).stdout)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

def client():
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)
    st = {"csrf": None}
    def call(method, path, body=None, headers=None, raw=False):
        h = {"Content-Type": "application/json"} if body is not None else {}
        if st["csrf"] and method != "GET":
            h["X-CSRF-Token"] = st["csrf"]
        h.update(headers or {})
        req = urllib.request.Request(BASE + path, json.dumps(body).encode() if body is not None else None, h, method=method)
        try:
            r = op.open(req)
            data = r.read()
            return r.status, (data if raw else json.loads(data))
        except urllib.error.HTTPError as e:
            data = e.read()
            if e.code in (301, 302):
                return e.code, e.headers.get("Location")
            try:
                return e.code, json.loads(data or b"{}")
            except json.JSONDecodeError:
                return e.code, data[:200]
    return call, st, jar

fails = []
def expect(cond, what):
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)

pw = secrets.token_urlsafe(14)
A, sa, jar = client()
s, r = A("POST", "/api/auth/signup", {"email": "stranger@example.test", "name": "X", "password": pw, "consents": {"service": True}})
expect(s == 400 and "private" in r["error"], "non-allowlisted signup refused")
s, r = A("POST", "/api/auth/signup", {"email": "veyz@example.test", "name": "Veyz", "password": pw, "consents": {"service": True}})
expect(s == 400 and "setup phrase" in r["error"], "allow-listed signup without setup code refused")
s, r = A("POST", "/api/auth/signup", {"email": "veyz@example.test", "name": "Veyz", "password": pw, "setup_code": SETUP["veyz@example.test"], "consents": {"service": True}})
expect(s == 200, "allowlisted signup with setup code works")
cookie = [c for c in jar if c.name == "linen_sid"][0]
expect(cookie.path == "/private/" and cookie.has_nonstandard_attr("HttpOnly"), "session cookie is HttpOnly and scoped to /private/")
s, me = A("GET", "/api/me"); sa["csrf"] = me["csrf"]
expect(me["passkeys"] == {"count": 0, "recovery_left": 0, "required": True}, "new account must add Face ID")
expect(me.get("setup_only") and me["members"] == [] and me["household"]["name"] == "", "household details hidden until Face ID is added")
s, r = A("GET", "/api/budget?month=2026-11")
expect(s == 403 and "Face ID" in r["error"], "budget is blocked until Face ID is added")
veyz_state = tempfile.mktemp()
s, opts = A("POST", "/api/passkeys/options", {})
s, r = A("POST", "/api/passkeys", {"name": "iPhone", "credential": authenticator("create", veyz_state, opts)})
expect(s == 200 and len(r["recovery_codes"]) == 10, "Face ID registered, 10 recovery codes issued")
codes = r["recovery_codes"]
expect(A("GET", "/api/budget?month=2026-11")[0] == 200, "budget unlocked after Face ID")
s, me = A("GET", "/api/me")  # household details are only visible once Face ID is added
expect(me["billing"]["can_write"] and me["private_mode"], "private mode: no billing gate")
# private mode joins the first real household; the demo household is separate
names = [m["name"] for m in me["members"]]
expect(names == ["Veyz"], f"own household created (members {names})")
s, r = A("POST", "/api/members", {"name": "Tiara"}); tiara = r["id"]; veyz = me["members"][0]["id"]
tmp = sa["csrf"]; sa["csrf"] = "nope"
expect(A("POST", "/api/goals", {"name": "x", "target_cents": 1})[0] == 403, "wrong CSRF token refused"); sa["csrf"] = tmp
expect(A("POST", "/api/goals", {"name": "x", "target_cents": 1}, headers={"Content-Type": "text/plain"})[0] == 415, "non-JSON body refused")

if len(sys.argv) > 1:
    data = base64.b64encode(open(sys.argv[1], "rb").read()).decode()
    s, p = A("POST", "/api/workbook/preview", {"content_b64": data})
    expect(s == 200 and p["people"] == ["Veyz", "T"], f"workbook preview {p.get('people')}")
    s, r = A("POST", "/api/workbook/import", {"content_b64": data, "person_map": {"Veyz": veyz, "T": tiara}, "from_month": "2026-03"})
    expect(s == 200 and r["items_created"] > 20, f"workbook import {r}")
    s, v = A("GET", "/api/budget?month=2026-11")
    left = {p["name"]: p["surplus_cents"] for p in v["people"]}
    expect(left == {"Veyz": 6900, "Tiara": 160000} and v["household"]["surplus_cents"] == 166900,
           f"Nov 26 matches the spreadsheet: {left}, household {v['household']['surplus_cents']}")
    rent = next(l for l in v["lines"] if l["name"] == "Rent")
    s, h = A("GET", f"/api/budget/lines/{rent['id']}/history")
    expect([x["amount_cents"] for x in h] == [1500000, 1620000, 1560000], f"rent history {[x['amount_cents'] for x in h]}")
    s, r = A("POST", f"/api/budget/lines/{rent['id']}/amount", {"month": "2026-12", "amount_cents": 1600000, "mode": "onward", "note": "test"})
    expect(s == 200 and r["before_cents"] == 1560000, "debit order change recorded")
    s, f = A("GET", "/api/forecast?month=2026-11")
    expect(any("Rent goes up R400" in i["title"] for i in f["insights"]), "forecast shows the new change")
    s, r = A("POST", f"/api/budget/lines/{rent['id']}/paid", {"month": "2026-11", "paid": True})
    expect(s == 200, "tick as paid")

# Hostile or wrong-typed input gets a clean 400, never a 500 or HTML
for body, what in [({"member_id": veyz, "kind": "expense", "name": "x", "amount_cents": 9000000000000000000, "start_month": "2026-11"}, "huge amount"),
                   ({"member_id": veyz, "kind": "expense", "name": "x", "amount_cents": 1e30, "start_month": "2026-11"}, "float amount"),
                   ({"member_id": veyz, "kind": "expense", "name": "x", "amount_cents": 100, "start_month": 202603}, "month as a number"),
                   ({"member_id": veyz, "kind": "expense", "name": ["x"], "amount_cents": 100, "start_month": "2026-11"}, "name as a list")]:
    s, r = A("POST", "/api/budget/lines", body)
    expect(s == 400 and isinstance(r, dict) and "error" in r, f"{what} rejected with a clean 400 ({s})")
expect(A("GET", "/api/forecast?month=2026-11")[0] == 200, "forecast still works after hostile input")
s, r = A("POST", "/api/goals", {"name": "x", "target_cents": 1e30})
expect(s == 400, "goal with absurd target rejected")
s, r = A("POST", "/api/passkeys", {"name": "x", "credential": {"id": "AA", "response": {"clientDataJSON": "e30", "attestationObject": "eA"}}})
expect(s == 400 and isinstance(r, dict), "malformed passkey data rejected cleanly")

s, r = A("POST", "/api/import", {"content": open("tests/fnb_sample.csv").read(), "member_id": veyz, "account_label": "FNB"})
expect(s == 200 and r["rows_added"] == 88, f"statement import {r.get('rows_added')}")
s, a = A("GET", "/api/actuals?month=2026-10")
expect(s == 200 and a["has_data"] and len(a["advice"]["actions"]) == 3, "statement analysis + advice")
s, g = A("POST", "/api/goals", {"name": "Emergency fund", "target_cents": 3000000, "target_month": "2027-06"})
s, gl = A("GET", "/api/goals?month=2026-11")
expect(s == 200 and gl[0]["required_monthly_cents"] > 0, "goal plan")
s, tok = A("POST", "/api/tokens", {"name": "PBI"})
s, csv = A("GET", "/api/powerbi/fact_budget.csv", headers={"Authorization": "Bearer " + tok["token"]}, raw=True)
expect(s == 200 and csv.startswith(b"\xef\xbb\xbfmonth,person_id"), "Power BI live feed with token")
expect(A("GET", "/api/powerbi/fact_budget.csv")[0] == 401, "Power BI feed without token refused")
s, z = A("GET", "/api/export/powerbi.zip", raw=True)
expect(s == 200 and z[:2] == b"PK", "Power BI zip download")
s, ex = A("GET", "/api/privacy/export", raw=True)
expect(s == 200 and b"password_hash" not in ex, "POPIA data export")

# Signing in again: password alone is refused, Face ID works, password + recovery code works once
F, sf, _ = client()
s, r = F("POST", "/api/auth/login", {"email": "veyz@example.test", "password": pw})
expect(s == 401 and r.get("need_recovery_code"), "password alone refused once Face ID is set up")
s, o = F("POST", "/api/auth/passkey/options", {})
s, r = F("POST", "/api/auth/passkey/verify", authenticator("get", veyz_state, o))
expect(s == 200 and F("GET", "/api/me")[1]["user"]["email"] == "veyz@example.test", "Face ID sign-in over HTTP")
G, _, _ = client()
expect(G("POST", "/api/auth/login", {"email": "veyz@example.test", "password": pw, "recovery_code": codes[0]})[0] == 200, "password + recovery code")
expect(client()[0]("POST", "/api/auth/login", {"email": "veyz@example.test", "password": pw, "recovery_code": codes[0]})[0] == 401, "recovery code is single-use")

# Second allowlisted person joins the same household (no invite needed in private mode)
B, sb, _ = client()
s, r = B("POST", "/api/auth/signup", {"email": "tiara@example.test", "name": "Tiara", "password": pw, "setup_code": SETUP["tiara@example.test"], "consents": {"service": True}})
s, meb = B("GET", "/api/me"); sb["csrf"] = meb["csrf"]
s, opts = B("POST", "/api/passkeys/options", {})
B("POST", "/api/passkeys", {"name": "iPhone", "credential": authenticator("create", tempfile.mktemp(), opts)})
s, meb = B("GET", "/api/me")  # visible once her Face ID is added
expect(meb["household"]["id"] == me["household"]["id"] and meb["user"]["role"] == "partner", "Tiara joins the same household as partner")
expect([m["name"] for m in meb["members"]] == ["Veyz", "Tiara"], "...and is linked to her existing person")

# Microsoft sign-in start (redirect only; needs client_id configured in dev/config.php)
C, _, cj = client()
s, loc = C("GET", "/api/auth/microsoft/start")
if s == 302:
    q = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)
    expect(loc.startswith("https://login.microsoftonline.com/") and q["code_challenge_method"] == ["S256"] and "nonce" in q and "state" in q,
           "Microsoft redirect uses PKCE, state and nonce")
    expect(q["redirect_uri"] == [BASE + "/api/auth/microsoft/callback"], "redirect URI is the configured public URL")
    bind = [c for c in cj if c.name == "linen_oauth"]
    expect(bool(bind) and bind[0].path == "/private/api/auth/microsoft/", "browser-binding cookie set")
    s, loc2 = C("GET", "/api/auth/microsoft/callback?code=x&state=forged")
    expect(s == 302 and "#/signin?error=" in loc2, "forged state is refused")
else:
    print("skip Microsoft redirect test (no client_id in dev/config.php)")

# Static protection: PHP source must not be served
expect(urllib.request.urlopen(urllib.request.Request(BASE + "/")).status == 200, "app page served")
try:
    urllib.request.urlopen(BASE + "/index.php")
    expect(False, "index.php not served raw")
except urllib.error.HTTPError as e:
    expect(e.code in (403, 404), "index.php not served raw")

s, r = B("POST", "/api/privacy/leave", {"password": pw}); expect(s == 200, "partner can leave")
s, r = A("POST", "/api/privacy/delete-household", {"password": pw}); expect(s == 200, "owner can delete everything")
expect(A("GET", "/api/me")[0] == 401, "signed out after delete")
print(f"\n{len(fails)} failures" if fails else "\nall passed")
sys.exit(1 if fails else 0)
