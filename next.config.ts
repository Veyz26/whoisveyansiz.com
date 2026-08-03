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
};

export default nextConfig;
