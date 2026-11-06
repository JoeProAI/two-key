import { CopyId } from "./ui/copy-id";
import { actionName, resultWord } from "@/lib/desk/story";
import type { DeskView } from "@/lib/desk/types";

function beforeOf(view: DeskView, currency: string): string {
  return view.balancesBefore.find((row) => row.currency === currency)?.available ?? "";
}

export function TransferPanel({ view }: { view: DeskView }) {
  return (
    <section data-step="request">
      <h2>Transfer</h2>
      <p>This is the original cancelled payment. Later steps are the plan, the objections, the tap, and the send.</p>
      <dl className="meta">
        <div><dt>Reference</dt><dd>{view.reference}</dd></div>
        <div><dt>Status</dt><dd>{view.status}</dd></div>
        <div><dt>Amount</dt><dd>{view.amount} {view.currency}</dd></div>
        <div><dt>Why it failed</dt><dd>{view.failure}</dd></div>
        <div><dt>Beneficiary</dt><dd>{view.beneficiary}</dd></div>
      </dl>
      <CopyId id={view.transferId} label="Transfer id" />
      <CopyId id={view.originalRequestId} label="Original request" />
      <CopyId id={view.requestId} label="Stable retry" />
    </section>
  );
}

export function CashPanel({ view }: { view: DeskView }) {
  const usd = view.balances.find((row) => row.currency === "USD")?.available ?? view.balances[0]?.available ?? "0.00";
  const covers = Number(usd.replace(/,/g, "")) >= Number(view.reserve.replace(/,/g, ""));
  return (
    <section data-step="cash">
      <h2>Cash</h2>
      <p>USD available {usd}. Floor {view.reserve}. {covers ? "Available covers the floor." : "Available is short of the floor."}</p>
      <p>{view.queuedLabel} {view.queuedAmount}.</p>
      <p>The floor is a Two-Key rule. It is not reserved.</p>
    </section>
  );
}

export function PlanPanel({ view }: { view: DeskView }) {
  return (
    <section data-step="plan">
      <h2>Plan</h2>
      {view.webhooks.length === 0 ? <p>No notices ingested for this transfer.</p> : (
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
                  <td>{row.flag || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.rounds.length === 0 ? <p>No plan filed. The cancelled transfer is the only fact so far.</p> : view.rounds.map((round) => (
        <article className="round" key={round.round}>
          <h3>Round {round.round}</h3>
          <p>{round.summary}</p>
          <ul>
            {round.actions.map((action) => (
              <li key={`${round.round}-${action.kind}-${action.requestId ?? action.detail}`}>
                <strong>Proposed. {actionName(action.kind)}.</strong> {action.detail}
                {action.requestId ? <CopyId id={action.requestId} label="Request id" /> : null}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

export function ObjectionsPanel({ view }: { view: DeskView }) {
  return (
    <section data-step="wringer">
      <h2>Objections from Wringer</h2>
      {view.rounds.length === 0 ? <p>No objections yet. File a plan first.</p> : view.rounds.map((round) => (
        <article className="round" key={`findings-${round.round}`}>
          <h3>Round {round.round}</h3>
          {round.findings.length === 0 ? <p>No objection on this round.</p> : (
            <ul>
              {round.findings.map((finding) => (
                <li key={`${round.round}-${finding.check}`}>
                  <strong>{finding.severity === "block" ? "Objection." : "Note."}</strong> {finding.check}. {finding.detail}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}

export function ApprovalPanel({ view }: { view: DeskView }) {
  return (
    <section data-step="approval">
      <h2>Approval</h2>
      {view.rounds.length === 0 ? <p>Nothing is waiting for a tap.</p> : view.rounds.map((round) => (
        <p key={`decision-${round.round}`}>
          Round {round.round}: {round.decision === "awaiting_human" ? "waiting for a tap" : round.decision}
          {round.approvedBy ? `, approved by ${round.approvedBy}` : ""}.
        </p>
      ))}
      <p>A tap is bound to this plan and this cash. If either changes, the tap is refused. The control stays off while an objection is open. Nothing here approves by itself.</p>
    </section>
  );
}

export function SendsPanel({ view }: { view: DeskView }) {
  const latest = view.rounds.at(-1);
  const pairs = (latest?.actions ?? []).map((action) => ({
    action,
    executed: action.requestId ? view.executions.find((row) => row.requestId === action.requestId) ?? null : null,
  }));
  const matched = new Set(pairs.map((pair) => pair.executed?.requestId).filter((id): id is string => Boolean(id)));
  const extra = view.executions.filter((row) => !matched.has(row.requestId));
  return (
    <section data-step="execution">
      <h2>Sends</h2>
      {pairs.length === 0 && view.executions.length === 0 ? <p>No send yet.</p> : null}
      {pairs.map((pair) => (
        <article className="pair" key={`${pair.action.kind}-${pair.action.requestId ?? pair.action.detail}`}>
          <h3>{actionName(pair.action.kind)}</h3>
          {pair.action.requestId ? <CopyId id={pair.action.requestId} label="Request id" /> : <p>No request id on this action.</p>}
          <div className="pair-grid">
            <div>
              <h4>Proposed</h4>
              <p>{pair.action.detail}</p>
            </div>
            <div>
              <h4>Executed</h4>
              {pair.executed ? (
                <>
                  <p>{resultWord(pair.executed.result)}</p>
                  {pair.executed.providerId ? <CopyId id={pair.executed.providerId} label="Provider id" /> : <p>No provider id on this row.</p>}
                  {pair.executed.note ? <p>{pair.executed.note}</p> : null}
                </>
              ) : <p>Not sent.</p>}
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
                  <td>{actionName(row.action)}</td>
                  <td>{resultWord(row.result)}{row.note ? `. ${row.note}` : ""}</td>
                  <td>{row.requestId}</td>
                  <td>{row.providerId ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function BalancesPanel({ view }: { view: DeskView }) {
  return (
    <section data-step="balances">
      <h2>Balance detail</h2>
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
              <tr key={row.currency}>
                <td>{row.currency}</td>
                <td>{beforeOf(view, row.currency)}</td>
                <td>{row.available}</td>
                <td>{row.pending ?? "0.00"}</td>
                <td>{row.reserved ?? "0.00"}</td>
                <td>{row.total ?? row.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>The 10,000 floor is a Two-Key rule, not reserved. Mock ledger math, not a live balance.</p>
    </section>
  );
}

export function ReplayPanel({ view }: { view: DeskView }) {
  const providerIds = view.executions.map((row) => row.providerId).filter((id): id is string => Boolean(id));
  const shared = new Set(providerIds.filter((id, index) => providerIds.indexOf(id) !== index));
  return (
    <section data-step="replay">
      <h2>Replay</h2>
      <p>{view.replayed ? "Reconcile kept the original provider id. It did not replan or pay." : "Reconcile reads the saved actions. It does not file a new plan."}</p>
      {view.executions.length === 0 ? <p>No send rows on this receipt.</p> : (
        <ul>
          {view.executions.map((row) => (
            <li key={`${row.action}-${row.requestId}-${row.result}`}>
              <strong>{resultWord(row.result)}. {actionName(row.action)}.</strong>
              {row.note ? ` ${row.note}` : ""}
              <CopyId id={row.requestId} label="Request id" />
              {row.providerId ? (
                <CopyId id={row.providerId} label={shared.has(row.providerId) ? "Provider id, same as another row" : "Provider id"} />
              ) : <p>No provider id on this row.</p>}
            </li>
          ))}
        </ul>
      )}
      <p>Full receipt lines stay folded below. The download is the redacted pack.</p>
    </section>
  );
}
