import { cvData } from "@/data/cv";
import { More, Stop } from "./Stop";

// The tools he uses most, then exam-based certifications only (no courses or training).
const CORE = ["Microsoft Azure", "Azure DevOps", "GitLab CI/CD", "PowerShell", "Ansible", "Windows Server", "Red Hat Enterprise Linux", "VMware", "Docker", "AWS", "Kubernetes", "Python"];
const SHOWN = ["AWS Certified Solutions Architect – Associate", "Kubernetes and Cloud Native Associate (KCNA)", "AWS Certified Cloud Practitioner", "LPI Linux Essentials", "ITIL 4 Foundation"];
const shown = cvData.certifications.filter((c) => SHOWN.includes(c.name));

export function Skills() {
  return (
    <Stop id="skills" title="Skills and credentials" line="Core tools and certifications.">
      <p className="text-sm leading-relaxed text-bone">{CORE.join(", ")}. Learning Terraform.</p>
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {shown.map((c) => (
          <li key={c.name} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
            <span className="text-bone">{c.name}</span>
            <span className="shrink-0 text-slate">{c.year}</span>
          </li>
        ))}
      </ul>
      <More label="Show all skills and credentials">
        <dl className="space-y-2">
          {Object.entries(cvData.skills.technical).map(([group, items]) => (
            <div key={group}>
              <dt className="text-bone">{group}</dt>
              <dd className="text-slate">{items.join(", ")}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-5 text-bone">Certifications</h3>
        <ul className="mt-1.5 space-y-1.5">
          {cvData.certifications.map((c) => (
            <li key={c.name}><span className="text-bone/90">{c.name}</span> <span className="text-slate">{c.issuer}, {c.year.toLowerCase()}</span></li>
          ))}
        </ul>
        <h3 className="mt-5 text-bone">Education</h3>
        <ul className="mt-1.5 space-y-1.5">
          {cvData.education.map((e) => (
            <li key={e.degree}><span className="text-bone/90">{e.degree}</span> <span className="text-slate">{e.institution}, {e.period}, {e.note.toLowerCase()}</span></li>
          ))}
        </ul>
      </More>
    </Stop>
  );
}
