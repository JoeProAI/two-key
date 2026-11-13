import type { ReactNode } from "react";
import { approveDesk, planDesk, replayDesk, unlockDesk } from "./actions";
import { DeskFrame } from "./ui/desk-frame";
import { ApproverField, DeskKeyField, GuardedForm } from "./ui/guarded-form";
import { SubmitButton } from "./ui/submit-button";
import { CopyId } from "./ui/copy-id";
import { HeroPlate } from "./ui/hero-plate";
import { AirwallexCalls } from "./ui/airwallex-calls";
import { actionName, nextCue, rail, resultWord, stateLine } from "@/lib/desk/story";
import type { DeskAction, DeskRound, DeskView } from "@/lib/desk/types";

const UNKNOWN = "Unknown. Not on this desk.";

export function Desk({ view, demo }: { view: DeskView; demo?: ReactNode }) {
  const cue = nextCue(view);
  const stops = rail(view);
  const state = view.error && view.phase !== "failed"
    ? { word: "Tap refused", tone: "fail" as const, detail: view.error }
    : stateLine(view);
  const latest = view.rounds.at(-1);
  const privateDesk = !view.publicFixture;
  const lead = openingLead(view, state, cue.text);
  return (
    <DeskFrame>
      <div className={demo ? "instrument has-demo" : "instrument"}>
      <header className="mast">
        <p className="brand"><a href={privateDesk ? "/" : "/fixture"}>Two-Key</a></p>
        <p className="mock">MOCK. No real money moves.</p>
        <p className="mast-links">
          <a href="/docs">Docs</a>
          {privateDesk ? <a href="/fixture">Mock fixture</a> : <a href="/">Private desk</a>}
          {view.publicFixture ? <span>Public fixture. Read only.</span> : null}
          <a href="#airwallex" className="awx-link">Airwallex calls</a>
        </p>
      </header>
      <section className="summary" id="incident" aria-labelledby="payee">
        <p className="eyebrow">Payee reference</p>
        <h1 id="payee">{view.reference}</h1>
        <div className="figure-row">
          <p className="amount">
            <span className="figures">{view.amount}</span>
            <span className="unit">{view.currency}</span>
          </p>
          <p className="state" data-tone={state.tone}>{state.word}</p>
        </div>
        <p className="next" id="next-step">
          <a href={cue.href}>{cue.text}</a>
        </p>
        {lead ? <p className="lead">{lead}</p> : null}
        {latest ? <p className="binding">{`Bound to plan round ${latest.round}. Digest ${short(latest.boundDigest)}`}</p> : null}
      </section>
      <HeroPlate />
      <nav className="rail" aria-label="Bound decision">
        {stops.map((stop) => (
          <a key={stop.id} href={`#${stop.id}`} data-stop={stop.id}>
            <span>{stop.label}</span>
            <strong>{stop.status}</strong>
          </a>
        ))}
      </nav>
      {demo}
      <section className="cash-field" id="cash">
        <Incident view={view} />
        <h2>Cash plan</h2>
        <Cash view={view} />
        <Plan rounds={view.rounds} />
        {privateDesk && view.canPlan && view.phase !== "failed" ? (
          <GuardedForm action={planDesk}>
            <SubmitButton idle="Run the planner" pending="Filing the plan" />
          </GuardedForm>
        ) : null}
      </section>
      <section className="consent">
        <div id="check">
          <h2>Independent check</h2>
          <p>Wringer is a fixture program, not a person. A clear check is not human consent.</p>
          <Checker rounds={view.rounds} blockCount={view.blockCount} />
        </div>
        <div id="authorization">
          <h2>Human authorization</h2>
          <Terms view={view} latest={latest} />
          {privateDesk && view.locked && view.canUnlock ? (
            <GuardedForm action={unlockDesk}>
              <DeskKeyField />
              <SubmitButton idle="Unlock the desk" pending="Checking the key" />
            </GuardedForm>
          ) : null}
          {privateDesk && view.canApprove && view.phase !== "failed" && !view.locked ? (
            <GuardedForm action={approveDesk} blocked={!view.canApprove}>
              <ApproverField blocked={!view.canApprove} />
              <SubmitButton
                idle="Approve this mock plan and simulate payment"
                pending="Simulating the payment"
                blocked={!view.canApprove}
              />
            </GuardedForm>
          ) : null}
          {view.publicFixture ? <p>This public fixture has no approval control.</p> : null}
        </div>
      </section>
      <section className="proof" id="receipt" aria-labelledby="receipt-title">
        <h2 id="receipt-title">Receipt</h2>
        <Proof view={view} />
        <p id="key-reason">Recorded gate line: {view.keyReason}</p>
        {privateDesk && view.phase === "failed" && view.canApprove ? (
          <GuardedForm action={approveDesk}>
            <SubmitButton idle="Retry the approved plan" pending="Retrying the simulation" />
          </GuardedForm>
        ) : null}
        {privateDesk && view.phase === "failed" && view.canPlan ? (
          <GuardedForm action={planDesk}>
            <SubmitButton idle="Replan with fresh balances" pending="Filing the plan" quiet />
          </GuardedForm>
        ) : null}
        {privateDesk && view.canReplay ? (
          <GuardedForm action={replayDesk}>
            <SubmitButton idle="Verify recorded mock result" pending="Checking the recorded ids" />
          </GuardedForm>
        ) : null}
      </section>
      <AirwallexCalls view={view} />
      </div>
    </DeskFrame>
  );
}

