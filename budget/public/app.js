"use strict";

let APP = "KAVE Budget";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const S = { me: null, config: null, month: null, member: "all" };

// ---------------------------------------------------------------- helpers
function zar(cents, { signed = false, whole = true } = {}) {
  if (cents == null) return "—";
  let abs = Math.abs(Math.round(cents));
  if (whole) abs = Math.round(abs / 100) * 100;
  const r = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const c = whole ? "" : "." + String(abs % 100).padStart(2, "0");
  return (cents < 0 ? "-" : signed && cents > 0 ? "+" : "") + "R" + r + c;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function addMonths(m, d) { const [y, mo] = m.split("-").map(Number); const i = y * 12 + mo - 1 + d; return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`; }
function monthName(m, style = "long") {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1, 1);
  return style === "short" ? d.toLocaleDateString("en-ZA", { month: "short" }) : d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}
const toCents = (v) => Math.round(parseFloat(String(v).replace(/[\s,R]/g, "")) * 100);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
function personIdx(id) { return S.me.members.findIndex((m) => m.id === id); }
function pclass(id) { return personIdx(id) % 2 === 0 ? "p1" : "p2"; }
function pname(id) { return S.me.members.find((m) => m.id === id)?.name ?? "Shared"; }
const memberQ = () => (S.member === "all" ? "" : `&member=${S.member}`);

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && S.me) headers["X-CSRF-Token"] = S.me.csrf;
  let res;
  try { res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" }); }
  catch { throw Object.assign(new Error("You're offline. Connect to the internet and try again."), { offline: true }); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.me) { S.me = null; go("#/signin"); }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data, status: res.status });
  return data;
}
async function download(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Download failed"); }
  const blob = await res.blob();
  const name = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "download";
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function toast(msg) {
  $$(".toast").forEach((t) => t.remove());
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function fail(e) { toast(e.message || String(e)); }

const tip = () => $("#tooltip");
function showTip(html, x, y) {
  const t = tip(); t.innerHTML = html; t.classList.remove("hidden");
  const r = t.getBoundingClientRect();
  t.style.left = Math.min(x + 14, innerWidth - r.width - 8) + "px";
  t.style.top = (y - r.height - 12 < 8 ? y + 16 : y - r.height - 12) + "px";
}
const hideTip = () => tip().classList.add("hidden");

function modal(html, onMount) {
  closeOverlays();
  const scrim = Object.assign(document.createElement("div"), { className: "scrim" });
  const box = Object.assign(document.createElement("div"), { className: "modal", innerHTML: html });
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
  scrim.onclick = closeOverlays;
  document.body.append(scrim, box);
  $$("[data-close]", box).forEach((b) => (b.onclick = closeOverlays));
  onMount?.(box);
  setTimeout(() => $("input, select, textarea", box)?.focus(), 50);
  return box;
}
function drawer(html, onMount) {
  closeOverlays();
  const scrim = Object.assign(document.createElement("div"), { className: "scrim" });
  const box = Object.assign(document.createElement("aside"), { className: "drawer", innerHTML: html });
  scrim.onclick = closeOverlays;
  document.body.append(scrim, box);
  $$("[data-close]", box).forEach((b) => (b.onclick = closeOverlays));
  onMount?.(box);
  return box;
}
function closeOverlays() { $$(".scrim, .modal, .drawer").forEach((e) => e.remove()); }
addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlays(); });

const I = {
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M10 10v10"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 4.8"/>',
  house: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
  face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 15.5a3.5 3.5 0 0 0 5 0"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
const brand = () => `<a class="brand" href="#/"><span class="brand-mark">${icon("house")}</span>${esc(APP)}</a>`;

// ---------------------------------------------------------------- routing
const PAGES = {
  overview: { title: "Overview", icon: "home", render: pageOverview, month: true, person: true },
  budget: { title: "Monthly budget", short: "Budget", icon: "sheet", render: pageBudget, month: true, person: true },
  debits: { title: "Debit orders", icon: "repeat", render: pageDebits, month: true, person: true },
  forecast: { title: "Next month", short: "Next", icon: "trend", render: pageForecast, month: true, person: true },
  goals: { title: "Goals", icon: "target", render: pageGoals, month: true },
  statements: { title: "Statements", icon: "file", render: pageStatements, person: true },
  debts: { title: "Debt plan", icon: "card", render: pageDebts },
  reports: { title: "Reports & Power BI", icon: "chart", render: pageReports },
  settings: { title: "Settings", icon: "gear", render: pageSettings },
};
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
addEventListener("hashchange", route);

async function route() {
  closeOverlays(); hideTip();
  S.fx?.dispose(); S.fx = null;
  S.pkWait?.abort(); S.pkWait = null;
  const [path, query] = location.hash.slice(1).split("?");
  const parts = path.split("/").filter(Boolean);
  if (!S.config) { S.config = await api("api/config").catch(() => ({ demo: false, plans: {}, private_mode: true })); APP = S.config.app_name || APP; }
  if (S.me === null) {
    try { S.me = await api("api/me"); S.month = S.month || S.me.this_month; }
    catch (e) { if (e.offline) return offlineScreen(); S.me = false; }
  }
  const pub = { "": S.config.private_mode ? signin : landing, signin: signin, signup: signup, privacy: privacyPage, join: signup };
  const key = parts[0] || "";
  if (!S.me || (key in pub && key !== "")) {
    if (!S.me && key in PAGES) return go("#/signin");
    const page = (pub[key] || pub[""])(parts, new URLSearchParams(query || ""));
    authBackdrop();
    return page;
  }
  if (S.me.passkeys?.required && S.me.user.id && !S.me.passkeys.count) { passkeySetup(); return authBackdrop(); }
  if (S.addDevice) { S.addDevice = false; passkeySetup(true); return authBackdrop(); }
  const name = key in PAGES ? key : "overview";
  renderShell(name);
  try { await PAGES[name].render($("#content"), new URLSearchParams(query || "")); }
  catch (e) { $("#content").innerHTML = `<div class="card empty"><h3>Couldn't load this page</h3><p>${esc(e.message)}</p></div>`; }
}

async function refreshMe() { S.me = await api("api/me"); }

// ---------------------------------------------------------------- public pages
function pubNav() {
  const right = S.config.private_mode
    ? `<a class="btn ghost" href="/">← whoisveyansiz.com</a>`
    : S.me ? `<a class="btn primary" href="#/overview">Open app</a>` : `<a class="btn ghost" href="#/signin">Sign in</a><a class="btn primary" href="#/signup">Start free trial</a>`;
  return `<header class="pub-nav">${brand()}<div class="row">${right}</div></header>`;
}

function landing() {
  const plans = Object.entries(S.config.plans || {});
  $("#root").innerHTML = `<div class="public">${pubNav()}
  <section class="hero">
    <div>
      <span class="chip">Made for South African households</span>
      <h1 style="margin-top:18px">Two salaries.<br>One <em>calm</em> budget.</h1>
      <p class="lede">Plan each month together, see every debit order change, know what next month looks like, and get a clear path to the things you're saving for.</p>
      <div class="row">
        <a class="btn primary" href="#/signup">Start your 30-day trial</a>
        ${S.config.demo ? `<button class="btn" id="try-demo">Explore the demo</button>` : ""}
      </div>
      <div class="trust"><span>POPIA-aligned</span><span>No bank passwords, ever</span><span>Export or delete anytime</span></div>
    </div>
    <div class="mock" aria-hidden="true">
      <div class="card m1">
        <div class="small muted">November · Household</div>
        <div class="serif" style="font-size:34px;margin:4px 0 10px">R6 520 <span class="small muted" style="font-family:var(--sans)">left over</span></div>
        <div class="meter"><i style="width:72%"></i></div>
        <div class="row small muted" style="margin-top:14px;gap:22px"><span><span class="dot p1"></span> Alex R4 930</span><span><span class="dot p2"></span> Sam R1 590</span></div>
      </div>
      <div class="card m2"><div class="small" style="font-weight:600">Car & home insurance</div><div class="small muted">R2 600 → R3 050 since June</div><span class="chip warn" style="margin-top:8px">+17% · get a quote</span></div>
      <div class="card m3"><div class="small" style="font-weight:600">Mauritius holiday</div><div class="meter good" style="margin:10px 0 6px"><i style="width:38%"></i></div><div class="small muted">On track for Sep 2027</div></div>
    </div>
  </section>
  <section class="section band" style="max-width:none"><div style="max-width:1180px;margin:0 auto">
    <h2>Everything your spreadsheet does, without the spreadsheet</h2>
    <p class="sub">Built from how real couples budget: yours, mine and ours.</p>
    <div class="features">
      ${[["people", "Separate and combined", "Each partner's salary, debit orders and personal spend, and the household total, side by side."],
         ["repeat", "Debit order tracker", "Record increases and decreases from the month they start. See what crept up this year."],
         ["trend", "Next month, today", "A projection with what's changing, what's ending and who might come up short."],
         ["target", "Goals with a plan", "How long it'll take, and exactly which items to trim to get there sooner."],
         ["chart", "Power BI ready", "One-click export or a live, refreshable feed for your own dashboards."],
         ["shield", "Private by design", "Encrypted in transit, never sold, and you can export or delete everything yourself."]]
        .map(([ic, t, d]) => `<div class="card feature flat"><div class="ic">${icon(ic)}</div><h3>${t}</h3><p>${d}</p></div>`).join("")}
    </div></div>
  </section>
  <section class="section">
    <h2>Simple pricing</h2><p class="sub">30 days free. No card needed to start.</p>
    <div class="pricing">${plans.map(([k, p]) => `<div class="card plan"><h3>${esc(p.name)}</h3>
      <div class="price">${zar(p.price_cents)} <small>/ ${p.interval}</small></div>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <a class="btn ${k === "household" ? "primary" : ""}" href="#/signup">Start free trial</a></div>`).join("")}</div>
  </section>
  <footer class="footer">© ${new Date().getFullYear()} ${APP} · <a href="#/privacy">Privacy notice</a> · General budgeting guidance, not financial advice</footer></div>`;
  $("#try-demo")?.addEventListener("click", startDemo);
}

async function startDemo() {
  try { await api("api/auth/demo", { method: "POST", body: {} }); S.me = null; go("#/overview"); } catch (e) { fail(e); }
}

function signin(parts, q) {
  const priv = S.config.private_mode;
  const err = q?.get("error");
  $("#root").innerHTML = `<div class="public">${pubNav()}<div class="auth-wrap"><div class="card auth">
    ${priv ? `<span class="chip">Private area</span>` : ""}
    <h1 style="margin-top:${priv ? 14 : 0}px">${priv ? "Our budget" : "Welcome back"}</h1>
    <p class="muted">${priv ? "Only invited people can sign in." : "Sign in to your household budget."}</p>
    ${err ? `<div class="banner warn" style="margin:16px 0 0">${esc(err)}</div>` : ""}
    ${hasPasskeys() ? `<button class="btn primary" id="pk-login" style="justify-content:center;width:100%;margin-top:22px">${icon("face")} Sign in with Face ID</button>
      <div class="error" id="pk-err" style="margin-top:8px;text-align:center"></div>
      ${S.config.password_login ? `<p class="small muted" style="text-align:center;margin:4px 0 0">New phone or computer? Sign in below with your password and a recovery code, then add Face ID on it.</p>` : ""}` : ""}
    ${S.config.microsoft ? `<a class="btn ${hasPasskeys() ? "" : "primary"} ms" href="api/auth/microsoft/start" style="justify-content:center;width:100%;margin-top:22px">
      <svg viewBox="0 0 21 21" width="16" height="16" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>
      Sign in with Microsoft</a>
      <p class="small muted" style="margin-top:10px;text-align:center">By signing in you agree to the <a href="#/privacy">privacy notice</a>.</p>` : ""}
    ${S.config.password_login ? `${S.config.microsoft || hasPasskeys() ? `<div class="or"><span>or use a password</span></div>` : ""}
    <form id="f">
      <label class="field">Email <input type="email" name="email" autocomplete="username webauthn" required></label>
      <label class="field">Password <input type="password" name="password" autocomplete="current-password" required></label>
      <label class="field hidden" id="rc-row">Recovery code <input type="text" name="recovery" autocomplete="one-time-code" placeholder="XXXXX-XXXXX" spellcheck="false"></label>
      <div class="error" id="err"></div>
      <button class="btn ${S.config.microsoft || hasPasskeys() ? "" : "primary"}" style="justify-content:center">Sign in</button>
      <p class="small muted" style="text-align:center">${priv ? `First time here? <a href="#/signup">Set up your account</a>` : `New here? <a href="#/signup">Start a free trial</a>`}</p>
    </form>` : ""}
    ${S.config.demo ? `<p class="small muted" style="text-align:center;margin-top:14px"><button class="link" id="try-demo">Explore the demo instead</button></p>` : ""}
  </div></div></div>`;
  $("#try-demo")?.addEventListener("click", startDemo);
  $("#f")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("api/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password"), recovery_code: f.get("recovery") || null } });
      // A recovery code means this device has no passkey yet: offer to add one.
      S.me = null; S.addDevice = !!f.get("recovery") && hasPasskeys(); go("#/overview");
    }
    catch (err) {
      $("#err").textContent = err.message;
      if (err.data?.need_recovery_code) { $("#rc-row").classList.remove("hidden"); $("[name=recovery]").focus(); }
    }
  });
  $("#pk-login")?.addEventListener("click", async (e) => {
    S.pkWait?.abort(); S.pkWait = null;  // only one passkey request at a time
    e.target.disabled = true; $("#pk-err").textContent = "";
    try { await passkeySignIn(); S.me = null; go("#/overview"); }
    catch (err) { $("#pk-err").textContent = passkeyError(err, true); e.target.disabled = false; }
  });
  passkeyAutofill();
}

