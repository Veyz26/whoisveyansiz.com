"use client";

import { useState } from "react";
import { Volume2, VolumeX, Menu, X } from "lucide-react";
import { sections } from "./constants";
import { useExperience } from "@/lib/experienceStore";
import { useSpaceAudio, playUi } from "@/lib/spaceAudio";

// Fixed top quick-nav. The bar itself is click-through (pointer-events-none)
// so dragging empty header space still scrolls on touch; only the actual
// controls opt back in. Quicklinks jump the in-canvas scroll via the store.

export function TopBar() {
  const active = useExperience((s) => s.active);
  const goTo = useExperience((s) => s.goTo);
  const { enabled, toggle } = useSpaceAudio();
  const [open, setOpen] = useState(false);

  return (
    <header className="font-space pointer-events-none fixed inset-x-0 top-0 z-[60] border-b border-white/5 bg-[#03020d]/40 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Logo */}
        <button
          onClick={() => {
            playUi();
            goTo(0);
          }}
          className="pointer-events-auto select-none text-left"
          aria-label="Veyansiz Chetty — home"
        >
          <span className="bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-lg font-bold tracking-tight text-transparent">
            VC
          </span>
          <span className="ml-2 hidden text-sm font-light text-white/40 sm:inline">
            Portfolio
          </span>
        </button>

        {/* Desktop quicklinks */}
        <nav className="pointer-events-auto hidden items-center gap-1 md:flex">
          {sections.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                playUi();
                goTo(i);
              }}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active === i ? "text-white" : "text-white/55 hover:text-white"
              }`}
              style={active === i ? { background: "rgba(255,255,255,0.08)" } : undefined}
            >
              {s.nav}
            </button>
          ))}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            aria-label={enabled ? "Mute ambient sound" : "Play ambient sound"}
            aria-pressed={enabled}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:text-white"
          >
            {enabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button
            onClick={() => {
              playUi();
              setOpen((o) => !o);
            }}
            aria-label="Toggle menu"
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:text-white md:hidden"
          >
            {open ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <nav className="pointer-events-auto border-t border-white/5 bg-[#03020d]/80 px-4 pb-4 pt-2 backdrop-blur-md md:hidden">
          <div className="grid grid-cols-2 gap-2">
            {sections.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  playUi();
                  goTo(i);
                  setOpen(false);
                }}
                className={`rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                  active === i
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                {s.nav}
              </button>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
