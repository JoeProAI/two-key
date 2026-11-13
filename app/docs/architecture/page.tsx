import { DocHead, Next, Source, Table } from "../kit";

const BLOCKS = [
  "double_payment", "unstable_request_id", "transfer_terms_changed", "retry_payee_changed", "fx_quote_mismatch",
  "cancelled_not_failed", "original_still_live", "stale_fx_quote", "beneficiary_correction_unverified",
  "beneficiary_unchanged_after_mismatch", "original_debit_not_returned", "reserve_breach",
];
const NOTES = ["duplicate_webhook", "out_of_order_webhook", "failed_not_yet_cancelled"];

export default function Architecture() {
  return (
    <article>
      <DocHead kicker="Architecture" title="Two keys, one tap, one receipt.">
        <p>The model can propose. Code decides what is allowed. A person approves the exact plan that code checked.</p>
      </DocHead>

      <ol className="doc-flow" aria-label="Flow of one money move">
        <li data-side="machine"><strong>Planner</strong><span>Drafts the fix: correct the payee, convert with an FX quote, defer a low-priority payout, retry the transfer.</span><code>lib/agents/planner.ts</code></li>
        <li data-side="machine"><strong>Wringer</strong><span>Tries to break the plan. Hard checks in code, plus any objections a model adds.</span><code>lib/agents/wringer.ts</code></li>
        <li data-side="human"><strong>Human tap</strong><span>At or above the approval threshold (default 10,000 USD). Bound to the plan digest and the cash snapshot.</span><code>lib/agents/executor.ts</code></li>
        <li data-side="ledger"><strong>Executor and ledger</strong><span>Funding first, then the transfer. One stable request_id per intent and action. Every step becomes a receipt line.</span><code>lib/ledger/</code></li>
      </ol>

      <h2>Planner and Wringer through OpenRouter</h2>
      <p>
        Every model call goes through OpenRouter (<code>lib/agents/openrouter.ts</code>). The model for each role comes from an env var.
        No model id is hardcoded. With the key or either model name missing, or <code>AGENT_MODE=stub</code>, both agents stay on
        fixtures and no request is sent. That is how <code>npm run demo</code>, <code>proof</code> and <code>matrix</code> run.
      </p>
      <p>
        In live mode the planner model proposes the moves from a closed set: <code>correct_beneficiary</code>, <code>fx_conversion</code>,
        <code> retry_transfer</code>, <code>defer_payout</code>. It revises from the Wringer findings, up to 3 rounds. Code validates the shape,
        ignores any id the model sends, recomputes every <code>request_id</code>, quote id and payout amount, and runs the hard checks on the
        model&apos;s own moves. A reply that breaks the schema is discarded and the fixture moves for that round stand.
      </p>

      <h2>Hard checks live in code</h2>
      <p>
        A model can add objections. It cannot clear a hard check. A model objection whose <code>check</code> matches a hard check is dropped,
        and a failed model call leaves the hard checks in place. Webhook text is data and never reaches the move list.
      </p>
      <div className="doc-chips" aria-label="Blocking checks">
        {BLOCKS.map((check) => <code key={check} data-severity="block">{check}</code>)}
      </div>
      <div className="doc-chips" aria-label="Notes">
        {NOTES.map((check) => <code key={check} data-severity="note">{check}</code>)}
      </div>
      <p className="doc-fine">Rhodamine chips block. Mint chips are notes. Names are as written in <code>lib/agents/wringer.ts</code>.</p>

      <h2>Deterministic request ids</h2>
      <p>
        A <code>request_id</code> is <code>sha256</code> of the intent, the action and the money fields (<code>lib/requestId.ts</code>). For FX that is the
        buy amount and both currencies. For a retry it is the slot, the original transfer, amount, currency and beneficiary. It does not depend on
        the attempt, a webhook, the quote id or the clock. A different buy amount is a different id. The same id with a different payload is an error
        and does not send.
      </p>
      <p>
        Before a create, the executor looks the id up (<code>GET /api/v1/transfers?request_id=</code>, <code>GET /api/v1/fx/conversions?request_id=</code>).
        A match with the same payload that is not CANCELLED is <code>already_done</code>. A CANCELLED match stops the run for a person. The live
        client repeats the lookup when a create call errors.
      </p>
      <Table
        head={["Move", "Payload in the key", "request_id"]}
        caption="Measured in docs/JUDGE.md. Provider ids change every process. These stay."
        rows={[
          ["FX conversion, buy 28000 USD with EUR", "28000 USD / EUR", <code key="a">e57286ec-aede-36bc-62c1-ed72e395d09d</code>],
          ["FX conversion, buy 10000 USD with EUR", "10000 USD / EUR", <code key="b">11872280-b7eb-0f0c-a139-589310f5fda2</code>],
          ["Retry transfer", "40000 USD, original transfer, beneficiary", <code key="c">c624d34b-1b4c-cbfb-723a-e3f5d031cd83</code>],
        ]}
      />

      <h2>Approval is bound to the plan digest</h2>
      <p>
        When a plan is filed, two fingerprints are stored with the decision (<code>lib/receipt/bind.ts</code>). The plan digest is <code>sha256</code> of the
        action list. The evidence digest is <code>sha256</code> of the balances, webhook status, quote id, reserve and queued payouts the plan was allowed to use.
      </p>
      <ul>
        <li>Execution refuses a plan whose action list no longer matches the bound digest.</li>
        <li>A tap that arrives with a different cash snapshot is refused. The plan stays waiting.</li>
        <li>A human tap cannot override a block, and a forced approved status still does not pay.</li>
        <li>A decision waiting on a tap expires after 4 hours. A late tap is refused and the planner starts over. Four hours is a product choice, not an Airwallex rule.</li>
        <li>On the desk, every bound term is shown before the approve control, in DOM and visual order. Typing a name stores a demo label. It is not authentication.</li>
      </ul>

      <h2>Before paying</h2>
      <ul>
        <li>The executor re-reads the original transfer and refuses to pay unless it is CANCELLED or FAILED.</li>
        <li>Funding runs first: defer, then FX, then the transfer. The run stops at the first error and a retry resumes on the same ids.</li>
        <li>Webhooks are verified with HMAC-SHA256 over timestamp and body, counted once per event id, and ordered by <code>created_at</code>, not arrival.</li>
        <li>The ledger is in memory by default. A Convex ledger with a claim lease exists in <code>convex/</code> but is not configured on the hosted demo.</li>
      </ul>

      <Source paths={["README.md", "lib/agents/", "lib/receipt/bind.ts", "lib/requestId.ts", "docs/agent-runs/README.md"]} />
      <Next href="/docs/airwallex" label="Airwallex map" />
    </article>
  );
}