// Offers this device's passkeys in the email field's suggestions (Safari's QuickType bar, Chrome's
// autofill). A device without one shows nothing, so this never leads to a QR code.
async function passkeyAutofill() {
  if (!hasPasskeys() || !(await PublicKeyCredential.isConditionalMediationAvailable?.().catch(() => false))) return;
  if (!$("#pk-login")) return;  // left the page while checking
  const wait = (S.pkWait = new AbortController());
  try { await passkeySignIn({ mediation: "conditional", signal: wait.signal }); S.me = null; go("#/overview"); }
  // The browser's own refusals (no passkey picked, request replaced) stay silent; only our server's answer is shown.
  catch (err) { if (!wait.signal.aborted && !(err instanceof DOMException) && $("#pk-err")) $("#pk-err").textContent = passkeyError(err, true); }
}

function signup(parts) {
  const invite = parts[0] === "join" ? parts[1] : null;
  $("#root").innerHTML = `<div class="public">${pubNav()}<div class="auth-wrap"><div class="card auth">
    <h1>${invite ? "Join your household" : S.config.private_mode ? "Set up your account" : "Start your free trial"}</h1>
    <p class="muted">${invite ? "Your partner invited you to share a budget." : S.config.private_mode ? "Only emails on the invite list can set up an account. Next you'll add Face ID." : "30 days free. Setting up takes two minutes."}</p>
    <form id="f">
      <label class="field">Your name <input type="text" name="name" autocomplete="given-name" required maxlength="60"></label>
      ${invite || S.config.private_mode ? "" : `<label class="field">Partner's name <span class="muted" style="font-weight:400">(optional, adds them to the budget)</span><input type="text" name="partner" maxlength="40"></label>`}
      <label class="field">Email <input type="email" name="email" autocomplete="email" required></label>
      ${S.config.private_mode && !invite ? `<label class="field">Setup code <span class="muted" style="font-weight:400">(from the owner)</span><input type="text" name="setup_code" autocomplete="one-time-code" spellcheck="false" required></label>` : ""}
      <label class="field">Password <input type="password" name="password" autocomplete="new-password" minlength="10" required>
        <span class="small muted" style="font-weight:400">At least 10 characters.</span></label>
      <div class="consents">
        <label class="check"><input type="checkbox" name="service" required> <span>I've read the <a href="#/privacy" target="_blank">privacy notice</a> and agree to ${APP} processing my household's budget information to provide the service.</span></label>
        <label class="check"><input type="checkbox" name="updates"> <span>Optional: email me product updates.</span></label>
      </div>
      <div class="error" id="err"></div>
      <button class="btn primary" style="justify-content:center">${invite ? "Join household" : S.config.private_mode ? "Continue to Face ID" : "Create account"}</button>
      <p class="small muted" style="text-align:center">Already have an account? <a href="#/signin">Sign in</a></p>
    </form></div></div></div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("api/auth/signup", { method: "POST", body: {
        name: f.get("name"), partner_name: f.get("partner") || null, email: f.get("email"), password: f.get("password"), invite, setup_code: f.get("setup_code") || null,
        consents: { service: !!f.get("service"), product_updates: !!f.get("updates") },
      } });
      S.me = null; go("#/overview");
    } catch (err) { $("#err").textContent = err.message; }
  };
}

function privacyPage() {
  $("#root").innerHTML = `<div class="public">${pubNav()}<article class="doc">
  <h1>Privacy notice</h1>
  <p class="small muted">Version ${esc(S.config.privacy_version)} · Draft template: have it reviewed by a legal adviser before launch.</p>
  <h2>Who we are</h2><p>${APP} (the "responsible party") provides a household budgeting service. Information Officer: <em>[name, email, phone, to be registered with the Information Regulator]</em>.</p>
  <h2>What we collect and why</h2><ul>
    <li><b>Account details</b> (name, email, password hash), to give you secure access.</li>
    <li><b>Budget information</b> you enter (income, expenses, debit orders, goals, debts), to provide budgeting, forecasts and general budgeting guidance.</li>
    <li><b>Bank statement lines</b> you choose to import, to compare plans with actual spending. Card and account numbers are masked to the last 4 digits before storage.</li>
    <li><b>Security records</b> (sign-ins, changes, exports), to protect your account and meet our accountability duties.</li></ul>
  <p>Budget items can reveal health or religious information (for example medication or tithes). This is special personal information. We only process it because you choose to record it, only for your budget, and never share it.</p>
  <h2>Who we share it with</h2><p>Our hosting provider (Hostinger) and, when you use Microsoft sign-in, Microsoft, which confirms who you are and receives no budget information. If you connect Power BI, the items and categories you export (which can include medical or giving items) go to Power BI under your own Microsoft account. We never sell your data or use it for advertising. Operators are bound by written agreements (POPIA s21).</p>
  <h2>How we protect it</h2><p>Encrypted connections (HTTPS), hashed passwords, per-household access control, audit logging, and backups encrypted at rest.</p>
  <h2>How long we keep it</h2><p>Statement lines are deleted automatically after your chosen retention period (default 36 months). Everything is deleted when you delete your household. Daily backups are kept for 14 days, so deleted data disappears from them within two weeks.</p>
  <h2>Your rights</h2><p>You can access (download) all your data, correct it, withdraw optional consents, and delete your account at any time in Settings → Privacy & data. You may also complain to the Information Regulator (inforegulator.org.za).</p>
  <p style="margin-top:30px"><a class="btn" href="#/">Back</a></p></article></div>`;
  scrollTo(0, 0);
}


// ---------------------------------------------------------------- passkeys (Face ID / Touch ID)
const hasPasskeys = () => !!(window.PublicKeyCredential && navigator.credentials);
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)).buffer;
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android phone";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
function passkeyError(e, signingIn) {
  if (e?.name === "NotAllowedError") return signingIn
    ? "Face ID was cancelled, or this device has no passkey for this site yet. On a new device, use your password and a recovery code."
    : "Face ID was cancelled or timed out.";
  if (e?.name === "InvalidStateError") return "This device already has a passkey for this account.";
  if (e?.name === "SecurityError") return "Passkeys only work on the real website address (https).";
  return e?.message || "Something went wrong with Face ID.";
}

async function passkeySignIn({ mediation, signal } = {}) {
  const o = await api("api/auth/passkey/options", { method: "POST", body: {} });
  const a = await navigator.credentials.get({ publicKey: { ...o, challenge: fromB64u(o.challenge) }, mediation, signal });
  await api("api/auth/passkey/verify", { method: "POST", body: {
    id: a.id, rawId: toB64u(a.rawId), type: a.type,
    response: { clientDataJSON: toB64u(a.response.clientDataJSON), authenticatorData: toB64u(a.response.authenticatorData),
      signature: toB64u(a.response.signature), userHandle: a.response.userHandle ? toB64u(a.response.userHandle) : null },
  } });
}

async function passkeyRegister(name) {
  const o = await api("api/passkeys/options", { method: "POST", body: {} });
  const c = await navigator.credentials.create({ publicKey: {
    ...o, challenge: fromB64u(o.challenge), user: { ...o.user, id: fromB64u(o.user.id) },
    excludeCredentials: o.excludeCredentials.map((x) => ({ ...x, id: fromB64u(x.id) })),
  } });
  return api("api/passkeys", { method: "POST", body: { name, credential: {
    id: c.id, rawId: toB64u(c.rawId), type: c.type, transports: c.response.getTransports?.() || [],
    response: { clientDataJSON: toB64u(c.response.clientDataJSON), attestationObject: toB64u(c.response.attestationObject) },
  } } });
}

function recoveryCodesHtml(codes) {
  return `<div class="codes">${codes.map((c) => `<code>${esc(c)}</code>`).join("")}</div>
    <div class="row" style="margin-top:12px"><button class="btn sm" id="copy-codes">Copy</button><button class="btn sm" id="dl-codes">Download .txt</button></div>`;
}
function bindRecoveryCodes(box, codes) {
  const text = `Recovery codes for ${location.host}${location.pathname}\nEach code works once, together with your password.\n\n${codes.join("\n")}\n`;
  $("#copy-codes", box).onclick = () => navigator.clipboard.writeText(text).then(() => toast("Copied"));
  $("#dl-codes", box).onclick = () => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: "budget-recovery-codes.txt" });
    document.body.appendChild(a); a.click(); a.remove();
  };
}

// again: the account already has Face ID elsewhere and this device signed in with a recovery code.
function passkeySetup(again) {
  const ok = hasPasskeys();
  $("#root").innerHTML = `<div class="public">${pubNav()}<div class="auth-wrap"><div class="card auth" id="setup">
    <span class="chip">${again ? "New device" : "One-time setup"}</span>
    <h1 style="margin-top:14px">${again ? "Add Face ID on this device" : "Add Face ID"}</h1>
    <p class="muted">${again
      ? "You used a recovery code to get in. Add Face ID or Touch ID here and this device signs in with your face from now on, with no code or QR code."
      : "From now on you'll sign in with Face ID or Touch ID: your phone plus your face, so a stolen password isn't enough. It's saved on this device, and syncs to your other Apple devices through iCloud Keychain."}</p>
    ${ok ? `<label class="field" style="margin-top:18px">Name this device <input type="text" id="pk-name" value="${esc(deviceName())}" maxlength="40"></label>
      <div class="error" id="err" style="margin-top:10px"></div>
      <button class="btn primary" id="add-pk" style="justify-content:center;width:100%;margin-top:14px">${icon("face")} Add Face ID</button>`
      : `<div class="banner warn" style="margin-top:18px">This browser doesn't support passkeys. Open this page in Safari on your iPhone or Mac, or a recent Chrome or Edge.</div>`}
    <p class="small muted" style="text-align:center;margin-top:16px">${again ? `<button class="link" id="skip">Not now</button>` : `<button class="link" id="out">Sign out</button>`}</p>
  </div></div></div>`;
  $("#skip")?.addEventListener("click", () => go("#/overview"));
  $("#out")?.addEventListener("click", async () => { await api("api/auth/logout", { method: "POST", body: {} }).catch(() => {}); S.me = false; go("#/"); });
  $("#add-pk")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const r = await passkeyRegister($("#pk-name").value);
      await refreshMe();
      if (!r.recovery_codes) { toast("Face ID added on this device"); return go("#/overview"); }
      $("#setup").innerHTML = `<span class="chip good">Face ID added</span>
        <h1 style="margin-top:14px">Save your recovery codes</h1>
        <p class="muted">If you ever lose access to your devices, sign in with your password plus one of these codes. Each works once. Keep them somewhere safe, like your password manager.</p>
        ${recoveryCodesHtml(r.recovery_codes || [])}
        <button class="btn primary" id="done" style="justify-content:center;width:100%;margin-top:22px">I've saved them, continue</button>`;
      bindRecoveryCodes($("#setup"), r.recovery_codes || []);
      $("#done").onclick = () => go("#/overview");
    } catch (err) { $("#err").textContent = passkeyError(err); e.target.disabled = false; }
  });
}

