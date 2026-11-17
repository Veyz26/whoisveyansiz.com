import { cvData } from "@/data/cv";
import { CvButton } from "./CvButton";

// The first stop: the words over the network. The section lets the pointer through to the scene,
// so the systems can be pointed at; only the buttons take clicks.
export function Hero() {
  return (
    <section id="top" className="pointer-events-none relative z-10">
      <div aria-hidden className="hero-scrim absolute inset-0" />
      <div className="relative mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl flex-col justify-end px-5 pb-14 pt-40 sm:px-8 lg:justify-center lg:pb-20 lg:pt-16">
        <p className="flex items-center gap-2.5 text-sm text-bone/85">
          <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
          Platform Engineer at {cvData.experience[0].company}
        </p>
        <h1 className="display-name mt-5 text-[clamp(32px,4.4vw,64px)] text-bone">
          Veyansiz<br />Chetty
        </h1>
        <p className="mt-6 max-w-[30rem] text-lg leading-relaxed text-bone/90 sm:text-xl">
          Platform Engineer specialising in site reliability and DevOps. Over seven years keeping infrastructure stable, secure and cost-effective through automation.
        </p>
        <div className="pointer-events-auto mt-8 flex flex-wrap gap-3">
          <a href="#contact" className="btn-primary">Get in touch</a>
          <a href="#work" className="btn-ghost bg-space/60">View experience</a>
          <CvButton />
        </div>
        <p className="mt-10 text-sm text-slate">Scroll to explore</p>
      </div>
    </section>
  );
}
