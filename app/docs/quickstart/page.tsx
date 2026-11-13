import { Cmd, DocHead, Next, Source, Table } from "../kit";

export default function Quickstart() {
  return (
    <article>
      <DocHead kicker="Quickstart" title="No keys. No login. One command.">
        <p>Node 20.9 or newer (tested on Node 22 and 24) and at least 2 GiB of RAM for the Next.js build.</p>
      </DocHead>

      <Cmd note="Install check, npm run check, demo, demo -- rerun, matrix, then the SANDBOX corridor only if sandbox keys are set.">{"git clone https://github.com/JoeProAI/two-key.git\ncd two-key\nnpm ci && npm run proof"}</Cmd>

      <p>
        <code>npm run proof</code> writes <code>artifacts/proof/summary.md</code> plus one log per step. It fails if the Northwind
        demo does not pay once, if the rerun is not <code>already_done</code> with zero new calls, or if any matrix row fails.
        Without sandbox keys the sandbox step prints <code>SANDBOX skipped</code> and names the missing variables. It never invents a sandbox id.
      </p>

      <h2>Open the desk</h2>
      <Cmd note="Then open http://localhost:3000/fixture">npm run dev</Cmd>

      <h2>Proof commands</h2>
      <Table
        head={["Command", "What it shows"]}
        rows={[
          [<code key="c">npm run check</code>, "Lint, typecheck, the full vitest suite, then a production build scanned for leaked key names and values."],
          [<code key="c">npm run demo</code>, "The scripted $40k scenario. Prints the receipt: Goal, Plan, New information, Revised decision, Resulting state."],
          [<code key="c">npm run demo -- rerun</code>, "The second run comes back already_done. No second send."],
          [<code key="c">npm run demo -- replay</code>, "Pay once, then a fresh process reconciles the same actions and the same provider ids."],
          [<code key="c">npm run demo -- deposit</code>, "A USD 18000 deposit after the block shrinks the FX buy from 28000 to 10000."],
          [<code key="c">npm run demo -- stale-quote</code>, "A 1-minute quote goes stale, the Wringer blocks, the planner re-quotes."],
          [<code key="c">npm run demo -- approval</code>, "A $25k payout waits 90 minutes for the tap, then pays once."],
          [<code key="c">npm run demo -- approval-timeout</code>, "Same payout, no tap within 4 hours: it expires and nothing moves."],
          [<code key="c">npm run matrix</code>, "Deterministic failure matrix. 21 pass, 0 fail. Exits 1 on any fail."],
          [<code key="c">npm run evidence</code>, "The matrix, then three separate scenarios: main, replay and deposit."],
          [<code key="c">npm run pack:source</code>, "A clean source zip from HEAD in dist/, with the tree sha and sha256."],
        ]}
      />

      <h2>Optional: live paths</h2>
      <p>
        Planner and Wringer run through OpenRouter only when the OpenRouter key and both model names are set. Without them,
        <code> npm run demo:agents</code> names what is missing and exits 2. The Airwallex sandbox corridor runs only with sandbox
        credentials. Put both in <code>.env.local</code> (the names are in <code>.env.example</code>) or the shell. Never commit them.
      </p>
      <Cmd>{"npm run demo:agents\nnpm run proof"}</Cmd>

      <Source paths={["README.md", "docs/JUDGE.md", "scripts/proof.mjs"]} />
      <Next href="/docs/architecture" label="Architecture" />
    </article>
  );
}
