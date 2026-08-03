import { create } from "zustand";
import { PAGES } from "@/components/space/constants";

// Bridges the in-canvas scroll value (drei ScrollControls) to the
// fixed DOM chrome (side nav, hints) that lives outside the Canvas.
// `active` only updates when the rounded section changes, so React
// subscribers re-render rarely rather than every animation frame.

interface ExperienceState {
  active: number;
  entered: boolean;
  scrollEl: HTMLElement | null;
  setActive: (offset: number) => void;
  setEntered: (v: boolean) => void;
  register: (el: HTMLElement | null) => void;
  goTo: (i: number) => void;
}

export const useExperience = create<ExperienceState>((set, get) => ({
  active: 0,
  entered: false,
  scrollEl: null,

  setActive: (offset: number) => {
    const next = Math.round(offset * (PAGES - 1));
    if (next !== get().active) set({ active: next });
  },

  setEntered: (v: boolean) => {
    if (v !== get().entered) set({ entered: v });
  },

  register: (el: HTMLElement | null) => {
    if (el && el !== get().scrollEl) set({ scrollEl: el });
  },

  goTo: (i: number) => {
    const el = get().scrollEl;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const top = (i / (PAGES - 1)) * max;
    el.scrollTo({ top, behavior: "smooth" });
  },
}));
