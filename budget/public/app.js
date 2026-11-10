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
// A message at the bottom; with an action ("Undo") it stays long enough to tap it.
function toast(msg, kind = "ok", { action, onAction } = {}) {
  $$(".toast").forEach((t) => t.remove());
  const t = Object.assign(document.createElement("div"), { className: `toast ${kind}`,
    innerHTML: `${icon(kind === "err" ? "alert" : "check")}<span></span>${action ? `<button type="button" class="toast-act"></button>` : ""}` });
  t.setAttribute("role", kind === "err" ? "alert" : "status");
  $("span", t).textContent = msg;
  if (action) {
    const b = $("button", t);
    b.textContent = action;
    b.onclick = async () => { b.disabled = true; try { await onAction(); } finally { t.remove(); } };
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), action ? 8000 : kind === "err" ? 5200 : 3200);
}
function fail(e) { toast(e.message || String(e), "err"); }
// Small deletes and category choices happen at once; the toast's "Undo" puts them back.
function undoable(msg, token, after = route) {
  toast(msg, "ok", { action: "Undo", onAction: async () => {
    try { await api("api/undo", { method: "POST", body: { token } }); toast("Put back"); await after(); } catch (e) { fail(e); }
  } });
}

// Shows a spinner on a button while its request runs, and stops double taps.
async function busy(btn, work) {
  if (!btn || btn.classList.contains("loading")) return;
  btn.classList.add("loading"); btn.disabled = true;
  try { return await work(); }
  finally { btn.classList.remove("loading"); btn.disabled = false; }
}

// Placeholder blocks shown while a page's data loads.
const skeleton = (cards = 2) => `<div class="skel" aria-busy="true" aria-label="Loading">
  <div class="kpis">${`<div class="card kpi"><i class="sk w40"></i><i class="sk big"></i><i class="sk w60"></i></div>`.repeat(3)}</div>
  ${`<div class="card"><i class="sk w30"></i><i class="sk"></i><i class="sk w80"></i><i class="sk w60"></i></div>`.repeat(cards)}</div>`;

// ---------------------------------------------------------------- appearance
// "auto" follows the device; "light" and "dark" are this browser's own choice.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private window */ } },
};
const theme = () => (["light", "dark"].includes(store.get("theme")) ? store.get("theme") : "auto");
function applyTheme(t = theme()) {
  const root = document.documentElement;
  if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t;
  // The browser bar follows the page: both tags get the chosen colour, or their own again on "auto".
  $$('meta[name="theme-color"]').forEach((m) => {
    m.dataset.auto = m.dataset.auto || m.content;
    m.content = t === "auto" ? m.dataset.auto : t === "dark" ? "#171310" : "#f6f1ea";
  });
}
function setTheme(t) { store.set("theme", t === "auto" ? null : t); applyTheme(t); S.fx?.recolor?.(); }
applyTheme();
const themeSeg = () => `<div class="seg theme-seg" role="group" aria-label="Appearance">${[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]
  .map(([k, l]) => `<button type="button" data-theme-set="${k}" class="${theme() === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
function bindThemeSeg(box) {
  $$("[data-theme-set]", box).forEach((b) => (b.onclick = () => {
    setTheme(b.dataset.themeSet);
    $$("[data-theme-set]", box).forEach((x) => x.classList.toggle("on", x === b));
  }));
}

async function signOut(all = false) {
  await api(all ? "api/auth/logout-all" : "api/auth/logout", { method: "POST", body: {} }).catch(() => {});
  S.me = false; go(all ? "#/signin" : "#/");
}

// The last person who signed in on this device, so the sign-in page can greet them by name.
const lastUser = () => { try { const u = JSON.parse(store.get("lastUser")); return u?.email ? u : null; } catch { return null; } };
function rememberUser() {
  const u = S.me?.user;
  if (!u?.id || !u.email || S.me.household?.is_demo) return;
  store.set("lastUser", JSON.stringify({ name: String(u.name || "").trim().split(/\s+/)[0], email: u.email }));
}

// "3 minutes ago" from the server's UTC timestamps.
function ago(utc) {
  const mins = Math.round((Date.now() - Date.parse(utc.replace(" ", "T") + "Z")) / 60000);
  if (!(mins >= 2)) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// Password strength, in step with the server's rule (10+ characters, not all the same few).
const pwMeter = () => `<span class="pw-meter" data-score="0"><span class="pw-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="pw-label" aria-live="polite"></span></span>`;
function pwScore(p) {
  if (!p) return [0, ""];
  if (p.length < 10) return [1, `${10 - p.length} more character${p.length === 9 ? "" : "s"}`];
  const uniq = new Set(p).size;
  if (uniq < 5) return [1, "Too repetitive"];
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const n = 2 + (p.length >= 14 || kinds >= 3) + (p.length >= 16 && uniq >= 9 && kinds >= 2);
  return [n, ["", "", "Fair", "Good", "Strong"][n]];
}
function bindPwMeters(box) {
  $$(".pw-meter", box).forEach((m) => {
    const input = $("input", m.closest("label"));
    input.addEventListener("input", () => {
      const [n, label] = pwScore(input.value);
      m.dataset.score = n; $(".pw-label", m).textContent = label;
    });
  });
}

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
function closeOverlays() {
  $$(".scrim:not(.ask-scrim), .modal:not(.ask), .drawer, .menu").forEach((e) => e.remove());
  const after = S.onClose; S.onClose = null; after?.();
}
addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlays(); });

// An in-app "are you sure?": resolves true or false. It sits above an open drawer or modal and leaves it
// in place, so saying no returns to where you were.
function ask(title, { body = "", yes = "Confirm", no = "Cancel", danger = false } = {}) {
  S.askDone?.(false);
  return new Promise((resolve) => {
    const scrim = Object.assign(document.createElement("div"), { className: "scrim ask-scrim" });
    const box = Object.assign(document.createElement("div"), { className: "modal ask", innerHTML: `
      <h2 id="ask-t">${esc(title)}</h2>${body ? `<p class="muted">${esc(body)}</p>` : ""}
      <div class="row ask-btns"><button type="button" class="btn" data-a="no">${esc(no)}</button>
        <button type="button" class="btn ${danger ? "danger solid" : "primary"}" data-a="yes">${esc(yes)}</button></div>` });
    box.setAttribute("role", "alertdialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "ask-t");
    const back = document.activeElement;
    const done = (v) => {
      S.askDone = null; removeEventListener("keydown", key, true);
      scrim.remove(); box.remove(); back?.focus?.(); resolve(v);
    };
    const key = (e) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); done(false); }
      // Keep Tab inside the two buttons.
      if (e.key === "Tab") { e.preventDefault(); $(`[data-a=${document.activeElement?.dataset.a === "yes" ? "no" : "yes"}]`, box).focus(); }
    };
    addEventListener("keydown", key, true);
    S.askDone = done;
    scrim.onclick = () => done(false);
    $("[data-a=no]", box).onclick = () => done(false);
    $("[data-a=yes]", box).onclick = () => done(true);
    document.body.append(scrim, box);
    $(`[data-a=${danger ? "no" : "yes"}]`, box).focus();
  });
}

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
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.2"/>',
  out: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19.5h20"/>',
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
  closeOverlays(); hideTip(); S.askDone?.(false);
  S.fx?.dispose(); S.fx = null;
  S.pkWait?.abort(); S.pkWait = null;
  const [path, query] = location.hash.slice(1).split("?");
  const parts = path.split("/").filter(Boolean);
  if (!S.config) { S.config = await api("api/config").catch(() => ({ demo: false, plans: {}, private_mode: true })); APP = S.config.app_name || APP; }
  if (S.me === null) {
    try { S.me = await api("api/me"); S.month = S.month || S.me.this_month; rememberUser(); }
    catch (e) { if (e.offline) return offlineScreen(); S.me = false; }
  }
  const priv = S.config.private_mode;
  const pub = { "": priv ? privateSignin : landing, signin: priv ? privateSignin : signin, signup: priv ? privateSignin : signup, privacy: privacyPage, join: signup };
  const key = parts[0] || "";
  if (!S.me || (key in pub && key !== "")) {
    if (!S.me && key in PAGES) return go("#/signin");
    document.title = APP;
    const page = (pub[key] || pub[""])(parts, new URLSearchParams(query || ""));
    authBackdrop();
    return page;
  }
  if (S.me.passkeys?.required && S.me.user.id && !S.me.passkeys.count) { passkeySetup(); return authBackdrop(); }
  if (S.addDevice) { S.addDevice = false; passkeySetup(true); return authBackdrop(); }
  const name = key in PAGES ? key : "overview";
  document.title = `${PAGES[name].title} · ${APP}`;
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
    ${hasPasskeys() ? `<button class="btn primary" id="pk-login" style="justify-content:center;width:100%;margin-top:22px">${icon("face")} Sign in with ${BIO}</button>
      <div class="error" id="pk-err" style="margin-top:8px;text-align:center"></div>
      ${S.config.password_login ? `<p class="small muted" style="text-align:center;margin:4px 0 0">New phone or computer? Sign in below with your password and a recovery code, then add ${BIO} on it.</p>` : ""}` : ""}
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
    $("#err").textContent = "";
    await busy($("button:not([type=button])", e.target), async () => {
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
  });
  $("#pk-login")?.addEventListener("click", (e) => faceIdSignIn(e.currentTarget, $("#pk-err"),
    `${Bio} was cancelled, or this device has no passkey for this site yet. On a new device, use your password and a recovery code.`));
  prefetchPasskey();
  passkeyAutofill($("#pk-err"));
}