// ---------------------------------------------------------------- shell
function renderShell(name) {
  const p = PAGES[name];
  const people = S.me.members;
  const b = S.me.billing;
  const nav = Object.entries(PAGES).map(([k, v]) => `<a href="#/${k}" class="${k === name ? "on" : ""}">${icon(v.icon)}<span>${v.title}</span></a>`).join("");
  $("#root").innerHTML = `<div class="shell">
    <aside class="side">${brand()}<nav aria-label="Main">${nav}</nav>
      ${S.config.private_mode ? `<a class="back-link small" href="/">← Back to whoisveyansiz.com</a>` : ""}
      <div class="who"><strong>${esc(S.me.user.name)}</strong>
        <span class="muted">${esc(S.me.household.name)}</span>
        <div class="row" style="margin-top:8px;justify-content:space-between">
          <span class="chip ${b.status === "active" ? "good" : b.can_write ? "" : "warn"}">${planLabel(b)}</span>
          <button class="link small" id="logout">Sign out</button></div></div>
    </aside>
    <div class="main">
      <div class="topbar" id="topbar"><h1>${p.title}</h1>
        ${p.person && people.length > 1 ? `<div class="seg" role="tablist" aria-label="Whose budget">
          <button class="${S.member === "all" ? "on" : ""}" data-m="all"><span class="dot hh"></span>Household</button>
          ${people.map((m) => `<button class="${String(S.member) === String(m.id) ? "on" : ""}" data-m="${m.id}"><span class="dot ${pclass(m.id)}"></span>${esc(m.name)}</button>`).join("")}
        </div>` : ""}
        ${p.month ? `<div class="stepper"><button id="prev" aria-label="Previous month">‹</button><span>${monthName(S.month)}</span><button id="next" aria-label="Next month">›</button></div>` : ""}
      </div>
      <div class="content" id="content"><div class="muted" style="padding:40px 0">Loading…</div></div>
      <footer class="app-foot">${esc(APP)} gives general budgeting information based on what you enter. It isn't financial advice and doesn't recommend specific financial products. For advice on investments, insurance or debt, speak to a registered financial adviser or an NCR-registered debt counsellor.</footer>
    </div>
    <nav class="mob-nav" aria-label="Main">${MOBILE_TABS.map((k) => `<a href="#/${k}" class="${k === name ? "on" : ""}">${icon(PAGES[k].icon)}<span>${PAGES[k].short || PAGES[k].title}</span></a>`).join("")}
      <button type="button" id="more" class="${MOBILE_TABS.includes(name) ? "" : "on"}">${icon("more")}<span>More</span></button></nav>
  </div>`;
  $$("[data-m]").forEach((btn) => (btn.onclick = () => { S.member = btn.dataset.m; route(); }));
  $("#prev")?.addEventListener("click", () => { S.month = addMonths(S.month, -1); route(); });
  $("#next")?.addEventListener("click", () => { S.month = addMonths(S.month, 1); route(); });
  $("#more").onclick = () => moreSheet(name);
  $("#logout").onclick = async () => { await api("api/auth/logout", { method: "POST", body: {} }).catch(() => {}); S.me = false; go("#/"); };
  const tb = $("#topbar");
  onscroll = () => tb.classList.toggle("scrolled", scrollY > 4);
}
function planLabel(b) {
  if (S.me.household.is_demo) return "Demo";
  if (S.config.private_mode) return "Private";
  if (b.status === "trialing") return `Trial · ${b.trial_days_left} days`;
  return { active: "Active", past_due: "Payment due", expired: "Trial ended", cancelled: "Cancelled" }[b.status] || b.status;
}
function billingBanner() {
  const b = S.me.billing;
  if (S.me.household.is_demo) return `<div class="banner"><span>You're exploring a demo household with made-up data.</span></div>`;
  if (S.config.private_mode) return "";
  if (!b.can_write) return `<div class="banner warn"><span>Your ${b.status === "expired" ? "trial has ended" : "plan isn't active"}. Your budget is read-only; exporting and deleting still work.</span><a class="btn sm primary" href="#/settings?tab=plan">Choose a plan</a></div>`;
  if (b.status === "trialing" && b.trial_days_left <= 7) return `<div class="banner"><span>${b.trial_days_left} days left in your trial.</span><a class="btn sm" href="#/settings?tab=plan">See plans</a></div>`;
  return "";
}

// ---------------------------------------------------------------- overview
async function pageOverview(el) {
  const [v, f, g] = await Promise.all([
    api(`api/budget?month=${S.month}${memberQ()}`), api(`api/forecast?month=${S.month}${memberQ()}`), api(`api/goals?month=${S.month}`),
  ]);
  if (!v.lines.length) return emptyBudget(el);
  const hh = v.household;
  const single = S.member !== "all";
  const moneyIn = single ? v.people[0].money_in_cents : hh.income_cents;
  const out = single ? v.people[0].money_out_cents : hh.expense_cents + hh.saving_cents;
  const left = hh.surplus_cents;
  const pr = v.progress;
  el.innerHTML = `${billingBanner()}
    <div class="kpis">
      <div class="card kpi"><div class="label">Money in</div><div class="value">${zar(moneyIn)}</div><div class="sub">${single ? "Salary and transfers received" : "All salaries and income"}</div></div>
      <div class="card kpi"><div class="label">Going out</div><div class="value">${zar(out)}</div>
        <div class="meter" style="margin:8px 0 6px" title="Paid so far"><i style="width:${pct(pr.paid_cents, pr.total_cents)}%"></i></div>
        <div class="sub">${zar(pr.paid_cents)} paid · ${pr.paid} of ${pr.total} items</div></div>
      <div class="card kpi"><div class="label">Left over</div><div class="value ${left < 0 ? "warn" : ""}">${zar(left)}</div>
        <div class="sub">Next month: ${zar(f.next.household.surplus_cents)}</div></div>
    </div>
    ${jarsCard(v)}
    ${!single && v.people.length > 1 ? `<div class="people" style="margin-bottom:18px">${v.people.map((p) => `
      <div class="card person ${pclass(p.id)}"><div class="card-head"><h3><span class="dot ${pclass(p.id)}"></span> ${esc(p.name)}</h3>
        <span class="chip ${p.surplus_cents < 0 ? "warn" : "good"}">${p.surplus_cents < 0 ? "Short" : "Left"} ${zar(Math.abs(p.surplus_cents))}</span></div>
        <div class="meter ${pclass(p.id)}" title="Share of money in that's going out"><i style="width:${Math.min(100, pct(p.money_out_cents, p.money_in_cents))}%"></i></div>
        <div class="figs"><div>In<b>${zar(p.money_in_cents)}</b></div><div>Out<b>${zar(p.money_out_cents)}</b></div><div>Net transfers<b>${zar(p.transfer_in_cents - p.transfer_out_cents, { signed: true })}</b></div></div></div>`).join("")}</div>` : ""}
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>Insights</h3><a class="small" href="#/forecast">Next month →</a></div>
        <div class="insights">${insightList(f.insights.slice(0, 5))}</div></div>
      <div class="card"><div class="card-head"><h3>Where it goes</h3><span class="small muted">planned this month</span></div>
        ${groupMeters(v.by_group, moneyIn)}
        <div class="bars" style="margin-top:18px">${v.by_category.slice(0, 7).map((c) => barRow(c.category, c.planned_cents, v.by_category[0].planned_cents)).join("")}</div></div>
      <div class="card"><div class="card-head"><h3>Goals</h3><a class="small" href="#/goals">All goals →</a></div>
        ${g.length ? `<div class="bars">${g.map((x) => `<div><div class="row" style="justify-content:space-between;margin-bottom:6px"><span>${esc(x.goal.name)}</span>
          <span class="small muted">${zar(x.goal.saved_cents)} of ${zar(x.goal.target_cents)}</span></div>
          <div class="meter good"><i style="width:${Math.min(100, x.progress_pct)}%"></i></div>
          <div class="small muted" style="margin-top:4px">${goalLine(x)}</div></div>`).join("")}</div>` : `<p class="muted">No goals yet. <a href="#/goals">Add one</a> to see how long it'll take.</p>`}</div>
      <div class="card"><div class="card-head"><h3>Changed this month</h3><a class="small" href="#/debits">Debit orders →</a></div>
        ${v.changes.length ? `<table class="t"><tbody>${v.changes.map((l) => `<tr><td><span class="dot ${pclass(l.member_id)}"></span> ${esc(l.name)}</td>
          <td class="num">${l.is_new ? `<span class="chip">New</span>` : `<span class="chip ${(l.change_cents > 0) === (l.kind !== "income") ? "warn" : "good"}">${zar(l.change_cents, { signed: true })}</span>`}</td>
          <td class="num">${zar(l.amount_cents)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Nothing changed from last month.</p>`}</div>
    </div>`;
  bindBarTips(el);
  mountJars(v);
}

function emptyBudget(el) {
  el.innerHTML = `${billingBanner()}<div class="card empty"><h3>Let's build your first month</h3>
    <p>Add each person's salary and what goes out, or bring in the Excel budget you already keep.</p>
    <div class="row" style="justify-content:center;margin-top:16px"><a class="btn primary" href="#/budget">Add items</a><a class="btn" href="#/settings?tab=import">Import from Excel</a></div></div>`;
}

// ---------------------------------------------------------------- 3D (scene3d.js, loaded on demand)
let fxModule = null;
const loadFx = () => (fxModule ||= import("./scene3d.js"));
const JAR_KEYS = ["Essentials", "Lifestyle", "Savings", "Transfers"];

// Each person's money out, split into the jar layers. Transfers to a partner come from the totals so
// they aren't counted twice.
function jarPeople(v) {
  return v.people.map((p) => {
    const groups = { Essentials: 0, Lifestyle: 0, Savings: 0, Transfers: p.transfer_out_cents || 0 };
    for (const sec of p.sections) for (const l of sec.lines) {
      if (l.kind !== "expense" && l.kind !== "saving") continue;
      const g = l.group in groups && l.group !== "Transfers" ? l.group : l.kind === "saving" ? "Savings" : "Lifestyle";
      groups[g] += l.amount_cents;
    }
    return { id: p.id, name: p.name, cls: pclass(p.id), money_in_cents: p.money_in_cents, surplus_cents: p.surplus_cents, groups };
  });
}

function jarsCard(v) {
  const people = jarPeople(v);
  const totals = Object.fromEntries(JAR_KEYS.map((k) => [k, people.reduce((a, p) => a + p.groups[k], 0)]));
  const summary = people.map((p) => `${p.name}: ${zar(p.money_in_cents)} in; ` + JAR_KEYS.filter((k) => p.groups[k]).map((k) => `${k.toLowerCase()} ${zar(p.groups[k])}`).join(", ")
    + `; ${p.surplus_cents < 0 ? "short" : "left over"} ${zar(Math.abs(p.surplus_cents))}.`).join(" ");
  return `<div class="card jars-card" id="jars-card">
    <div class="card-head"><h3>${people.length > 1 ? "Your jars" : "Your jar"}</h3><span class="small muted">Jar height is money in · drag to turn</span></div>
    <div class="jars3d" id="jars3d" role="img" aria-label="${esc(summary)}"><div class="fx-tip hidden" id="jars-tip"></div></div>
    <div class="legend jars-legend">${JAR_KEYS.filter((k) => totals[k]).map((k) => `<span><span class="sw jar-${k.toLowerCase()}"></span>${k} <b>${zar(totals[k])}</b></span>`).join("")}
      <span><span class="sw jar-left"></span>Clear glass: left over</span></div>
  </div>`;
}

async function mountJars(v) {
  const host = $("#jars3d");
  if (!host) return;
  try {
    const fx = await loadFx();
    if (!host.isConnected) return;
    if (!fx.webglAvailable()) return $("#jars-card")?.remove();
    const tip = $("#jars-tip");
    S.fx?.dispose();
    S.fx = fx.mountJars(host, jarPeople(v), {
      format: (c) => zar(c),
      onTip: (d, x, y) => {
        if (!d) return tip.classList.add("hidden");
        tip.innerHTML = `<b>${esc(d.layer)}</b> · ${esc(d.person)}<br>${zar(d.cents)} <span class="muted">(${d.share}% of money in)</span>`;
        tip.style.transform = `translate(${Math.min(x + 14, host.clientWidth - 200)}px, ${Math.max(0, y - 54)}px)`;
        tip.classList.remove("hidden");
      },
    });
  } catch {
    $("#jars-card")?.remove();   // no 3D (old browser, blocked WebGL): the cards below still show everything
  }
}

async function authBackdrop() {
  const wrap = $(".public");
  if (!wrap || !$(".auth-wrap") || wrap.querySelector(".fx-backdrop")) return;
  const host = document.createElement("div");
  host.className = "fx-backdrop";
  wrap.prepend(host);
  try {
    const fx = await loadFx();
    if (!host.isConnected || !fx.webglAvailable()) return host.remove();
    S.fx?.dispose();
    S.fx = fx.mountBackdrop(host);
  } catch {
    host.remove();
  }
}

function insightList(items) {
  if (!items.length) return `<p class="muted">Nothing needs your attention. Nicely done.</p>`;
  const sym = { warn: "!", good: "↓", info: "i" };
  return items.map((i) => `<div class="insight ${i.tone}"><span class="ic">${sym[i.tone]}</span><span class="t">${esc(i.title)}</span>
    <span class="amt ${i.amount_cents > 0 ? "good" : i.amount_cents < 0 ? "warn" : ""}">${i.amount_cents ? zar(i.amount_cents, { signed: true }) + "/mo" : ""}</span>
    <span class="d">${esc(i.detail)}</span></div>`).join("");
}

function groupMeters(g, income) {
  const guide = { Essentials: 50, Lifestyle: 30, Savings: 20 };
  return `<div class="legend"><span><span class="sw" style="background:var(--accent)"></span>Share of income</span><span><span class="tk"></span>50 / 30 / 20 guide</span></div>
  <div class="bars">${Object.entries(guide).map(([k, target]) => {
    const p = pct(g[k] || 0, income);
    return `<div class="bar-row" data-tip="${esc(k)}: ${zar(g[k] || 0)} (${p}% of income, guide ${target}%)"><span>${k}</span>
      <div class="track"><div class="fill" style="width:${Math.min(100, p)}%"></div><div class="tick" style="left:calc(${target}% - 1px)"></div></div>
      <span class="num">${p}%</span></div>`;
  }).join("")}</div>`;
}
function barRow(label, value, max, tick, tickLabel = "planned") {
  return `<div class="bar-row" data-tip="${esc(label)}: ${zar(value)}${tick != null ? ` · ${tickLabel} ${zar(tick)}` : ""}"><span>${esc(label)}</span>
    <div class="track"><div class="fill" style="width:${Math.max(1, (100 * value) / Math.max(max, 1))}%"></div>
    ${tick ? `<div class="tick" style="left:calc(${Math.min(100, (100 * tick) / Math.max(max, 1))}% - 1px)"></div>` : ""}</div>
    <span class="num">${zar(value)}</span></div>`;
}
function bindBarTips(el) {
  $$("[data-tip]", el).forEach((r) => {
    r.addEventListener("mousemove", (e) => showTip(esc(r.dataset.tip), e.clientX, e.clientY));
    r.addEventListener("mouseleave", hideTip);
  });
}
function goalLine(x) {
  if (x.remaining_cents === 0) return "Reached";
  if (x.goal.target_month) return x.on_track ? `On track for ${monthName(x.goal.target_month)}` : `Needs ${zar(x.required_monthly_cents)}/mo, ${zar(x.gap_cents)} short`;
  return x.months_needed ? `About ${x.months_needed} months at ${zar(x.contribution_cents)}/mo` : "No spare money assigned yet";
}

// ---------------------------------------------------------------- budget sheet
async function pageBudget(el) {
  const v = await api(`api/budget?month=${S.month}${memberQ()}`);
  const hh = v.household;
  const single = S.member !== "all";
  el.innerHTML = `${billingBanner()}
    <div class="card" style="margin-bottom:18px;padding:16px 22px"><div class="row" style="justify-content:space-between">
      <div class="row" style="gap:28px">
        <div><div class="small muted">Money in</div><div class="serif" style="font-size:22px">${zar(single ? v.people[0]?.money_in_cents : hh.income_cents)}</div></div>
        <div><div class="small muted">Going out</div><div class="serif" style="font-size:22px">${zar(single ? v.people[0]?.money_out_cents : hh.expense_cents + hh.saving_cents)}</div></div>
        <div><div class="small muted">Left over</div><div class="serif ${hh.surplus_cents < 0 ? "warn" : "good"}" style="font-size:22px">${zar(hh.surplus_cents)}</div></div>
      </div>
      <div style="min-width:220px;flex:0 1 300px"><div class="small muted" style="margin-bottom:6px">${v.progress.paid} of ${v.progress.total} paid · ${zar(v.progress.paid_cents)}</div>
        <div class="meter good"><i style="width:${pct(v.progress.paid, v.progress.total)}%"></i></div></div>
    </div></div>
    <div class="sheet">${v.people.map((p) => personColumn(p)).join("")}</div>`;
  $$(".item input[type=checkbox]", el).forEach((cb) => {
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = async () => {
      try { await api(`api/budget/lines/${cb.dataset.id}/paid`, { method: "POST", body: { month: S.month, paid: cb.checked } }); cb.closest(".item").classList.toggle("paid", cb.checked); }
      catch (e) { cb.checked = !cb.checked; fail(e); }
    };
  });
  $$(".item[data-id]", el).forEach((row) => (row.onclick = () => openLine(+row.dataset.id, v)));
  $$("[data-add]", el).forEach((b) => (b.onclick = () => addLineModal(+b.dataset.add)));
}

function personColumn(p) {
  const cls = pclass(p.id);
  const itemRow = (l, incoming = false) => {
    const up = (l.change_cents > 0) === (l.kind !== "income");
    const chg = incoming ? "" : l.change_cents ? `<small class="${up ? "warn" : "good"}">${zar(l.change_cents, { signed: true })}</small>`
      : l.is_new ? `<small class="muted">new</small>` : l.ends_this_month ? `<small class="muted">last month</small>` : "";
    const sub = incoming ? `from ${esc(l.member_name)}` : [l.kind === "transfer" ? `to ${esc(l.to_member_name)}` : "", l.is_debit_order ? "debit order" : "", esc(l.notes || "")].filter(Boolean).join(" · ");
    const isIn = l.kind === "income" || incoming;
    return `<div class="item ${l.paid && !incoming ? "paid" : ""} ${isIn ? "income" : ""}" ${incoming ? "" : `data-id="${l.id}"`}>
      ${isIn ? "<span></span>" : `<input type="checkbox" data-id="${l.id}" ${l.paid ? "checked" : ""} aria-label="Mark ${esc(l.name)} paid">`}
      <div class="nm"><div>${esc(l.name)}</div>${sub ? `<small>${sub}</small>` : ""}</div>
      <div class="am">${incoming ? "+" : ""}${zar(l.amount_cents, { whole: false })}${chg}</div></div>`;
  };
  return `<section class="card col ${cls}">
    <div class="col-head"><h2><span class="dot ${cls}"></span>${esc(p.name)}</h2><button class="btn sm" data-add="${p.id}">+ Add item</button></div>
    ${p.sections.map((s) => `<div class="sec-name">${esc(s.name)}</div>${s.lines.map((l) => itemRow(l)).join("")}`).join("")}
    ${p.incoming_transfers.length ? `<div class="sec-name">From partner</div>${p.incoming_transfers.map((l) => itemRow(l, true)).join("")}` : ""}
    ${!p.sections.length ? `<div class="add-row muted">Nothing here yet. Start with ${esc(p.name)}'s salary.</div>` : ""}
    <div class="col-foot"><div>In<b>${zar(p.money_in_cents)}</b></div><div>Out<b>${zar(p.money_out_cents)}</b></div>
      <div>Left<b class="${p.surplus_cents < 0 ? "warn" : "good"}">${zar(p.surplus_cents)}</b></div></div>
  </section>`;
}

function categoryOptions(sel) { return S.me.categories.filter((c) => c !== "Income" && c !== "Transfers").map((c) => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join(""); }
function memberOptions(sel, except) { return S.me.members.filter((m) => m.id !== except).map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.name)}</option>`).join(""); }

function addLineModal(memberId) {
  const box = modal(`<h2>Add to ${esc(pname(memberId))}'s budget</h2><form id="f">
    <div class="seg" id="kind">${[["expense", "Expense"], ["income", "Income"], ["saving", "Saving"], ["transfer", "Transfer"]].map(([k, l], i) => `<button type="button" data-k="${k}" class="${i ? "" : "on"}">${l}</button>`).join("")}</div>
    <label class="field">Name <input type="text" name="name" placeholder="e.g. Netflix, Rent, Salary" required maxlength="80"></label>
    <div class="grid g2"><label class="field">Amount per month (R) <input type="number" inputmode="decimal" name="amount" min="0" step="0.01" required></label>
      <label class="field">Starts <input type="month" name="start" value="${S.month}" required></label></div>
    <div class="grid g2" id="cat-row"><label class="field">Category <select name="category"><option value="">Guess for me</option>${categoryOptions()}</select></label>
      <label class="field">Section <input type="text" name="section" placeholder="e.g. Debit orders, Personal" maxlength="40"></label></div>
    <label class="field hidden" id="to-row">Paid to <select name="to">${memberOptions(null, memberId)}</select></label>
    <label class="check" id="do-row"><input type="checkbox" name="debit"> It's a debit order</label>
    <label class="field">Ends <span class="muted" style="font-weight:400">(optional, for things like "3 payments")</span><input type="month" name="end"></label>
    <label class="field">Notes <input type="text" name="notes" placeholder="e.g. R230 + R230 + R200" maxlength="200"></label>
    <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`);
  let kind = "expense";
  $$("#kind button", box).forEach((b) => (b.onclick = () => {
    kind = b.dataset.k; $$("#kind button", box).forEach((x) => x.classList.toggle("on", x === b));
    $("#to-row", box).classList.toggle("hidden", kind !== "transfer");
    $("#cat-row", box).classList.toggle("hidden", kind === "income" || kind === "transfer");
    $("#do-row", box).classList.toggle("hidden", kind === "income");
  }));
  $("#f", box).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("api/budget/lines", { method: "POST", body: {
        member_id: memberId, kind, name: f.get("name"), amount_cents: toCents(f.get("amount")), start_month: f.get("start"),
        category: f.get("category") || null, section: f.get("section") || null, is_debit_order: !!f.get("debit"),
        end_month: f.get("end") || null, notes: f.get("notes") || null, to_member_id: kind === "transfer" ? +f.get("to") : null,
      } });
      closeOverlays(); toast("Added"); route();
    } catch (err) { fail(err); }
  };
}

