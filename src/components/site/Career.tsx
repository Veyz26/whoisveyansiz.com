"use client";

import { useState } from "react";
import { cvData } from "@/data/cv";
import { More, Stop } from "./Stop";

// The career as one timeline: each role's bar is as wide as the time spent in it. Tapping a bar shows that
// role in a sentence; its full list of duties is behind "Show details".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const toIdx = (s: string) => {
  const [m, y] = s.trim().split(/\s+/);
  return +y * 12 + MONTHS.indexOf(m);
};
const now = new Date();
const nowIdx = now.getFullYear() * 12 + now.getMonth();

const roles = cvData.experience.map((job) => {
  const [a, b] = job.period.split(/\s+[–-]\s+/);
  const start = toIdx(a);
  // A role that hasn't begun yet gets a one-month sliver and reads "Starts <month>"; a role whose end month
  // hasn't arrived reads as running to now.
  const upcoming = start > nowIdx;
  const end = (b === "Present" || toIdx(b) > nowIdx ? Math.max(nowIdx, start) : toIdx(b)) + 1;
  const period = upcoming ? `Starts ${a}` : toIdx(b) > nowIdx ? `${a} – Present` : job.period;
  return { ...job, period, start, end, upcoming };
});
const first = Math.min(...roles.map((r) => r.start));
const last = Math.max(...roles.map((r) => r.end));
const span = last - first;
// One colour per employer from the palette: the two Capitec roles in steps of the accent, the long Derivco
// stretch in three steps of the network's link colour, the first job in muted text.
const SHADE = [
  "var(--c-accent)", "color-mix(in srgb, var(--c-accent) 62%, var(--c-space))", "var(--c-edge)", "color-mix(in srgb, var(--c-edge) 72%, var(--c-space))",
  "color-mix(in srgb, var(--c-edge) 50%, var(--c-space))", "color-mix(in srgb, var(--c-slate) 70%, var(--c-space))",
];

const duration = (months: number) => {
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(" ");
};
const years: number[] = [];
for (let y = Math.ceil(first / 12); y * 12 <= last; y += 2) years.push(y);

export function Career() {
  const [open, setOpen] = useState(Math.max(0, roles.findIndex((r) => !r.upcoming)));
  const role = roles[open];
  return (
    <Stop id="work" title="Experience" line="Six roles since 2018, from service desk to platform engineering. Select one for details.">
      {/* Each bar is labelled with its employer; a role that hasn't started is a striped tab at the end, wide
          enough to tap. The selected bar is fully lit and outlined. */}
      <div className="relative h-10 rounded bg-panel-2" role="group" aria-label="Career timeline">
        {roles.map((r, i) => (
          <button
            key={i}
            onClick={() => setOpen(i)}
            aria-pressed={open === i}
            aria-label={`${r.title}, ${r.company}, ${r.period}`}
            className={`absolute inset-y-0 overflow-hidden border-r-2 border-panel px-1.5 text-left text-[10px] font-semibold text-space transition-[filter,opacity] hover:brightness-110 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bone ${i === 0 ? "rounded-r" : ""} ${i === roles.length - 1 ? "rounded-l" : ""}`}
            style={{
              ...(r.upcoming
                ? { right: 0, width: 22, backgroundImage: `repeating-linear-gradient(135deg, ${SHADE[i]} 0 4px, transparent 4px 7px)` }
                : { left: `${((r.start - first) / span) * 100}%`, width: `${((r.end - r.start) / span) * 100}%`, background: SHADE[i] }),
              opacity: open === i ? 1 : 0.72,
              boxShadow: open === i ? "inset 0 0 0 2px var(--c-bone)" : undefined,
            }}
          >
            {!r.upcoming && <span aria-hidden className="block truncate">{r.company.split(" ")[0]}</span>}
          </button>
        ))}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-slate">
        {years.map((y) => (
          <span key={y} className="absolute -translate-x-1/2" style={{ left: `${((y * 12 - first) / span) * 100}%` }}>{y}</span>
        ))}
      </div>
      <div className="mt-4" aria-live="polite">
        <p className="text-base font-medium text-bone">{role.title}</p>
        <p className="text-sm text-slate">{role.company}, {role.period}{role.upcoming ? "" : ` (${duration(role.end - role.start)})`}</p>
        <p className="mt-2 text-sm leading-relaxed text-bone/85">{role.summary}</p>
        {role.highlights.length > 0 && <More key={open}>
          <ul className="space-y-2">
            {role.highlights.map((h) => (
              <li key={h} className="grid grid-cols-[12px_1fr] gap-2">
                <span aria-hidden className="mt-[0.6em] h-1 w-1 rounded-full" style={{ background: SHADE[open] }} />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </More>}
      </div>
    </Stop>
  );
}