// ---------------------------------------------------------------- private sign-in
// One card, email first: the server says what this person needs next (Face ID, their password, or
// setting up the account), so the card only ever shows that one step.
function privateSignin(parts, q) {
  $("#root").innerHTML = `<div class="public">${pubNav()}<div class="auth-wrap"><div class="card auth" id="auth"></div></div></div>`;
  authStep("start", { error: q?.get("error") || "" });
}

const pwField = (ac) => `<label class="field">Password<span class="pw">
  <input type="password" name="password" autocomplete="${ac}" required${ac === "new-password" ? ` minlength="10" placeholder="At least 10 characters"` : ""}>
  <button type="button" class="pw-toggle" aria-label="Show password">Show</button></span>${ac === "new-password" ? pwMeter() : ""}</label>`;

function authStep(step, ctx = {}) {
  const box = $("#auth");
  if (!box) return;
  S.pkWait?.abort(); S.pkWait = null;
  const { email = "", name = "" } = ctx;
  const back = step === "start" && !email && !ctx.other ? lastUser() : null;
  const hi = `<h1>Hi ${esc(name || "there")}</h1>`;
  const who = `<button type="button" class="who" id="who" aria-label="Use a different email">
    <span class="avatar" aria-hidden="true">${esc((name || email || "?")[0].toUpperCase())}</span><span class="who-email">${esc(email)}</span><span class="who-change">Change</span></button>`;
  // Lets password managers file the password under the right email.
  const user = `<input class="sr" type="email" name="username" autocomplete="username" value="${esc(email)}" tabindex="-1" aria-hidden="true" readonly>`;
  const face = (label) => hasPasskeys() ? `<button type="button" class="btn primary xl" id="pk">${icon("face")} ${label}</button>` : "";
  const views = {
    start: () => back ? `
      <span class="avatar lg" aria-hidden="true">${esc((back.name || back.email)[0].toUpperCase())}</span>
      <h1>Welcome back${back.name ? `, ${esc(back.name)}` : ""}</h1>
      <p class="muted lead who-email">${esc(back.email)}</p>
      ${face(`Sign in with ${BIO}`)}
      <form id="f"><input type="hidden" name="email" value="${esc(back.email)}">
        <button class="btn xl${hasPasskeys() ? "" : " primary"}">Use my password</button></form>
      <div class="error" id="err" role="alert">${esc(ctx.error || "")}</div>
      <p class="foot"><button type="button" class="link" id="other">Not ${esc(back.name || "you")}? Use a different account</button></p>` : `
      <span class="chip">Private</span>
      <h1>Sign in</h1>
      <p class="muted lead">Your household budget, for invited people only.</p>
      ${face(`Sign in with ${BIO}`)}
      ${hasPasskeys() ? `<div class="or"><span>or continue with email</span></div>` : ""}
      <form id="f" class="inline-form" novalidate>
        <label class="sr" for="email">Email</label>
        <input id="email" type="email" name="email" value="${esc(email)}" placeholder="Email address" autocomplete="username webauthn"
          inputmode="email" autocapitalize="off" spellcheck="false" required>
        <button class="btn icon-btn" aria-label="Continue">${icon("arrow")}</button>
      </form>
      ${S.config.microsoft ? `<a class="btn xl ms" href="api/auth/microsoft/start">Continue with Microsoft</a>` : ""}`,
    passkey: () => `${who}${hi}
      <p class="muted lead">${hasPasskeys() ? `Sign in with ${BIO}.` : "This browser can't use passkeys. Use your password and a recovery code."}</p>
      ${face(`Use ${BIO}`)}
      <div class="error" id="err" role="alert">${esc(ctx.error || "")}</div>
      <details class="alt"${hasPasskeys() && !ctx.open ? "" : " open"}><summary>New phone or computer?</summary>
        <p class="small muted">Use your password and one recovery code, once. Then add ${BIO} on this device.</p>
        <form id="f">${user}${pwField("current-password")}
          <label class="field">Recovery code<input type="text" name="recovery" autocomplete="one-time-code" placeholder="XXXXX-XXXXX" spellcheck="false" autocapitalize="characters" required></label>
          <button class="btn xl">Sign in</button><div class="error" role="alert"></div></form>
      </details>`,
    password: () => `${who}${hi}
      <p class="muted lead">Enter your password${S.config.require_passkey ? `, then add ${BIO}` : ""}.</p>
      <form id="f">${user}${pwField("current-password")}<button class="btn primary xl">Sign in</button></form>`,
    new: () => `${who}
      <h1>Create your account</h1>
      <p class="muted lead">You're on the invite list. Next you'll add ${BIO}.</p>
      <form id="f">${user}
        <label class="field">Your name<input type="text" name="name" autocomplete="given-name" maxlength="60" required></label>
        <label class="field">Setup phrase<input type="text" name="setup_code" autocomplete="off" placeholder="From the owner" spellcheck="false" autocapitalize="off" autocorrect="off" required>
          <span class="hint">Capitals and spaces don't matter.</span></label>
        ${pwField("new-password")}
        <label class="check"><input type="checkbox" name="service" required> <span>I agree to the <a href="#/privacy" target="_blank">privacy notice</a>.</span></label>
        <button class="btn primary xl">Create account</button></form>`,
    microsoft: () => `${who}${hi}
      <p class="muted lead">This account signs in with Microsoft.</p>
      <a class="btn primary xl" href="api/auth/microsoft/start">Continue with Microsoft</a>`,
  };
  const body = views[step]();
  box.innerHTML = `<div class="step">${body}
    ${body.includes('id="err"') ? "" : `<div class="error" id="err" role="alert">${esc(ctx.error || "")}</div>`}
    ${step === "start" && S.config.demo ? `<p class="foot"><button class="link" id="try-demo">Explore the demo</button></p>` : ""}</div>`;

  const err = $("#err", box), form = $("#f", box);
  const say = (m) => { ($(".error", form) || err).textContent = m; };
  $("#who", box)?.addEventListener("click", () => authStep("start", { email, other: true }));
  $("#other", box)?.addEventListener("click", () => { store.set("lastUser", null); authStep("start", { other: true }); });
  bindPwMeters(box);
  $("#try-demo", box)?.addEventListener("click", startDemo);
  box.querySelectorAll(".pw-toggle").forEach((b) => b.addEventListener("click", () => {
    const i = b.previousElementSibling, show = i.type === "password";
    i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-label", show ? "Hide password" : "Show password");
  }));
  $("#pk", box)?.addEventListener("click", (e) => faceIdSignIn(e.currentTarget, err, step === "start"
    ? back ? "No passkey for this site on this device yet? Use your password." : "No passkey for this site on this device yet? Continue with your email."
    : `${Bio} didn't go through. Try again, or use \u201cNew phone or computer?\u201d`));
  if (hasPasskeys() && (step === "start" || step === "passkey")) prefetchPasskey();
  if ($("#email", box)) passkeyAutofill(err);
  // Phones: open the keyboard only where typing is the next thing to do.
  if (step === "password" || step === "new") $("input:not(.sr)", form)?.focus();

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    const f = new FormData(form), btn = $("button:not([type=button])", form);
    btn.disabled = true; btn.classList.add("loading"); say("");
    try {
      if (step === "start") {
        const to = String(f.get("email")).trim();
        const r = await api("api/auth/lookup", { method: "POST", body: { email: to } });
        if (r.next === "not_invited") throw new Error("That email isn't on the invite list. Check for a typo, or ask the owner to add it.");
        // "Use my password" on an account with a passkey: open the password + recovery code form.
        return authStep(r.next, { email: to, name: r.name, open: !!back });
      }
      if (step === "new") {
        await api("api/auth/signup", { method: "POST", body: { name: f.get("name"), email, password: f.get("password"), setup_code: f.get("setup_code"),
          consents: { service: !!f.get("service"), product_updates: false } } });
      } else {
        await api("api/auth/login", { method: "POST", body: { email, password: f.get("password"), recovery_code: f.get("recovery") || null } });
        S.addDevice = step === "passkey" && hasPasskeys();  // signed in without Face ID: offer it on this device
      }
      S.me = null; go("#/overview");
    } catch (x) {
      // The account got Face ID since the email check: switch to that step.
      if (x.data?.need_recovery_code && step === "password") return authStep("passkey", { email, name, error: x.message });
      say(x.message); btn.disabled = false; btn.classList.remove("loading");
    }
  });
}

