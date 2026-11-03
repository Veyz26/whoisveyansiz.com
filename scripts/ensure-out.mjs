// Makes sure the static site is in out/ after `next build`.
//
// On Hostinger's Node.js build, `next build` finishes but no out/ folder appears, although the
// same build creates it locally and on GitHub. Rather than guess why, this script:
//   1. does nothing when out/ is there (the normal case);
//   2. otherwise prints what Next reported, so the build log shows what happened;
//   3. copies the export from wherever Next says it wrote it, or failing that, assembles out/
//      from the pages Next prerendered into .next/ (this site is fully static).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "out";
const NEXT = ".next";
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

if (existsSync(join(OUT, "index.html"))) process.exit(0);

console.log("ensure-out: no out/index.html after next build; diagnostics follow");
const detail = readJson(join(NEXT, "export-detail.json"));
const server = readJson(join(NEXT, "required-server-files.json"));
console.log("  cwd:", process.cwd());
console.log("  export-detail.json:", JSON.stringify(detail));
console.log("  resolved output:", server?.config?.output, "distDir:", server?.config?.distDir);
console.log("  .next/standalone exists:", existsSync(join(NEXT, "standalone")));
console.log(
  "  env names:",
  Object.keys(process.env).filter((k) => /NEXT|HOSTINGER|OUTPUT|EXPORT|BUILD/i.test(k)).sort().join(" ") || "(none)",
);

// Next exported, but somewhere else.
const elsewhere = detail?.outDirectory;
if (detail?.success && elsewhere && existsSync(join(elsewhere, "index.html"))) {
  cpSync(elsewhere, OUT, { recursive: true });
  console.log(`ensure-out: copied the export from ${elsewhere}`);
  process.exit(0);
}

// Assemble out/ from the prerendered pages.
const app = join(NEXT, "server", "app");
if (!existsSync(join(app, "index.html")) || !existsSync(join(NEXT, "static"))) {
  console.error("ensure-out: no prerendered pages in .next/server/app either; cannot build out/");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
cpSync("public", OUT, { recursive: true }); // robots.txt, sitemap.xml, .htaccess
cpSync(join(NEXT, "static"), join(OUT, "_next", "static"), { recursive: true });
cpSync(join(app, "index.html"), join(OUT, "index.html"));
if (existsSync(join(app, "index.rsc"))) cpSync(join(app, "index.rsc"), join(OUT, "index.txt"));
// Route data for client navigation: index.segments/_tree.segment.rsc -> __next._tree.txt, etc.
const segments = join(app, "index.segments");
if (existsSync(segments)) {
  for (const f of readdirSync(segments).filter((f) => f.endsWith(".segment.rsc"))) {
    cpSync(join(segments, f), join(OUT, `__next.${f.replace(".segment.rsc", "")}.txt`));
  }
}
if (existsSync(join(app, "_not-found.html"))) {
  for (const page of ["404.html", "404/index.html", "_not-found/index.html"]) {
    mkdirSync(join(OUT, page, ".."), { recursive: true });
    cpSync(join(app, "_not-found.html"), join(OUT, page));
  }
}
console.log("ensure-out: assembled out/ from .next/server/app and .next/static");
