import { DocHead, Next, Source, Table } from "./kit";

export default function Overview() {
  return (
    <article>
      <DocHead kicker="Airwallex Agentic Banking Hackathon" title="Two-Key fixes a failed supplier payment without paying twice.">
        <p>
          A payment ops agent. Tracks: 03 Payment Ops Incident Commander (primary) and 01 Adaptive Treasury Controller.
          Each money move needs two keys. The planner drafts the fix. The Wringer tries to break it. Code holds the hard
          checks, and a person taps once at or above the approval threshold. Every step lands in the ledger and comes out as a receipt.
        </p>
      </DocHead>

      <section className="doc-spread" aria-labelledby="case">
        <div className="doc-note">
          <p className="eyebrow">The incident on the desk</p>
          <h2 id="case">INV-2291 Northwind Steel</h2>
          <p className="doc-figure">40,000.00 <span>USD</span></p>
          <p>
            The original transfer failed on a beneficiary name mismatch and was read back CANCELLED. The supplier (fictional)
            confirmed its legal account name. Cash is short in USD, a 10,000 USD floor is policy, and a 7,000 retainer is queued.
          </p>
        </div>
        <ol className="doc-steps">
          <li><strong>Round 1 is blocked.</strong> A plain retry trips <code>double_payment</code>, <code>unstable_request_id</code>, <code>beneficiary_unchanged_after_mismatch</code> and <code>reserve_breach</code>.</li>
          <li><strong>Round 2 revises.</strong> Correct the payee to the supplier-confirmed name, buy 28,000 USD with EUR at the quoted rate, defer the retainer, retry once with a stable <code>request_id</code>.</li>
          <li><strong>A person taps.</strong> The tap is bound to that plan digest and that cash snapshot. A changed plan or changed cash is refused.</li>
          <li><strong>It pays once.</strong> A rerun comes back <code>already_done</code> with no second send. USD ends at 22,000 + 28,000 − 40,000 = 10,000, the floor.</li>
        </ol>
      </section>

      <h2>What runs where</h2>
      <Table
        head={["Label", "Means"]}
        rows={[
          ["MOCK", <>Hand-written fixtures in <code>lib/airwallex/mock.ts</code>. No network. No real money moves. The public desk and every <code>npm run demo</code> line are MOCK.</>],
          ["SANDBOX", <>Airwallex sandbox host only, real sandbox ids, still not real money. Only <code>npm run live-smoke</code> and the optional step in <code>npm run proof</code> call it.</>],
          ["Live money", <>Not built. The live client refuses any host other than <code>api.sandbox.airwallex.com</code>.</>],
        ]}
      />

      <h2>Where to look</h2>
      <ul className="doc-links">
        <li><a href="/fixture">/fixture</a>: the public judge page. MOCK, read only. Open Demo controls to step through incident, blocked, planned, refused, failed, paid and replay.</li>
        <li><a href="/docs/quickstart">Quickstart</a>: one command, no keys, about 90 seconds after install.</li>
        <li><a href="/docs/claims">Claims and limits</a>: every claim with the command that checks it, and what is not proved.</li>
        <li><a href="/docs/red-team">Red team</a>: 28 attacks a skeptical judge would raise, each with the test that answers it.</li>
      </ul>

      <Source paths={["README.md", "docs/JUDGE.md"]} />
      <Next href="/docs/quickstart" label="Quickstart" />
    </article>
  );
}
