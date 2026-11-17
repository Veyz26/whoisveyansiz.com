import { More, Stop } from "./Stop";

// Outcomes from the CV: the figure, a few words, and the work behind it on request.
const results = [
  { figure: "€7 000 a month", unit: "approximate saving, GitLab decommission at Derivco", what: "Planned and executed the GitLab decommission at Derivco, with a compliant seven-year backup strategy." },
  { figure: "€20 000 a year", unit: "estimated saving, Azure disk optimisation at Derivco", what: "Analysed Azure disk performance and cost at Derivco." },
];

export function Results() {
  return (
    <Stop id="results" title="Results" line="Cost savings delivered at Derivco.">
      <ul className="space-y-3">
        {results.map((r) => (
          <li key={r.figure}>
            <p className="text-2xl font-semibold tracking-tight text-bone sm:text-[26px]">{r.figure}</p>
            <p className="text-sm text-slate">{r.unit}</p>
          </li>
        ))}
      </ul>
      <More>
        <ul className="space-y-3">
          {results.map((r) => <li key={r.figure}><span className="text-bone">{r.figure}:</span> {r.what}</li>)}
        </ul>
      </More>
    </Stop>
  );
}
