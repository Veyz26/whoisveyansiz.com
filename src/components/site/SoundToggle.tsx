"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { sound } from "./sound";

// Turns the music and sound effects on and off. If the visitor left sound on last time, it comes back on at
// their first click or key press (browsers don't allow audio before that).
export function SoundToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const s = sound;
    if (!s) return;
    const off = s.subscribe(setOn);
    let resume: ((e?: Event) => void) | null = null;
    if (s.wanted()) {
      // A first click on this button turns sound on by itself, so it doesn't count here.
      resume = (e?: Event) => {
        if (!(e?.target as Element | null)?.closest?.("[data-sound-toggle]")) s.enable();
        cleanup();
      };
      addEventListener("pointerdown", resume, { once: true });
      addEventListener("keydown", resume, { once: true });
    }
    function cleanup() {
      if (!resume) return;
      removeEventListener("pointerdown", resume);
      removeEventListener("keydown", resume);
      resume = null;
    }
    return () => { off(); cleanup(); };
  }, []);
  return (
    <button type="button" data-sound-toggle onClick={() => sound?.toggle()} aria-pressed={on}
      aria-label={on ? "Turn sound off" : "Turn sound on (music and effects)"} title={on ? "Sound on" : "Sound off"}
      className="flex h-11 w-10 items-center sm:w-11 justify-center rounded-md border border-line text-bone/75 transition-colors hover:text-bone">
      {on ? <Volume2 size={17} /> : <VolumeX size={17} />}
    </button>
  );
}