// Login options are fetched before the tap, so the Face ID prompt opens straight from it: Safari can
// refuse a prompt that starts too long after the tap, and it saves a round trip.
let pkNext = null;
function prefetchPasskey() {
  const p = api("api/auth/passkey/options", { method: "POST", body: {} }).then((o) => ({ o, at: Date.now() }));
  p.catch(() => {});
  pkNext = p;
}
async function loginOptions() {
  const p = pkNext; pkNext = null;
  const got = p && (await p.catch(() => null));
  if (got && Date.now() - got.at < 4 * 60_000) return got.o;  // the server keeps challenges for 5 minutes
  return api("api/auth/passkey/options", { method: "POST", body: {} });
}

async function faceIdSignIn(btn, err, notAllowed) {
  btn.disabled = true; btn.classList.add("loading"); err.textContent = "";
  // One passkey request at a time: stop the email field's autofill request and let it finish first.
  S.pkWait?.abort(); S.pkWait = null;
  await pkSettled;
  try { await passkeySignIn(); S.me = null; go("#/overview"); }
  catch (e) { err.textContent = passkeyError(e, notAllowed); btn.disabled = false; btn.classList.remove("loading"); prefetchPasskey(); }
}

// Offers this device's passkeys in the email field's suggestions (Safari's QuickType bar, Chrome's
// autofill). A device without one shows nothing, so this never leads to a QR code.
let pkSettled = Promise.resolve();  // the last autofill request, settled (it never rejects)
async function passkeyAutofill(err) {
  if (!hasPasskeys() || !(await PublicKeyCredential.isConditionalMediationAvailable?.().catch(() => false))) return;
  await pkSettled;  // a request that was just stopped has to finish before the next one starts
  if (!err.isConnected || S.pkWait) return;  // left the page, or already waiting
  const ctrl = new AbortController();
  const done = passkeySignIn({ mediation: "conditional", signal: ctrl.signal })
    .then(() => { S.me = null; go("#/overview"); })
    // The browser's own refusals (no passkey picked, request replaced) stay silent; only our server's answer is shown.
    .catch((e) => { if (!ctrl.signal.aborted && !(e instanceof DOMException) && err.isConnected) err.textContent = passkeyError(e); })
    .finally(() => { if (S.pkWait?.done === done) S.pkWait = null; });
  S.pkWait = { abort: () => ctrl.abort(), done };
  pkSettled = done;
}

function signup(parts) {
  const invite = parts[0] === "join" ? parts[1] : null;
  $("#root").innerHTML = `<div class="public">${pubNav()}<div class="auth-wrap"><div class="card auth">
    <h1>${invite ? "Join your household" : S.config.private_mode ? "Set up your account" : "Start your free trial"}</h1>
    <p class="muted">${invite ? "Your partner invited you to share a budget." : S.config.private_mode ? `Only emails on the invite list can set up an account. Next you'll add ${BIO}.` : "30 days free. Setting up takes two minutes."}</p>
    <form id="f">
      <label class="field">Your name <input type="text" name="name" autocomplete="given-name" required maxlength="60"></label>
      ${invite || S.config.private_mode ? "" : `<label class="field">Partner's name <span class="muted" style="font-weight:400">(optional, adds them to the budget)</span><input type="text" name="partner" maxlength="40"></label>`}
      <label class="field">Email <input type="email" name="email" autocomplete="email" required></label>
      ${S.config.private_mode && !invite ? `<label class="field">Setup phrase <span class="muted" style="font-weight:400">(from the owner)</span><input type="text" name="setup_code" autocomplete="one-time-code" spellcheck="false" required></label>` : ""}
      <label class="field">Password <input type="password" name="password" autocomplete="new-password" minlength="10" placeholder="At least 10 characters" required>${pwMeter()}</label>
      <div class="consents">
        <label class="check"><input type="checkbox" name="service" required> <span>I've read the <a href="#/privacy" target="_blank">privacy notice</a> and agree to ${APP} processing my household's budget information to provide the service.</span></label>
        <label class="check"><input type="checkbox" name="updates"> <span>Optional: email me product updates.</span></label>
      </div>
      <div class="error" id="err"></div>
      <button class="btn primary" style="justify-content:center">${invite ? "Join household" : S.config.private_mode ? "Continue" : "Create account"}</button>
      <p class="small muted" style="text-align:center">Already have an account? <a href="#/signin">Sign in</a></p>
    </form></div></div></div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $("#err").textContent = "";
    await busy($("button:not([type=button])", e.target), async () => {
      try {
        await api("api/auth/signup", { method: "POST", body: {
          name: f.get("name"), partner_name: f.get("partner") || null, email: f.get("email"), password: f.get("password"), invite, setup_code: f.get("setup_code") || null,
          consents: { service: !!f.get("service"), product_updates: !!f.get("updates") },
        } });
        S.me = null; go("#/overview");
      } catch (err) { $("#err").textContent = err.message; }
    });
  };
  bindPwMeters($("#f"));
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
// What this device calls its passkey prompt, for buttons and messages ("Sign in with Touch ID").
const APPLE = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
const BIO = (() => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  if (/Windows/.test(ua)) return "Windows Hello";
  return "a passkey";
})();
const Bio = BIO[0].toUpperCase() + BIO.slice(1);
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android phone";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
function passkeyError(e, notAllowed = `${Bio} was cancelled or timed out.`) {
  if (e?.name === "NotAllowedError") return notAllowed;
  if (e?.name === "InvalidStateError") return "This device already has a passkey for this account.";
  if (e?.name === "SecurityError") return "Passkeys only work on the real website address (https).";
  return e?.message || `Something went wrong with ${BIO}.`;
}