async function openLine(id, view) {
  const l = view.lines.find((x) => x.id === id);
  const [hist, goalList] = await Promise.all([api(`api/budget/lines/${id}/history`), l.kind === "saving" ? api(`api/goals?month=${S.month}`) : []]);
  const goalOpts = goalList.map((g) => `<option value="${g.goal.id}" ${g.goal.id === l.goal_id ? "selected" : ""}>${esc(g.goal.name)}</option>`).join("");
  const box = drawer(`<div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="chip"><span class="dot ${pclass(l.member_id)}"></span>${esc(l.member_name)}</span><button class="btn ghost sm" data-close>Close</button></div>
    <h2>${esc(l.name)}</h2>
    <div class="card flat" style="margin:16px 0;padding:16px">
      <div class="small muted">${monthName(S.month)}</div>
      <div class="row" style="justify-content:space-between"><div class="serif" style="font-size:30px">${zar(l.amount_cents, { whole: false })}</div>
      <button class="btn primary sm" id="chg">Change amount</button></div>
      ${l.prev_amount_cents != null && l.change_cents ? `<div class="small muted">Was ${zar(l.prev_amount_cents, { whole: false })} last month</div>` : ""}
    </div>
    <h3>History</h3>
    <table class="t" style="margin-bottom:22px"><tbody>${hist.map((h) => `<tr><td>${monthName(h.month)}</td><td class="num">${zar(h.amount_cents, { whole: false })}</td>
      <td class="num">${h.change_cents == null ? `<span class="chip outline">start</span>` : `<span class="chip ${(h.change_cents > 0) === (l.kind !== "income") ? "warn" : "good"}">${zar(h.change_cents, { signed: true })}</span>`}</td></tr>
      ${h.note ? `<tr><td colspan="3" class="small muted" style="padding-top:0">${esc(h.note)}</td></tr>` : ""}`).join("")}</tbody></table>
    <h3>Details</h3>
    <form id="f" style="display:grid;gap:12px">
      <label class="field">Name <input type="text" name="name" value="${esc(l.name)}" required maxlength="80"></label>
      <div class="grid g2"><label class="field">Type <select name="kind">${["expense", "income", "saving", "transfer"].map((k) => `<option ${k === l.kind ? "selected" : ""}>${k}</option>`).join("")}</select></label>
        <label class="field">Person <select name="member">${memberOptions(l.member_id)}</select></label></div>
      <label class="field ${l.kind === "transfer" ? "" : "hidden"}" id="to-row">Paid to <select name="to">${memberOptions(l.to_member_id, l.member_id)}</select></label>
      <div class="grid g2"><label class="field">Category <select name="category">${l.kind === "income" ? "<option>Income</option>" : l.kind === "transfer" ? "<option>Transfers</option>" : categoryOptions(l.category)}</select></label>
        <label class="field">Section <input type="text" name="section" value="${esc(l.section)}" maxlength="40"></label></div>
      <label class="field">Can it be cut back? <select name="flex">
        ${[["fixed", "Fixed: a commitment"], ["reducible", "Reducible: can trim a little"], ["discretionary", "Discretionary: nice to have"]].map(([k, t]) => `<option value="${k}" ${k === l.flexibility ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" name="debit" ${l.is_debit_order ? "checked" : ""}> Debit order</label>
      ${l.kind === "saving" ? `<label class="field">Goes towards goal <select name="goal"><option value="">None</option>${goalOpts}</select></label>` : ""}
      <label class="field">Last month <span class="muted" style="font-weight:400">(leave empty if ongoing)</span><input type="month" name="end" value="${l.end_month || ""}"></label>
      <label class="field">Notes <input type="text" name="notes" value="${esc(l.notes || "")}" maxlength="200"></label>
      <div class="row" style="justify-content:space-between;margin-top:6px"><button type="button" class="btn danger sm" id="del">Delete item</button><button class="btn primary">Save</button></div>
    </form>`);
  $("[name=kind]", box).onchange = (e) => $("#to-row", box).classList.toggle("hidden", e.target.value !== "transfer");
  $("#chg", box).onclick = () => amountModal(l);
  $("#del", box).onclick = async () => {
    if (!confirm(`Delete "${l.name}" and its history from every month?`)) return;
    try { await api(`api/budget/lines/${id}`, { method: "DELETE" }); closeOverlays(); toast("Deleted"); route(); } catch (e) { fail(e); }
  };
  $("#f", box).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const kind = f.get("kind");
    const body = { name: f.get("name"), kind, member_id: +f.get("member"), section: f.get("section"), flexibility: f.get("flex"),
      is_debit_order: !!f.get("debit"), end_month: f.get("end") || null, notes: f.get("notes") };
    if (kind === "transfer") body.to_member_id = +f.get("to");
    if (kind === "saving" && l.kind === "saving") body.goal_id = f.get("goal") ? +f.get("goal") : null;
    if (kind === l.kind && kind !== "income" && kind !== "transfer") body.category = f.get("category");
    try { await api(`api/budget/lines/${id}`, { method: "PATCH", body }); closeOverlays(); toast("Saved"); route(); } catch (err) { fail(err); }
  };
}

function amountModal(l) {
  const box = modal(`<h2>Change ${esc(l.name)}</h2>
    <p class="muted">Currently ${zar(l.amount_cents, { whole: false })} a month.</p>
    <form id="f">
      <div class="grid g2"><label class="field">New amount (R) <input type="number" inputmode="decimal" name="amount" min="0" step="0.01" value="${(l.amount_cents / 100).toFixed(2)}" required></label>
        <label class="field">From <input type="month" name="month" value="${S.month}" required></label></div>
      <div class="seg" id="mode"><button type="button" class="on" data-v="onward">From then on</button><button type="button" data-v="once">That month only</button></div>
      <label class="field">Note <input type="text" name="note" placeholder="e.g. Annual increase" maxlength="120"></label>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save change</button></div>
    </form>`);
  let mode = "onward";
  $$("#mode button", box).forEach((b) => (b.onclick = () => { mode = b.dataset.v; $$("#mode button", box).forEach((x) => x.classList.toggle("on", x === b)); }));
  $("#f", box).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api(`api/budget/lines/${l.id}/amount`, { method: "POST", body: { month: f.get("month"), amount_cents: toCents(f.get("amount")), mode, note: f.get("note") } });
      closeOverlays();
      toast(r.before_cents != null ? `${zar(r.before_cents)} → ${zar(r.after_cents)} from ${monthName(r.month)}` : "Saved");
      route();
    } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- debit orders
async function pageDebits(el) {
  const rows = await api(`api/debit-orders?month=${S.month}${memberQ()}`);
  const byP = {};
  rows.forEach((r) => (byP[r.member_id] = (byP[r.member_id] || 0) + r.amount_cents));
  const total = rows.reduce((a, r) => a + r.amount_cents, 0);
  const crept = rows.filter((r) => r.year_change_cents > 0).reduce((a, r) => a + r.year_change_cents, 0);
  el.innerHTML = `${billingBanner()}
    <div class="kpis">
      <div class="card kpi"><div class="label">Debit orders this month</div><div class="value">${zar(total)}</div><div class="sub">${rows.length} debit orders</div></div>
      <div class="card kpi"><div class="label">By person</div>${Object.entries(byP).map(([id, c]) => `<div class="row" style="justify-content:space-between;margin-top:6px"><span><span class="dot ${pclass(+id)}"></span> ${esc(pname(+id))}</span><b>${zar(c)}</b></div>`).join("")}</div>
      <div class="card kpi"><div class="label">Increases over 12 months</div><div class="value ${crept ? "warn" : ""}">${zar(crept, { signed: true })}</div><div class="sub">a month more than a year ago</div></div>
    </div>
    <div class="card"><div class="card-head"><h3>All debit orders</h3><span class="small muted">Use Update when an amount changes. The old amount stays in the history.</span></div>
    ${rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th class="hide-md">Person</th><th class="num">Amount</th><th class="num">vs last month</th><th class="num hide-sm">12 months</th><th class="hide-md">Trend</th><th></th></tr></thead><tbody>
    ${rows.map((r) => {
      const max = Math.max(...r.history.map((h) => h.amount_cents), 1);
      return `<tr><td><b style="font-weight:500">${esc(r.name)}</b>${r.notes ? `<div class="small muted">${esc(r.notes)}</div>` : ""}${r.end_month ? `<div class="small muted">until ${monthName(r.end_month)}</div>` : ""}${r.upcoming.length ? `<div class="small warn">→ ${zar(r.upcoming[0].amount_cents)} from ${monthName(r.upcoming[0].month)}</div>` : ""}</td>
        <td class="hide-md"><span class="dot ${pclass(r.member_id)}"></span> ${esc(r.member_name)}</td>
        <td class="num">${zar(r.amount_cents, { whole: false })}</td>
        <td class="num">${r.change_cents ? `<span class="chip ${r.change_cents > 0 ? "warn" : "good"}">${zar(r.change_cents, { signed: true })}</span>` : `<span class="muted">—</span>`}</td>
        <td class="num hide-sm">${r.year_change_cents ? `<span class="${r.year_change_cents > 0 ? "warn" : "good"}">${r.year_change_pct > 0 ? "+" : ""}${r.year_change_pct}%</span>` : `<span class="muted">—</span>`}</td>
        <td class="hide-md"><div class="hist" title="${r.history.map((h) => `${monthName(h.month, "short")} ${zar(h.amount_cents)}`).join(" → ")}">${r.history.slice(-8).map((h, i, a) => `<i class="${i === a.length - 1 ? "last" : ""}" style="height:${8 + 18 * (h.amount_cents / max)}px"></i>`).join("")}</div></td>
        <td class="num"><button class="btn sm" data-upd="${r.id}">Update</button></td></tr>`;
    }).join("")}</tbody></table></div>` : `<div class="empty"><p>No debit orders yet. Tick "It's a debit order" when adding items to your budget.</p></div>`}</div>`;
  $$("[data-upd]", el).forEach((b) => (b.onclick = () => { const r = rows.find((x) => x.id === +b.dataset.upd); amountModal({ ...r, kind: "expense" }); }));
}

// ---------------------------------------------------------------- forecast
async function pageForecast(el) {
  const f = await api(`api/forecast?month=${S.month}${memberQ()}`);
  const nx = f.next, th = f.this;
  const tin = (h) => h.income_cents + (h.transfer_in_cents || 0);
  const tout = (h) => h.expense_cents + h.saving_cents + (h.transfer_out_cents || 0);
  el.innerHTML = `${billingBanner()}
    <div class="card" style="margin-bottom:18px"><div class="card-head"><h3>${monthName(f.next_month)} at a glance</h3><span class="small muted">compared with ${monthName(f.month)}</span></div>
      <div class="grid g3">
        ${[["Money in", tin(th.household), tin(nx.household), true], ["Going out", tout(th.household), tout(nx.household), false],
           ["Left over", th.household.surplus_cents, nx.household.surplus_cents, true]].map(([lbl, a, b, upGood]) => {
          const d = b - a;
          return `<div><div class="small muted">${lbl}</div><div class="serif" style="font-size:30px">${zar(b)}</div>
            <div class="small">${d ? `<span class="${(d > 0) === upGood ? "good" : "warn"}">${zar(d, { signed: true })}</span> vs this month` : `<span class="muted">same as this month</span>`}</div></div>`;
        }).join("")}
      </div>
      ${nx.people.length > 1 ? `<div class="people" style="margin-top:18px">${nx.people.map((p) => {
        const was = th.people.find((x) => x.id === p.id);
        return `<div class="card flat person ${pclass(p.id)}" style="padding:14px 16px"><div class="row" style="justify-content:space-between"><b style="font-weight:600"><span class="dot ${pclass(p.id)}"></span> ${esc(p.name)}</b>
          <span class="chip ${p.surplus_cents < 0 ? "warn" : "good"}">${zar(p.surplus_cents)}</span></div>
          <div class="small muted" style="margin-top:6px">Left over ${zar(was?.surplus_cents)} → ${zar(p.surplus_cents)}</div></div>`;
      }).join("")}</div>` : ""}
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>What to know</h3></div><div class="insights">${insightList(f.insights)}</div></div>
      <div class="card"><div class="card-head"><h3>Left over, next 6 months</h3></div>
        <div class="legend">${(f.projection[0].people.length > 1 ? f.projection[0].people : []).map((p) => `<span><span class="sw" style="background:var(--${pclass(p.id)})"></span>${esc(p.name)}</span>`).join("")}</div>
        <div class="chart" id="proj"></div>
        <details class="small muted" style="margin-top:10px"><summary>Show as table</summary><table class="t" style="margin-top:8px"><thead><tr><th>Month</th>${f.projection[0].people.map((p) => `<th class="num">${esc(p.name)}</th>`).join("")}<th class="num">Total</th></tr></thead>
          <tbody>${f.projection.map((m) => `<tr><td>${monthName(m.month)}</td>${m.people.map((p) => `<td class="num">${zar(p.surplus_cents)}</td>`).join("")}<td class="num">${zar(m.household_surplus_cents)}</td></tr>`).join("")}</tbody></table></details>
        <h3 style="margin-top:22px">Balance next month</h3>${groupMeters(nx.by_group, tin(nx.household))}
      </div>
    </div>`;
  drawProjection($("#proj"), f.projection);
  bindBarTips(el);
}

function svgEl(tag, attrs, parent) { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent?.appendChild(n); return n; }
function niceStep(v) { const raw = Math.max(v, 1) / 4; const p = 10 ** Math.floor(Math.log10(raw)); for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]) if (m * p >= raw) return m * p; return 10 * p; }
function axisLabel(c) { const r = c / 100; const a = Math.abs(r); return (r < 0 ? "-" : "") + (a >= 1000 ? `R${Math.round(a / 100) / 10}k` : `R${Math.round(a)}`); }

function drawProjection(box, proj) {
  const multi = proj[0].people.length > 1;
  const series = multi ? proj[0].people.map((p) => ({ name: p.name, color: `var(--${pclass(p.id)})`, vals: proj.map((m) => m.people.find((x) => x.id === p.id).surplus_cents) }))
    : [{ name: "Left over", color: "var(--accent)", vals: proj.map((m) => m.household_surplus_cents) }];
  const W = 520, H = 230, L = 50, B = 26, T = 10, R = 6;
  const all = series.flatMap((s) => s.vals);
  const step = niceStep(Math.max(...all.map(Math.abs), 1));
  const max = Math.max(step, Math.ceil(Math.max(0, ...all) / step) * step);
  const min = Math.floor(Math.min(0, ...all) / step) * step;
  const y = (v) => T + ((H - T - B) * (max - v)) / (max - min);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Money left over per month" }, box);
  for (let v = min; v <= max + 1; v += step) {
    svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "zero" : "grid" }, svg);
    svgEl("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = axisLabel(v);
  }
  const band = (W - L - R) / proj.length, bw = Math.min(18, (band - 12) / series.length - 2);
  proj.forEach((m, i) => {
    const cx = L + band * i + band / 2;
    series.forEach((s, j) => {
      const v = s.vals[i], x = cx - (series.length * (bw + 2)) / 2 + j * (bw + 2) + 1;
      const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0))), r = Math.min(4, h / 2, bw / 2);
      const d = v >= 0
        ? `M${x},${y(0)}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${y(0)}Z`
        : `M${x},${y(0)}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + bw - r}Q${x + bw},${top + h} ${x + bw},${top + h - r}V${y(0)}Z`;
      svgEl("path", { d, fill: s.color, opacity: i === 0 ? 0.5 : 1 }, svg);
    });
    svgEl("text", { x: cx, y: H - 7, "text-anchor": "middle" }, svg).textContent = i === 0 ? "Now" : monthName(m.month, "short");
    const hit = svgEl("rect", { x: L + band * i, y: T, width: band, height: H - T - B, fill: "transparent" }, svg);
    hit.onmousemove = (e) => showTip(`<b>${monthName(m.month)}</b>${series.map((s) => `<div class="r"><span><span class="dot" style="background:${s.color}"></span> ${esc(s.name)}</span><span>${zar(s.vals[i])}</span></div>`).join("")}
      ${multi ? `<div class="r" style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px"><span>Household</span><b>${zar(m.household_surplus_cents)}</b></div>` : ""}`, e.clientX, e.clientY);
    hit.onmouseleave = hideTip;
  });
}

