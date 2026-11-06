import { approveDesk, planDesk, replayDesk, unlockDesk } from "./actions";
import {
  ApprovalPanel,
  BalancesPanel,
  CashPanel,
  ObjectionsPanel,
  PlanPanel,
  ReplayPanel,
  SendsPanel,
  TransferPanel,
} from "./desk-panels";
import { DeskFrame } from "./ui/desk-frame";
import { EvidenceSwitch } from "./ui/evidence-switch";
import { ApproverField, DeskKeyField, GuardedForm } from "./ui/guarded-form";
import { SubmitButton } from "./ui/submit-button";
import { CopyId } from "./ui/copy-id";
import {
  approvalLine,
  countLine,
  decisionCopy,
  gateLine,
  proposalLine,
  resultLine,
  stationNote,
  tabLabel,
} from "@/lib/desk/story";
import type { DeskView } from "@/lib/desk/types";

function Actions({ view }: { view: DeskView }) {
  if (view.locked) {
    return (
      <div className="actions">
        {view.lockNote ? <p>{view.lockNote}</p> : null}
        {view.canUnlock ? (
          <GuardedForm action={unlockDesk} blocked={false}>
            <DeskKeyField />
            <SubmitButton idle="Unlock the desk" pending="Checking the key" />
          </GuardedForm>
        ) : null}
      </div>
    );
  }
  const showPay = !view.publicFixture && view.phase !== "incident" && !view.canReplay;
  const payBlocked = !view.canApprove;
  return (
    <div className="actions">
      {view.publicFixture && view.lockNote ? <p>{view.lockNote}</p> : null}
      {view.canPlan ? (
        <GuardedForm action={planDesk}>
          <SubmitButton
            quiet={showPay || view.canReplay}
            idle={view.phase === "failed" ? "Replan with fresh balances" : "Run the planner"}
            pending="Filing the plan"
          />
        </GuardedForm>
      ) : null}
      {view.publicFixture || view.phase === "incident" ? null : view.canReplay ? (
        <GuardedForm action={replayDesk}>
          <input type="hidden" name="approver" value="joe" />
          <SubmitButton idle="Reconcile this receipt" pending="Reconciling" />
        </GuardedForm>
      ) : (
        <GuardedForm action={approveDesk} blocked={payBlocked}>
          <ApproverField blocked={payBlocked} />
          <SubmitButton
            idle={view.phase === "failed" ? "Retry the approved plan" : "Approve and pay once"}
            pending="Paying once"
            blocked={payBlocked}
          />
        </GuardedForm>
      )}
    </div>
  );
}

export function Desk({ view }: { view: DeskView }) {
  const lead = decisionCopy(view);
  const counts = countLine(view);
  const tabs = view.stations.map((station) => ({
    id: station.id,
    label: tabLabel(station.id, station.label),
    note: stationNote(station),
  }));
  const pending = view.balances.map((row) => `${row.currency} pending ${row.pending ?? "0.00"}, reserved ${row.reserved ?? "0.00"}`).join(". ");

  return (
    <DeskFrame>
      <header className="mast">
        <div className="mast-id">
          <p className="brand">Two-Key</p>
          <p className="where">{view.reference}</p>
        </div>
        <div className="mast-side">
          <p className="where">{view.publicFixture ? "Mock fixture. Read only." : "Private desk. Mock ledger."}</p>
          {view.publicFixture ? <a className="quiet-link" href="/">Private desk</a> : <a className="quiet-link" href="/fixture">Mock fixture</a>}
        </div>
      </header>

      {view.warning ? <p className="banner" role="status"><em className="accent">Warning.</em> {view.warning}</p> : null}

      <h1 id="decision" role={view.error ? "alert" : undefined}>
        <em className="accent">{lead.accent}</em> {lead.rest}
      </h1>
      <p className="gate" id="key-reason">{gateLine(view)}</p>

      <div className="facts">
        <section>
          <h2>Failed transfer</h2>
          <p>{view.status}. {view.failure}</p>
          <p className="figure">{view.amount} {view.currency}</p>
        </section>
        <section>
          <h2>Proposed</h2>
          <p>{proposalLine(view)}</p>
        </section>
        <section>
          <h2>Approval</h2>
          <p>{approvalLine(view)}</p>
        </section>
        <section>
          <h2>Result</h2>
          <p>{resultLine(view)}</p>
          {counts ? <p>{counts}</p> : null}
        </section>
      </div>

      <section className="balances" aria-labelledby="balance-heading">
        <h2 id="balance-heading">Resulting balances</h2>
        <table>
          <caption>Before is the opening available balance. Now is available after this beat. Total is available plus pending plus reserved.</caption>
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col">Before</th>
              <th scope="col">Now</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {view.balances.map((row) => (
              <tr key={row.currency}>
                <th scope="row">{row.currency}</th>
                <td>{view.balancesBefore.find((item) => item.currency === row.currency)?.available ?? row.available}</td>
                <td>{row.available}</td>
                <td>{row.total ?? row.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fine">{pending}. Floor {view.reserve} {view.currency === "USD" ? "USD" : view.currency}. {view.queuedLabel} {view.queuedAmount}. The floor is a rule, not reserved. Mock ledger, not a live balance.</p>
        <CopyId id={view.requestId} label="Stable retry request" />
      </section>

      <Actions view={view} />

      <EvidenceSwitch tabs={tabs} focus={view.focus}>
        <TransferPanel view={view} />
        <CashPanel view={view} />
        <PlanPanel view={view} />
        <ObjectionsPanel view={view} />
        <ApprovalPanel view={view} />
        <SendsPanel view={view} />
        <BalancesPanel view={view} />
        <ReplayPanel view={view} />
      </EvidenceSwitch>

      <div className="slip">
        <details>
          <summary>Receipt lines</summary>
          {view.receipt && view.receipt.length > 0 ? <pre>{view.receipt.join("\n")}</pre> : (
            <p>No receipt yet. A clear plan and one tap write it. A failed send does not get a paid receipt.</p>
          )}
        </details>
        {view.downloadHref ? <a className="quiet-link" href={view.downloadHref}>Download the redacted receipt</a> : null}
      </div>

      <footer className="foot">
        <span>{view.modeLabel}</span>
        <span>{view.publicFixture ? "Public page" : "Private page"}</span>
        <span>{view.modelLabel}</span>
        <span>Ledger: {view.ledgerLabel}</span>
        <span>Fixture {view.provenance.fixture}</span>
        <span>SHA {view.provenance.gitSha.slice(0, 12)}</span>
      </footer>
    </DeskFrame>
  );
}