async function passkeySignIn({ mediation, signal } = {}) {
  const o = mediation ? await api("api/auth/passkey/options", { method: "POST", body: {} }) : await loginOptions();
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
    <div class="step"><span class="chip">${again ? "New device" : "Last step"}</span>
    <h1>${again ? `Add ${BIO} here` : `Add ${BIO}`}</h1>
    <p class="muted lead">${again
      ? `Next time, this device signs you in with ${BIO}. No code needed.`
      : `Sign in with ${BIO} from now on, so a stolen password isn't enough. It's saved on this device${APPLE ? " (and your other Apple devices through iCloud Keychain)" : ""}.`}</p>
    ${ok ? `<label class="field">Device name<input type="text" id="pk-name" value="${esc(deviceName())}" maxlength="40"></label>
      <button class="btn primary xl" id="add-pk" style="margin-top:14px">${icon("face")} Add ${BIO}</button>
      <div class="error" id="err" role="alert"></div>`
      : `<div class="banner warn" style="margin-top:18px">This browser doesn't support passkeys. Open this page in Safari on your iPhone or Mac, or a recent Chrome or Edge.</div>`}
    <p class="foot">${again ? `<button class="link" id="skip">Not now</button>` : `<button class="link" id="out">Sign out</button>`}</p></div>
  </div></div></div>`;
  $("#skip")?.addEventListener("click", () => go("#/overview"));
  $("#out")?.addEventListener("click", () => signOut());
  $("#add-pk")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.classList.add("loading");
    try {
      const r = await passkeyRegister($("#pk-name").value);
      await refreshMe();
      if (!r.recovery_codes) { toast(`${Bio} added on this device`); return go("#/overview"); }
      $("#setup").innerHTML = `<div class="step"><span class="chip good">${Bio} added</span>
        <h1>Save your recovery codes</h1>
        <p class="muted lead">On a new phone or computer, you sign in once with your password and one of these. Each works once. Keep them in your password manager.</p>
        ${recoveryCodesHtml(r.recovery_codes || [])}
        <button class="btn primary xl" id="done" style="margin-top:22px">I've saved them</button></div>`;
      bindRecoveryCodes($("#setup"), r.recovery_codes || []);
      $("#done").onclick = () => go("#/overview");
    } catch (err) { $("#err").textContent = passkeyError(err); e.target.disabled = false; e.target.classList.remove("loading"); }
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
      <div class="acct"><button type="button" class="acct-btn" id="acct" aria-haspopup="menu" aria-expanded="false">
        ${avatar()}<span class="acct-text"><strong>${esc(S.me.user.name)}</strong><span class="muted">${esc(S.me.household.name)} · ${planLabel(b)}</span></span>
        <span class="acct-caret" aria-hidden="true"></span></button></div>
    </aside>
    <div class="main">
      <div class="topbar" id="topbar"><h1>${p.title}</h1>
        <button type="button" class="btn sm up-btn" id="upload" aria-label="Upload statements">${icon("upload")}<span>Upload</span></button>
        ${p.person && people.length > 1 ? `<div class="seg" role="tablist" aria-label="Whose budget">
          <button class="${S.member === "all" ? "on" : ""}" data-m="all"><span class="dot hh"></span>Household</button>
          ${people.map((m) => `<button class="${String(S.member) === String(m.id) ? "on" : ""}" data-m="${m.id}"><span class="dot ${pclass(m.id)}"></span>${esc(m.name)}</button>`).join("")}
        </div>` : ""}
        ${p.month ? `<div class="stepper"><button id="prev" aria-label="Previous month">‹</button><span>${monthName(S.month)}</span><button id="next" aria-label="Next month">›</button></div>` : ""}
      </div>
      <div class="content" id="content">${skeleton()}</div>
      <footer class="app-foot">${esc(APP)} gives general budgeting information based on what you enter. It isn't financial advice and doesn't recommend specific financial products. For advice on investments, insurance or debt, speak to a registered financial adviser or an NCR-registered debt counsellor.</footer>
    </div>
    <nav class="mob-nav" aria-label="Main">${MOBILE_TABS.map((k) => `<a href="#/${k}" class="${k === name ? "on" : ""}">${icon(PAGES[k].icon)}<span>${PAGES[k].short || PAGES[k].title}</span></a>`).join("")}
      <button type="button" id="more" class="${MOBILE_TABS.includes(name) ? "" : "on"}">${icon("more")}<span>More</span></button></nav>
  </div>`;
  $$("[data-m]").forEach((btn) => (btn.onclick = () => { S.member = btn.dataset.m; route(); }));
  $("#prev")?.addEventListener("click", () => { S.month = addMonths(S.month, -1); route(); });
  $("#next")?.addEventListener("click", () => { S.month = addMonths(S.month, 1); route(); });
  $("#more").onclick = () => moreSheet(name);
  $("#upload").onclick = openUpload;
  $("#acct").onclick = (e) => accountMenu(e.currentTarget);
  const tb = $("#topbar");
  onscroll = () => tb.classList.toggle("scrolled", scrollY > 4);
}
const planTone = (b) => (b.status === "active" ? "good" : b.can_write ? "" : "warn");
const avatar = (cls = "") => `<span class="avatar ${cls}" aria-hidden="true">${esc((S.me.user.name || "?")[0].toUpperCase())}</span>`;

// The account popover above the sidebar's account button.
function accountMenu(btn) {
  const open = $(".menu");
  btn.setAttribute("aria-expanded", String(!open));
  if (open) return open.remove();
  const u = S.me.user, m = document.createElement("div");
  m.className = "menu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "Account");
  m.innerHTML = `<div class="menu-head">${avatar("lg")}<div><strong>${esc(u.name)}</strong><span class="muted small">${esc(u.email || S.me.household.name)}</span></div>
      <span class="chip ${planTone(S.me.billing)}">${planLabel(S.me.billing)}</span></div>
    <div class="menu-row"><span class="small muted">Appearance</span>${themeSeg()}</div>
    <a role="menuitem" href="#/settings?tab=security">${icon("shield")}<span>Security &amp; sign-in</span></a>
    <a role="menuitem" href="#/settings">${icon("gear")}<span>Settings</span></a>
    <button type="button" role="menuitem" id="menu-out">${icon("out")}<span>Sign out</span></button>`;
  btn.parentElement.appendChild(m);
  bindThemeSeg(m);
  $("#menu-out", m).onclick = () => signOut();
  const close = (e) => {
    if (m.isConnected) {
      if (e.type === "keydown" ? e.key !== "Escape" : m.contains(e.target) || btn.contains(e.target)) return;
      m.remove(); btn.setAttribute("aria-expanded", "false");
      if (e.type === "keydown") btn.focus();
    }
    removeEventListener("pointerdown", close, true); removeEventListener("keydown", close, true);
  };
  addEventListener("pointerdown", close, true); addEventListener("keydown", close, true);
  $("a", m).focus({ preventScroll: true });
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
  const hasActuals = S.me.statement_months.includes(S.month);
  const [v, f, g, a] = await Promise.all([
    api(`api/budget?month=${S.month}${memberQ()}`), api(`api/forecast?month=${S.month}${memberQ()}`), api(`api/goals?month=${S.month}`),
    hasActuals ? api(`api/actuals?month=${S.month}${memberQ()}`) : null,
  ]);
  if (!v.lines.length) return emptyBudget(el);
  const hh = v.household;
  const single = S.member !== "all";
  const moneyIn = single ? v.people[0].money_in_cents : hh.income_cents;
  const out = single ? v.people[0].money_out_cents : hh.expense_cents + hh.saving_cents;
  const left = hh.surplus_cents;
  const pr = v.progress;
  el.innerHTML = `${billingBanner()}${reviewBanner()}
    <div class="kpis">
      <div class="card kpi drill" role="button" tabindex="0" data-drill="kpi:in"><div class="label">Money in</div><div class="value">${zar(moneyIn)}</div><div class="sub">${single ? "Salary and transfers received" : "All salaries and income"}</div></div>
      <div class="card kpi drill" role="button" tabindex="0" data-drill="kpi:out"><div class="label">Going out</div><div class="value">${zar(out)}</div>
        <div class="meter" style="margin:8px 0 6px" title="Paid so far"><i style="width:${pct(pr.paid_cents, pr.total_cents)}%"></i></div>
        <div class="sub">${zar(pr.paid_cents)} paid · ${pr.paid} of ${pr.total} items</div></div>
      <div class="card kpi"><div class="label">Left over</div><div class="value ${left < 0 ? "warn" : ""}">${zar(left)}</div>
        <div class="sub">Next month: ${zar(f.next.household.surplus_cents)}</div></div>
    </div>
    ${a?.has_data ? actualsCard(a) : ""}
    ${jarsCard(v)}
    ${!single && v.people.length > 1 ? `<div class="people" style="margin-bottom:18px">${v.people.map((p) => `
      <div class="card person ${pclass(p.id)}"><div class="card-head"><h3><span class="dot ${pclass(p.id)}"></span> ${esc(p.name)}</h3>
        <span class="chip ${p.surplus_cents < 0 ? "warn" : "good"}">${p.surplus_cents < 0 ? "Short" : "Left"} ${zar(Math.abs(p.surplus_cents))}</span></div>
        <div class="meter ${pclass(p.id)}" title="Share of money in that's going out"><i style="width:${Math.min(100, pct(p.money_out_cents, p.money_in_cents))}%"></i></div>
        <div class="figs"><div>In<b>${zar(p.money_in_cents)}</b></div><div>Out<b>${zar(p.money_out_cents)}</b></div><div>Net transfers<b>${zar(p.transfer_in_cents - p.transfer_out_cents, { signed: true })}</b></div></div></div>`).join("")}</div>` : ""}
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>Insights</h3><a class="small" href="#/forecast">Next month →</a></div>
        <div class="insights">${insightList(f.insights.slice(0, 5))}</div></div>
      <div class="card"><div class="card-head"><h3>Where it goes</h3><span class="small muted">tap a bar for the items</span></div>
        ${groupMeters(v.by_group, moneyIn)}
        <div class="bars" style="margin-top:18px">${v.by_category.slice(0, 7).map((c) => barRow(c.category, c.planned_cents, v.by_category[0].planned_cents, null, "planned", `cat:${c.category}`)).join("")}</div></div>
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
  bindReview(el);
  // Tap a figure, a bar or a jar layer to see exactly what's behind it.
  bindDrill(el, (key) => {
    const [kind, ...rest] = key.split(":");
    const arg = rest.join(":");
    if (kind === "kpi" && arg === "in") return linesDrawer("Money in", v.lines.filter((l) => l.kind === "income"), v);
    if (kind === "kpi") return linesDrawer("Going out", v.lines.filter((l) => l.kind !== "income" && (single || l.kind !== "transfer")), v);
    if (kind === "cat") return linesDrawer(arg, v.lines.filter((l) => l.kind !== "income" && l.kind !== "transfer" && l.category === arg), v, { month: S.month, actuals: hasActuals });
    if (kind === "group") return linesDrawer(arg, v.lines.filter((l) => lineGroup(l) === arg), v);
    if (kind === "flow") return txnDrawer({ in: "Came in", spent: "Spent", moved: "Moved between your own accounts" }[arg], { month: S.month, flow: arg });
    if (kind === "jar") { const [id, layer] = arg.split("/"); const p = v.people.find((x) => x.id === +id); return linesDrawer(`${p?.name}: ${layer}`, v.lines.filter((l) => l.member_id === +id && lineGroup(l) === layer), v); }
  });
  mountJars(v, (d) => linesDrawer(`${d.person}: ${d.layer}`, v.lines.filter((l) => l.member_id === d.id && lineGroup(l) === d.layer), v));
}