// ---------------------------------------------------------------- goals
async function pageGoals(el) {
  const goals = await api(`api/goals?month=${S.month}`);
  el.innerHTML = `${billingBanner()}
    <div class="row" style="justify-content:space-between;margin-bottom:16px"><p class="muted" style="margin:0;max-width:640px">Personal goals use that person's spare money first; shared goals use what's left. Goals with a deadline come first, then the rest is split. Each suggested cut appears under one goal only, and never touches debts, insurance, medical, giving, housing or contracts. Figures are before any interest earned.</p>
      <button class="btn primary" id="add">+ New goal</button></div>
    ${goals.length ? `<div class="goals">${goals.map(goalCard).join("")}</div>` : `<div class="card empty"><h3>What are you saving for?</h3><p>An emergency fund, a holiday, a deposit. Add a goal to see how long it takes and what could get you there sooner.</p><button class="btn primary" id="add2" style="margin-top:12px">Add a goal</button></div>`}`;
  $("#add").onclick = () => goalModal();
  $("#add2")?.addEventListener("click", () => goalModal());
  $$("[data-edit]", el).forEach((b) => (b.onclick = () => goalModal(goals.find((g) => g.goal.id === +b.dataset.edit).goal)));
  $$("[data-apply]", el).forEach((b) => (b.onclick = async () => {
    const [lineId, cut, cur, name] = [+b.dataset.apply, +b.dataset.cut, +b.dataset.cur, b.dataset.name];
    const from = addMonths(S.month, 1);
    if (!confirm(`Reduce ${name} from ${zar(cur)} to ${zar(cur - cut)} from ${monthName(from)}?\n\nOnly do this if it's something you can genuinely spend less on. It won't change a contract, debit order or minimum repayment — cancel or renegotiate those with the provider first.`)) return;
    try { await api(`api/budget/lines/${lineId}/amount`, { method: "POST", body: { month: from, amount_cents: cur - cut, mode: "onward", note: "Cut back for a goal" } }); toast("Budget updated"); route(); }
    catch (e) { fail(e); }
  }));
  $$("input[type=range][data-goal]", el).forEach((r) => (r.oninput = () => {
    const g = goals.find((x) => x.goal.id === +r.dataset.goal);
    const per = +r.value * 100;
    const months = per > 0 ? Math.ceil(g.remaining_cents / per) : null;
    $(`#wi-${g.goal.id}`).innerHTML = months ? `At <b>${zar(per)}</b>/month you'd get there in <b>${months} months</b> (${monthName(addMonths(S.month, months))}).` : "Move the slider to try a monthly amount.";
  }));
}

