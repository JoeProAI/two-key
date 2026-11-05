import "server-only";
import { createMockClient } from "../airwallex/mock";
import * as fx from "../airwallex/fixtures";
import type { Action } from "../ledger/types";
import { MemoryLedger } from "../ledger/memory";
import { stableRequestId } from "../requestId";
import { buildReceipt, runDemo } from "../scenario";
import { approve, execute } from "../agents/executor";
import { agentMode } from "../agents/openrouter";
import { ledgerBackend, loadIncident, syncIncident } from "../ledger/remote";
import { ledgerFromRemote, type RemoteIncident } from "../ledger/payload";
import { assertDeskAccess, gateState, type DeskAccess, type GateState } from "./gate";
import type { DeskRound, DeskView, DeskWebhook } from "./types";

const NO_ACCESS: DeskAccess = { unlocked: false };

const INTENT_ID = "intent_inv2291";

type Session = {
  awx: ReturnType<typeof createMockClient>;
  ledger: MemoryLedger;
  phase: "review" | "paid" | "failed";
  ledgerKind: "memory" | "convex";
  warning: string | null;
  error: string | null;
  replayed: boolean;
  now: number;
};

type DeskGlobal = { session: Session | null; bootError: string | null };

/** One store for the whole Node process. Next bundles the page and the server actions separately, so a module-level `let` would not be shared. */
const deskGlobal = globalThis as typeof globalThis & { __twoKeyDesk?: DeskGlobal };
const store: DeskGlobal = (deskGlobal.__twoKeyDesk ??= { session: null, bootError: null });

export function resetDeskForTests() {
  store.session = null;
  store.bootError = null;
}

export function noteDeskError(message: string) {
  store.bootError = message;
  if (store.session) store.session.error = message;
}

export function cleanApprover(raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 40);
  return cleaned || "joe";
}

export function publicError(e: unknown): string {
  const message = e instanceof Error ? e.message : "The desk could not finish.";
  if (/unauthorized/i.test(message)) return "The ledger refused the write.";
  if (/convex|https?:|secret|token|api[_ ]?key/i.test(message)) return "The desk could not finish. The detail stays on the server.";
  return message.slice(0, 240);
}

