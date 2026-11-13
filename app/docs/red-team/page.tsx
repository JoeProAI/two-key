import type { ReactNode } from "react";
import { DocHead, Next, Source } from "../kit";
import { ATTACKS } from "./attacks";

/** Backtick spans become code. Everything else stays text. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) =>
    part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : <span key={index}>{part}</span>,
  );
}

export default function RedTeam() {
  return (
    <article>
      <DocHead kicker="Red team" title={`${ATTACKS.length} attacks, each with the test that answers it.`}>
        <p>Run everything with <code>npm ci && npm run proof</code>. Matrix rows come from <code>npm run matrix</code>.</p>
      </DocHead>
      <ol className="attacks">
        {ATTACKS.map(([attack, answer, proof], index) => (
          <li key={attack} id={`attack-${index + 1}`}>
            <h2>{attack.replace(/^"|"$/g, "")}</h2>
            <p>{inline(answer)}</p>
            <p className="attack-proof"><b className="attack-label">Proof</b> {inline(proof)}</p>
          </li>
        ))}
      </ol>
      <Source paths={["docs/RED-TEAM.md"]} />
      <Next href="/docs/evidence" label="Evidence" />
    </article>
  );
}
