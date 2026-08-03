"use client";

import { useState, type FormEvent } from "react";
import { cvData } from "@/data/cv";
import { sections } from "./constants";
import { playUi } from "@/lib/spaceAudio";
import {
  MapPin,
  Github,
  Linkedin,
  Send,
  CheckCircle,
  AlertCircle,
  Cloud,
  Terminal,
  Shield,
  TrendingUp,
  ChevronDown,
} from "lucide-react";

// All textual content for the experience, laid out as six sections sized to
// `--vph` (the real container height drei uses for its scroll pages) so they
// stay in lock-step with the camera on every device. The 3D layer behind is
// purely visual; everything readable / interactive lives here. Layouts are
// dense on mobile so each section fits one viewport without clipping.
//
// Pointer events: shells and display panels are click-through so that (a)
// touch-dragging anywhere scrolls, and (b) the canvas behind still receives
// hover for the interactive asteroids. Only genuinely interactive things
// (links, the contact form) opt back in via `interactive` / pointer-events-auto.

function Panel({
  children,
  className = "",
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md shadow-2xl ${
        interactive ? "pointer-events-auto" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

function SectionShell({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{ height: "var(--vph, 100vh)" }}
      className="pointer-events-none relative flex w-screen items-start justify-center px-5 pt-16 pb-6 sm:items-center sm:px-8 sm:py-16"
    >
      <div className="w-full max-w-5xl">{children}</div>
    </section>
  );
}

function Kicker({ i }: { i: number }) {
  return (
    <p
      className="font-space mb-2 text-[10px] font-medium uppercase tracking-[0.3em] sm:text-xs"
      style={{ color: sections[i].color }}
    >
      {sections[i].kicker}
    </p>
  );
}

const highlights = [
  { icon: Cloud, title: "Cloud Engineering", desc: "Azure infrastructure, DevOps platforms, scalable cloud" },
  { icon: Terminal, title: "Automation", desc: "PowerShell, CI/CD pipelines, infrastructure-as-code" },
  { icon: Shield, title: "Security & Access", desc: "RBAC, Okta, Entra ID, secure provisioning" },
  { icon: TrendingUp, title: "Cost Optimization", desc: "€20K+ annual savings through data-driven analysis" },
];

export function Overlay() {
  return (
    <>
      <HeroSection />
      <AboutSection />
      <ExperienceSection />
      <SkillsSection />
      <EducationSection />
      <ContactSection />
    </>
  );
}

// ── 00 Hero ──────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <SectionShell id="home">
      {/* radial scrim keeps the title legible over the glowing core */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[70vh] w-[70vh] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(3,2,13,0.82) 0%, rgba(3,2,13,0.55) 40%, rgba(3,2,13,0) 72%)",
        }}
      />
      <div className="flex h-full flex-col items-center justify-center text-center sm:h-auto">
        <div className="mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm backdrop-blur-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-white/90">Available for opportunities</span>
        </div>

        <h1 className="bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent sm:text-7xl lg:text-8xl">
          {cvData.personal.name}
        </h1>

        <p className="font-space mx-auto mt-6 max-w-2xl text-base font-light text-indigo-100/80 sm:text-2xl">
          {cvData.personal.title}
        </p>

        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-white/50">
          <MapPin size={14} />
          {cvData.personal.location}
        </p>

        <div className="mt-12 flex flex-col items-center gap-2 text-white/40">
          <span className="text-xs uppercase tracking-[0.3em]">Scroll to launch</span>
          <ChevronDown size={18} className="animate-bounce" />
        </div>
      </div>
    </SectionShell>
  );
}

