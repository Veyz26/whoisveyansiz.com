import { cvData } from "@/data/cv";

// The CV as a printable A4 document, built from the same data as the site so the two never disagree.
// `full` is every duty; `one-page` keeps the two most relevant duties for the two most relevant roles and a
// summary line for the rest. Phone and email are left out on purpose (the site is public); the contact line
// points to the site's form and LinkedIn instead. scripts/make-cv-pdfs.mjs prints both to PDF after the build.

const SITE = "whoisveyansiz.com";
const ONE_PAGE_PICKS: Record<string, number[]> = { "System Engineer II": [0, 2], "DevOps Engineer II": [2, 3] };

const link = (href: string) => href.replace(/^https?:\/\/(www\.)?/, "");

export function CvDocument({ variant }: { variant: "full" | "one-page" }) {
  const full = variant === "full";
  const { personal, profile, experience, certifications, education, skills } = cvData;
  return (
    <article className={`cv-sheet ${full ? "" : "cv-compact"}`}>
      <header className="cv-head">
        <h1 className="cv-name">{personal.name}</h1>
        <p className="cv-role">Platform Engineer, specialising in site reliability and DevOps</p>
        <p className="cv-contact">
          <span>{personal.location}, South Africa</span>
          <a href={`https://${SITE}/#contact`}>{SITE} (contact form)</a>
          <a href={personal.linkedin}>{link(personal.linkedin)}</a>
          <a href={personal.github}>{link(personal.github)}</a>
        </p>
      </header>

      <section>
        <h2 className="cv-h">Profile</h2>
        <p>{profile}</p>
      </section>

      <section>
        <h2 className="cv-h">Experience</h2>
        {experience.map((job) => {
          const picks = full ? job.highlights.map((_, i) => i) : (ONE_PAGE_PICKS[job.title] ?? []);
          return (
            <div key={job.title + job.period} className="cv-job">
              <div className="cv-job-head">
                <div className="cv-job-line">
                  <p><strong>{job.title}</strong>, {job.company}</p>
                  <p className="cv-muted cv-nowrap">{job.period}</p>
                </div>
                <p className="cv-summary">{job.summary}</p>
              </div>
              {picks.length > 0 && (
                <ul className="cv-list">
                  {picks.map((i) => <li key={i}>{job.highlights[i]}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      <section className="cv-keep">
        <h2 className="cv-h">Skills</h2>
        {Object.entries(skills.technical).map(([group, items]) => (
          <p key={group} className="cv-skill"><strong>{group}:</strong> {items.join(", ")}</p>
        ))}
      </section>

      <section className="cv-keep">
        <h2 className="cv-h">Certifications</h2>
        <ul className="cv-rows">
          {certifications.map((c) => (
            <li key={c.name}><span>{c.name}</span><span className="cv-muted">{c.issuer}, {c.year}</span></li>
          ))}
        </ul>
      </section>

      <section className="cv-keep">
        <h2 className="cv-h">Education</h2>
        <ul className="cv-rows">
          {education.map((e) => (
            <li key={e.degree}><span>{e.degree} ({e.note.toLowerCase()})</span><span className="cv-muted">{e.institution}, {e.period}</span></li>
          ))}
        </ul>
      </section>
    </article>
  );
}

// The bar above the sheet on screen (hidden in print): download the PDF or print.
export function CvToolbar({ pdf, other }: { pdf: string; other: { href: string; label: string } }) {
  return (
    <nav className="cv-toolbar" aria-label="CV">
      <a href="/" className="cv-back">Back to the site</a>
      <div className="cv-actions">
        <a href={other.href}>{other.label}</a>
        <a href={pdf} download className="btn-primary !py-2 !text-sm">Download PDF</a>
      </div>
    </nav>
  );
}
