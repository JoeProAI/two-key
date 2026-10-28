"use client";

import { useFormStatus } from "react-dom";
import { approveDesk, planDesk, replayDesk } from "./actions";
import type { DeskView } from "@/lib/desk/types";

function Submit({ idle, pending, disabled, className }: { idle: string; pending: string; disabled?: boolean; className?: string }) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || status.pending} aria-busy={status.pending || undefined}>
      {status.pending ? pending : idle}
    </button>
  );
}

export function Desk({ view }: { view: DeskView }) {
  return (
    <div className="desk-wrap">
      <header className="mast">
        <p className="kicker">Payment ops · Incident INV-2291</p>
        <div className="mast-row">
          <h1>Two-Key</h1>
          <p className="case-no">Northwind Steel</p>
        </div>
        <p className="lede">A $40,000 supplier payment failed on the account name. One retry. Two keys. A receipt.</p>
      </header>

      {view.error ? <p className="banner" role="alert">{view.error}</p> : null}
      {view.warning ? <p className="banner warning">{view.warning}</p> : null}

      <div className="desk">
        <article className="sheet">
          <div className="amount-break">
            <div className="figures">
              <p className="currency">{view.currency}</p>
              <p className="amount">{view.amount}</p>
            </div>
            <p className="stamp" aria-hidden="true">Cancelled</p>
          </div>
          <p className="failure">{view.failure}</p>
          <dl className="meta">
            <div>
              <dt>Reference</dt>
              <dd>{view.reference}</dd>
            </div>
            <div>
              <dt>Transfer</dt>
              <dd>{view.transferId}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{view.status}</dd>
            </div>
            <div>
              <dt>Beneficiary</dt>
              <dd>{view.beneficiary}</dd>
            </div>
            <div>
              <dt>Original request</dt>
              <dd>{view.originalRequestId}</dd>
            </div>
          </dl>

          <section className="tape">
            <h2>Notices</h2>
            {view.webhooks.length === 0 ? (
              <p className="empty">No notices ingested for this transfer. Wait for the failure, then run the planner.</p>
            ) : (
              <table>
                <caption>Arrival order. Duplicates and a late processing notice are marked.</caption>
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
            <p className="note">Arrival order ends on PROCESSING. Created-at order ends on CANCELLED. The desk follows created-at, then a fresh read of the transfer.</p>
          </section>

          <section className="balances">
            <h2>Balances now</h2>
            <table>
              <caption>Available balances, the USD floor, and the queued retainer.</caption>
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col">Available</th>
                </tr>
              </thead>
              <tbody>
                {view.balances.map((row) => (
                  <tr key={row.currency}>
                    <td>{row.currency}</td>
                    <td>{row.available}</td>
                  </tr>
                ))}
                <tr>
                  <td>USD floor</td>
                  <td>{view.reserve}</td>
                </tr>
                <tr>
                  <td>{view.queuedLabel}</td>
                  <td>{view.queuedAmount}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="rounds">
            <h2>Rounds</h2>
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
                {round.findings.map((finding) => (
                  <p className={finding.severity === "block" ? "finding block" : "finding"} key={`${round.round}-${finding.check}`}>
                    <span className="check">{finding.severity === "block" ? "Block" : "Note"} · {finding.check}</span>
                    <br />
                    {finding.detail}
                  </p>
                ))}
                <p className="decision">
                  Decision: {round.decision}
                  {round.approvedBy ? `, approved by ${round.approvedBy}` : ""}
                </p>
              </article>
            ))}
            {view.canPlan ? (
              <form action={planDesk}>
                <Submit className="ghost" idle="Run the planner" pending="Filing the plan" />
              </form>
            ) : null}
          </section>

          <section className="receipt-slip" aria-live="polite">
            <h2>Receipt</h2>
            {view.receipt && view.receipt.length > 0 ? (
              <pre>{view.receipt.join("\n")}</pre>
            ) : (
              <p className="empty">No receipt yet. A seated pair of keys and one tap write it.</p>
            )}
            {view.transfersCreated !== null ? (
              <p className="counts">
                <span>Transfers created: {view.transfersCreated}</span>
                <span>Conversions created: {view.conversionsCreated}</span>
                {view.replayed ? <span>Replay on an empty ledger</span> : null}
              </p>
            ) : null}
          </section>
        </article>

        <aside className="rail">
          <h2>Keys</h2>
          <div className="keys" role="group" aria-label="Two keys">
            <div className="tumbler" data-state={view.plannerSeated ? "seated" : "open"}>
              <span className="slot" aria-hidden="true" />
              <span className="key-name">Planner</span>
              <span className="key-state">{view.plannerSeated ? "Seated" : "Open"}</span>
            </div>
            <div className="tumbler" data-state={view.wringerSeated ? "seated" : "open"}>
              <span className="slot" aria-hidden="true" />
              <span className="key-name">Wringer</span>
              <span className="key-state">
                {view.wringerSeated ? "Seated" : view.plannerSeated ? `Open. ${view.blockCount} blocks.` : "Open"}
              </span>
            </div>
          </div>
          <p className="request" id="key-reason">{view.keyReason}</p>
          <p className="request">Stable request id {view.requestId}</p>
          {view.phase === "incident" ? null : view.canReplay ? (
            <form className="replay" action={replayDesk}>
              <input type="hidden" name="approver" value="joe" />
              <Submit idle="Replay on an empty ledger" pending="Replaying" />
            </form>
          ) : (
            <form className="tap" action={approveDesk}>
              <label htmlFor="approver">Approver</label>
              <input id="approver" name="approver" type="text" defaultValue="joe" maxLength={40} autoComplete="name" required disabled={!view.canApprove} />
              <Submit idle="Approve and pay once" pending="Paying once" disabled={!view.canApprove} />
            </form>
          )}
        </aside>
      </div>

      <footer className="foot">
        <span>{view.modelLabel}</span>
        <span>Ledger: {view.ledgerLabel}</span>
      </footer>
    </div>
  );
}
