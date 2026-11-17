"use client";

import { useState, type FormEvent } from "react";
import { cvData } from "@/data/cv";

// This is a fully static site — there is no server to post to. The form
// relays through a third-party form service (Formspree, Web3Forms, etc.)
// whose endpoint is baked in at build time via NEXT_PUBLIC_CONTACT_ENDPOINT.
// Keeping the address in an env var means the personal email and phone number
// still never appear in the client bundle.
const CONTACT_ENDPOINT = process.env.NEXT_PUBLIC_CONTACT_ENDPOINT ?? "";

// What's on the terminal at the end of the data hall. The journey draws this same form onto the 3D screen in
// perspective (at the screen's shape) and glides it into place, where it becomes live. `compact` is the stacked
// layout phones get, on their portrait screen and live alike; `fill` stretches it to the screen's height.
export function ContactTerminal({ live, compact = false, fill = false, headingId }: { live: boolean; compact?: boolean; fill?: boolean; headingId?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to submit");
      setState("sent");
      setForm({ name: "", email: "", message: "" });
    } catch {
      setState("error");
    }
  };

  const label = "mb-1 block text-xs text-slate";
  const field = "w-full rounded-sm border border-screen/25 bg-space/80 px-3 py-2 text-sm text-bone outline-none focus:border-screen/70";
  const link = "text-sm text-bone/85 underline decoration-screen/40 underline-offset-4 hover:text-bone";
  return (
    <div className={`terminal flex flex-col ${compact && !fill ? "" : "h-full"}`} inert={!live}>
      <div className="flex items-center justify-between border-b border-screen/20 px-5 py-2.5 text-xs text-slate">
        <span>veyansiz@datahall: ~/contact</span>
        <a href="/private/" className="hover:text-bone">Private area</a>
      </div>
      <div className={compact ? "grid flex-1 content-center gap-5 p-5" : "grid flex-1 grid-cols-[1fr_1.35fr] content-center gap-10 px-10 py-8"}>
        <div>
          <p className="terminal-prompt text-xs text-ok">$ ./contact</p>
          <h2 id={headingId} className="card-title mt-3 text-bone">Contact</h2>
          <p className="mt-2 text-sm leading-relaxed text-bone/80">
            Open to conversations about platform engineering, site reliability and DevOps. Messages reach me by email.
          </p>
          <div className="mt-5 flex flex-wrap gap-4">
            <a className={link} href={cvData.personal.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <a className={link} href={cvData.personal.github} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className={link} href="/cv/Veyansiz-Chetty-CV-one-page.pdf" download>CV, one page</a>
            <a className={link} href="/cv/Veyansiz-Chetty-CV.pdf" download>CV, full</a>
          </div>
          <p className="mt-5 text-xs text-slate">{cvData.personal.location}, South Africa</p>
        </div>
        <form onSubmit={submit} className="grid content-start gap-3">
          <div className={compact ? "grid gap-3" : "grid grid-cols-2 gap-3"}>
            <div>
              <label htmlFor={`${headingId}-name`} className={label}>Name</label>
              <input id={`${headingId}-name`} required autoComplete="name" value={form.name} onChange={set("name")} className={field} />
            </div>
            <div>
              <label htmlFor={`${headingId}-email`} className={label}>Email</label>
              <input id={`${headingId}-email`} type="email" required autoComplete="email" value={form.email} onChange={set("email")} className={field} />
            </div>
          </div>
          <div>
            <label htmlFor={`${headingId}-message`} className={label}>Message</label>
            <textarea id={`${headingId}-message`} required rows={compact ? 4 : 6} value={form.message} onChange={set("message")} className={`${field} resize-none`} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={state === "sending" || !CONTACT_ENDPOINT} className="btn-primary !py-2 !text-sm">
              {state === "sending" ? "Sending…" : "Send message"}
            </button>
            {state === "sent" && <span role="status" className="text-sm text-ok">Message sent. I will reply by email.</span>}
            {state === "error" && <span role="alert" className="text-sm text-accent">Message not sent. Please try again or use LinkedIn.</span>}
          </div>
          {!CONTACT_ENDPOINT && <p className="text-xs text-slate">The form is not available yet. Please use LinkedIn.</p>}
        </form>
      </div>
    </div>
  );
}

// The last stop. Its length of scroll is the flight down the hall into the screen; the form itself is drawn by
// the journey. Without WebGL there is no screen, so the form shows here instead.
export function Contact() {
  // Keyboard path to the form on the screen: focusing this link flies to the end of the hall and, once the
  // form is live, moves focus into it.
  const toForm = () => {
    if (!document.documentElement.hasAttribute("data-webgl")) return;
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    let tries = 0;
    const t = setInterval(() => {
      const input = document.querySelector<HTMLInputElement>(".screen-ui input");
      if ((input && !input.closest("[inert]")) || ++tries > 30) { clearInterval(t); input?.focus({ preventScroll: true }); }
    }, 100);
  };
  return (
    <section id="contact" aria-label="Contact" className="pointer-events-none relative z-10 min-h-[170svh]">
      <a href="#contact" onFocus={toForm}
        className="sr-only focus:not-sr-only focus:pointer-events-auto focus:fixed focus:left-4 focus:top-20 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:text-bone">
        Go to the contact form
      </a>
      <div className="contact-fallback pointer-events-auto sticky top-24 mx-auto w-[min(60rem,calc(100vw-1.5rem))] pt-[30svh]">
        <ContactTerminal live compact headingId="contact-title" />
      </div>
    </section>
  );
}
