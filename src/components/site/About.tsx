import { cvData } from "@/data/cv";
import { Stop } from "./Stop";

const current = cvData.experience[0];
const facts = [
  { term: "Role", value: "Platform Engineer" },
  { term: "Employer", value: current.company },
  { term: "Focus", value: "SRE and DevOps" },
  { term: "Experience", value: "7+ years" },
];

export function About() {
  return (
    <Stop id="about" title="About"
      line="Over seven years in infrastructure and operations, from the service desk to DevOps and systems engineering.">
      <p className="mb-4 text-[15px] leading-relaxed text-bone/80">
        I keep infrastructure available, secure and cost-effective. At {current.company}: high-availability Windows and
        Linux environments, patching and disaster recovery. At Derivco: Azure automation, DevOps platforms and cost reduction.
      </p>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
        {facts.map((f) => (
          <div key={f.term}>
            <dt className="text-xs text-slate">{f.term}</dt>
            <dd className="mt-0.5 text-sm text-bone">{f.value}</dd>
          </div>
        ))}
      </dl>
    </Stop>
  );
}