function goalCard(g) {
  const p = Math.min(100, g.progress_pct), C = 2 * Math.PI * 30;
  const who = g.goal.member_id ? pname(g.goal.member_id) : "Shared";
  const status = g.remaining_cents === 0 ? `<span class="chip good">Reached</span>` : g.past_target ? `<span class="chip warn">Past its date</span>`
    : g.on_track ? `<span class="chip good">On track</span>` : g.goal.target_month ? `<span class="chip warn">Behind</span>` : `<span class="chip">No money assigned</span>`;
  const sliderMax = Math.max(1000, Math.ceil(g.remaining_cents / 100 / 3 / 500) * 500);
  return `<div class="card goal">
    <div class="row" style="gap:16px;align-items:center;flex-wrap:nowrap">
      <svg class="ring" viewBox="0 0 74 74" role="img" aria-label="${Math.round(p)}% saved"><circle class="bg" cx="37" cy="37" r="30"/><circle class="fg" cx="37" cy="37" r="30" transform="rotate(-90 37 37)" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p / 100)}"/><text x="37" y="42" text-anchor="middle">${Math.round(p)}%</text></svg>
      <div style="flex:1;min-width:0"><h3 style="margin:0 0 6px">${esc(g.goal.name)}</h3><div class="row" style="gap:8px">${status}<span class="chip outline">${esc(who)}</span></div></div>
      <button class="btn ghost sm" data-edit="${g.goal.id}">Edit</button>
    </div>
    <div class="facts">
      <div>Saved<b>${zar(g.goal.saved_cents)} <span class="muted" style="font-weight:400">of ${zar(g.goal.target_cents)}</span></b></div>
      <div>${g.goal.target_month ? "Target" : "Estimated"}<b>${g.goal.target_month ? monthName(g.goal.target_month) : g.eta_month ? monthName(g.eta_month) : "—"}</b></div>
      <div>Going towards it<b>${zar(g.contribution_cents)}/mo</b>${g.linked_savings_cents ? `<span class="small muted">incl. ${zar(g.linked_savings_cents)} from savings</span>` : ""}</div>
      <div>${g.goal.target_month ? "Needed" : "Time to goal"}<b>${g.goal.target_month ? `${zar(g.required_monthly_cents)}/mo` : g.months_needed != null ? `${g.months_needed} months` : "—"}</b></div>
    </div>
    ${g.past_target ? `<p class="small warn" style="margin:0 0 10px">The target date has passed. <button class="link" data-edit="${g.goal.id}">Set a new date</button> to plan it again.</p>` : ""}
    ${g.cuts.length ? `<div class="small" style="font-weight:600">${g.goal.target_month && g.gap_cents ? `To close the ${zar(g.gap_cents)}/month gap` : "To get there sooner"}</div>
      <div class="cuts">${g.fee_win_cents ? `<div class="cut"><span>Avoidable bank fees (from statements)</span><span class="good">+${zar(g.fee_win_cents)}</span><span></span></div>` : ""}
      ${g.cuts.map((c) => `<div class="cut"><span>${esc(c.name)} <span class="muted">${zar(c.current_cents)} → ${zar(c.new_cents)}</span></span><span class="good">+${zar(c.cut_cents)}</span>
        <button class="btn sm" data-apply="${c.line_id}" data-cut="${c.cut_cents}" data-cur="${c.current_cents}" data-name="${esc(c.name)}">Apply</button></div>`).join("")}</div>
      <p class="small muted" style="margin:8px 0 0">${g.months_with_cuts ? `With these: about ${g.months_with_cuts} months${g.eta_with_cuts ? ` (${monthName(g.eta_with_cuts)})` : ""}.` : ""}${g.cuts_close_gap === false ? " These alone don't close the gap; a later target date may be more realistic." : ""}</p>` : ""}
    ${g.remaining_cents ? `<div class="whatif"><label class="small muted">What if we put aside… <input type="range" min="0" max="${sliderMax}" step="100" value="${Math.round(g.contribution_cents / 100)}" data-goal="${g.goal.id}"></label>
      <div class="small" id="wi-${g.goal.id}">${g.months_needed ? `At <b>${zar(g.contribution_cents)}</b>/month you'd get there in <b>${g.months_needed} months</b>.` : "Move the slider to try a monthly amount."}</div></div>` : ""}
  </div>`;
}

