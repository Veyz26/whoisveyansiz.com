"use client";

import { useEffect, useRef } from "react";

// A stop on the journey: a long stretch of scroll whose caption is pinned to the bottom-left corner.
// A caption stays up from halfway after the previous stop until halfway to the next, crossfading with its
// neighbours, so there is always one on screen once the journey starts.
export function Stop({ id, title, line, children }: { id: string; title: string; line?: string; children?: React.ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = card.current!;
    const section = el.closest("section")!;
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = section.getBoundingClientRect();
        const d = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
        const o = Math.max(0, Math.min(1, (0.8 - Math.abs(d)) / 0.3));
        el.style.opacity = String(o);
        // Faded-out cards let clicks through to the scene but stay in the tab order and the accessibility tree.
        el.style.pointerEvents = o < 0.5 ? "none" : "auto";
      });
    };
    // Tabbing into a card that isn't in view flies there, so what has focus is always on screen.
    const focus = () => {
      if (Number(el.style.opacity) > 0.9) return;
      const r = section.getBoundingClientRect();
      scrollTo({ top: r.top + scrollY + r.height / 2 - innerHeight / 2, behavior: "instant" });
    };
    el.addEventListener("focusin", focus);
    place();
    addEventListener("scroll", place, { passive: true });
    addEventListener("resize", place);
    return () => { cancelAnimationFrame(raf); el.removeEventListener("focusin", focus); removeEventListener("scroll", place); removeEventListener("resize", place); };
  }, []);

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="pointer-events-none relative z-10 min-h-[170svh]">
      <div ref={card} style={{ opacity: 0, pointerEvents: "none" }}
        className="caption panel fixed inset-x-3 bottom-3 max-h-[72svh] overflow-y-auto p-5 sm:inset-x-auto sm:bottom-8 sm:left-8 sm:w-[25rem] sm:p-6">
        <h2 id={`${id}-title`} className="card-title text-bone">{title}</h2>
        {line && <p className="mt-1.5 text-sm leading-relaxed text-bone/80 sm:text-base">{line}</p>}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </section>
  );
}

// Everything beyond the essentials, one tap away.
export function More({ label = "Show details", children }: { label?: string; children: React.ReactNode }) {
  return (
    <details className="more mt-3">
      <summary className="cursor-pointer text-sm font-medium text-accent">{label}</summary>
      <div className="mt-3 text-sm leading-relaxed text-bone/80">{children}</div>
    </details>
  );
}
