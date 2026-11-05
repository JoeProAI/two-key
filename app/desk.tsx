"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { approveDesk, planDesk, replayDesk, unlockDesk } from "./actions";
import type { DeskView } from "@/lib/desk/types";

function Submit({ idle, pending, disabled, className }: { idle: string; pending: string; disabled?: boolean; className?: string }) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || status.pending} aria-busy={status.pending || undefined}>
      {status.pending ? pending : idle}
    </button>
  );
}

function parseMoney(value: string): number {
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function Floor({ available, floor }: { available: string; floor: string }) {
  const have = parseMoney(available);
  const mark = parseMoney(floor);
  const max = Math.max(have, mark, 1);
  return (
    <div className="floor">
      <div className="floor-label">
        <span>USD available {available}</span>
        <span>Floor {floor}</span>
      </div>
      <div className="floor-track" role="img" aria-label={`USD available ${available} against a floor of ${floor}`}>
        <div className="floor-fill" style={{ width: `${Math.min(100, (have / max) * 100)}%` }} />
        <div className="floor-mark" style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} />
      </div>
    </div>
  );
}

export function Desk({ view }: { view: DeskView }) {
  const [offline, setOffline] = useState(false);
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
  const usd = view.balances.find((row) => row.currency === "USD")?.available ?? view.balances[0]?.available ?? "0.00";

  return (
    <div className="desk-wrap">
      <header className="mast">
        <p className="kicker">Payment ops · Incident INV-2291</p>
        <div className="mast-row">
          <h1>Two-Key</h1>
          <p className="mode">{view.modeLabel}</p>
        </div>
        <p className="lede">A $40,000 supplier payment failed on the account name. One retry. Two keys. A receipt you can trace from the request to the balance.</p>
        <p><a className="text-link" href="/fixture">Public fixture</a></p>
      </header>

      {offline ? <p className="banner warning" role="status">This browser is offline. The sheet is the last page that loaded. A tap needs the server.</p> : null}
      {view.error ? <p className="banner" role="alert">{view.error}</p> : null}
      {view.warning ? <p className="banner warning">{view.warning}</p> : null}

      <nav className="spine" aria-label="Evidence spine">
        <ol>
          {view.stations.map((station, index) => (
            <li key={station.id}>
              <a href={`#evidence-${station.id}`} data-state={station.state} aria-current={station.id === view.focus ? "true" : undefined}>
                <span className="spine-index">{index + 1}</span>
                <span className="spine-label">{station.label}</span>
                <span className="spine-detail">{station.detail}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="desk">
        <article className="sheet">
          <section id="evidence-request" data-current={view.focus === "request" ? "true" : undefined}>
            <h2>Request</h2>
            <div className="amount-break">
              <div className="figures">
                <p className="currency">{view.currency}</p>
                <p className="amount">{view.amount}</p>
              </div>
              <p className="stamp">{view.status}</p>
            </div>
            <p className="failure">{view.failure}</p>
            <dl className="meta">
              <div><dt>Reference</dt><dd>{view.reference}</dd></div>
              <div><dt>Transfer</dt><dd>{view.transferId}</dd></div>
              <div><dt>Status</dt><dd>{view.status}</dd></div>
              <div><dt>Beneficiary</dt><dd>{view.beneficiary}</dd></div>
              <div><dt>Original request</dt><dd>{view.originalRequestId}</dd></div>
              <div><dt>Stable retry</dt><dd>{view.requestId}</dd></div>
            </dl>
          </section>

          <section id="evidence-cash" data-current={view.focus === "cash" ? "true" : undefined}>
            <h2>Cash</h2>
            <Floor available={usd} floor={view.reserve} />
            <table>
              <caption>Available balances, the USD floor, and the queued retainer.</caption>
              <thead>
                <tr><th scope="col">Currency</th><th scope="col">Available</th></tr>
              </thead>
              <tbody>
                {view.balances.map((row) => (
                  <tr key={row.currency}><td>{row.currency}</td><td>{row.available}</td></tr>
                ))}
                <tr><td>USD floor</td><td>{view.reserve}</td></tr>
                <tr><td>{view.queuedLabel}</td><td>{view.queuedAmount}</td></tr>
              </tbody>
            </table>
          </section>

          <section className="tape" id="evidence-plan" data-current={view.focus === "plan" ? "true" : undefined}>
            <h2>Notices and plan</h2>
            {view.webhooks.length === 0 ? (
              <p className="empty">No notices ingested for this transfer.</p>
            ) : (
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
                  {view.webhooks.map((row, i) => (
                    <tr key={`${row.id}-${i}`}>
                      <td>{row.id}</td>
                      <td>{row.name}</td>
                      <td>{row.status}</td>
                      <td>{row.created}</td>
                      <td>{row.flag ? <span className="flag">{row.flag}</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="rounds">
              {view.rounds.length === 0 ? (
                <p className="empty">No plan filed. The failed transfer is the only thing on the sheet.</p>
              ) : view.rounds.map((round) => (
                <article className="round" key={round.round}>
                  <p className="round-no">Round {round.round}</p>
                  <p className="summary">{round.summary}</p>
                  <ul>
                    {round.actions.map((action) => (
                      <li key={`${round.round}-${action.kind}-${action.requestId ?? action.detail}`}>
                        <strong>{action.kind}.</strong> {action.detail}
                        {action.requestId ? <div className="request">{action.requestId}</div> : null}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            {view.canPlan ? (
              <form action={planDesk}>
                <Submit className="ghost" idle={view.phase === "failed" ? "Replan with fresh balances" : "Run the planner"} pending="Filing the plan" />
              </form>
            ) : null}
          </section>

          <section id="evidence-wringer" data-current={view.focus === "wringer" ? "true" : undefined}>
            <h2>Wringer</h2>
            {view.rounds.length === 0 ? <p className="empty">No objections yet. File a plan first.</p> : null}
            {view.rounds.map((round) => (
              <details key={`findings-${round.round}`} open={round.round === view.rounds.length}>
                <summary>Round {round.round} objections</summary>
                {round.findings.length === 0 ? <p className="empty">No objection on this round.</p> : round.findings.map((finding) => (
                  <p className={finding.severity === "block" ? "finding block" : "finding"} key={`${round.round}-${finding.check}`}>
                    <span className="check">{finding.severity === "block" ? "Block" : "Note"} · {finding.check}</span>
                    <br />
                    {finding.detail}
                  </p>
                ))}
              </details>
            ))}
          </section>

          <section id="evidence-approval" data-current={view.focus === "approval" ? "true" : undefined}>
            <h2>Approval</h2>
            {view.rounds.length === 0 ? <p className="empty">Nothing is waiting for a tap.</p> : view.rounds.map((round) => (
              <p className="decision" key={`decision-${round.round}`}>
                Round {round.round}: {round.decision}
                {round.approvedBy ? `, approved by ${round.approvedBy}` : ""}
              </p>
            ))}
            <p className="note">A tap is bound to this plan and this evidence. If either changes, the tap is refused.</p>
          </section>

          <section id="evidence-execution" data-current={view.focus === "execution" ? "true" : undefined}>
            <h2>Execution</h2>
            {view.executions.length === 0 ? (
              <p className="empty">No execution yet.</p>
            ) : (
              <table className="exec-table">
                <caption>Each row is one request id. already_done keeps the original provider id.</caption>
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Result</th>
                    <th scope="col">Provider id</th>
                  </tr>
                </thead>
                <tbody>
                  {view.executions.map((ex) => (
                    <tr key={`${ex.action}-${ex.requestId}-${ex.result}`}>
                      <td>{ex.action}<div className="request">{ex.requestId}</div></td>
                      <td>{ex.result}{ex.note ? <div className="request">{ex.note}</div> : null}</td>
                      <td>{ex.providerId ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section id="evidence-balances" className="balances" data-current={view.focus === "balances" ? "true" : undefined}>
            <h2>Balances</h2>
            <table>
              <caption>Available is spendable in this mock. Pending and reserved stay 0. Total is available plus those.</caption>
              <thead>
                <tr><th scope="col">Currency</th><th scope="col">Before available</th><th scope="col">Available</th><th scope="col">Pending</th><th scope="col">Reserved</th><th scope="col">Total</th></tr>
              </thead>
              <tbody>
                {view.balances.map((row) => (
                  <tr key={`after-${row.currency}`}>
                    <td>{row.currency}</td>
                    <td>{view.balancesBefore.find((b) => b.currency === row.currency)?.available ?? ""}</td>
                    <td>{row.available}</td>
                    <td>{row.pending ?? "0.00"}</td>
                    <td>{row.reserved ?? "0.00"}</td>
                    <td>{row.total ?? row.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section id="evidence-replay" className="receipt-slip" data-current={view.focus === "replay" ? "true" : undefined} aria-live="polite">
            <h2>Receipt</h2>
            {view.receipt && view.receipt.length > 0 ? (
              <details>
                <summary>Plain receipt lines</summary>
                <pre>{view.receipt.join("\n")}</pre>
              </details>
            ) : (
              <p className="empty">No receipt yet. A seated pair of keys and one tap write it. A failed send does not get a paid receipt.</p>
            )}
            {view.transferCalls !== null ? (
              <p className="counts">
                <span>Transfer calls: {view.transferCalls}</span>
                <span>Transfers settled: {view.transfersSettled ?? 0}</span>
                <span>Conversion calls: {view.conversionCalls}</span>
                <span>Conversions settled: {view.conversionsSettled ?? 0}</span>
              </p>
            ) : view.transfersSettled !== null ? (
              <p className="counts">
                <span>Transfers settled: {view.transfersSettled}</span>
                <span>Conversions settled: {view.conversionsSettled ?? 0}</span>
                <span>Call attempts are not stored on this ledger</span>
              </p>
            ) : null}
            {view.executions.some((row) => row.result === "error") ? (
              <p className="note">An error row did not settle. Calls count the attempt. Settled counts an object this mock stored.</p>
            ) : null}
            <p className="note">Available is what this mock will spend. Pending and reserved stay 0, and total equals available plus those. The 10,000 floor is a Two-Key rule, not reserved_amount. Mock ledger math, not a live balance.</p>
            <p className="note">{view.replayed ? "Reconcile kept the original provider id. It did not replan or pay." : "Reconcile reads the saved actions. It does not file a new plan."}</p>
          </section>
        </article>

        <aside className="rail">
          <h2>Keys</h2>
          <div className="keys" role="group" aria-label="Two keys">
            <div className="tumbler" data-state={view.locked ? "closed" : view.plannerSeated ? "seated" : "open"}>
              <span className="slot" aria-hidden="true" />
              <span className="key-name">Planner</span>
              <span className="key-state">{view.locked ? "Closed" : view.plannerSeated ? "Seated" : "Open"}</span>
            </div>
            <div className="tumbler" data-state={view.locked ? "closed" : view.wringerSeated ? "seated" : "open"}>
              <span className="slot" aria-hidden="true" />
              <span className="key-name">Wringer</span>
              <span className="key-state">
                {view.locked ? "Closed" : view.wringerSeated ? "Seated" : view.plannerSeated ? `Open. ${view.blockCount} blocks.` : "Open"}
              </span>
            </div>
          </div>
          <p className="request" id="key-reason">{view.keyReason}</p>
          <p className="request">Stable request id {view.requestId}</p>
          {view.publicFixture ? <p className="note">{view.lockNote}</p> : null}
          {view.downloadHref ? <p><a className="text-link" href={view.downloadHref}>Download the redacted receipt</a></p> : null}
          {view.locked ? (
            <div className="lock">
              <p className="request">{view.lockNote}</p>
              {view.canUnlock ? (
                <form className="tap" action={unlockDesk}>
                  <label htmlFor="desk-key">Desk key</label>
                  <input id="desk-key" name="deskKey" type="password" autoComplete="current-password" maxLength={200} required />
                  <Submit idle="Unlock the desk" pending="Checking the key" />
                </form>
              ) : null}
            </div>
          ) : view.publicFixture ? (
            <p><a className="text-link" href="/">Ops desk</a></p>
          ) : view.phase === "incident" ? (
            <p><a className="text-link" href="/fixture">Public fixture</a></p>
          ) : view.canReplay ? (
            <form className="replay" action={replayDesk}>
              <input type="hidden" name="approver" value="joe" />
              <Submit idle="Reconcile this receipt" pending="Reconciling" />
            </form>
          ) : (
            <form className="tap" action={approveDesk}>
              <label htmlFor="approver">Approver</label>
              <input id="approver" name="approver" type="text" defaultValue="joe" maxLength={40} autoComplete="name" required disabled={!view.canApprove} />
              <Submit idle={view.phase === "failed" ? "Retry the approved plan" : "Approve and pay once"} pending="Paying once" disabled={!view.canApprove} />
            </form>
          )}
        </aside>
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
