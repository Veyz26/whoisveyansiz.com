// Copies the private budget app into the static export so it deploys with the site:
//   budget/public/*  ->  out/private/        (page, assets, .htaccess, PHP front controller)
//   budget/src/*     ->  out/private/app/    (PHP source, denied to browsers by .htaccess)
// The database and config are NOT part of the build; they live outside public_html (see budget/README.md).
import { cpSync, existsSync, rmSync } from "node:fs";

const out = "out/private";
if (!existsSync("out")) {
  console.error("copy-budget: run `next build` first (no out/ folder).");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync("budget/public", out, { recursive: true });
cpSync("budget/src", `${out}/app`, { recursive: true });
console.log("copy-budget: private budget app copied to out/private/");