// Which jar an item belongs in: the same split the 3D jars and "Where it goes" use.
function lineGroup(l) {
  if (l.kind === "transfer") return "Transfers";
  if (l.kind === "income") return null;
  return l.group === "Essentials" || l.group === "Lifestyle" || l.group === "Savings" ? l.group : l.kind === "saving" ? "Savings" : "Lifestyle";
}

// The budget items behind a figure. Tap one to open it; for a category with statements, the actual transactions are a tap away too.
function linesDrawer(title, lines, view, { month = S.month, actuals = false } = {}) {
  const total = lines.reduce((s, l) => s + l.amount_cents, 0);
  const box = drawer(`<div class="up-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost sm" data-close>Close</button></div>
    <div class="dd-total"><b>${zar(total)}</b><span class="small muted">${lines.length} item${lines.length === 1 ? "" : "s"} planned · ${esc(monthName(month))}</span></div>
    ${lines.length ? `<div class="dd-list">${lines.map((l) => `<button type="button" class="dd-row" data-id="${l.id}"><span class="dot ${pclass(l.member_id)}"></span>
      <span class="nm">${esc(l.name)}<small>${esc(l.member_name)}${l.to_member_name ? ` → ${esc(l.to_member_name)}` : l.category && l.category !== title ? ` · ${esc(l.category)}` : ""}${l.paid ? " · paid" : ""}</small></span>
      <b>${zar(l.amount_cents)}</b></button>`).join("")}</div>` : `<p class="muted">Nothing planned here this month.</p>`}
    ${actuals ? `<button type="button" class="btn sm dd-more" id="dd-actual">What actually went out on ${esc(title)} →</button>` : ""}`);
  $$(".dd-row", box).forEach((b) => (b.onclick = () => openLine(+b.dataset.id, view)));
  $("#dd-actual", box)?.addEventListener("click", () => txnDrawer(title, { month, flow: "spent", category: title }));
}

// The transactions a figure was summed from: the same filter the server used for the card, so the totals match.
async function txnDrawer(title, { month, flow, category }) {
  const box = drawer(`<div class="up-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost sm" data-close>Close</button></div><div id="dd">${skeleton(1)}</div>`);
  try {
    const rows = await api(`api/transactions?month=${month}&flow=${flow}${category ? `&category=${encodeURIComponent(category)}` : ""}${memberQ()}`);
    const total = rows.reduce((s, t) => s + t.amount_cents, 0);
    $("#dd", box).innerHTML = `<div class="dd-total"><b>${zar(flow === "in" ? total : flow === "moved" ? Math.abs(total) : -total)}</b>
        <span class="small muted">${rows.length} transaction${rows.length === 1 ? "" : "s"} · ${esc(monthName(month))}</span></div>
      ${rows.length ? `<table class="t dd-t"><tbody>${rows.map((t) => `<tr><td class="small muted">${t.posted_on.slice(5)}</td>
        <td>${esc(t.description)}<div class="small muted">${esc(t.account)}${category ? "" : ` · ${esc(t.category)}`}</div></td>
        <td class="num ${t.amount_cents > 0 ? "good" : ""}">${zar(t.amount_cents, { whole: false })}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No transactions.</p>`}
      <p class="small" style="margin-top:14px"><a href="#/statements?tab=transactions&m=${month}" data-close>Open the transactions tab →</a></p>`;
    $$("[data-close]", box).forEach((b) => (b.onclick = closeOverlays));
  } catch (e) { fail(e); }
}

function bindDrill(el, fn) {
  $$("[data-drill]", el).forEach((r) => {
    r.addEventListener("click", () => fn(r.dataset.drill, r));
    r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(r.dataset.drill, r); } });
  });
}

// What the statements show for the month, next to the plan. Came in − spent − moved = left over, which is how much
// the balance changed, so it can be checked against the statement.
function actualsCard(a) {
  const s = a.summary;
  const moved = s.moved_cents >= 0 ? ["Moved to your own accounts", s.moved_cents] : ["Back from your own accounts", -s.moved_cents];
  return `<div class="card actuals">
    <div class="card-head"><h3>From your statements</h3><a class="small" href="#/statements?tab=transactions&m=${S.month}">See transactions</a></div>
    <div class="actuals-row">
      <div class="drill" role="button" tabindex="0" data-drill="flow:in"><span>Came in</span><b>${zar(s.income_cents)}</b></div>
      <div class="drill" role="button" tabindex="0" data-drill="flow:spent"><span>Spent</span><b>${zar(s.spend_cents)}</b></div>
      <div class="drill" role="button" tabindex="0" data-drill="flow:moved"><span>${moved[0]}</span><b>${zar(moved[1])}</b></div>
      <div><span>Left over</span><b class="${s.net_cents < 0 ? "warn" : ""}">${zar(s.net_cents)}</b></div>
    </div>
    <p class="small muted">From ${a.accounts.map(esc).join(", ")}.${a.missing.length ? ` No statements yet from ${a.missing.map(esc).join(" or ")}.` : ""}
      Money moved to your own accounts (pockets, savings, investments) isn't spending; what's spent from those accounts shows once you upload their statements.</p>
    ${s.partial ? `<p class="small muted">Your statements cover only part of ${esc(monthName(S.month))}, so these totals are incomplete.</p>` : ""}
  </div>`;
}

function emptyBudget(el) {
  const have = S.me.statement_months.length > 0;
  el.innerHTML = `${billingBanner()}<div class="card empty"><h3>Let's build your first month</h3>
    <p>${have
      ? `Your statements are in. ${esc(APP)} can draft each person's budget from them: income, debit orders, bank fees and everyday spending by category. You can change anything afterwards.`
      : "Upload your bank statements (FNB PDFs work as the bank sends them) and your budget is drafted from them, or add each person's salary and what goes out yourself, or bring in the Excel budget you already keep."}</p>
    <div class="row" style="justify-content:center;margin-top:16px">
      ${have ? `<button type="button" class="btn primary" id="draft">Build my budget from statements</button>` : `<button type="button" class="btn primary" id="open-upload">Upload bank statements</button>`}
      <a class="btn" href="#/budget">Add items</a><a class="btn" href="#/settings?tab=import">Import from Excel</a></div>
    <div class="error" id="err" style="margin-top:10px"></div></div>`;
  $("#open-upload", el)?.addEventListener("click", openUpload);
  $("#draft", el)?.addEventListener("click", (e) => draftBudget(e.currentTarget, $("#err", el)));
}

async function draftBudget(btn, err) {
  btn.disabled = true;
  try {
    const r = await api("api/budget/draft", { method: "POST", body: {} });
    if (!r.lines) {
      err.textContent = "No month is fully covered by your statements yet. Upload the statement for the month before or after, then try again.";
      btn.disabled = false;
      return;
    }
    toast(`Budget drafted from ${monthSpan(r.months[0] + "-01", r.months.at(-1) + "-01")}`);
    route();
  } catch (e) { err.textContent = e.message; btn.disabled = false; }
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
    <div class="legend jars-legend">${JAR_KEYS.filter((k) => totals[k]).map((k) => `<button type="button" class="legend-btn" data-drill="group:${k}"><span class="sw jar-${k.toLowerCase()}"></span>${k} <b>${zar(totals[k])}</b></button>`).join("")}
      <span><span class="sw jar-left"></span>Clear glass: left over</span></div>
  </div>`;
}

async function mountJars(v, onPick) {
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
      onPick,
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
    return `<div class="bar-row drill" role="button" tabindex="0" data-drill="group:${k}" data-tip="${esc(k)}: ${zar(g[k] || 0)} (${p}% of income, guide ${target}%)"><span>${k}</span>
      <div class="track"><div class="fill" style="width:${Math.min(100, p)}%"></div><div class="tick" style="left:calc(${target}% - 1px)"></div></div>
      <span class="num">${p}%</span></div>`;
  }).join("")}</div>`;
}
function barRow(label, value, max, tick, tickLabel = "planned", drill = null) {
  return `<div class="bar-row ${drill ? `drill" role="button" tabindex="0" data-drill="${esc(drill)}` : ""}" data-tip="${esc(label)}: ${zar(value)}${tick != null ? ` · ${tickLabel} ${zar(tick)}` : ""}"><span>${esc(label)}</span>
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
    ${v.lines.some((l) => l.draft_key) ? `<div class="row draft-row"><span class="small muted">Items marked “from statements” were drafted from your bank statements.</span>
      <button type="button" class="btn sm" id="redraft">Redraft from statements</button></div>` : ""}
    <div class="sheet">${v.people.map((p) => personColumn(p)).join("")}</div>`;
  $("#redraft", el)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;  // e.currentTarget is null once the await below has run
    if (!(await ask("Redraft from your statements?", { body: "Items you added, changed, ticked as paid or linked to a goal stay as they are.", yes: "Redraft" }))) return;
    btn.disabled = true;
    try {
      const r = await api("api/budget/draft", { method: "POST", body: {} });
      toast(r.lines ? `${r.lines} items drafted from ${monthSpan(r.months[0] + "-01", r.months.at(-1) + "-01")}`
        : r.members.length ? "Nothing new to draft: your own items already cover it" : "No month is fully covered by statements yet");
      route();
    } catch (err) { fail(err); btn.disabled = false; }
  });
  $$(".item input[type=checkbox]", el).forEach((cb) => {
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = async () => {
      const paid = cb.checked;
      const set = async (p) => { await api(`api/budget/lines/${cb.dataset.id}/paid`, { method: "POST", body: { month: S.month, paid: p } }); cb.checked = p; cb.closest(".item").classList.toggle("paid", p); };
      try {
        await set(paid);
        toast(paid ? "Ticked as paid" : "Ticked as not paid", "ok", { action: "Undo", onAction: () => set(!paid).catch(fail) });
      } catch (e) { cb.checked = !paid; fail(e); }
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
    const sub = incoming ? `from ${esc(l.member_name)}` : [l.kind === "transfer" ? `to ${esc(l.to_member_name)}` : "", l.is_debit_order ? "debit order" : "",
      l.source === "statements" ? "from statements" : "", esc(l.notes || "")].filter(Boolean).join(" · ");
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
    ${!p.sections.length ? `<div class="add-row muted">Nothing here yet. Upload ${esc(p.name)}'s statements, or start with their salary.</div>` : ""}
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
    try { const r = await api(`api/budget/lines/${id}`, { method: "DELETE" }); closeOverlays(); undoable(`Deleted \u201c${l.name}\u201d`, r.undo); route(); } catch (e) { fail(e); }
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
  // At least R1 000 of scale: with every month at R0 the steps would be fractions of a cent, and the extra
  // gridlines and "R0" labels landed above the chart, over the cards before it.
  const step = niceStep(Math.max(...all.map(Math.abs), 100000));
  const max = Math.max(step, Math.ceil(Math.max(0, ...all) / step) * step);
  const min = Math.floor(Math.min(0, ...all) / step) * step;
  const y = (v) => T + ((H - T - B) * (max - v)) / (max - min);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Money left over per month", overflow: "hidden" }, box);
  for (let v = min; v <= max + step / 2; v += step) {
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
    if (!(await ask(`Reduce ${name} from ${zar(cur)} to ${zar(cur - cut)}?`, { body: `From ${monthName(from)}. Only do this if it's something you can genuinely spend less on. It won't change a contract, debit order or minimum repayment: cancel or renegotiate those with the provider first.`, yes: "Reduce it" }))) return;
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
  $("#del", box)?.addEventListener("click", async () => {
    try { const r = await api(`api/goals/${g.id}`, { method: "DELETE" }); closeOverlays(); undoable(`Deleted \u201c${g.name}\u201d`, r.undo); route(); } catch (e) { fail(e); }
  });
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
    box.innerHTML = `<div class="card empty"><h3>No statements yet</h3><p>Import your FNB PDF statements, or CSV exports from the FNB or Capitec app, to compare your plan with what actually went out.</p><a class="btn primary" style="margin-top:12px" href="#/statements?tab=import">Import a statement</a></div>`;
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
      <div class="kpis"><div class="card kpi drill" role="button" tabindex="0" data-drill="flow:spent"><div class="label">Actually spent</div><div class="value">${zar(a.summary.spend_cents)}</div><div class="sub">excluding transfers and savings · tap to see</div></div>
        <div class="card kpi"><div class="label">Planned</div><div class="value">${zar(plannedOut)}</div><div class="sub">expenses in your budget</div></div>
        <div class="card kpi"><div class="label">Difference</div><div class="value ${a.summary.spend_cents > plannedOut ? "warn" : "good"}">${zar(a.summary.spend_cents - plannedOut, { signed: true })}</div><div class="sub">${a.summary.uncategorised} transaction(s) in Other</div></div></div>
      <div class="grid g2"><div class="card"><h3>By category</h3><div class="legend"><span><span class="sw" style="background:var(--accent)"></span>Actual</span><span><span class="tk"></span>Planned</span></div>
        <div class="bars">${rows.map((r) => barRow(r.c, r.a, max, r.p, "planned", `cat:${r.c}`)).join("")}</div></div>
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
  bindDrill(box, (key) => {
    const cat = key.startsWith("cat:") ? key.slice(4) : null;
    txnDrawer(cat || "Actually spent", { month: sm, flow: "spent", category: cat });
  });
}

