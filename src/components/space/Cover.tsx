"use client";

import { ArrowRight, Volume2 } from "lucide-react";
import { cvData } from "@/data/cv";

// Cinematic entry screen shown over the live starfield. Doubles as the loader:
// the Enter button stays disabled until the WebGL context is ready. Clicking
// Enter is the user gesture that lets the soundtrack start, so the music plays
// from the moment the visitor enters the experience.

export function Cover({
  ready,
  hidden,
  onEnter,
}: {
  ready: boolean;
  hidden: boolean;
  onEnter: () => void;
}) {
  return (
    <div
      className={`font-space fixed inset-0 z-[70] flex flex-col items-center justify-center px-6 text-center transition-opacity duration-1000 ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* scrim so the title reads cleanly over the stars */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(3,2,13,0.6) 0%, rgba(3,2,13,0.82) 58%, #03020d 100%)",
        }}
      />

      <p className="mb-5 text-[11px] uppercase tracking-[0.35em] text-indigo-300/70 sm:text-xs sm:tracking-[0.4em]">
        {cvData.personal.title}
      </p>

      <h1 className="bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent sm:text-7xl lg:text-8xl">
        {cvData.personal.name}
      </h1>

      <p className="mt-6 max-w-md text-sm text-white/50">
        A cinematic flight through a career in cloud, platforms and automation.
      </p>

      <button
        onClick={onEnter}
        disabled={!ready}
        className="group mt-12 inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/10 px-8 py-3.5 text-sm font-medium text-white backdrop-blur-md transition-all hover:bg-white/20 disabled:cursor-default disabled:opacity-40"
      >
        {ready ? (
          <>
            <span>Enter</span>
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </>
        ) : (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Initializing…
          </>
        )}
      </button>

      <p className="mt-5 flex items-center gap-2 text-[11px] text-white/35">
        <Volume2 size={13} /> Sound on · best experienced with headphones
      </p>
    </div>
  );
}
