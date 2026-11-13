import { DocHead, Limit, Next, Source, Table } from "../kit";

const c = (text: string) => <code>{text}</code>;

export default function Claims() {
  return (
    <article>
      <DocHead kicker="Claims and limits" title="Every claim, and the command that checks it.">
        <p>All commands run offline on the mock provider unless the row says SANDBOX or OpenRouter.</p>
      </DocHead>

      <Table
        head={["Claim", "Verify"]}
        rows={[
          ["The $40k Northwind incident runs end to end in MOCK with no keys.", c("npm ci && npm run demo")],
          ["The second run is already_done with no second send.", c("npm run demo -- rerun")],
          ["Every deterministic failure case passes.", <>{c("npm run matrix")} (21 pass, 0 fail)</>],
          ["Lint, types, tests and leak scan are green. 138 tests in 26 files on main at 9fbb9e9.", c("npm run check")],
          ["One command reproduces the judge path.", <>{c("npm run proof")} (writes {c("artifacts/proof/summary.md")})</>],
          ["The judge path passes on a fresh machine from a public clone.", <>{c("docs/fresh-machine/2026-11-12-daytona/")}: Debian 13, Node 24, 2 vCPU 2 GiB, proof ok. At 1 GiB the Next build is killed for memory.</>],
          ["A SANDBOX corridor ran on 2026-10-27, rerun 2026-10-28.", <>{c("docs/ops-note.md")}. Rerun with sandbox credentials set: {c("npm run proof")} (SANDBOX)</>],
          ["Each desk step maps to a named Airwallex endpoint, function and test.", <a key="m" href="/docs/airwallex">Airwallex map</a>],
          ["The receipt reads Goal, Plan, New information, Revised decision, Resulting state.", <>{c("npm run demo")}; {c("tests/scenarios.test.ts")}</>],
          ["Planner and Wringer run through OpenRouter when configured, and code stays authoritative.", <>{c("npm run demo:agents")} (OpenRouter); {c("npx vitest run tests/agents-live.test.ts")}</>],
          ["Without OpenRouter env, demo:agents names what is missing and exits non-zero.", <>{c("npm run demo:agents; echo $?")} prints 2</>],
          ["In live mode the model proposes the moves; code recomputes ids and blocks any amount, payee or quote that differs from the evidence. The model cannot clear a block.", c("npx vitest run tests/agents-planner.test.ts tests/wringer-hard-stop.test.ts tests/agents-live.test.ts")],
          ["A live model proposed the moves, code blocked its round 2 plan, it revised, and one transfer went out (mock provider).", <>{c("docs/agent-runs/2026-11-13-live-ernie-free-model-moves-converged.json")}: round 2 has {c("reserve_breach")} in codeFindings, round 3 is approved, one transfer call.</>],
          ["A retry never goes to a payee the bank rejected. The payee is corrected to supplier-confirmed names first.", <>{c("npx vitest run tests/beneficiary-fix.test.ts")}; matrix row retry to unchanged payee</>],
          ["A request_id is stable per intent, action and money fields.", c("npx vitest run tests/request-id.test.ts")],
          ["Duplicate and out-of-order webhooks are handled.", c("npx vitest run tests/webhooks.test.ts")],
          ["Approval expires after 4 hours.", "Matrix rows approval timeout, late approve"],
          ["The approve control follows the bound terms.", c("npx vitest run tests/desk-order.test.ts")],
          ["Secrets stay server side.", c("npx vitest run tests/key-leak.test.ts && npm run leak-scan")],
          ["The live client refuses any host but the sandbox.", c("npx vitest run tests/corridor.test.ts tests/live-smoke-guards.test.ts")],
          ["proof, demo and evidence leave the git tree clean.", c("npm run proof && git status --short")],
          ["The source zip unpacks and runs.", <>{c("npm run pack:source")}, then {c("npm ci && npm run demo")} in the unpacked folder</>],
          ["MIT licensed.", c("LICENSE")],
        ]}
      />

      <h2>Known limits, stated plainly</h2>
      <ul className="doc-limits">
        <Limit><strong>Sandbox login is failing right now.</strong> A rerun on 2026-11-12 got 403 <code>unauthorized</code> at <code>POST /api/v1/authentication/login</code>. No new sandbox ids exist. The mock provider is what the desk demonstrates.</Limit>
        <Limit><strong>The desk build has not run against the sandbox.</strong> The sandbox evidence is from <code>scripts/live-smoke.ts</code> on 2026-10-27 and 2026-10-28.</Limit>
        <Limit><strong>Webhook delivery is unconfirmed.</strong> No webhook was subscribed during the sandbox run, so delivery of <code>payout.transfer.cancelled</code> is not proved.</Limit>
        <Limit><strong>One error code is unconfirmed.</strong> The HTTP code for a duplicate <code>request_id</code> on conversion create. The client looks the id up first and never sent the duplicate.</Limit>
        <Limit><strong>Live model runs used the mock provider.</strong> Four OpenRouter transcripts are committed in <code>docs/agent-runs/</code>, all on a free model. Two paid once and two stayed blocked and paid nothing. None touched the sandbox.</Limit>
        <Limit><strong>Convex is optional and not configured.</strong> The hosted demo uses the in-memory ledger. No-double-pay across a process restart needs the Convex claim, and the lease window against a live host is not proved.</Limit>
        <Limit><strong>The typed name is a label.</strong> Typing a name on the desk records a demo label. It is not authentication.</Limit>
        <Limit><strong>Some numbers are product choices.</strong> The 4 hour approval timeout and the 60 second quote headroom are not Airwallex rules.</Limit>
      </ul>

      <Source paths={["docs/CLAIMS.md", "docs/RED-TEAM.md", "docs/ops-note.md"]} />
      <Next href="/docs/red-team" label="Red team" />
    </article>
  );
}
