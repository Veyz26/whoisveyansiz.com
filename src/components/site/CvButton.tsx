"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, FileDown } from "lucide-react";

// "Download CV" as a button beside the hero's others: it opens a small menu with the two PDFs. Built on
// <details>, so it works with the keyboard and without JavaScript; the script only closes it on a click
// elsewhere or Escape.
const CVS = [
  { href: "/cv/Veyansiz-Chetty-CV-one-page.pdf", label: "One-page CV", note: "PDF, 1 page" },
  { href: "/cv/Veyansiz-Chetty-CV.pdf", label: "Full CV", note: "PDF, 2 pages" },
];

export function CvButton() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) {
        d.open = false;
        if (e instanceof KeyboardEvent) d.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  return (
    <details ref={ref} className="cv-menu relative">
      <summary className="btn-ghost cursor-pointer list-none bg-space/60">
        <FileDown size={16} aria-hidden />
        Download CV
        <ChevronDown size={15} aria-hidden className="cv-menu-chevron transition-transform" />
      </summary>
      <ul className="panel absolute left-0 top-full z-20 mt-2 min-w-56 overflow-hidden !bg-panel p-1.5 shadow-xl shadow-black/50">
        {CVS.map((cv) => (
          <li key={cv.href}>
            <a href={cv.href} download onClick={() => { if (ref.current) ref.current.open = false; }}
              className="flex items-baseline justify-between gap-4 rounded px-3 py-2.5 text-sm text-bone hover:bg-panel-2 focus-visible:bg-panel-2">
              {cv.label}
              <span className="text-xs text-slate">{cv.note}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
