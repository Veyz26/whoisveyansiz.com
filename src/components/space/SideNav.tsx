"use client";

import { sections } from "./constants";
import { useExperience } from "@/lib/experienceStore";
import { playUi } from "@/lib/spaceAudio";

// Desktop-only section navigator + scroll-progress rail on the right edge.
// Hidden on mobile, where the TopBar provides navigation instead. Reads the
// active section from the store (updates only when it changes) and jumps the
// in-canvas scroll via goTo().

export function SideNav() {
  const active = useExperience((s) => s.active);
  const goTo = useExperience((s) => s.goTo);

  return (
    <>
      {/* Section navigator */}
      <nav
        aria-label="Sections"
        className="font-space pointer-events-auto fixed right-6 top-1/2 z-40 hidden -translate-y-1/2 md:block"
      >
        <ul className="flex flex-col items-end gap-4">
          {sections.map((s, i) => {
            const isActive = i === active;
            return (
              <li key={s.id} className="group flex items-center gap-3">
                <span
                  className={`text-[10px] uppercase tracking-widest transition-all duration-300 ${
                    isActive ? "text-white/80" : "text-white/0 group-hover:text-white/40"
                  }`}
                >
                  {s.label}
                </span>
                <button
                  onClick={() => {
                    playUi();
                    goTo(i);
                  }}
                  aria-label={`Go to ${s.label}`}
                  className="relative flex h-3 w-3 items-center justify-center"
                >
                  <span
                    className="block rounded-full transition-all duration-300"
                    style={{
                      width: isActive ? 12 : 7,
                      height: isActive ? 12 : 7,
                      background: isActive ? s.color : "rgba(255,255,255,0.25)",
                      boxShadow: isActive ? `0 0 12px 2px ${s.color}` : "none",
                    }}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Progress rail */}
      <div className="pointer-events-none fixed bottom-6 right-[31px] top-20 z-30 hidden w-px bg-white/10 md:block">
        <div
          id="exp-progress-fill"
          className="absolute inset-x-0 top-0 h-full origin-top bg-gradient-to-b from-indigo-400 via-emerald-400 to-pink-400"
          style={{ transform: "scaleY(0)" }}
        />
      </div>
    </>
  );
}
