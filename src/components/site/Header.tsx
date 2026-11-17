import { SoundToggle } from "./SoundToggle";

const links = [
  { href: "#about", label: "About" },
  { href: "#work", label: "Experience" },
  { href: "#results", label: "Results" },
  { href: "#skills", label: "Skills" },
  { href: "#contact", label: "Contact" },
];

// The section you're at is underlined (Rail marks it on <html data-stop>). On phones the links give way to a
// single Contact button; the private area is reached from the contact terminal's title bar.
export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-space/95">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <a href="#top" className="font-display whitespace-nowrap text-xs uppercase tracking-[0.08em] text-bone sm:text-base sm:tracking-[0.12em]">Veyansiz Chetty</a>
        <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} data-nav={l.href.slice(1)} className="nav-link text-sm text-bone/70 transition-colors hover:text-bone">{l.label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          <SoundToggle />
          <a href="#contact" className="header-cta btn-primary hidden !py-2 !text-sm md:inline-flex">Get in touch</a>
          <a href="#contact" className="btn-ghost inline-flex min-h-11 items-center !px-4 !py-2 !text-sm md:hidden">Contact</a>
        </div>
      </div>
    </header>
  );
}
