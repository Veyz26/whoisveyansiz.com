import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cvData } from "@/data/cv";

// Self-hosted, so the strict CSP (font-src 'self') holds. Michroma, wide and geometric, carries the name and
// headings; IBM Plex Sans carries everything else, including every number (tabular figures).
// To use Aqum instead (Slava Antipov's display face), put its woff2 in src/fonts and point this at it.
const display = localFont({
  src: "../fonts/Michroma.woff2",
  weight: "400",
  variable: "--font-display-face",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const plex = localFont({
  src: [
    { path: "../fonts/IBMPlexSans.woff2", weight: "400 600", style: "normal" },
    { path: "../fonts/IBMPlexSans-Italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-plex",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
});

const description =
  "Veyansiz Chetty is a Platform Engineer at Capitec in Gauteng, specialising in site reliability and DevOps, with over seven years in infrastructure, automation and operations.";

export const metadata: Metadata = {
  title: "Veyansiz Chetty — Platform Engineer, SRE and DevOps",
  description,
  keywords: ["Platform Engineer", "Site Reliability Engineering", "SRE", "DevOps Engineer", "Cloud Engineer", "Systems Engineer", "Azure", "Kubernetes", "CI/CD", "Veyansiz Chetty"],
  authors: [{ name: "Veyansiz Chetty" }],
  openGraph: { title: "Veyansiz Chetty — Platform Engineer, SRE and DevOps", description, type: "website", locale: "en_ZA" },
  twitter: { card: "summary_large_image", title: "Veyansiz Chetty — Platform Engineer, SRE and DevOps", description },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${display.variable} ${plex.variable}`} style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        {/* Colour-scheme preview: ?palette=<name> picks one of the alternatives in globals.css before anything
            paints (so the 3D scene reads it too). Without the parameter the site uses Steel. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=new URLSearchParams(location.search).get("palette");if(/^(night|mission|aurora|abyss|eclipse)$/.test(p||""))document.documentElement.dataset.palette=p}catch(e){}`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Person",
              name: cvData.personal.name,
              jobTitle: cvData.personal.title,
              worksFor: { "@type": "Organization", name: cvData.experience[0].company },
              knowsAbout: ["Site Reliability Engineering", "DevOps", "Microsoft Azure", "AWS", "Linux", "CI/CD", "Ansible", "Incident Management", "Disaster Recovery"],
              description,
              address: { "@type": "PostalAddress", addressLocality: cvData.personal.location },
              sameAs: [cvData.personal.linkedin, cvData.personal.github],
            }),
          }}
        />
      </head>
      <body className="font-sans bg-space text-bone">
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
