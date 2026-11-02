"""Concurrency test: a fresh database hit by simultaneous first requests, then simultaneous writes.
Starts its own multi-worker PHP server on :8775 with a throwaway database.
Usage (from budget/): python3 tests/concurrency.py"""
import concurrent.futures as cf, json, os, re, secrets, sqlite3, subprocess, sys, tempfile, time, urllib.request, http.cookiejar

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PORT = 8775
BASE = f"http://localhost:{PORT}/private"
tmp = tempfile.mkdtemp()
cfg = os.path.join(tmp, "config.php")
db_path = os.path.join(tmp, "c.db")
code = secrets.token_hex(6)
with open(cfg, "w") as f:
    f.write(f"<?php return ['db_path' => '{db_path}', 'allowed_emails' => ['c@example.test'], 'setup_codes' => ['c@example.test' => '{code}'],"
            f" 'public_url' => '{BASE}', 'secure_cookies' => false];")
env = dict(os.environ, BUDGET_CONFIG=cfg, PHP_CLI_SERVER_WORKERS="8")
srv = subprocess.Popen(["php", "-S", f"localhost:{PORT}", "dev/router.php"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, start_new_session=True)  # own process group: workers die with it
fails = []

def expect(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        fails.append(what)

try:
    time.sleep(1)
    def get(_):
        try:
            return urllib.request.urlopen(BASE + "/api/config").status
        except urllib.error.HTTPError as e:
            return e.code
    with cf.ThreadPoolExecutor(12) as ex:
        codes = list(ex.map(get, range(12)))
    expect(codes == [200] * 12, f"12 simultaneous first requests on an empty database: {codes}")
    want = int(re.search(r"SCHEMA_VERSION = (\d+)", open(os.path.join(ROOT, "src", "Db.php")).read())[1])
    got = sqlite3.connect(db_path).execute("PRAGMA user_version").fetchone()[0]
    expect(got == want, f"schema fully migrated (v{got}, expected v{want})")
    expect(all(get(0) == 200 for _ in range(3)), "later requests still work")

    # sign up + passkey, then hammer writes
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def call(method, path, body=None, csrf=None):
        h = {"Content-Type": "application/json"} if body is not None else {}
        if csrf:
            h["X-CSRF-Token"] = csrf
        req = urllib.request.Request(BASE + path, json.dumps(body).encode() if body is not None else None, h, method=method)
        try:
            r = op.open(req)
            return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")
    call("POST", "/api/auth/signup", {"email": "c@example.test", "name": "C", "password": secrets.token_urlsafe(14), "setup_code": code, "consents": {"service": True}})
    me = call("GET", "/api/me")[1]
    csrf = me["csrf"]
    o = call("POST", "/api/passkeys/options", {}, csrf)[1]
    cred = json.loads(subprocess.run(["php", os.path.join(HERE, "FakeAuthenticator.php"), "create", os.path.join(tmp, "a.json"), "localhost", f"http://localhost:{PORT}"],
                                     input=json.dumps(o), capture_output=True, text=True, check=True).stdout)
    call("POST", "/api/passkeys", {"name": "x", "credential": cred}, csrf)
    mid = call("GET", "/api/me")[1]["members"][0]["id"]  # visible once Face ID is added
    def add(i):
        return call("POST", "/api/budget/lines", {"member_id": mid, "kind": "expense", "name": f"Item {i}", "amount_cents": 100 + i, "start_month": "2026-11"}, csrf)[0]
    with cf.ThreadPoolExecutor(12) as ex:
        codes = list(ex.map(add, range(12)))
    expect(codes == [200] * 12, f"12 simultaneous edits: {codes}")
    lines = call("GET", "/api/budget?month=2026-11")[1]["lines"]
    expect(len(lines) == 12, f"all 12 edits saved ({len(lines)})")
finally:
    os.killpg(srv.pid, 15)  # stop the server and all its workers
    srv.wait()
print(f"\n{len(fails)} failures" if fails else "\nall passed")
sys.exit(1 if fails else 0)