async function transactionsTab(box, sm, picker) {
  const rows = await api(`api/transactions?month=${sm}${memberQ()}`);
  const unknown = rows.filter((t) => t.category_source === "none" && !t.is_transfer).length;
  box.innerHTML = `<div class="row" style="margin-bottom:14px">${picker}<label class="check"><input type="checkbox" id="rule" checked> Remember my choice for that merchant</label></div>
    ${unknown ? `<div class="banner"><span>${unknown} transaction${unknown === 1 ? "" : "s"} this month still need${unknown === 1 ? "s" : ""} a category.</span><button type="button" class="btn sm primary" id="rv-open">Sort them</button></div>` : ""}
    <div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>
    ${rows.map((t) => `<tr><td class="small muted">${t.posted_on}</td><td>${esc(t.description)}<div class="small muted">${esc(t.account)}</div></td>
      <td class="num ${t.amount_cents > 0 ? "good" : ""}">${zar(t.amount_cents, { whole: false })}</td>
      <td><select data-id="${t.id}" aria-label="Category">${S.me.categories.map((c) => `<option ${c === t.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table></div></div>`;
  $$("select[data-id]", box).forEach((s) => (s.onchange = async () => {
    try {
      const r = await api(`api/transactions/${s.dataset.id}/category`, { method: "POST", body: { category: s.value, make_rule: $("#rule").checked } });
      undoable(r.updated > 1 ? `Sorted ${r.updated} transactions as ${s.value}` : `Sorted as ${s.value}`, r.undo);
    } catch (e) { fail(e); }
  }));
  bindReview(box);
}

// ---------------------------------------------------------------- review inbox
// What the app couldn't sort, one payee at a time. A choice sorts every transaction from that payee and is
// remembered, so next month's statements come in already sorted.
const reviewBanner = () => S.me.to_review > 0 ? `<div class="banner rv-banner"><span><b>${S.me.to_review}</b> transaction${S.me.to_review === 1 ? "" : "s"} from your statements ${S.me.to_review === 1 ? "needs" : "need"} sorting.</span>
  <button type="button" class="btn sm primary" id="rv-open">Sort them</button></div>` : "";
const bindReview = (el) => $("#rv-open", el)?.addEventListener("click", () => reviewInbox());

async function reviewInbox() {
  const skipped = new Set();
  let done = 0, total = 0, busy = false;
  const box = modal(`<div class="up-head"><h2>Sort transactions</h2><button type="button" class="btn ghost sm" data-close>Close</button></div>
    <div class="meter good rv-meter"><i style="width:0"></i></div><div id="rv"></div>`);
  S.onClose = () => { if (done) refreshMe().then(route); };
  const host = $("#rv", box);
  const show = async () => {
    const q = await api("api/review");
    const items = q.items.filter((i) => !skipped.has(i.id));
    total = Math.max(total, done + items.length);
    $(".rv-meter i", box).style.width = `${pct(done, total)}%`;
    const i = items[0];
    if (!i) {
      host.innerHTML = `<div class="rv-done"><h3>${done ? "All sorted" : "Nothing to sort"}</h3>
        <p class="muted">${done ? `${done} card${done === 1 ? "" : "s"} sorted. ${esc(APP)} will sort these payees itself next time.` : "Every transaction already has a category."}${skipped.size ? ` ${skipped.size} skipped for later.` : ""}</p>
        <div class="row rv-foot"><a class="btn primary" href="#/statements?tab=spending" data-close>See spending</a><button type="button" class="btn" data-close>Done</button></div></div>`;
      $$("[data-close]", host).forEach((b) => (b.onclick = closeOverlays));
      return;
    }
    const incoming = i.amount_cents > 0;
    const first = incoming ? ["Income", "Transfers", "Other"] : [];
    const cats = [...first, ...S.me.categories.filter((c) => !first.includes(c) && (incoming || c !== "Income")), ...(incoming ? [] : ["Income"])];
    host.innerHTML = `<div class="small muted rv-pos">${done + 1} of ${total}</div>
      <div class="rv-card">
        <div class="rv-amt ${incoming ? "good" : ""}">${zar(i.amount_cents, { whole: false })}</div>
        <div class="rv-desc">${esc(i.description)}</div>
        <div class="small muted">${i.posted_on} · ${esc(i.account)}${i.count > 1 ? ` · <b>+${i.count - 1} more</b> like this, ${zar(Math.abs(i.total_cents))} in all` : ""}</div>
      </div>
      <p class="small muted rv-hint">${i.remembers ? `What is this? ${esc(APP)} remembers your choice for this payee.` : "What is this? (This name is too vague to remember.)"}</p>
      <div class="rv-cats">${cats.map((c) => `<button type="button" class="btn sm" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <div class="row rv-foot"><button type="button" class="btn ghost sm" id="rv-skip">Skip this one</button></div>`;
    $("#rv-skip", host).onclick = () => { skipped.add(i.id); show(); };
    $$("[data-cat]", host).forEach((b) => (b.onclick = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await api(`api/transactions/${i.id}/category`, { method: "POST", body: { category: b.dataset.cat, make_rule: true } });
        done++;
        toast(r.updated > 1 ? `${r.updated} sorted as ${b.dataset.cat}` : `Sorted as ${b.dataset.cat}`, "ok", { action: "Undo", onAction: async () => {
          try { await api("api/undo", { method: "POST", body: { token: r.undo } }); done = Math.max(0, done - 1); if (box.isConnected) show(); else { refreshMe().then(route); } } catch (e) { fail(e); }
        } });
        await show();
      } catch (e) { fail(e); }
      busy = false;
    }));
  };
  try { await show(); } catch (e) { fail(e); closeOverlays(); }
}

const fileB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(new Error("Couldn't read that file."));
  r.readAsDataURL(file);
});

function statementImport(box) {
  box.innerHTML = `<div class="card up-card">${uploaderHtml()}</div>`;
  uploader(box);
}

// ---------------------------------------------------------------- statement upload
// One place for every statement: any month, any number of files. The server works out the bank, account and
// dates; an account seen before goes to the same person, and a new one is asked about once.
function openUpload() {
  drawer(`<div class="up-head"><h2>Upload statements</h2><button type="button" class="btn ghost sm" data-close>Close</button></div>${uploaderHtml()}`, uploader);
}

const uploaderHtml = () => `
  <p class="muted small up-intro">Any month, as many files as you like: FNB PDFs as the bank sends them, or CSV exports from FNB or Capitec.
    ${esc(APP)} works out the bank, account, months and whose account it is.</p>
  <div class="drop" id="drop">
    <span class="drop-ic" aria-hidden="true">${icon("upload")}</span>
    <strong>Choose statements</strong>
    <span class="muted small drop-hint">or drop them here</span>
    <!-- The real file input covers the whole box: iPhone Safari doesn't reliably open the picker from a
         tap on a label for a hidden input, but a tap on the input itself always works. -->
    <input type="file" id="up-files" multiple aria-label="Choose statements">
  </div>
  <ul class="up-list" id="up-list" aria-live="polite"></ul>
  <div class="up-done hidden" id="up-done"><button type="button" class="btn primary hidden" id="up-sort"></button><button type="button" class="btn" id="up-view">See transactions</button></div>`;

function monthSpan(a, b) {
  const [ma, mb] = [a.slice(0, 7), b.slice(0, 7)];
  if (ma === mb) return monthName(ma);
  return ma.slice(0, 4) === mb.slice(0, 4) ? `${monthName(ma, "short")} – ${monthName(mb)}` : `${monthName(ma)} – ${monthName(mb)}`;
}

function uploader(box) {
  const list = $("#up-list", box), input = $("#up-files", box), drop = $("#drop", box);
  const owners = {};   // "fnb:1234" -> member id, or null for joint: asked once per account
  const waiting = {};  // the same key -> files waiting for that answer
  let latest = null;   // newest date imported, so "See transactions" opens that month
  let queue = Promise.resolve();

  const add = (files) => {
    for (const file of files) {
      const li = document.createElement("li");
      li.className = "up-item";
      li.innerHTML = `<div class="up-file">${icon("file")}<span>${esc(file.name)}</span></div><div class="up-status muted small">Waiting…</div>`;
      list.appendChild(li);
      const item = { file, li };
      queue = queue.then(() => send(item));
    }
  };
  const picked = () => { if (input.files.length) { add([...input.files]); input.value = ""; } };
  input.addEventListener("change", picked);
  input.addEventListener("input", picked);  // some iOS versions fire only one of the two
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); add([...e.dataTransfer.files]); });

  async function send(item, owner) {
    const status = $(".up-status", item.li);
    status.className = "up-status muted small";
    status.textContent = "Reading…";
    try {
      item.b64 ??= await fileB64(item.file);
      const body = { filename: item.file.name, content_b64: item.b64, auto: true };
      if (owner !== undefined) body.member_id = owner;
      const r = await api("api/import", { method: "POST", body });
      if (!latest || r.last_date > latest) latest = r.last_date;
      status.className = "up-status small";
      status.innerHTML = `<span class="chip good">${r.rows_added} new</span> ${esc(r.account_label)} · ${esc(monthSpan(r.first_date, r.last_date))}`
        + (r.rows_duplicate ? ` <span class="muted">· ${r.rows_duplicate} already here</span>` : "")
        + (r.drafted ? `<div class="good">Budget drafted from your statements (${r.drafted} items).</div>` : "");
      $("#up-done", box).classList.remove("hidden");
      await refreshMe();
      const sort = $("#up-sort", box);
      sort.classList.toggle("hidden", !S.me.to_review);
      sort.textContent = `Sort ${S.me.to_review} transaction${S.me.to_review === 1 ? "" : "s"}`;
      $("#up-view", box).classList.toggle("primary", !S.me.to_review);
    } catch (err) {
      if (err.data?.needs_owner) return askOwner(item, err.data);
      status.className = "up-status small warn";
      status.textContent = err.message;
    }
  }

  function askOwner(item, d) {
    const key = d.last4 ? `${d.bank}:${d.last4}` : null;
    if (key && key in owners) return send(item, owners[key]);
    const status = $(".up-status", item.li);
    if (key && waiting[key]) { waiting[key].push(item); status.textContent = "Same account as above: waiting for your answer."; return; }
    if (key) waiting[key] = [item];
    status.className = "up-status small";
    status.innerHTML = `<div class="ask">Whose account is ${esc(d.bank.toUpperCase())}${d.last4 ? ` ••${esc(d.last4)}` : ""}?
        <span class="muted">${esc(monthSpan(d.first_date, d.last_date))}. You'll only be asked once.</span></div>
      <div class="row ask-btns">${S.me.members.map((m) => `<button type="button" class="btn sm" data-owner="${m.id}"><span class="dot ${pclass(m.id)}"></span>${esc(m.name)}</button>`).join("")}
        <button type="button" class="btn sm" data-owner="">Joint</button></div>`;
    $$("[data-owner]", status).forEach((b) => (b.onclick = () => {
      const owner = b.dataset.owner === "" ? null : +b.dataset.owner;
      const items = key ? waiting[key] : [item];
      if (key) { owners[key] = owner; delete waiting[key]; }
      for (const it of items) queue = queue.then(() => send(it, owner));
    }));
  }

  $("#up-view", box).onclick = () => { closeOverlays(); go(`#/statements?tab=transactions${latest ? `&m=${latest.slice(0, 7)}` : ""}`); };
  $("#up-sort", box).onclick = () => reviewInbox();
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
  $$("[data-del]", el).forEach((b) => (b.onclick = async () => {
    const name = debts.find((d) => d.id === +b.dataset.del)?.name || "debt";
    try { const r = await api(`api/debts/${b.dataset.del}`, { method: "DELETE" }); undoable(`Removed \u201c${name}\u201d`, r.undo); route(); } catch (e) { fail(e); }
  }));
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
  $$("[data-rev]", el).forEach((b) => (b.onclick = async () => { if (!(await ask("Revoke this token?", { body: "Reports using it will stop refreshing.", yes: "Revoke", danger: true }))) return; await api(`api/tokens/${b.dataset.rev}`, { method: "DELETE" }).catch(fail); route(); }));
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
      const b64 = await fileB64(file);
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
    $("#cancel")?.addEventListener("click", async () => { if (!(await ask("Cancel your plan?", { body: "You keep access until the end of the paid period.", yes: "Cancel plan", no: "Keep plan", danger: true }))) return; await api("api/billing/cancel", { method: "POST", body: {} }).catch(fail); await refreshMe(); route(); });
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
      if (!(await ask(owner ? "Delete the household?" : "Leave this household?", { body: owner ? "Everything in it is deleted for both of you, permanently." : "You'll lose access to this budget.", yes: owner ? "Delete everything" : "Leave", danger: true }))) return;
      try { await api(owner ? "api/privacy/delete-household" : "api/privacy/leave", { method: "POST", body: { password: new FormData(e.target).get("pw") } }); S.me = false; store.set("lastUser", null); toast("Done"); go("#/"); } catch (err) { fail(err); }
    });
  } else {
    box.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><h3>Change password</h3>
      ${demo ? `<p class="small muted">Not available in the demo.</p>` : `<form id="pf" style="display:grid;gap:12px">${S.me.user.has_password ? `<label class="field">Current password<input type="password" name="old" autocomplete="current-password" required></label>` : `<p class="small muted">You sign in with Microsoft. You can also set a password as a backup.</p>`}
      <label class="field">New password<input type="password" name="new" autocomplete="new-password" minlength="10" placeholder="At least 10 characters" required>${pwMeter()}</label><button class="btn primary" style="justify-self:start">${S.me.user.has_password ? "Change password" : "Set password"}</button></form>`}</div>
      <div class="card" id="sess-card"><h3>Where you're signed in</h3><i class="sk w60"></i><i class="sk"></i></div>
      ${demo ? "" : `<div class="card" id="pk-card" style="grid-column:1/-1"><h3>Passkeys</h3><i class="sk w60"></i><i class="sk"></i></div>`}</div>`;
    if (!demo) renderPasskeyCard($("#pk-card"));
    renderSessionsCard($("#sess-card"));
    if ($("#pf")) bindPwMeters($("#pf"));
    $("#pf")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      busy($("button", e.target), async () => {
        try { await api("api/auth/password", { method: "POST", body: { old: f.get("old"), new: f.get("new") } }); S.me = false; toast("Password changed. Please sign in again."); go("#/signin"); } catch (err) { fail(err); }
      });
    });
  }
}


// ---------------------------------------------------------------- iPhone / PWA
const MOBILE_TABS = ["overview", "budget", "forecast", "goals"];
const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

function moreSheet(current) {
  const items = Object.keys(PAGES).filter((k) => !MOBILE_TABS.includes(k));
  const box = modal(`<div class="menu-head">${avatar("lg")}<div><strong>${esc(S.me.user.name)}</strong><span class="muted small">${esc(S.me.household.name)}</span></div>
      <span class="chip ${planTone(S.me.billing)}">${planLabel(S.me.billing)}</span></div>
    <nav class="sheet-list" aria-label="More">
    ${items.map((k) => `<a href="#/${k}" class="${k === current ? "on" : ""}">${icon(PAGES[k].icon)}<span>${PAGES[k].title}</span></a>`).join("")}
    ${S.config.private_mode ? `<a href="/">${icon("house")}<span>whoisveyansiz.com</span></a>` : ""}
    <button type="button" id="sheet-out">${icon("out")}<span>Sign out</span></button></nav>
    <div class="menu-row"><span class="small muted">Appearance</span>${themeSeg()}</div>`);
  bindThemeSeg(box);
  $$("a[href^='#/']", box).forEach((a) => a.addEventListener("click", closeOverlays));
  $("#sheet-out", box).onclick = () => signOut();
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


async function renderSessionsCard(card) {
  let r;
  try { r = await api("api/sessions"); } catch (e) { card.innerHTML = `<h3>Where you're signed in</h3><p class="small muted">${esc(e.message)}</p>`; return; }
  const others = r.sessions.filter((x) => !x.current).length;
  card.innerHTML = `<h3>Where you're signed in</h3>
    <p class="small muted">Something you don't recognise? Sign it out, then change your password.</p>
    <ul class="sessions">${r.sessions.map((x) => `<li>${icon(/iPhone|iPad|phone|tablet/.test(x.device) ? "phone" : "laptop")}
      <div><strong>${esc(x.device)}</strong><span class="small muted">${x.current ? "Active now" : `Active ${ago(x.last_seen_at)}`} · signed in ${esc(new Date(x.created_at.replace(" ", "T") + "Z").toLocaleDateString(undefined, { day: "numeric", month: "short" }))}</span></div>
      ${x.current ? `<span class="chip good">This device</span>` : `<button class="link small" data-sess="${esc(x.id)}">Sign out</button>`}</li>`).join("")}</ul>
    <div class="row" style="margin-top:14px">${others ? `<button class="btn sm" id="others">Sign out other devices</button>` : ""}<button class="btn sm ghost" id="all">Sign out everywhere</button></div>`;
  $$("[data-sess]", card).forEach((b) => (b.onclick = async () => {
    try { await api(`api/sessions/${b.dataset.sess}`, { method: "DELETE" }); toast("Signed out on that device"); } catch (e) { fail(e); }
    renderSessionsCard(card);
  }));
  $("#others", card)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    try { await api("api/auth/logout-others", { method: "POST", body: {} }); toast("Signed out everywhere else"); } catch (x) { fail(x); }
    renderSessionsCard(card);
  }));
  $("#all", card).onclick = async () => {
    if (await ask("Sign out everywhere?", { body: "Every device, including this one, will need to sign in again.", yes: "Sign out everywhere" })) signOut(true);
  };
}

