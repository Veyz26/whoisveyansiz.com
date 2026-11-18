import { Wallet } from "lucide-react";
import { SoundToggle } from "./SoundToggle";

const links = [
  { href: "#about", label: "About" },
  { href: "#work", label: "Experience" },
  { href: "#results", label: "Results" },
  { href: "#skills", label: "Skills" },
  { href: "#contact", label: "Contact" },
];

// The section you're at is underlined (Rail marks it on <html data-stop>). On phones the links give way to a
// single Contact button. "Budget" opens the private budget app (sign-in required); it's an icon alone on
// smaller screens.
export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-space/95">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-8">
        <a href="#top" className="font-display whitespace-nowrap text-[11px] uppercase tracking-[0.04em] text-bone min-[400px]:text-xs min-[400px]:tracking-[0.08em] sm:text-base sm:tracking-[0.12em]">Veyansiz Chetty</a>
        <nav aria-label="Sections" className="hidden items-center gap-7 lg:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} data-nav={l.href.slice(1)} className="nav-link text-sm text-bone/70 transition-colors hover:text-bone">{l.label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-2.5">
          <a href="/private/" title="Budget app (sign-in required)" aria-label="Budget app (sign-in required)"
            className="flex h-11 min-w-10 items-center justify-center gap-2 rounded-md border border-line px-2.5 text-sm sm:min-w-11 sm:px-3 text-bone/75 transition-colors hover:text-bone">
            <Wallet size={17} aria-hidden />
            <span className="hidden lg:inline">Budget</span>
          </a>
          <SoundToggle />
          <a href="#contact" className="header-cta btn-primary hidden !py-2 !text-sm lg:inline-flex">Get in touch</a>
          <a href="#contact" className="btn-ghost inline-flex min-h-11 items-center !px-3 !py-2 !text-sm sm:!px-4 lg:hidden">Contact</a>
        </div>
      </div>
    </header>
  );
}
