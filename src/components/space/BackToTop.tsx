"use client";

import { ArrowUp } from "lucide-react";
import { useExperience } from "@/lib/experienceStore";
import { playUi } from "@/lib/spaceAudio";
import { PAGES } from "./constants";

// Appears once the visitor reaches the final section and flies the camera
// back to the launch screen. Bottom-centre so it clears the desktop side
// rail and works on mobile.

export function BackToTop() {
  const active = useExperience((s) => s.active);
  const goTo = useExperience((s) => s.goTo);
  const show = active >= PAGES - 1;

  return (
    <button
      onClick={() => {
        playUi("warp");
        goTo(0);
      }}
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      className={`fixed bottom-6 left-1/2 z-[60] inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-2.5 text-sm font-medium text-white shadow-lg backdrop-blur-md transition-all duration-500 hover:bg-white/20 ${
        show
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <ArrowUp size={16} /> Back to top
    </button>
  );
}