// ── 01 About ─────────────────────────────────────────────────────────
function AboutSection() {
  return (
    <SectionShell id="about">
      <div className="grid items-center gap-5 lg:grid-cols-2 lg:gap-8">
        <div>
          <Kicker i={1} />
          <h2 className="mb-3 text-2xl font-bold text-white sm:mb-5 sm:text-4xl">
            Building the cloud, one pipeline at a time
          </h2>
          <p className="line-clamp-6 text-sm leading-relaxed text-white/70 sm:line-clamp-none sm:text-base">
            {cvData.profile}
          </p>
          <div className="mt-4 flex gap-8 sm:mt-6">
            <div>
              <p className="bg-gradient-to-r from-white to-purple-300 bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">7+</p>
              <p className="text-xs text-white/50">Years Experience</p>
            </div>
            <div>
              <p className="bg-gradient-to-r from-white to-purple-300 bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">€27K+</p>
              <p className="text-xs text-white/50">Annual Savings</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {highlights.map((h) => (
            <Panel key={h.title} className="p-3 sm:p-5">
              <div className="mb-2 inline-flex rounded-lg bg-purple-500/15 p-2 text-purple-200 sm:mb-3 sm:rounded-xl sm:p-2.5">
                <h.icon size={18} />
              </div>
              <h3 className="text-sm font-semibold text-white">{h.title}</h3>
              <p className="mt-1 hidden text-xs text-white/55 sm:block">{h.desc}</p>
            </Panel>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

// ── 02 Experience ────────────────────────────────────────────────────
function ExperienceSection() {
  return (
    <SectionShell id="experience">
      <div>
        <div className="mb-4 text-center sm:mb-6">
          <Kicker i={2} />
          <h2 className="text-2xl font-bold text-white sm:text-4xl">Career Trajectory</h2>
          <p className="mt-2 hidden text-xs text-white/40 sm:block">Hover an asteroid to see the role</p>
        </div>
        <div className="space-y-2 sm:space-y-3">
          {cvData.experience.map((job, i) => (
            <Panel key={`${job.company}-${i}`} className="flex items-center justify-between gap-2 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                    i === 0 ? "bg-sky-400 shadow-[0_0_10px_2px_rgba(56,189,248,0.7)]" : "bg-white/30"
                  }`}
                />
                <div>
                  <h3 className="text-sm font-semibold text-white">{job.title}</h3>
                  <p className="text-xs text-sky-200/70">{job.company}</p>
                </div>
              </div>
              <span className="whitespace-nowrap text-[11px] text-white/45 sm:text-xs">{job.period}</span>
            </Panel>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

// ── 03 Skills ────────────────────────────────────────────────────────
function SkillsSection() {
  const categories = Object.entries(cvData.skills.technical);
  return (
    <SectionShell id="skills">
      <div>
        <div className="mb-4 text-center sm:mb-6">
          <Kicker i={3} />
          <h2 className="text-2xl font-bold text-white sm:text-4xl">The Tech Constellation</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
          {categories.map(([cat, items]) => (
            <Panel key={cat} className="p-3 sm:p-4">
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200/80 sm:mb-2 sm:text-xs">{cat}</h3>
              <div className="flex flex-wrap gap-1">
                {items.map((s) => (
                  <span key={s} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/75 sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-xs">
                    {s}
                  </span>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

// ── 04 Education + Certifications ─────────────────────────────────────
function EducationSection() {
  return (
    <SectionShell id="education">
      <div>
        <div className="mb-4 text-center sm:mb-6">
          <Kicker i={4} />
          <h2 className="text-2xl font-bold text-white sm:text-4xl">Credentials in Orbit</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-orange-200/80 sm:text-xs">Education</h3>
            <div className="space-y-1.5 sm:space-y-2">
              {cvData.education.map((e, i) => (
                <Panel key={i} className="flex items-center justify-between gap-3 p-2.5 sm:p-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white sm:text-sm">{e.degree}</p>
                    <p className="text-[11px] text-white/50">{e.institution}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {"note" in e && e.note ? (
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300/90">
                        {e.note}
                      </span>
                    ) : null}
                    <span className="whitespace-nowrap text-[11px] text-white/40">{e.period}</span>
                  </div>
                </Panel>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-orange-200/80 sm:text-xs">Certifications</h3>
            <Panel className="p-3 sm:p-4">
              <div className="flex flex-wrap gap-1 sm:gap-1.5">
                {cvData.certifications.map((c) => (
                  <span key={c.name} className="rounded-md bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-100/80 sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-xs">
                    {c.name}
                  </span>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

// ── 05 Contact ───────────────────────────────────────────────────────
// This is a fully static site — there is no server to post to. The form
// relays through a third-party form service (Formspree, Web3Forms, etc.)
// whose endpoint is baked in at build time via NEXT_PUBLIC_CONTACT_ENDPOINT.
// Keeping the address in an env var means the personal email and phone number
// still never appear in the client bundle.
const CONTACT_ENDPOINT = process.env.NEXT_PUBLIC_CONTACT_ENDPOINT ?? "";

function ContactSection() {
  const [formState, setFormState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [formData, setFormData] = useState({ name: "", email: "", subject: "", message: "" });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    playUi();
    setFormState("submitting");
    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to submit");
      setFormState("success");
      setFormData({ name: "", email: "", subject: "", message: "" });
      setTimeout(() => setFormState("idle"), 8000);
    } catch {
      setFormState("error");
      setTimeout(() => setFormState("idle"), 5000);
    }
  };

  const field =
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-pink-400/50 focus:ring-1 focus:ring-pink-400/40";

  return (
    <SectionShell id="contact">
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Kicker i={5} />
          <h2 className="mb-2 text-2xl font-bold text-white sm:mb-4 sm:text-4xl">Let&apos;s Connect</h2>
          <p className="mb-6 hidden text-sm text-white/60 sm:block">
            Have an opportunity, question, or just want to say hello? Send a message — it reaches me by email and WhatsApp instantly.
          </p>

          {/* Desktop: full link rows */}
          <div className="hidden space-y-2 sm:block">
            <a href={cvData.personal.github} target="_blank" rel="noopener noreferrer" className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/80 transition-colors hover:border-white/25">
              <Github size={18} /> github.com/Veyz26
            </a>
            <a href={cvData.personal.linkedin} target="_blank" rel="noopener noreferrer" className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/80 transition-colors hover:border-white/25">
              <Linkedin size={18} /> linkedin.com/in/veyansiz
            </a>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/60">
              <MapPin size={18} /> {cvData.personal.location}
            </div>
          </div>

          {/* Mobile: compact icon links */}
          <div className="mb-3 flex gap-2 sm:hidden">
            <a href={cvData.personal.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80">
              <Github size={18} />
            </a>
            <a href={cvData.personal.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80">
              <Linkedin size={18} />
            </a>
            <span className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs text-white/55">
              <MapPin size={14} /> {cvData.personal.location}
            </span>
          </div>
        </div>

        <Panel interactive className="p-4 sm:p-6 lg:col-span-3">
          <form onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                required
                placeholder="Your name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={field}
              />
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={field}
              />
            </div>
            <input
              type="text"
              placeholder="Subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              className={`${field} mt-3`}
            />
            <textarea
              required
              rows={3}
              placeholder="Your message..."
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              className={`${field} mt-3 resize-none`}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={formState === "submitting" || !CONTACT_ENDPOINT}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 px-7 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:brightness-110 disabled:opacity-50"
              >
                {formState === "submitting" ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={16} /> Send Message
                  </>
                )}
              </button>

              {formState === "success" && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                  <CheckCircle size={16} /> Sent!
                </span>
              )}

              {formState === "error" && (
                <span className="flex items-center gap-1.5 text-sm text-red-400">
                  <AlertCircle size={16} /> Failed. Try again.
                </span>
              )}
            </div>

            {!CONTACT_ENDPOINT && (
              <p className="mt-3 text-xs text-amber-400/80">
                Messaging isn&apos;t wired up yet — please reach me on LinkedIn in the meantime.
              </p>
            )}
          </form>
        </Panel>
      </div>
    </SectionShell>
  );
}
