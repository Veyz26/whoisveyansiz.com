import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a fully static site to ./out — no Node server needed at runtime.
  // This is what gets uploaded to Hostinger's public_html.
  output: "export",

  // Next's image optimiser needs a server; static export can't use it.
  images: { unoptimized: true },

  // Emit /about/index.html instead of /about.html so Apache/LiteSpeed serves
  // clean URLs without any rewrite rules.
  trailingSlash: true,

  // Hostinger's build environment kills extra Node processes: Turbopack's CSS
  // workers died there, so `npm run build` uses webpack, and a single worker
  // keeps page generation in as few processes as possible.
  experimental: { cpus: 1 },
};

export default nextConfig;
