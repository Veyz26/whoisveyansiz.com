# whoisveyansiz.com

Personal portfolio of **Veyansiz Chetty** — a single-page cinematic flight through
space built with React Three Fiber. Scrolling flies a camera through six section
anchors, each with its own procedural 3D scene, while the HTML content scrolls in
lock-step on top.

Designed and created by AlphaByte.

## Stack

- **Next.js 16** (App Router) — exported as a fully static site
- **React Three Fiber / drei / postprocessing** on top of three.js
- **Tailwind CSS v4**
- **Zustand** for the scroll/nav bridge between DOM and canvas

Everything visual is **procedural** — no external textures, HDRIs or CDN fonts.
Fonts are self-hosted (Inter via `next/font/local`, Space Grotesk fetched and
inlined by `next/font/google` at build time). Audio is synthesised in the Web
Audio API, so there are no media files either. Keep it this way: the CSP in
`public/.htaccess` is deliberately strict.

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

Build and preview exactly what gets deployed:

```bash
npm run build        # emits ./out
npm run preview      # serves ./out on http://localhost:3000
```

> The dev/preview screenshot tooling times out on this site because the R3F render
> loop never lets the page go idle. That is expected — verify in a real browser.

## Configuration

Copy `.env.example` to `.env.local`:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CONTACT_ENDPOINT` | Where the contact form POSTs. Use a form-relay service (Formspree, Web3Forms). Leave unset and the form shows a "reach me on LinkedIn" notice instead of silently dropping messages. |

This is a static site with no backend, so the value is **inlined into the JS
bundle at build time**. Only put a form-relay endpoint here — never a real API
key, email address or phone number.

## Deploying to Hostinger (Business plan)

The site builds to plain HTML/CSS/JS, so it goes in `public_html` — no Node
runtime needed at all.

### Option A — manual upload

1. `npm run build`
2. Zip the **contents** of `out/` (not the folder itself)
3. hPanel → **Files → File Manager** → open `public_html`
4. Delete anything already there, upload the zip, right-click → **Extract**
5. Confirm `index.html` and `.htaccess` sit directly in `public_html`

> File Manager hides dotfiles by default — enable "Show hidden files" to confirm
> `.htaccess` made it across. Without it you lose the security headers, caching
> and the HTTPS redirect.

### Option B — auto-deploy from GitHub

Push to `main` and let a GitHub Action FTP the `out/` folder up. In hPanel go to
**Files → FTP Accounts** and add `FTP_SERVER`, `FTP_USERNAME` and `FTP_PASSWORD`
as repository secrets under **Settings → Secrets and variables → Actions**, then
add `.github/workflows/deploy.yml`.

## What changed from the K8s version

This repo replaces the old `K8Website` homelab deployment. Removed:

- All API routes (`/api/contact`, `/api/chat`, `/api/analytics`, `/api/track`) —
  static export cannot run server code
- `middleware.ts` — its security headers moved to `public/.htaccess`
- Prisma/PostgreSQL, Redis and the self-built analytics pipeline
- Dockerfiles, Kubernetes manifests, cloudflared tunnel config and deploy scripts
- The unused legacy light-theme section components

The 3D experience itself is unchanged.