function Incident({ view }: { view: DeskView }) {
  return (
    <div className="history">
      <h2>Incident history</h2>
      <dl className="terms">
        <Term label="Original transfer" value={view.transferId} copy />
        <Term label="Original status" value={view.status} />
        <Term label="Failure" value={view.failure || UNKNOWN} unknown={!view.failure} />
        <Term label="Original request id" value={view.originalRequestId} copy />
        <Term label="Beneficiary id" value={view.beneficiary || UNKNOWN} unknown={!view.beneficiary} copy={Boolean(view.beneficiary)} />
        <Term label="Stored account name" value={view.payeeStored} />
      </dl>
      <div className="newinfo" aria-labelledby="newinfo-title">
        <h3 id="newinfo-title">New information</h3>
        <dl className="terms">
          <Term label="Read-back" value={view.readBack} />
          <Term label="Supplier confirmed name" value={view.payeeConfirmed} />
          <Term label="Account" value={`Same account, ending ${view.payeeLast4}`} />
          <Term label="Source" value={view.payeeSource} />
        </dl>
        <p className="fine">Fictional supplier. The plan updates the payee before any retry. Code blocks a retry to an unchanged payee.</p>
      </div>
      {view.webhooks.length ? (
        <ul className="hooks">
          {view.webhooks.map((hook, index) => (
            <li key={`${hook.id}-${hook.created}-${index}`}>{hook.name}. {hook.status}. {hook.flag}. Created {hook.created}.</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Cash({ view }: { view: DeskView }) {
  return (
    <>
      <div className="cash">
        {view.balances.map((row) => {
          const before = view.balancesBefore.find((item) => item.currency === row.currency);
          return (
            <div key={row.currency} className="purse">
              <h3>{row.currency}</h3>
              <p><span>Before</span> <strong>{before?.available ?? UNKNOWN}</strong></p>
              <p><span>Available now</span> <strong>{row.available}</strong></p>
              <p><span>Pending</span> <strong>{row.pending ?? "0.00"}</strong></p>
              <p><span>Reserved</span> <strong>{row.reserved ?? "0.00"}</strong></p>
              <p><span>Total</span> <strong>{row.total ?? row.available}</strong></p>
            </div>
          );
        })}
      </div>
      <p>Before is the opening available balance. Now is available after this beat. Total is available plus pending plus reserved.</p>
      <p>The {view.reserve} {view.balances[0]?.currency ?? "USD"} floor is a policy rule. It is not reserved.</p>
      <p>{view.queuedLabel}: {view.queuedAmount}. The retainer is not reserved.</p>
      <p>Mock ledger, not a live balance.</p>
    </>
  );
}

function Plan({ rounds }: { rounds: DeskRound[] }) {
  if (!rounds.length) return <p>No plan is filed.</p>;
  return (
    <ol className="rounds">
      {rounds.map((round) => (
        <li key={round.round}>
          <h3>Round {round.round}. {round.decision}</h3>
          <p>{round.summary}</p>
          {round.actions.map((action) => (
            <ActionFacts key={`${round.round}-${action.requestId ?? action.kind}`} action={action} />
          ))}
        </li>
      ))}
    </ol>
  );
}

function ActionFacts({ action }: { action: DeskAction }) {
  return (
    <div className="action">
      <h4>{action.kind}</h4>
      <p>{action.detail}</p>
      <dl className="terms">
        <Term label="Request id" value={action.requestId ?? UNKNOWN} unknown={!action.requestId} copy={Boolean(action.requestId)} />
        {action.kind === "FX conversion" ? (
          <>
            <Term label="Quote id" value={action.quoteId ?? UNKNOWN} unknown={!action.quoteId} copy={Boolean(action.quoteId)} />
            <Term label="Quote valid from" value={action.quoteValidFrom ?? UNKNOWN} unknown={!action.quoteValidFrom} />
            <Term label="Quote valid to" value={action.quoteValidTo ?? UNKNOWN} unknown={!action.quoteValidTo} />
            <Term label="Quoted client rate" value={action.clientRate ?? "Quoted rate unknown"} unknown={!action.clientRate} />
            <Term label="Quoted sell amount" value={action.sellAmount ? `${action.sellAmount} ${action.sellCurrency ?? ""}`.trim() : UNKNOWN} unknown={!action.sellAmount} />
          </>
        ) : null}
        {action.beneficiaryId ? <Term label="Beneficiary id" value={action.beneficiaryId} copy /> : null}
      </dl>
    </div>
  );
}

function Checker({ rounds, blockCount }: { rounds: DeskRound[]; blockCount: number }) {
  if (!rounds.length) return <p>The checker has not run.</p>;
  return (
    <>
      <p>{blockCount ? `${blockCount} blocking findings on the latest round.` : "No blocking finding on the latest round. That is not consent."}</p>
      <ol className="rounds">
        {rounds.map((round) => (
          <li key={round.round}>
            <h3>Round {round.round}</h3>
            {round.findings.length ? (
              <ul>
                {round.findings.map((finding) => (
                  <li key={`${round.round}-${finding.check}`}>
                    <strong data-severity={finding.severity}>{finding.severity === "block" ? "Blocking" : "Note"}. {finding.check}.</strong> {finding.detail}
                    {finding.at ? ` Recorded at ${finding.at} on the demo clock.` : " Recorded time unknown."}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No objection on this round.</p>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function Terms({ view, latest }: { view: DeskView; latest: DeskRound | undefined }) {
  const fx = latest?.actions.find((action) => action.kind === "FX conversion");
  const retry = latest?.actions.find((action) => action.kind === "Retry transfer");
  return (
    <>
      <p>These are the terms a mock tap would bind. Missing fields stay unknown. This page does not add a new block when a field is unknown.</p>
      {!latest ? <p>No plan is filed, so there is no bound digest.</p> : null}
      <dl className="terms">
        <Term label="Payee reference" value={view.reference} />
        <Term label="Amount and currency" value={`${view.amount} ${view.currency}`} />
        <Term label="Retry request id" value={retry?.requestId ?? (view.requestId ? `${view.requestId}. Not filed on a plan yet.` : UNKNOWN)} unknown={!retry?.requestId} copy={Boolean(retry?.requestId)} />
        <Term label="FX request id" value={fx?.requestId ?? UNKNOWN} unknown={!fx?.requestId} copy={Boolean(fx?.requestId)} />
        <Term label="Beneficiary id" value={retry?.beneficiaryId ?? view.beneficiary ?? UNKNOWN} unknown={!(retry?.beneficiaryId ?? view.beneficiary)} copy />
        <Term label="Destination account name" value={UNKNOWN} unknown />
        <Term label="Fees" value={UNKNOWN} unknown />
        <Term label="Slippage" value={UNKNOWN} unknown />
        <Term label="Quote id" value={fx?.quoteId ?? UNKNOWN} unknown={!fx?.quoteId} copy={Boolean(fx?.quoteId)} />
        <Term label="Quoted client rate" value={fx?.clientRate ?? "Quoted rate unknown"} unknown={!fx?.clientRate} />
        <Term label="Quoted sell amount" value={fx?.sellAmount ? `${fx.sellAmount} ${fx.sellCurrency ?? ""}`.trim() : UNKNOWN} unknown={!fx?.sellAmount} />
        <Term label="Quote valid to" value={fx?.quoteValidTo ?? UNKNOWN} unknown={!fx?.quoteValidTo} />
        <Term label="Bound digest" value={latest?.boundDigest ?? UNKNOWN} unknown={!latest?.boundDigest} copy={Boolean(latest?.boundDigest)} />
        <Term label="Evidence digest" value={latest?.evidenceDigest ?? UNKNOWN} unknown={!latest?.evidenceDigest} copy={Boolean(latest?.evidenceDigest)} />
        <Term label="Plan filed" value={latest?.decidedAt ? `${latest.decidedAt} on the demo clock` : UNKNOWN} unknown={!latest?.decidedAt} />
        <Term label="Cash snapshot time" value={UNKNOWN} unknown />
        <Term label="Demo approver label" value={latest?.approvedBy ? `${latest.approvedBy}. This is not authentication.` : "None recorded. A typed name is a demo label, not authentication."} />
        <Term label="Label recorded at" value={latest?.approvedAt ?? "None recorded."} unknown={!latest?.approvedAt} />
        <Term label="Authenticated identity" value={UNKNOWN} unknown />
      </dl>
      {view.phase === "failed" ? <p>The simulation did not finish. The retry control is in the receipt, after the failure.</p> : null}
    </>
  );
}

function Proof({ view }: { view: DeskView }) {
  return (
    <>
      {view.replayed ? <p>Verify recorded mock result. This check creates no new payment.</p> : null}
      {view.phase === "paid" && !view.replayed ? <p>Simulated payment recorded. This is not a live provider payment.</p> : null}
      {view.phase === "failed" ? <p>Nothing is marked paid. {view.error}</p> : null}
      <dl className="terms">
        <Term label="Transfer calls" value={count(view.transferCalls)} />
        <Term label="Transfers settled" value={count(view.transfersSettled)} />
        <Term label="Conversion calls" value={count(view.conversionCalls)} />
        <Term label="Conversions settled" value={count(view.conversionsSettled)} />
      </dl>
      {view.executions.length ? (
        <ul className="executions">
          {view.executions.map((row, index) => (
            <li key={`${index}-${row.result}-${row.action}-${row.requestId}`}>
              <strong>{resultWord(row.result)}. {actionName(row.action)}.</strong>
              <span>Request id {row.requestId}</span>
              <span>{row.providerId ? `Provider id ${row.providerId}` : "No provider id on this row."}</span>
              {row.note ? <span>{row.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : <p>No simulated execution on this beat.</p>}
      {view.receipt?.length ? (
        <ol className="receipt-lines">
          {view.receipt.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ol>
      ) : null}
      <p>{view.provenance.fixture}. Run {view.provenance.runId}. Git {view.provenance.gitSha}.</p>
      {view.downloadHref ? <p><a href={view.downloadHref}>Receipt JSON</a></p> : null}
    </>
  );
}

function Term({ label, value, unknown, copy }: { label: string; value: string; unknown?: boolean; copy?: boolean }) {
  return (
    <div className={unknown ? "term unknown" : "term"}>
      <dt>{label}</dt>
      <dd>{copy ? <CopyId id={value} /> : value}</dd>
    </div>
  );
}

/** One statement per fact in the opening: drop lead sentences the next-step button already says.
 *  Before a plan exists, the lead states the incident instead of repeating "nothing sent". */
function openingLead(view: DeskView, state: { word: string; detail: string }, cue: string): string {
  if (!view.locked && !view.error && !view.rounds.length && view.phase !== "paid" && view.phase !== "failed") {
    const failure = view.failure ? ` ${view.failure.replace(/\.?$/, ".")}` : "";
    return `The original transfer was ${view.status.toLowerCase()}.${failure}`;
  }
  const key = (line: string) => line.toLowerCase().replace(/\b(is|was|has been)\b/g, "").replace(/\W+/g, "");
  const said = new Set(sentences(cue).map(key));
  return sentences(state.detail).filter((line) => !said.has(key(line))).join(" ");
}

function sentences(text: string): string[] {
  return text.split(/(?<=\.)\s+/).map((line) => line.trim()).filter(Boolean);
}

function short(digest: string | null | undefined): string {
  if (!digest) return "unknown";
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest;
}

function count(value: number | null): string {
  return value === null ? UNKNOWN : String(value);
}