function goalModal(g) {
  const box = modal(`<h2>${g ? "Edit goal" : "New goal"}</h2><form id="f">
    <label class="field">What for? <input type="text" name="name" value="${esc(g?.name || "")}" placeholder="e.g. Emergency fund, Holiday, House deposit" required maxlength="80"></label>
    <div class="grid g2"><label class="field">Target (R) <input type="number" inputmode="decimal" name="target" min="1" step="1" value="${g ? g.target_cents / 100 : ""}" required></label>
      <label class="field">Saved so far (R) <input type="number" inputmode="decimal" name="saved" min="0" step="1" value="${g ? g.saved_cents / 100 : 0}"></label></div>
    <div class="grid g2"><label class="field">By when? <span class="muted" style="font-weight:400">(optional)</span><input type="month" name="by" value="${g?.target_month || ""}"></label>
      <label class="field">Whose goal <select name="who"><option value="">Shared</option>${memberOptions(g?.member_id)}</select></label></div>
    <div class="actions">${g ? `<button type="button" class="btn danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
  if (g && !g.member_id) $("[name=who]", box).value = "";
  $("#del", box)?.addEventListener("click", async () => { if (!confirm("Delete this goal?")) return; await api(`api/goals/${g.id}`, { method: "DELETE" }).catch(fail); closeOverlays(); route(); });
  $("#f", box).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { name: f.get("name"), target_cents: toCents(f.get("target")), saved_cents: toCents(f.get("saved") || 0), target_month: f.get("by") || null, member_id: f.get("who") ? +f.get("who") : null };
    try { await api(g ? `api/goals/${g.id}` : "api/goals", { method: g ? "PATCH" : "POST", body }); closeOverlays(); toast("Goal saved"); route(); } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- statements
async function pageStatements(el, q) {
  const tab = q.get("tab") || "spending";
  const tabs = [["spending", "Spending vs plan"], ["transactions", "Transactions"], ["fees", "Fees & recurring"], ["import", "Import"]];
  el.innerHTML = `${billingBanner()}<div class="tabs">${tabs.map(([k, t]) => `<button class="${k === tab ? "on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div><div id="tab"></div>`;
  $$("[data-tab]", el).forEach((b) => (b.onclick = () => go(`#/statements?tab=${b.dataset.tab}`)));
  const box = $("#tab");
  if (tab === "import") return statementImport(box);
  const months = S.me.statement_months;
  if (!months.length) {
    box.innerHTML = `<div class="card empty"><h3>No statements yet</h3><p>Import CSV exports from the FNB or Capitec app to compare your plan with what actually went out.</p><a class="btn primary" style="margin-top:12px" href="#/statements?tab=import">Import a statement</a></div>`;
    return;
  }
  const sm = q.get("m") && months.includes(q.get("m")) ? q.get("m") : months[0];
  const picker = `<select id="sm" style="width:auto">${months.map((m) => `<option value="${m}" ${m === sm ? "selected" : ""}>${monthName(m)}</option>`).join("")}</select>`;
  const a = await api(`api/actuals?month=${sm}${memberQ()}`);
  if (!a.has_data) { box.innerHTML = `<div class="card empty"><p>No statements for this person yet.</p></div>`; return; }
  if (tab === "spending") {
    const plan = await api(`api/budget?month=${sm}${memberQ()}`);
    const planned = Object.fromEntries(plan.by_category.map((c) => [c.category, c.planned_cents]));
    const actual = Object.fromEntries(a.summary.by_category.map((c) => [c.category, c.spend_cents]));
    const cats = [...new Set([...Object.keys(actual), ...Object.keys(planned)])].filter((c) => c !== "Savings & investments");
    const rows = cats.map((c) => ({ c, p: planned[c] || 0, a: actual[c] || 0 })).sort((x, y) => Math.max(y.p, y.a) - Math.max(x.p, x.a));
    const max = Math.max(1, ...rows.map((r) => Math.max(r.p, r.a)));
    const plannedOut = plan.household.expense_cents;
    box.innerHTML = `<div class="row" style="margin-bottom:14px">${picker}<span class="small muted">From imported statements</span></div>
      <div class="kpis"><div class="card kpi"><div class="label">Actually spent</div><div class="value">${zar(a.summary.spend_cents)}</div><div class="sub">excluding transfers and savings</div></div>
        <div class="card kpi"><div class="label">Planned</div><div class="value">${zar(plannedOut)}</div><div class="sub">expenses in your budget</div></div>
        <div class="card kpi"><div class="label">Difference</div><div class="value ${a.summary.spend_cents > plannedOut ? "warn" : "good"}">${zar(a.summary.spend_cents - plannedOut, { signed: true })}</div><div class="sub">${a.summary.uncategorised} transaction(s) in Other</div></div></div>
      <div class="grid g2"><div class="card"><h3>By category</h3><div class="legend"><span><span class="sw" style="background:var(--accent)"></span>Actual</span><span><span class="tk"></span>Planned</span></div>
        <div class="bars">${rows.map((r) => barRow(r.c, r.a, max, r.p)).join("")}</div></div>
        <div class="card"><h3>Suggested actions</h3><div class="insights">${a.advice.actions.length ? a.advice.actions.map((x) => `<div class="insight info"><span class="ic">→</span><span class="t">${esc(x.title)}</span><span class="amt good">${x.monthly_impact_cents ? "~" + zar(x.monthly_impact_cents) + "/mo" : ""}</span><span class="d">${esc(x.detail)}</span></div>`).join("") : `<p class="muted">Nothing stands out.</p>`}</div></div></div>`;
  } else if (tab === "transactions") {
    await transactionsTab(box, sm, picker);
  } else {
    const f = a.fees;
    box.innerHTML = `<div class="row" style="margin-bottom:14px">${picker}<span class="small muted">3 months up to this month</span></div>
      <div class="kpis"><div class="card kpi"><div class="label">Bank fees</div><div class="value">${zar(f.fees_monthly_avg_cents)}</div><div class="sub">average a month</div></div>
      <div class="card kpi"><div class="label">Interest charged</div><div class="value">${zar(f.interest_monthly_avg_cents)}</div><div class="sub">average a month</div></div>
      <div class="card kpi"><div class="label">Recurring</div><div class="value">${zar(a.recurring.filter((r) => r.active).reduce((s, r) => s + r.monthly_cents, 0))}</div><div class="sub">${a.recurring.length} found</div></div></div>
      <div class="grid g2"><div class="card"><h3>Fees</h3>${f.fee_kinds.length ? `<table class="t"><tbody>${f.fee_kinds.map((k) => `<tr><td>${esc(k.kind)} ${k.avoidable ? `<span class="chip warn">avoidable</span>` : ""}</td><td class="num">${k.count}×</td><td class="num">${zar(k.total_cents, { whole: false })}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No fees found.</p>`}</div>
      <div class="card"><h3>Recurring payments</h3>${a.recurring.length ? `<table class="t"><tbody>${a.recurring.map((r) => `<tr><td>${esc(r.merchant)}<div class="small muted">${esc(r.kind)}</div></td><td class="num">${zar(r.monthly_cents, { whole: false })}</td><td class="num muted">${zar(r.annual_cents)}/yr</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Needs at least two months of statements.</p>`}</div></div>`;
  }
  $("#sm")?.addEventListener("change", (e) => go(`#/statements?tab=${tab}&m=${e.target.value}`));
  bindBarTips(box);
}

async function transactionsTab(box, sm, picker) {
  const rows = await api(`api/transactions?month=${sm}${memberQ()}`);
  const unknown = rows.filter((t) => t.category_source === "none" && !t.is_transfer).length;
  box.innerHTML = `<div class="row" style="margin-bottom:14px">${picker}<label class="check"><input type="checkbox" id="rule" checked> Remember my choice for that merchant</label></div>
    ${unknown ? `<div class="banner"><span>${unknown} transaction(s) need a category.${S.me.llm.available ? " AI can suggest them. Only merchant names are sent." : ""}</span>${S.me.llm.available ? `<button class="btn sm primary" id="ai">Suggest categories</button>` : ""}</div>` : ""}
    <div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>
    ${rows.map((t) => `<tr><td class="small muted">${t.posted_on}</td><td>${esc(t.description)}<div class="small muted">${esc(t.account)}</div></td>
      <td class="num ${t.amount_cents > 0 ? "good" : ""}">${zar(t.amount_cents, { whole: false })}</td>
      <td><select data-id="${t.id}" aria-label="Category">${S.me.categories.map((c) => `<option ${c === t.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table></div></div>`;
  $$("select[data-id]", box).forEach((s) => (s.onchange = async () => {
    try { const r = await api(`api/transactions/${s.dataset.id}/category`, { method: "POST", body: { category: s.value, make_rule: $("#rule").checked } }); toast(r.updated > 1 ? `Updated ${r.updated} transactions` : "Saved"); }
    catch (e) { fail(e); }
  }));
  $("#ai")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Asking…";
    try { const r = await api("api/categorise/ai", { method: "POST", body: {} }); toast(`Categorised ${r.transactions_updated} transaction(s)`); route(); } catch (err) { fail(err); e.target.disabled = false; }
  });
}

function statementImport(box) {
  box.innerHTML = `<div class="card" style="max-width:620px"><h3>Import bank statements</h3>
    <p class="muted small">CSV exports from the FNB or Capitec app or online banking. Card and account numbers are reduced to the last 4 digits before they're stored. Importing the same statement twice won't duplicate anything.</p>
    <form id="f" style="display:grid;gap:14px;margin-top:14px">
      <label class="field">Statement files <input type="file" id="files" accept=".csv,text/csv" multiple required></label>
      <div class="grid g2"><label class="field">Whose account <select name="member"><option value="">Joint</option>${memberOptions()}</select></label>
        <label class="field">Bank <select name="bank"><option value="auto">Detect</option><option value="fnb">FNB</option><option value="capitec">Capitec</option></select></label></div>
      <label class="field">Account name <input type="text" name="label" placeholder="e.g. FNB Cheque" maxlength="40"></label>
      <button class="btn primary" style="justify-self:start">Import</button></form>
    <ul id="out" class="small" style="padding-left:18px;margin-top:14px"></ul></div>`;
  $("#f", box).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    for (const file of $("#files").files) {
      const li = document.createElement("li"); li.textContent = `${file.name}: importing…`; $("#out").appendChild(li);
      try {
        const r = await api("api/import", { method: "POST", body: { filename: file.name, content: await file.text(), bank: f.get("bank"), account_label: f.get("label"), member_id: f.get("member") ? +f.get("member") : null } });
        li.innerHTML = `<b>${esc(file.name)}</b>: ${r.rows_added} new, ${r.rows_duplicate} already imported (${r.first_date} to ${r.last_date})`;
      } catch (err) { li.innerHTML = `<b>${esc(file.name)}</b>: <span class="warn">${esc(err.message)}</span>`; }
    }
    await refreshMe();
  };
}

// ---------------------------------------------------------------- debts
async function pageDebts(el) {
  const debts = await api("api/debts");
  el.innerHTML = `${billingBanner()}<div class="grid g2" style="align-items:start">
    <div class="card"><h3>Your debts</h3>
      ${debts.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Debt</th><th class="num">Balance</th><th class="num">Rate</th><th class="num">Minimum</th><th></th></tr></thead><tbody>${debts.map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${zar(d.balance_cents)}</td><td class="num">${(d.apr_bp / 100).toFixed(2)}%</td><td class="num">${zar(d.min_payment_cents)}</td><td class="num"><button class="link small" data-del="${d.id}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Add loans, cards, overdrafts and store accounts.</p>`}
      <form id="f" class="grid g2 debt-form" style="margin-top:16px">
        <input type="text" name="name" placeholder="Name, e.g. Credit card" required maxlength="60">
        <input type="number" inputmode="decimal" name="bal" step="0.01" min="0" placeholder="Balance (R)" required>
        <input type="number" inputmode="decimal" name="apr" step="0.01" min="0" max="100" placeholder="Interest rate % a year" required>
        <input type="number" inputmode="decimal" name="min" step="0.01" min="0" placeholder="Minimum payment (R)" required>
        <button class="btn primary" style="justify-self:start">Add debt</button></form></div>
    <div class="card"><h3>Payoff plan</h3><label class="field" style="max-width:240px">Extra I can pay each month (R)<input type="number" inputmode="decimal" id="extra" min="0" step="100" value="1000"></label><div id="plan" style="margin-top:16px"></div></div></div>`;
  $$("[data-del]", el).forEach((b) => (b.onclick = async () => { await api(`api/debts/${b.dataset.del}`, { method: "DELETE" }).catch(fail); route(); }));
  $("#f", el).onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await api("api/debts", { method: "POST", body: { name: f.get("name"), balance_cents: toCents(f.get("bal")), apr_bp: Math.round(+f.get("apr") * 100), min_payment_cents: toCents(f.get("min")) } }); route(); } catch (err) { fail(err); }
  };
  const draw = async () => {
    if (!debts.length) { $("#plan").innerHTML = ""; return; }
    const p = await api(`api/debts/plan?extra_cents=${toCents($("#extra").value || 0) || 0}`);
    const card = (key, title) => { const x = p[key]; const best = key === p.recommended && p.extra_cents > 0; return `<div class="card flat" style="padding:14px 16px;${best ? "border-color:var(--accent)" : ""}">
      <div class="row" style="justify-content:space-between"><b style="font-weight:600">${title}</b>${best ? `<span class="chip good">best</span>` : ""}</div>
      <div class="serif" style="font-size:26px">${x.never_pays_off ? "Never at this rate" : `${x.months} months`}</div>
      <div class="small muted">${zar(x.total_interest_cents)} interest${x.interest_saved_cents ? ` · saves ${zar(x.interest_saved_cents)}` : ""}${x.months_saved ? ` · ${x.months_saved} months sooner` : ""}</div>
      ${key !== "baseline" ? `<div class="small muted">Order: ${x.payoff_order.map((o) => esc(o.name)).join(" → ")}</div>` : ""}</div>`; };
    const warn = (p.warnings || []).map((w) => `<div class="banner warn" style="display:block">The minimum on <b>${esc(w.name)}</b> (${zar(w.minimum_cents ?? w.min_payment_cents)}) doesn't cover its monthly interest (about ${zar(w.interest_cents)}), so the balance keeps growing. Paying more than the interest each month is the first step.</div>`).join("");
    $("#plan").innerHTML = `${warn}<div class="grid" style="gap:10px">${card("baseline", "Minimums only")}${card("avalanche", "Avalanche: highest rate first")}${card("snowball", "Snowball: smallest balance first")}</div>`;
  };
  let t; $("#extra").oninput = () => { clearTimeout(t); t = setTimeout(draw, 250); };
  draw();
}

// ---------------------------------------------------------------- reports
async function pageReports(el) {
  const t = await api("api/tokens");
  const owner = S.me.user.role === "owner" && !S.me.household.is_demo;
  el.innerHTML = `<div class="grid g2" style="align-items:start">
    <div class="card"><h3>Download for Power BI or Excel</h3>
      <p class="muted small">A ready-made data model: people, categories and months, plus your budget for every month (including the next six, so it doubles as a forecast), transactions, goals and debts.</p>
      <button class="btn primary" id="zip">Download Power BI pack (.zip)</button>
      <div class="small muted" style="margin:16px 0 6px">Or single tables (CSV):</div>
      <div class="row" style="gap:8px">${t.tables.map((x) => `<button class="btn sm" data-csv="${x}">${x}</button>`).join("")}</div>
      <p class="small muted" style="margin-top:16px">In Power BI Desktop: <b>Get Data → Folder</b>, then pick the unzipped folder. Relationships and starter DAX measures are in README.txt.</p></div>
    <div class="card"><h3>Live feed (scheduled refresh)</h3>
      <p class="muted small">Create a read-only token so Power BI can refresh straight from your budget. Treat the token like a password; you can revoke it any time.</p>
      ${owner ? `<form id="tf" class="row"><input type="text" name="name" placeholder="Token name, e.g. Power BI" style="flex:1" maxlength="60"><button class="btn primary">Create token</button></form>` : `<p class="small muted">Only the household owner can create tokens${S.me.household.is_demo ? " (not available in the demo)" : ""}.</p>`}
      <div id="newtok"></div>
      ${t.tokens.length ? `<table class="t" style="margin-top:12px"><tbody>${t.tokens.map((k) => `<tr><td>${esc(k.name)}<div class="small muted">${esc(k.prefix)}… · ${k.last_used_at ? "used " + esc(k.last_used_at) : "never used"}</div></td><td class="num">${owner ? `<button class="link small" data-rev="${k.id}">Revoke</button>` : ""}</td></tr>`).join("")}</tbody></table>` : ""}
      <div class="small muted" style="margin:16px 0 6px">Power Query (Get Data → Blank query → Advanced editor). Create a text parameter <code>ApiToken</code> first:</div>
      <pre class="code">${esc(t.query_template)}</pre>
      <p class="small muted">Tables: ${t.tables.map((x) => `<code>${x}</code>`).join(", ")} at <code>${esc(t.base_url)}/api/powerbi/&lt;table&gt;.csv</code></p></div></div>`;
  $("#zip").onclick = () => download("api/export/powerbi.zip").catch(fail);
  $$("[data-csv]", el).forEach((b) => (b.onclick = () => download(`api/export/${b.dataset.csv}.csv`).catch(fail)));
  $("#tf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { const r = await api("api/tokens", { method: "POST", body: { name: new FormData(e.target).get("name") } });
      $("#newtok").innerHTML = `<div class="banner" style="margin-top:12px;display:block"><b>Copy this token now.</b> It won't be shown again.<pre class="code" style="margin:8px 0 0">${esc(r.token)}</pre></div>`;
    } catch (err) { fail(err); }
  });
  $$("[data-rev]", el).forEach((b) => (b.onclick = async () => { if (!confirm("Revoke this token? Reports using it will stop refreshing.")) return; await api(`api/tokens/${b.dataset.rev}`, { method: "DELETE" }).catch(fail); route(); }));
}

