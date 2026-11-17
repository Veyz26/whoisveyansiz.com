"use client";

import { useEffect, useState } from "react";

// How far along the journey you are: a thin line down the right edge with a stop for each section.
// It also makes every in-page link (here, in the header, in the hero) land exactly on its stop, where the
// camera arrives at that section's scene and its caption is fully shown.
const STOPS = [
  ["top", "Start"], ["about", "About"], ["work", "Experience"], ["results", "Results"],
  ["skills", "Skills"], ["contact", "Contact"],
] as const;

export function Rail() {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const on = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      setProgress(max > 0 ? scrollY / max : 0);
      let a = 0, best = Infinity;
      STOPS.forEach(([id], i) => {
        const el = document.getElementById(id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const off = Math.abs(i === 0 ? scrollY : r.top + r.height / 2 - innerHeight / 2);
        if (off < best) { best = off; a = i; }
      });
      setActive(a);
      if (document.documentElement.dataset.stop !== STOPS[a][0]) {
        if (document.documentElement.dataset.stop) dispatchEvent(new CustomEvent("journey:stop", { detail: STOPS[a][0] }));
        document.documentElement.dataset.stop = STOPS[a][0];
      }
    };
    const jump = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      const id = a?.getAttribute("href")?.slice(1);
      const el = id ? document.getElementById(id) : null;
      if (!el || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const top = id === "top" ? 0 : r.top + scrollY + r.height / 2 - innerHeight / 2;
      scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      history.replaceState(null, "", `#${id}`);
    };
    on();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    document.addEventListener("click", jump);
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); document.removeEventListener("click", jump); };
  }, []);

  return (
    <>
    {/* On smaller screens, a thin line under the header shows how far along the journey you are. */}
    <div aria-hidden className="fixed inset-x-0 top-16 z-40 h-0.5 lg:hidden">
      <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
    </div>
    <nav aria-label="Journey" className="fixed bottom-8 right-6 top-24 z-40 hidden w-3 lg:block">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line">
        <div className="absolute inset-x-0 top-0 bg-accent" style={{ height: `${progress * 100}%` }} />
      </div>
      <ul className="relative flex h-full flex-col justify-between">
        {STOPS.map(([id, label], i) => (
          <li key={id} className="group relative flex items-center justify-center">
            <a href={`#${id}`} aria-label={label} aria-current={active === i ? "true" : undefined}
              className={`block rounded-full transition-all ${active === i ? "h-3 w-3 bg-accent" : "h-2 w-2 bg-slate/50 hover:bg-bone"}`} />
            <span className={`pointer-events-none absolute right-6 whitespace-nowrap text-xs transition-opacity ${active === i ? "text-bone opacity-100" : "text-bone/70 opacity-0 group-hover:opacity-100"}`}>
              {label}
            </span>
          </li>
        ))}
      </ul>
    </nav>
    </>
  );
}