function fmt(amount: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function failureText(): string {
  const reason = fx.originalTransfer.failure_reason;
  if (!reason) return "No failure reason on the transfer.";
  if (typeof reason === "string") return reason;
  return reason.description || reason.code || "Failure reason missing.";
}

function webhookRows(): DeskWebhook[] {
  const seen = new Set<string>();
  return fx.demoWebhookDeliveries.map((event) => {
    let flag = "";
    if (seen.has(event.id)) flag = "Duplicate";
    else if (event.id === "evt_proc_00") flag = "Late arrival";
    seen.add(event.id);
    return {
      id: event.id,
      name: event.name,
      status: event.data.object.status,
      created: event.created_at,
      flag,
    };
  });
}

function actionRow(action: Action): DeskRound["actions"][number] {
  if (action.kind === "retry_transfer") {
    return { kind: "Retry transfer", detail: `${action.currency} ${fmt(action.amount)} once`, requestId: action.requestId };
  }
  if (action.kind === "fx_conversion") {
    return { kind: "FX conversion", detail: `Buy ${fmt(action.buyAmount)} ${action.buyCurrency} with ${action.sellCurrency}`, requestId: action.requestId };
  }
  return { kind: "Defer payout", detail: `${action.currency} ${fmt(action.amount)} held until ${action.until}`, requestId: `defer:${action.payoutId}` };
}

function roundsFromLedger(ledger: MemoryLedger): DeskRound[] {
  return ledger.proposals
    .filter((p) => p.intentId === INTENT_ID)
    .map((p) => {
      const decision = ledger.decisions.find((d) => d.proposalId === p.id);
      return {
        round: p.round,
        summary: p.summary,
        decision: decision?.status ?? "open",
        approvedBy: decision?.humanApprovedBy,
        actions: p.actions.map(actionRow),
        findings: ledger.objections
          .filter((o) => o.proposalId === p.id)
          .map((o) => ({ check: o.check, severity: o.severity, detail: o.detail })),
      };
    });
}

function modelLabel(): string {
  return agentMode() === "llm" ? "Live model" : "Fixture responses";
}

function ledgerLabel(kind: "memory" | "convex"): string {
  return kind === "convex" ? "Convex" : "This process";
}

function keyCopy(phase: DeskView["phase"], plannerSeated: boolean, wringerSeated: boolean, blockCount: number, requestId: string): string {
  if (phase === "paid") return `Paid once under request_id ${requestId}.`;
  if (phase === "failed") return "The approved plan did not finish. Nothing is marked paid. Retry it or replan with fresh balances.";
  if (!plannerSeated) return "Both keys are open. Run the planner.";
  if (!wringerSeated) return `Wringer key is open. ${blockCount} blocking objection${blockCount === 1 ? "" : "s"} on the latest round.`;
  return "Both keys are seated. One tap pays once.";
}

function baseView(partial: Partial<DeskView> & Pick<DeskView, "phase" | "rounds" | "receipt" | "canPlan" | "canApprove" | "canReplay">): DeskView {
  const requestId = stableRequestId(INTENT_ID, "retry_transfer", "0");
  const view: DeskView = {
    transferId: fx.ORIGINAL_TRANSFER_ID,
    amount: fmt(fx.originalTransfer.transfer_amount),
    currency: fx.originalTransfer.transfer_currency,
    status: fx.originalTransfer.status,
    reference: fx.originalTransfer.reference ?? "",
    failure: failureText(),
    beneficiary: fx.SUPPLIER_BENEFICIARY_ID,
    originalRequestId: fx.ORIGINAL_REQUEST_ID,
    balances: fx.balances.map((b) => ({ currency: b.currency, available: fmt(b.available_amount) })),
    reserve: fmt(fx.RESERVE_USD),
    queuedLabel: fx.queuedPayout.label,
    queuedAmount: fmt(fx.queuedPayout.amount),
    webhooks: webhookRows(),
    requestId,
    transfersCreated: null,
    conversionsCreated: null,
    ledgerLabel: ledgerLabel(ledgerBackend() === "convex" ? "convex" : "memory"),
    modelLabel: modelLabel(),
    error: store.bootError,
    warning: null,
    replayed: false,
    blockCount: 0,
    plannerSeated: false,
    wringerSeated: false,
    keyReason: "",
    locked: false,
    lockNote: null,
    canUnlock: false,
    ...partial,
  };
  view.blockCount = view.rounds.at(-1)?.findings.filter((f) => f.severity === "block").length ?? 0;
  view.plannerSeated = view.phase !== "incident";
  view.wringerSeated = view.plannerSeated && view.blockCount === 0;
  view.canApprove = partial.canApprove && view.wringerSeated;
  view.keyReason = keyCopy(view.phase, view.plannerSeated, view.wringerSeated, view.blockCount, view.requestId);
  return view;
}

function viewFromSession(s: Session): DeskView {
  const rounds = roundsFromLedger(s.ledger);
  const receipt = s.ledger.receipts.filter((r) => r.intentId === INTENT_ID).at(-1)?.lines ?? null;
  return baseView({
    phase: s.phase,
    rounds,
    receipt,
    balances: s.awx.balances.map((b) => ({ currency: b.currency, available: fmt(b.available_amount) })),
    transfersCreated: s.awx.calls.createTransfer,
    conversionsCreated: s.awx.calls.createConversion,
    ledgerLabel: ledgerLabel(s.ledgerKind),
    error: s.error ?? store.bootError,
    warning: s.warning,
    canPlan: s.phase === "failed",
    canApprove: s.phase === "review" || s.phase === "failed",
    canReplay: s.phase === "paid",
    replayed: s.replayed,
  });
}

function viewFromRemote(remote: RemoteIncident): DeskView | null {
  if (!remote.receipts.length && !remote.proposals.length) return null;
  const rounds: DeskRound[] = remote.proposals.map((p) => {
    const decision = remote.decisions.find((d) => d.proposalKey === p.key);
    return {
      round: p.round,
      summary: p.summary,
      decision: decision?.status ?? "open",
      approvedBy: decision?.humanApprovedBy,
      actions: (p.actions as Action[]).map(actionRow),
      findings: remote.objections
        .filter((o) => o.proposalKey === p.key)
        .map((o) => ({ check: o.check, severity: o.severity, detail: o.detail })),
    };
  });
  const paid = remote.receipts.length > 0;
  const retrySends = remote.executions.filter((e) => e.actionKind === "retry_transfer" && e.result === "ok").length;
  const conversionSends = remote.executions.filter((e) => e.actionKind === "fx_conversion" && e.result === "ok").length;
  return baseView({
    phase: paid ? "paid" : "review",
    rounds,
    receipt: remote.receipts.at(-1)?.lines ?? null,
    transfersCreated: paid ? retrySends : null,
    conversionsCreated: paid ? conversionSends : null,
    ledgerLabel: "Convex",
    warning: paid
      ? "Loaded from the ledger. This process has not sent a payment."
      : "Loaded from the ledger. Nothing here is waiting for a tap. Run the planner for a fresh plan.",
    canPlan: !paid,
    canApprove: false,
    canReplay: false,
  });
}

/** A pending decision in Convex outlives the process. Rebuild a session that can still take the tap.
 *  The mock is told about the quote the plan already holds, as Airwallex would still have it. */
function hydrate(remote: RemoteIncident): Session | null {
  if (remote.receipts.length || !remote.decisions.some((d) => d.status === "awaiting_human")) return null;
  const ledger = ledgerFromRemote(remote);
  if (!ledger) return null;
  const quotes = ledger.proposals.flatMap((p) => p.actions).flatMap((a) =>
    a.kind === "fx_conversion"
      ? [{ quote_id: a.quoteId, buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: a.buyAmount, valid_to_at: a.quoteValidToAt }]
      : []);
  const warning = "Restored from the ledger after a restart. The decision is still waiting for a tap.";
  return { awx: createMockClient({ quotes }), ledger, phase: "review", ledgerKind: "convex", warning, error: null, replayed: false, now: fx.T0 };
}

async function restoreFromLedger(): Promise<Session | null> {
  if (ledgerBackend() !== "convex") return null;
  const remote = await loadIncident(INTENT_ID);
  const restored = remote ? hydrate(remote) : null;
  if (restored) store.session = restored;
  return restored;
}

async function project(s: Session) {
  try {
    s.ledgerKind = await syncIncident(s.ledger);
  } catch {
    s.ledgerKind = "memory";
    s.warning = "Ledger sync failed. The receipt is still in this process.";
  }
}

export async function openPlan(access: DeskAccess = NO_ACCESS) {
  assertDeskAccess(access);
  if (store.session && store.session.phase !== "failed") return;
  // A replan after a failed send keeps the same Airwallex state: whatever did move stays moved.
  const awx = store.session?.awx ?? createMockClient();
  const ledger = new MemoryLedger();
  const now = fx.T0;
  await runDemo(awx, { ledger, now });
  store.session = { awx, ledger, phase: "review", ledgerKind: "memory", warning: null, error: null, replayed: false, now };
  store.bootError = null;
  await project(store.session);
}

export async function approveSession(who: string, access: DeskAccess = NO_ACCESS) {
  assertDeskAccess(access);
  const current = store.session ?? (await restoreFromLedger());
  if (!current) throw new Error("Plan the incident before approving.");
  if (current.phase === "paid") return;
  const decision = current.phase === "failed"
    ? current.ledger.decisions.filter((d) => d.status === "approved").at(-1)
    : current.ledger.decisions.find((d) => d.status === "awaiting_human");
  if (!decision) throw new Error("Nothing is waiting for a tap.");
  const proposal = current.ledger.proposals.find((p) => p.id === decision.proposalId);
  if (!proposal) throw new Error("The plan for that decision is missing.");
  if (decision.status === "awaiting_human") approve(current.ledger, decision.id, who, current.now);
  const outcomes = await execute(current.ledger, current.awx, decision, proposal, current.now, new Set());
  const failed = outcomes.find((o) => o.result === "error");
  if (failed) {
    current.phase = "failed";
    current.error = failureCopy(failed.actionKind, failed.response);
    await project(current);
    return;
  }
  buildReceipt(current.ledger, INTENT_ID, current.now);
  const intent = current.ledger.intents.find((i) => i.id === INTENT_ID);
  if (intent) intent.status = "resolved";
  current.phase = "paid";
  current.error = null;
  await project(current);
}

const ACTION_NAMES: Record<Action["kind"], string> = { retry_transfer: "The retry transfer", fx_conversion: "The FX conversion", defer_payout: "The payout deferral" };

function failureCopy(kind: Action["kind"], response: unknown): string {
  const raw = (response as { message?: unknown } | undefined)?.message;
  const detail = publicError(new Error(typeof raw === "string" && raw ? raw : "no detail"));
  return `${ACTION_NAMES[kind]} failed: ${detail}. Nothing was marked paid. Retry the approved plan or replan.`;
}

export async function replaySession(who: string, access: DeskAccess = NO_ACCESS) {
  assertDeskAccess(access);
  const current = store.session;
  if (!current || current.phase !== "paid") throw new Error("Pay once before replaying.");
  const ledger = new MemoryLedger();
  await runDemo(current.awx, { approver: who, ledger, now: current.now });
  current.ledger = ledger;
  current.replayed = true;
  current.error = null;
  await project(current);
}

/** What a visitor without the desk key sees: the fixture incident only. No session, no Convex read. */
function lockedView(gate: Extract<GateState, "locked" | "unconfigured">, keyMissed: boolean): DeskView {
  return baseView({
    phase: "incident",
    rounds: [],
    receipt: null,
    canPlan: false,
    canApprove: false,
    canReplay: false,
    error: keyMissed ? "That desk key did not match." : null,
    locked: true,
    canUnlock: gate === "locked",
    lockNote: gate === "locked"
      ? "This desk is locked. Enter the desk key to open the ledger, plan, and approve."
      : "This desk has no desk key set on the server, so the shared ledger stays closed.",
  });
}

export async function getDeskView(access: DeskAccess = NO_ACCESS, opts: { keyMissed?: boolean } = {}): Promise<DeskView> {
  const gate = gateState(access);
  if (gate === "locked" || gate === "unconfigured") return lockedView(gate, Boolean(opts.keyMissed));
  if (store.session) return viewFromSession(store.session);
  if (ledgerBackend() === "convex") {
    try {
      const remote = await loadIncident(INTENT_ID);
      if (remote) {
        const restored = hydrate(remote);
        if (restored) {
          store.session = restored;
          return viewFromSession(restored);
        }
        const view = viewFromRemote(remote);
        if (view) return view;
      }
    } catch {
      store.bootError = "The ledger could not be read. The incident below is the fixture.";
    }
  }
  return baseView({ phase: "incident", rounds: [], receipt: null, canPlan: true, canApprove: false, canReplay: false });
}
