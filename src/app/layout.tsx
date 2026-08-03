import type { Metadata } from "next";
import localFont from "next/font/local";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { cvData } from "@/data/cv";

const inter = localFont({
  src: [
    {
      path: "../fonts/Inter-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/Inter-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../fonts/Inter-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/Inter-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-sans",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
});

// Ethereal, space-themed display font for headings, name and accents.
// Self-hosted by next/font at build time, so it stays within the site's CSP.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Veyansiz Chetty | DevOps & Cloud Engineer",
  description:
    "Portfolio of Veyansiz Chetty — DevOps Engineer, Cloud Engineer, and Platform Engineer with 7+ years of experience in cloud infrastructure, automation, and operational excellence.",
  keywords: [
    "DevOps Engineer",
    "Cloud Engineer",
    "Platform Engineer",
    "Azure",
    "Kubernetes",
    "CI/CD",
    "Infrastructure",
    "Veyansiz Chetty",
  ],
  authors: [{ name: "Veyansiz Chetty" }],
  openGraph: {
    title: "Veyansiz Chetty | DevOps & Cloud Engineer",
    description:
      "Portfolio of Veyansiz Chetty — DevOps Engineer, Cloud Engineer, and Platform Engineer.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Veyansiz Chetty | DevOps & Cloud Engineer",
    description:
      "Portfolio of Veyansiz Chetty — DevOps Engineer, Cloud Engineer, and Platform Engineer.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Person",
              name: cvData.personal.name,
              jobTitle: cvData.personal.title,
              description: "DevOps Engineer, Cloud Engineer, and Platform Engineer with 7+ years of experience in cloud infrastructure, automation, and operational excellence.",
              address: {
                "@type": "PostalAddress",
                addressLocality: cvData.personal.location,
              },
              sameAs: [
                cvData.personal.linkedin,
                cvData.personal.github,
              ],
            }),
          }}
        />
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased bg-[#03020d] text-white`}>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
