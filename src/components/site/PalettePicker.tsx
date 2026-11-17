"use client";

import { useEffect, useState } from "react";

// For comparing colour schemes: shown only when the page was opened with ?palette=..., and each choice
// reloads the page in that scheme (the 3D scene reads its colours when it starts).
const PALETTES = [
  ["steel", "Steel"], ["night", "Night shift"], ["mission", "Mission control"], ["aurora", "Aurora"], ["abyss", "Abyss"], ["eclipse", "Eclipse"],
] as const;

export function PalettePicker() {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => { setCurrent(new URLSearchParams(location.search).get("palette")); }, []);
  if (current === null) return null;
  return (
    <nav aria-label="Colour scheme preview" className="panel fixed right-4 top-20 z-50 p-3 text-sm lg:right-12">
      <p className="mb-2 text-xs text-slate">Colour scheme</p>
      <ul className="grid gap-1">
        {PALETTES.map(([id, label]) => (
          <li key={id}>
            <a href={`?palette=${id}`} aria-current={(current || "steel") === id ? "true" : undefined}
              className={`flex items-center gap-2 rounded px-2 py-1 ${(current || "steel") === id ? "bg-panel-2 text-bone" : "text-bone/70 hover:text-bone"}`}>
              <span aria-hidden className="h-3 w-3 rounded-full" data-swatch={id} />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
