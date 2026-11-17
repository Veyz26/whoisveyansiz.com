// Prints the CV pages (out/cv/ and out/cv/one-page/) to PDF with headless Chrome, after `next build`.
// The site links to the PDFs, so CI must have Chrome (GitHub's ubuntu runners do) and the deploy workflow
// checks they exist. Locally, a missing Chrome only warns. Set CHROME_PATH to point at a specific browser.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const OUT = resolve("out");
const PAGES = [
  ["cv/", "cv/Veyansiz-Chetty-CV.pdf"],
  ["cv/one-page/", "cv/Veyansiz-Chetty-CV-one-page.pdf"],
];
const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.warn("make-cv-pdfs: no Chrome found (set CHROME_PATH); the CV PDFs were not made");
  process.exit(0);
}

// Serve out/ so the pages load their fonts and styles exactly as on the site.
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
  let p = join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!p.startsWith(OUT) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[extname(p)] ?? "application/octet-stream" });
  createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

let failed = false;
for (const [page, pdf] of PAGES) {
  // Chrome runs alongside this script's server (asynchronously), which serves it the page.
  const target = join(OUT, pdf);
  const run = await new Promise((done) => {
    const p = spawn(chrome, [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", "--hide-scrollbars",
      "--virtual-time-budget=8000", `--print-to-pdf=${target}`, `http://127.0.0.1:${port}/${page}`,
    ], { stdio: "ignore" });
    p.on("exit", (code) => done(code));
  });
  if (run !== 0 || !existsSync(target)) { failed = true; console.error(`make-cv-pdfs: failed to print ${page}`); }
  else console.log(`make-cv-pdfs: ${pdf} (${Math.round(statSync(target).size / 1024)} KB)`);
}
server.close();
process.exit(failed ? 1 : 0);

