"use client";

import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import { approveDesk, planDesk, replayDesk, unlockDesk } from "./actions";
import type { DeskAction, DeskExecution, DeskStation, DeskView } from "@/lib/desk/types";

function Submit({
  idle,
  pending,
  blocked,
  className,
  describedBy,
}: {
  idle: string;
  pending: string;
  blocked?: boolean;
  className?: string;
  describedBy?: string;
}) {
  const status = useFormStatus();
  const off = Boolean(blocked || status.pending);
  return (
    <button
      type="submit"
      className={className}
      aria-disabled={off || undefined}
      aria-busy={status.pending || undefined}
      aria-describedby={describedBy}
      onClick={(event) => {
        if (off) event.preventDefault();
      }}
    >
      {status.pending ? pending : idle}
    </button>
  );
}

function stopWhen(blocked: boolean) {
  return (event: FormEvent) => {
    if (blocked) event.preventDefault();
  };
}

function parseMoney(value: string): number {
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function stateWord(state: DeskStation["state"]): string {
  if (state === "clear") return "Clear";
  if (state === "hold") return "Hold";
  if (state === "block") return "Block";
  if (state === "unknown") return "Unknown";
  return "Empty";
}

function statusTone(status: string): "danger" | "ok" | "hold" {
  const value = status.toUpperCase();
  if (value.includes("CANCEL") || value.includes("FAIL") || value.includes("ERROR")) return "danger";
  if (value.includes("PAID") || value.includes("SETTLE") || value.includes("SUCCESS")) return "ok";
  return "hold";
}

function resultTone(result: string): "ok" | "danger" | "hold" | "ink" {
  if (result === "ok") return "ok";
  if (result === "error") return "danger";
  if (result === "already_done") return "hold";
  return "ink";
}

function gateCopy(kind: "planner" | "wringer", view: DeskView): { tone: string; word: string; note: string } {
  if (view.locked) return { tone: "ink", word: "Closed", note: "Desk key shut" };
  if (kind === "planner") {
    return view.plannerSeated
      ? { tone: "ok", word: "Seated", note: "Plan filed" }
      : { tone: "hold", word: "Open", note: "No plan filed" };
  }
  if (view.wringerSeated) return { tone: "ok", word: "Seated", note: "No block" };
  if (view.plannerSeated) return { tone: "danger", word: "Block", note: `${view.blockCount} blocks` };
  return { tone: "hold", word: "Open", note: "Waiting on a plan" };
}

function Pill({ tone, children }: { tone: string; children: string }) {
  return (
    <span className="pill" data-tone={tone}>
      <span className="mark" aria-hidden="true" />
      {children}
    </span>
  );
}

function Controls({ view, offline }: { view: DeskView; offline: boolean }) {
  const describedBy = offline ? "key-reason offline-note" : "key-reason";
  if (view.locked) {
    return (
      <div className="lock">
        {view.lockNote ? <p className="note">{view.lockNote}</p> : null}
        {view.canUnlock ? (
          <form action={unlockDesk} onSubmit={stopWhen(offline)}>
            <label htmlFor="desk-key">Desk key</label>
            <input id="desk-key" name="deskKey" type="password" autoComplete="current-password" maxLength={200} required aria-describedby={describedBy} />
            <Submit idle="Unlock the desk" pending="Checking the key" blocked={offline} describedBy={describedBy} />
          </form>
        ) : null}
      </div>
    );
  }
  const showPay = !view.publicFixture && view.phase !== "incident" && !view.canReplay;
  const payBlocked = offline || !view.canApprove;
  return (
    <div className="controls">
      {view.publicFixture && view.lockNote ? <p className="note">{view.lockNote}</p> : null}
      {view.canPlan ? (
        <form action={planDesk} onSubmit={stopWhen(offline)}>
          <Submit
            className={showPay || view.canReplay ? "secondary" : undefined}
            idle={view.phase === "failed" ? "Replan with fresh balances" : "Run the planner"}
            pending="Filing the plan"
            blocked={offline}
            describedBy={describedBy}
          />
        </form>
      ) : null}
      {view.publicFixture || view.phase === "incident" ? null : view.canReplay ? (
        <form className="replay" action={replayDesk} onSubmit={stopWhen(offline)}>
          <input type="hidden" name="approver" value="joe" />
          <Submit idle="Reconcile this receipt" pending="Reconciling" blocked={offline} describedBy={describedBy} />
        </form>
      ) : (
        <form className="tap" action={approveDesk} onSubmit={stopWhen(payBlocked)}>
          <label htmlFor="approver">Approver</label>
          <input
            id="approver"
            name="approver"
            type="text"
            defaultValue="joe"
            maxLength={40}
            autoComplete="name"
            required
            aria-describedby={describedBy}
            readOnly={payBlocked}
          />
          <Submit
            idle={view.phase === "failed" ? "Retry the approved plan" : "Approve and pay once"}
            pending="Paying once"
            blocked={payBlocked}
            describedBy={describedBy}
          />
        </form>
      )}
    </div>
  );
}

function MoneyStrip({ view }: { view: DeskView }) {
  return (
    <div className="money" role="group" aria-label="Balances">
      {view.balances.map((row) => {
        const before = view.balancesBefore.find((item) => item.currency === row.currency)?.available ?? row.available;
        return (
          <div className="money-row" key={row.currency}>
            <span className="ccy">{row.currency}</span>
            <span className="pair"><span className="lbl">Before</span><span className="num">{before}</span></span>
            <span className="pair"><span className="lbl">Now</span><span className="num">{row.available}</span></span>
            <span className="pair"><span className="lbl">Total</span><span className="num">{row.total ?? row.available}</span></span>
          </div>
        );
      })}
    </div>
  );
}

function Counts({ view }: { view: DeskView }) {
  if (view.transferCalls !== null) {
    return (
      <p className="counts">
        <span>Transfer calls {view.transferCalls}</span>
        <span>Transfers settled {view.transfersSettled ?? 0}</span>
        <span>Conversion calls {view.conversionCalls}</span>
        <span>Conversions settled {view.conversionsSettled ?? 0}</span>
      </p>
    );
  }
  if (view.transfersSettled !== null) {
    return (
      <p className="counts">
        <span>Transfers settled {view.transfersSettled}</span>
        <span>Conversions settled {view.conversionsSettled ?? 0}</span>
        <span>Call attempts are not stored on this ledger</span>
      </p>
    );
  }
  return null;
}

function RequestStep({ view }: { view: DeskView }) {
  return (
    <>
      <p>Original transfer. Status {view.status}. The later steps are the plan, the Wringer, the tap, the send, and the balances.</p>
      <dl className="meta">
        <div><dt>Reference</dt><dd>{view.reference}</dd></div>
        <div><dt>Transfer</dt><dd>{view.transferId}</dd></div>
        <div><dt>Amount</dt><dd>{view.amount} {view.currency}</dd></div>
        <div><dt>Beneficiary</dt><dd>{view.beneficiary}</dd></div>
        <div><dt>Original request</dt><dd>{view.originalRequestId}</dd></div>
        <div><dt>Stable retry</dt><dd>{view.requestId}</dd></div>
      </dl>
      <p className="failure">{view.failure}</p>
    </>
  );
}

function CashStep({ view }: { view: DeskView }) {
  const usd = view.balances.find((row) => row.currency === "USD")?.available ?? view.balances[0]?.available ?? "0.00";
  const covers = parseMoney(usd) >= parseMoney(view.reserve);
  return (
    <>
      <p>USD available {usd}. Floor {view.reserve}. {covers ? "Available covers the floor." : "Available is short of the floor."}</p>
      <p>{view.queuedLabel} {view.queuedAmount}.</p>
      <MoneyStrip view={view} />
      <p className="note">The floor is a Two-Key rule. It is not reserved. Pending and reserved stay on the balance step.</p>
    </>
  );
}

function PlanStep({ view }: { view: DeskView }) {
  return (
    <>
      {view.webhooks.length === 0 ? (
        <p className="empty">No notices ingested for this transfer.</p>
      ) : (
        <div className="scroll">
          <table>
            <caption>Arrival order. Duplicates and a late processing notice are marked. The desk follows created-at.</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">Flag</th>
              </tr>
            </thead>
            <tbody>
              {view.webhooks.map((row, index) => (
                <tr key={`${row.id}-${index}`}>
                  <td>{row.id}</td>
                  <td>{row.name}</td>
                  <td>{row.status}</td>
                  <td>{row.created}</td>
                  <td>{row.flag ? <Pill tone="danger">{row.flag}</Pill> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.rounds.length === 0 ? (
        <p className="empty">No plan filed. The failed transfer is the only thing on the sheet.</p>
      ) : view.rounds.map((round) => (
        <article className="round" key={round.round}>
          <p className="round-no">Round {round.round}</p>
          <p>{round.summary}</p>
          <ul>
            {round.actions.map((action) => (
              <li key={`${round.round}-${action.kind}-${action.requestId ?? action.detail}`}>
                <Pill tone="hold">Proposed</Pill>
                <strong>{action.kind}.</strong> {action.detail}
                {action.requestId ? <div className="request">Request id {action.requestId}</div> : null}
              </li>
            ))}
          </ul>
        </article>
      ))}
      {view.canPlan ? <p className="note">The plan control is on the incident plate.</p> : null}
    </>
  );
}

function WringerStep({ view }: { view: DeskView }) {
  if (view.rounds.length === 0) return <p className="empty">No objections yet. File a plan first.</p>;
  return (
    <>
      {view.rounds.map((round) => (
        <article className="round" key={`findings-${round.round}`}>
          <h3 className="round-no">Round {round.round}</h3>
          {round.findings.length === 0 ? <p className="empty">No objection on this round.</p> : round.findings.map((finding) => (
            <p className={finding.severity === "block" ? "finding block" : "finding"} key={`${round.round}-${finding.check}`}>
              <Pill tone={finding.severity === "block" ? "danger" : "hold"}>{finding.severity === "block" ? "Block" : "Note"}</Pill>
              <span className="check">{finding.check}</span>
              <br />
              {finding.detail}
            </p>
          ))}
        </article>
      ))}
    </>
  );
}

function ApprovalStep({ view }: { view: DeskView }) {
  if (view.rounds.length === 0) return <p className="empty">Nothing is waiting for a tap.</p>;
  return (
    <>
      {view.rounds.map((round) => (
        <p className="decision" key={`decision-${round.round}`}>
          <Pill tone={round.decision === "approved" ? "ok" : round.decision === "blocked" || round.decision === "expired" ? "danger" : "hold"}>{round.decision}</Pill>
          Round {round.round}
          {round.approvedBy ? `, approved by ${round.approvedBy}` : ""}
        </p>
      ))}
      <p className="note">A tap is bound to this plan and this evidence. If either changes, the tap is refused. The control is on the incident plate. It stays off while a key is open.</p>
    </>
  );
}

function pairActions(view: DeskView): { action: DeskAction; executed: DeskExecution | null }[] {
  const latest = view.rounds.at(-1);
  if (!latest) return [];
  return latest.actions.map((action) => ({
    action,
    executed: action.requestId ? view.executions.find((row) => row.requestId === action.requestId) ?? null : null,
  }));
}

function ExecutionStep({ view }: { view: DeskView }) {
  const pairs = pairActions(view);
  const matched = new Set(pairs.map((pair) => pair.executed?.requestId).filter((id): id is string => Boolean(id)));
  const extra = view.executions.filter((row) => !matched.has(row.requestId));
  if (pairs.length === 0 && view.executions.length === 0) return <p className="empty">No execution yet.</p>;
  return (
    <>
      {pairs.map((pair) => (
        <article className="record" key={`${pair.action.kind}-${pair.action.requestId ?? pair.action.detail}`}>
          <p className="kind">{pair.action.kind}</p>
          <p className="request">{pair.action.requestId ? `Request id ${pair.action.requestId}` : "No request id on this action."}</p>
          <div className="compare">
            <div className="col">
              <h3>Proposed</h3>
              <div className="cell"><p>{pair.action.detail}</p></div>
            </div>
            <div className="col">
              <h3>Executed</h3>
              <div className="cell">
                {pair.executed ? (
                  <>
                    <Pill tone={resultTone(pair.executed.result)}>{pair.executed.result}</Pill>
                    <p className="request">{pair.executed.providerId ? `Provider id ${pair.executed.providerId}` : "No provider id on this row."}</p>
                    {pair.executed.note ? <p>{pair.executed.note}</p> : null}
                  </>
                ) : (
                  <Pill tone="ink">Not sent</Pill>
                )}
              </div>
            </div>
          </div>
        </article>
      ))}
      {extra.length > 0 ? (
        <div className="scroll">
          <table>
            <caption>Recorded rows that are not in the latest plan.</caption>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Result</th>
                <th scope="col">Request id</th>
                <th scope="col">Provider id</th>
              </tr>
            </thead>
            <tbody>
              {extra.map((row) => (
                <tr key={`${row.action}-${row.requestId}-${row.result}`}>
                  <td>{row.action}</td>
                  <td><Pill tone={resultTone(row.result)}>{row.result}</Pill>{row.note ? <div>{row.note}</div> : null}</td>
                  <td>{row.requestId}</td>
                  <td>{row.providerId ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function BalancesStep({ view }: { view: DeskView }) {
  return (
    <div className="scroll">
      <table>
        <caption>Available is spendable in this mock. Pending and reserved stay 0. Total is available plus those.</caption>
        <thead>
          <tr>
            <th scope="col">Currency</th>
            <th scope="col">Before</th>
            <th scope="col">Available</th>
            <th scope="col">Pending</th>
            <th scope="col">Reserved</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {view.balances.map((row) => (
            <tr key={`after-${row.currency}`}>
              <td>{row.currency}</td>
              <td>{view.balancesBefore.find((item) => item.currency === row.currency)?.available ?? ""}</td>
              <td>{row.available}</td>
              <td>{row.pending ?? "0.00"}</td>
              <td>{row.reserved ?? "0.00"}</td>
              <td>{row.total ?? row.available}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">The 10,000 floor is a Two-Key rule, not reserved_amount. Mock ledger math, not a live balance.</p>
    </div>
  );
}

function ReplayStep({ view }: { view: DeskView }) {
  const providerIds = view.executions.map((row) => row.providerId).filter((id): id is string => Boolean(id));
  const shared = new Set(providerIds.filter((id, index) => providerIds.indexOf(id) !== index));
  return (
    <>
      <Counts view={view} />
      {view.executions.length === 0 ? <p className="empty">No execution rows on this receipt.</p> : (
        <ul>
          {view.executions.map((row) => (
            <li key={`${row.action}-${row.requestId}-${row.result}`}>
              <Pill tone={resultTone(row.result)}>{row.result}</Pill>
              {row.action}
              <div className="request">Request id {row.requestId}</div>
              <div className="request">Provider id {row.providerId ?? "none"}{row.providerId && shared.has(row.providerId) ? ". Same provider id as another row." : ""}</div>
              {row.note ? <div>{row.note}</div> : null}
            </li>
          ))}
        </ul>
      )}
      {view.executions.some((row) => row.result === "error") ? (
        <p className="note">An error row did not settle. Calls count the attempt. Settled counts an object this mock stored.</p>
      ) : null}
      <p className="note">{view.replayed ? "Reconcile kept the original provider id. It did not replan or pay." : "Reconcile reads the saved actions. It does not file a new plan."}</p>
      <p className="note">Full receipt lines stay in the details below. The download is the redacted pack.</p>
    </>
  );
}

function StepBody({ view, id }: { view: DeskView; id: string }) {
  if (id === "request") return <RequestStep view={view} />;
  if (id === "cash") return <CashStep view={view} />;
  if (id === "plan") return <PlanStep view={view} />;
  if (id === "wringer") return <WringerStep view={view} />;
  if (id === "approval") return <ApprovalStep view={view} />;
  if (id === "execution") return <ExecutionStep view={view} />;
  if (id === "balances") return <BalancesStep view={view} />;
  return <ReplayStep view={view} />;
}

export function Desk({ view }: { view: DeskView }) {
  const [offline, setOffline] = useState(false);
  const signature = `${view.focus}:${view.phase}:${String(view.replayed)}:${view.receipt?.length ?? 0}`;
  const [selected, setSelected] = useState(view.focus);
  const [signatureSeen, setSignatureSeen] = useState(signature);
  const [wide, setWide] = useState(false);
  if (signatureSeen !== signature) {
    setSignatureSeen(signature);
    setSelected(view.focus);
  }
  const current = view.stations.some((station) => station.id === selected) ? selected : view.focus;

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1100px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  function onTabsKey(event: KeyboardEvent<HTMLDivElement>) {
    const ids = view.stations.map((station) => station.id);
    const index = Math.max(0, ids.indexOf(current));
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % ids.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const id = ids[next];
    setSelected(id);
    requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
  }

  const station = view.stations.find((item) => item.id === current) ?? view.stations[0];
  const stepIndex = Math.max(0, view.stations.findIndex((item) => item.id === station?.id));
  const planner = gateCopy("planner", view);
  const wringer = gateCopy("wringer", view);
  const pendingLine = view.balances.map((row) => `${row.currency} pending ${row.pending ?? "0.00"}, reserved ${row.reserved ?? "0.00"}`).join(". ");

  return (
    <div className="desk-wrap">
      <a className="skip" href="#evidence-panel">Skip to evidence</a>
      <header className="bar">
        <p className="brand">Two-Key</p>
        <p className="kicker">INV-2291</p>
        <p className="mode">{view.modeLabel}</p>
        {view.publicFixture ? <a className="quiet" href="/">Ops desk</a> : <a className="quiet" href="/fixture">Public fixture</a>}
      </header>

      {offline ? (
        <p className="banner warning" id="offline-note" role="status">
          <span className="tag">Offline</span> This browser is offline. This is the last page that loaded. Controls stay off until the browser is back online. The receipt was not changed.
        </p>
      ) : null}
      {view.error ? <p className="banner" role="alert"><span className="tag">Error</span> {view.error}</p> : null}
      {view.warning ? <p className="banner warning" role="status"><span className="tag">Warning</span> {view.warning}</p> : null}

      <div className="board">
        <section className="incident" aria-labelledby="incident-heading">
          <div className="incident-top">
            <p className="ref">{view.reference}</p>
            <p className="stamp" data-tone={statusTone(view.status)}>
              <span className="mark" aria-hidden="true" />
              {view.status}
            </p>
          </div>
          <h1 className="amount" id="incident-heading">
            <span className="currency">{view.currency}</span>
            {view.amount}
          </h1>
          <p className="failure">{view.failure}</p>
          <div className="gates" role="group" aria-label="Two keys">
            <div className="gate" data-tone={planner.tone}>
              <span className="gate-name">Planner</span>
              <span className="gate-word"><span className="mark" aria-hidden="true" />{planner.word}</span>
              <span className="gate-note">{planner.note}</span>
            </div>
            <div className="gate" data-tone={wringer.tone}>
              <span className="gate-name">Wringer</span>
              <span className="gate-word"><span className="mark" aria-hidden="true" />{wringer.word}</span>
              <span className="gate-note">{wringer.note}</span>
            </div>
          </div>
          <p className="reason" id="key-reason">{view.keyReason}</p>
          <p className="request">Stable request id {view.requestId}</p>
          <Controls view={view} offline={offline} />
          <MoneyStrip view={view} />
          <p className="fine">{pendingLine}. Total equals available plus those. Floor {view.reserve}. Queued {view.queuedLabel} {view.queuedAmount}. Mock ledger, not a live balance.</p>
          <Counts view={view} />
        </section>

        <section className="evidence" aria-label="Evidence chain">
          <div
            className="steps"
            role="tablist"
            aria-label="Evidence chain"
            aria-orientation={wide ? "vertical" : "horizontal"}
            onKeyDown={onTabsKey}
          >
            {view.stations.map((item, index) => {
              const on = item.id === station?.id;
              return (
                <button
                  key={item.id}
                  id={`tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="evidence-panel"
                  tabIndex={on ? 0 : -1}
                  data-state={item.state}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="idx">{String(index + 1).padStart(2, "0")}</span>
                  <span className="lab">{item.label}</span>
                  <span className="st">{stateWord(item.state)}</span>
                </button>
              );
            })}
          </div>
          {station ? (
            <div
              className="evidence-body"
              id="evidence-panel"
              role="tabpanel"
              aria-labelledby={`tab-${station.id}`}
              tabIndex={0}
            >
              <p className="step-kicker">Step {stepIndex + 1} of {view.stations.length}</p>
              <h2>{station.label}</h2>
              <p>
                <Pill tone={station.state === "clear" ? "ok" : station.state === "block" ? "danger" : station.state === "unknown" ? "ink" : "hold"}>
                  {stateWord(station.state)}
                </Pill>
                {station.detail}
              </p>
              <p className="hint">Arrow keys move along the chain. This step is the only evidence open.</p>
              <StepBody view={view} id={station.id} />
            </div>
          ) : null}
        </section>
      </div>

      <div className="slip">
        <details>
          <summary>Receipt lines</summary>
          {view.receipt && view.receipt.length > 0 ? (
            <pre>{view.receipt.join("\n")}</pre>
          ) : (
            <p className="empty">No receipt yet. A seated pair of keys and one tap write it. A failed send does not get a paid receipt.</p>
          )}
        </details>
        {view.downloadHref ? <a className="quiet" href={view.downloadHref}>Download the redacted receipt</a> : null}
      </div>

      <footer className="foot">
        <span>{view.modeLabel}</span>
        <span>{view.modelLabel}</span>
        <span>Ledger: {view.ledgerLabel}</span>
        <span>Fixture {view.provenance.fixture}</span>
        <span>SHA {view.provenance.gitSha.slice(0, 12)}</span>
      </footer>
    </div>
  );
}