// ---------------------------------------------------------------- settings
async function pageSettings(el, q) {
  const tab = q.get("tab") || "household";
  const tabs = [["household", "Household"], ["import", "Import Excel"], ...(S.config.private_mode ? [] : [["plan", "Plan"]]), ["privacy", "Privacy & data"], ["security", "Security"]];
  el.innerHTML = `<div class="tabs">${tabs.map(([k, t]) => `<button class="${k === tab ? "on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div><div id="tab"></div>`;
  $$("[data-tab]", el).forEach((b) => (b.onclick = () => go(`#/settings?tab=${b.dataset.tab}`)));
  const box = $("#tab");
  const owner = S.me.user.role === "owner";
  const demo = S.me.household.is_demo;
  if (tab === "household") {
    box.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><h3>Household</h3>
      <form id="hf" class="row"><input type="text" name="name" value="${esc(S.me.household.name)}" style="flex:1" ${owner ? "" : "disabled"} maxlength="80">${owner ? `<button class="btn">Save</button>` : ""}</form>
      <h3 style="margin-top:22px">People in the budget</h3>
      ${S.me.members.map((m) => `<form class="row" data-mf="${m.id}" style="margin-bottom:8px"><span class="dot ${pclass(m.id)}"></span><input type="text" name="name" value="${esc(m.name)}" style="flex:1" maxlength="40"><button class="btn sm">Rename</button></form>`).join("")}
      ${owner ? `<form id="af" class="row" style="margin-top:12px"><input type="text" name="name" placeholder="Add a person" style="flex:1" maxlength="40"><button class="btn sm">Add</button></form>` : ""}</div>
      <div class="card"><h3>Invite your partner</h3><p class="muted small">${S.config.private_mode ? "Anyone whose email is on the allowlist (in the server config) joins this household automatically the first time they sign in with Microsoft. An invite link also works, once, for 7 days." : "They get their own login to the same household budget. The link works once and expires in 7 days."}</p>
      ${owner && !demo ? `<button class="btn primary" id="inv">Create invite link</button><div id="invout"></div>` : `<p class="small muted">${demo ? "Not available in the demo." : "Only the owner can invite."}</p>`}</div></div>`;
    $("#hf")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("api/household", { method: "PATCH", body: { name: new FormData(e.target).get("name") } }); await refreshMe(); toast("Saved"); route(); } catch (err) { fail(err); } });
    $$("[data-mf]", box).forEach((f) => (f.onsubmit = async (e) => { e.preventDefault(); try { await api(`api/members/${f.dataset.mf}`, { method: "PATCH", body: { name: new FormData(f).get("name") } }); await refreshMe(); toast("Renamed"); route(); } catch (err) { fail(err); } }));
    $("#af")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("api/members", { method: "POST", body: { name: new FormData(e.target).get("name") } }); await refreshMe(); route(); } catch (err) { fail(err); } });
    $("#inv")?.addEventListener("click", async () => {
      try { const r = await api("api/invites", { method: "POST", body: {} }); const link = `${location.origin}/#/join/${r.token}`;
        $("#invout").innerHTML = `<pre class="code" style="margin-top:12px;white-space:pre-wrap;word-break:break-all">${esc(link)}</pre><button class="btn sm" id="cp">Copy link</button>`;
        $("#cp").onclick = () => navigator.clipboard.writeText(link).then(() => toast("Copied"));
      } catch (err) { fail(err); }
    });
  } else if (tab === "import") {
    box.innerHTML = `<div class="card" style="max-width:680px"><h3>Import your Excel budget</h3>
      <p class="muted small">For workbooks with one sheet per month (named like “March 26”), each with a “&lt;Name&gt; Salary” row and the items below it. Amounts that change between sheets become dated changes, and items that disappear end after the last month they appear in. The file is read but not stored.</p>
      <label class="field" style="margin-top:12px">Workbook (.xlsx) <input type="file" id="xl" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      <div id="xlout" style="margin-top:16px"></div></div>`;
    $("#xl").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(file); });
      try {
        const p = await api("api/workbook/preview", { method: "POST", body: { content_b64: b64 } });
        const guess = (n) => S.me.members.find((m) => m.name.toLowerCase().startsWith(n.toLowerCase()))?.id ?? S.me.members[p.people.indexOf(n)]?.id;
        $("#xlout").innerHTML = `<p class="small">Found <b>${p.sheets.length} monthly sheets</b>: ${p.sheets.map((s) => `${esc(s.sheet)} (${s.items} items)`).join(", ")}.</p>
          <form id="mf" style="display:grid;gap:12px"><div class="small" style="font-weight:600">Match the people in the workbook</div>
          ${p.people.map((n, i) => `<label class="field">“${esc(n)}” is <select name="p${i}"><option value="">Skip</option>${memberOptions(guess(n))}</select></label>`).join("")}
          <label class="field">Start from <select name="from">${p.sheets.map((s, i) => `<option value="${s.month}" ${i === 0 ? "selected" : ""}>${esc(s.sheet)}</option>`).join("")}</select></label>
          <button class="btn primary" style="justify-self:start">Import</button></form>`;
        $("#mf").onsubmit = async (ev) => {
          ev.preventDefault(); const f = new FormData(ev.target); const map = {};
          p.people.forEach((n, i) => { if (f.get(`p${i}`)) map[n] = +f.get(`p${i}`); });
          try { const r = await api("api/workbook/import", { method: "POST", body: { content_b64: b64, person_map: map, from_month: f.get("from") } });
            toast(`Imported ${r.items_created} items and ${r.amount_changes} changes`); S.month = r.to_month; go("#/budget");
          } catch (err) { fail(err); }
        };
      } catch (err) { $("#xlout").innerHTML = `<p class="warn">${esc(err.message)}</p>`; }
    };
  } else if (tab === "plan") {
    const b = await api("api/billing");
    box.innerHTML = `<div class="card" style="max-width:780px"><h3>Your plan</h3>
      <p>${demo ? "This is a demo household." : b.status === "trialing" ? `Free trial: ${b.trial_days_left} days left (ends ${esc(b.trial_ends_on)}).` : b.status === "active" ? `Active until ${esc(b.paid_until)}.` : `Status: ${esc(b.status)}.`}</p>
      <div class="pricing" style="justify-content:start;margin-top:16px">${Object.entries(b.plans).map(([k, p]) => `<div class="card flat plan"><h3>${esc(p.name)}</h3><div class="price">${zar(p.price_cents)} <small>/ ${p.interval}</small></div>
        <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        ${owner && !demo && b.dev_mode ? `<button class="btn primary" data-sim="${k}">Activate (test mode)</button>` : `<button class="btn" disabled>Card payments coming soon</button>`}</div>`).join("")}</div>
      ${owner && !demo && b.status === "active" ? `<button class="btn danger sm" id="cancel" style="margin-top:16px">Cancel plan</button>` : ""}
      <p class="small muted" style="margin-top:16px">Payment collection isn't connected yet${b.dev_mode ? "; test mode activates a plan without charging" : ""}.</p></div>`;
    $$("[data-sim]", box).forEach((x) => (x.onclick = async () => { try { await api("api/billing/simulate", { method: "POST", body: { plan: x.dataset.sim } }); await refreshMe(); toast("Plan activated (test mode)"); route(); } catch (e) { fail(e); } }));
    $("#cancel")?.addEventListener("click", async () => { if (!confirm("Cancel your plan? You keep access until the end of the paid period.")) return; await api("api/billing/cancel", { method: "POST", body: {} }).catch(fail); await refreshMe(); route(); });
  } else if (tab === "privacy") {
    const audit = await api("api/privacy/audit");
    const c = S.me.consents;
    box.innerHTML = `<div class="grid g2" style="align-items:start">
      <div class="card"><h3>Your choices</h3>
        ${demo ? `<p class="small muted">Consents apply to real accounts.</p>` : `<label class="check"><input type="checkbox" checked disabled> Processing to provide the service (since ${esc(c.service?.at || "")}). To withdraw this, delete your account.</label>
        <label class="check" style="margin-top:10px"><input type="checkbox" data-consent="product_updates" ${c.product_updates?.granted ? "checked" : ""}> Product update emails</label>`}
        <h3 style="margin-top:24px">Keep statement lines for</h3>
        <form id="rf" class="row"><select name="r" style="width:auto" ${owner ? "" : "disabled"}>${[12, 24, 36, 60, 84].map((m) => `<option value="${m}" ${m === S.me.household.retention_months ? "selected" : ""}>${m} months</option>`).join("")}</select>${owner ? `<button class="btn sm">Save</button>` : ""}</form>
        <p class="small muted">Older statement lines are deleted automatically. Your budget plan is kept until you delete it.</p>
        <h3 style="margin-top:24px">Your data</h3>
        <div class="row"><button class="btn" id="exp">Download all my data</button><a class="btn ghost" href="#/privacy" target="_blank">Privacy notice</a></div>
        ${!demo ? `<h3 style="margin-top:24px" class="warn">${owner ? "Delete household" : "Leave household"}</h3>
        <p class="small muted">${owner ? "Permanently deletes the household, everyone's logins to it, and all budget, statement and goal data. This can't be undone." : "Removes your login. The household's budget stays with the owner."}</p>
        <form id="df" class="row"><input type="${S.me.user.has_password ? "password" : "email"}" name="pw" placeholder="${S.me.user.has_password ? "Confirm with your password" : "Type your email to confirm"}" style="flex:1" required><button class="btn danger">${owner ? "Delete everything" : "Leave"}</button></form>` : ""}</div>
      <div class="card"><h3>Activity log</h3><p class="small muted">Sign-ins, changes to sensitive settings, imports and exports.</p>
        <div class="table-wrap"><table class="t"><tbody>${audit.map((a) => `<tr><td class="small">${esc(a.action)}${a.detail ? `<div class="muted">${esc(a.detail)}</div>` : ""}</td><td class="small muted">${esc(a.user_name || "")}</td><td class="small muted num">${esc(a.created_at)} UTC</td></tr>`).join("")}</tbody></table></div></div></div>`;
    $$("[data-consent]", box).forEach((cb) => (cb.onchange = async () => { try { await api("api/privacy/consent", { method: "POST", body: { purpose: cb.dataset.consent, granted: cb.checked } }); await refreshMe(); toast("Saved"); } catch (e) { cb.checked = !cb.checked; fail(e); } }));
    $("#rf")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("api/household", { method: "PATCH", body: { retention_months: +new FormData(e.target).get("r") } }); await refreshMe(); toast("Saved"); } catch (err) { fail(err); } });
    $("#exp").onclick = () => download("api/privacy/export").catch(fail);
    $("#df")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!confirm(owner ? "Delete the household and all its data permanently?" : "Leave this household?")) return;
      try { await api(owner ? "api/privacy/delete-household" : "api/privacy/leave", { method: "POST", body: { password: new FormData(e.target).get("pw") } }); S.me = false; toast("Done"); go("#/"); } catch (err) { fail(err); }
    });
  } else {
    box.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><h3>Change password</h3>
      ${demo ? `<p class="small muted">Not available in the demo.</p>` : `<form id="pf" style="display:grid;gap:12px">${S.me.user.has_password ? `<label class="field">Current password<input type="password" name="old" autocomplete="current-password" required></label>` : `<p class="small muted">You sign in with Microsoft. You can also set a password as a backup.</p>`}
      <label class="field">New password<input type="password" name="new" autocomplete="new-password" minlength="10" required></label><button class="btn primary" style="justify-self:start">${S.me.user.has_password ? "Change password" : "Set password"}</button></form>`}</div>
      <div class="card"><h3>Sessions</h3><p class="small muted">Signed in somewhere you don't recognise? Sign out everywhere, then change your password.</p><button class="btn" id="all">Sign out everywhere</button></div>
      ${demo ? "" : `<div class="card" id="pk-card" style="grid-column:1/-1"><h3>Face ID &amp; passkeys</h3><p class="muted small">Loading…</p></div>`}</div>`;
    if (!demo) renderPasskeyCard($("#pk-card"));
    $("#pf")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("api/auth/password", { method: "POST", body: { old: f.get("old"), new: f.get("new") } }); S.me = false; toast("Password changed. Please sign in again."); go("#/signin"); } catch (err) { fail(err); } });
    $("#all").onclick = async () => { await api("api/auth/logout-all", { method: "POST", body: {} }).catch(() => {}); S.me = false; go("#/signin"); };
  }
}


// ---------------------------------------------------------------- iPhone / PWA
const MOBILE_TABS = ["overview", "budget", "forecast", "goals"];
const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

function moreSheet(current) {
  const items = Object.keys(PAGES).filter((k) => !MOBILE_TABS.includes(k));
  const box = modal(`<h2>More</h2><nav class="sheet-list">
    ${items.map((k) => `<a href="#/${k}" class="${k === current ? "on" : ""}">${icon(PAGES[k].icon)}<span>${PAGES[k].title}</span></a>`).join("")}
    ${S.config.private_mode ? `<a href="/">${icon("house")}<span>whoisveyansiz.com</span></a>` : ""}
    <button type="button" id="sheet-out">${icon("shield")}<span>Sign out</span></button></nav>`);
  $$("a[href^='#/']", box).forEach((a) => a.addEventListener("click", closeOverlays));
  $("#sheet-out", box).onclick = async () => { await api("api/auth/logout", { method: "POST", body: {} }).catch(() => {}); S.me = false; go("#/"); };
}

function offlineScreen() {
  $("#root").innerHTML = `<div class="public"><div class="auth-wrap"><div class="card auth" style="text-align:center">
    <span class="chip">Offline</span><h1 style="margin-top:14px">No connection</h1>
    <p class="muted">Your budget lives safely on the server, so it needs the internet. It'll load as soon as you're back online.</p>
    <button class="btn primary" id="retry" style="justify-content:center;width:100%;margin-top:18px">Try again</button></div></div></div>`;
  $("#retry").onclick = () => { S.me = null; route(); };
}

function installHint() {
  const iOS = /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  let dismissed = false;
  try { dismissed = localStorage.getItem("installHintDismissed") === "1"; } catch { /* storage unavailable */ }
  if (!iOS || standalone() || dismissed || $(".install-hint")) return;
  const el = Object.assign(document.createElement("div"), { className: "install-hint", role: "note" });
  el.innerHTML = `<img src="icons/icon-180.png" alt=""><div><b>Add to your Home Screen</b><br>Tap ${icon("share")} Share, then “Add to Home Screen”.</div><button aria-label="Dismiss">×</button>`;
  el.querySelector("button").onclick = () => { el.remove(); try { localStorage.setItem("installHintDismissed", "1"); } catch { /* ignore */ } };
  document.body.appendChild(el);
}

if (standalone()) document.documentElement.classList.add("standalone");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* app still works without it */ });
addEventListener("online", () => { S.me = S.me || null; route(); });
// Reopening the app from the Home Screen: refresh the numbers (and the sign-in check) if it's been a while.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 2 * 60 * 1000 && !$(".modal, .drawer")) { S.me = null; route(); }
});

route().then(() => setTimeout(installHint, 1500));


async function renderPasskeyCard(card) {
  const r = await api("api/passkeys");
  card.innerHTML = `<div class="card-head"><h3>Face ID &amp; passkeys</h3>${hasPasskeys() ? `<button class="btn sm primary" id="pk-add">${icon("face")} Add this device</button>` : ""}</div>
    <p class="muted small">Sign in with Face ID, Touch ID or your device PIN. Each device keeps its own passkey (Apple devices share theirs through iCloud Keychain). To add a new phone, sign in on it with your password and a recovery code, and it offers Face ID there.</p>
    ${r.passkeys.length ? `<table class="t"><tbody>${r.passkeys.map((k) => `<tr><td>${esc(k.name)}<div class="small muted">Added ${esc(k.created_at.slice(0, 10))}${k.last_used_at ? ` · last used ${esc(k.last_used_at.slice(0, 10))}` : ""}</div></td>
      <td class="num"><button class="link small" data-pk-del="${k.id}">Remove</button></td></tr>`).join("")}</tbody></table>` : `<p class="small warn">No passkeys yet.</p>`}
    <div class="row" style="justify-content:space-between;margin-top:16px"><span class="small muted">${r.recovery_left} of 10 recovery codes left</span>
      <button class="btn sm" id="rc-new">New recovery codes</button></div><div id="rc-out"></div>`;
  $("#pk-add", card)?.addEventListener("click", async () => {
    try { await passkeyRegister(deviceName()); toast("Passkey added"); renderPasskeyCard(card); } catch (e) { toast(passkeyError(e)); }
  });
  $$("[data-pk-del]", card).forEach((b) => (b.onclick = async () => {
    if (!confirm("Remove this passkey? That device will no longer sign in with Face ID.")) return;
    try { await api(`api/passkeys/${b.dataset.pkDel}`, { method: "DELETE" }); renderPasskeyCard(card); } catch (e) { fail(e); }
  }));
  $("#rc-new", card).onclick = async () => {
    if (!confirm("Make new recovery codes? Your old ones will stop working.")) return;
    try {
      const x = await api("api/passkeys/recovery-codes", { method: "POST", body: {} });
      $("#rc-out", card).innerHTML = `<p class="small" style="margin-top:12px"><b>Save these now.</b> They won't be shown again.</p>${recoveryCodesHtml(x.recovery_codes)}`;
      bindRecoveryCodes($("#rc-out", card), x.recovery_codes);
    } catch (e) { fail(e); }
  };
}