async function renderPasskeyCard(card) {
  const r = await api("api/passkeys");
  card.innerHTML = `<div class="card-head"><h3>Passkeys</h3>${hasPasskeys() ? `<button class="btn sm primary" id="pk-add">${icon("face")} Add this device</button>` : ""}</div>
    <p class="muted small">Sign in with Face ID, Touch ID, Windows Hello or your device's screen lock. Each device keeps its own passkey (Apple devices share theirs through iCloud Keychain). To add a new phone or computer, sign in on it with your password and a recovery code, and it offers to add one there.</p>
    ${r.passkeys.length ? `<table class="t"><tbody>${r.passkeys.map((k) => `<tr><td>${esc(k.name)}<div class="small muted">Added ${esc(k.created_at.slice(0, 10))}${k.last_used_at ? ` · last used ${esc(k.last_used_at.slice(0, 10))}` : ""}</div></td>
      <td class="num"><button class="link small" data-pk-del="${k.id}">Remove</button></td></tr>`).join("")}</tbody></table>` : `<p class="small warn">No passkeys yet.</p>`}
    <div class="row" style="justify-content:space-between;margin-top:16px"><span class="small muted">${r.recovery_left} of 10 recovery codes left</span>
      <button class="btn sm" id="rc-new">New recovery codes</button></div><div id="rc-out"></div>`;
  $("#pk-add", card)?.addEventListener("click", async () => {
    try { await passkeyRegister(deviceName()); toast("Passkey added"); renderPasskeyCard(card); } catch (e) { toast(passkeyError(e), "err"); }
  });
  $$("[data-pk-del]", card).forEach((b) => (b.onclick = async () => {
    if (!(await ask("Remove this passkey?", { body: "That device will need your password and a recovery code to sign in again.", yes: "Remove", danger: true }))) return;
    try { await api(`api/passkeys/${b.dataset.pkDel}`, { method: "DELETE" }); renderPasskeyCard(card); } catch (e) { fail(e); }
  }));
  $("#rc-new", card).onclick = async () => {
    if (!(await ask("Make new recovery codes?", { body: "Your old ones will stop working.", yes: "Make new codes" }))) return;
    try {
      const x = await api("api/passkeys/recovery-codes", { method: "POST", body: {} });
      $("#rc-out", card).innerHTML = `<p class="small" style="margin-top:12px"><b>Save these now.</b> They won't be shown again.</p>${recoveryCodesHtml(x.recovery_codes)}`;
      bindRecoveryCodes($("#rc-out", card), x.recovery_codes);
    } catch (e) { fail(e); }
  };
}
