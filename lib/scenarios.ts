import type { AirwallexClient, Transfer, WebhookEvent } from "./airwallex/types";
import * as fx from "./airwallex/fixtures";
import { createMockClient } from "./airwallex/mock";
import { MemoryLedger } from "./ledger/memory";
import { WebhookInbox } from "./webhooks/inbox";
import type { Situation } from "./agents/situation";
import { plan } from "./agents/planner";
import { review } from "./agents/wringer";
import { approve, decide, execute, expireIfStale } from "./agents/executor";
import { round } from "./money";
import { buildReceipt, runDemo } from "./scenario";

async function situationFor(awx: AirwallexClient, intentId: string, now: number, transferId: string, deliveries: WebhookEvent<Transfer>[], queued: Situation["queuedPayouts"], thresholdUsd: number): Promise<Situation> {
  const inbox = new WebhookInbox();
  for (const e of deliveries) inbox.ingest(e);
  const original = await awx.getTransfer(transferId);
  const failed = deliveries.filter((e) => e.name === "payout.transfer.failed");
  return {
    intentId, now, original,
    webhook: {
      statusByCreatedAt: inbox.status(transferId), statusByArrival: inbox.statusByArrival(transferId),
      sawFailedEvent: failed.length > 0, failedDeliveries: failed.length, uniqueFailedEvents: new Set(failed.map((e) => e.id)).size, duplicates: inbox.duplicates(),
    },
    balances: await awx.getBalances(),
    reserve: { currency: "USD", amount: fx.RESERVE_USD },
    queuedPayouts: queued,
    approvalThresholdUsd: thresholdUsd,
  };
}

/** Scenario (a): the first quote is a 1-minute quote and the agents take 20s, so it has 40s left when reviewed.
 *  The Wringer blocks it (needs 60s headroom). The planner re-quotes with MIN_15 and the plan passes. */
export async function runStaleQuoteDemo(opts: { approver?: string; thinkMs?: number } = {}) {
  let clock = fx.T0;
  const awx = createMockClient({ now: () => clock });
  const ledger = new MemoryLedger();
  const intentId = "intent_inv2291_fx";
  ledger.intents.push({ id: intentId, title: "Pay Northwind Steel INV-2291 (USD 40,000) once, funded from EUR", createdAt: clock, status: "open" });
  const s = await situationFor(awx, intentId, clock, fx.ORIGINAL_TRANSFER_ID, fx.cleanWebhookDeliveries, [{ ...fx.queuedPayout }], 10000);
  const usd = s.balances.find((b) => b.currency === "USD")!.available_amount;
  const short = round(s.original.transfer_amount + s.reserve.amount - usd, "USD");
  const rounds = [];
  const validities = ["MIN_1", "MIN_15"] as const;
  for (let r = 0; r < validities.length; r++) {
    s.quote = await awx.createQuote({ buy_currency: "USD", sell_currency: "EUR", buy_amount: short, validity: validities[r] });
    clock += opts.thinkMs ?? 20_000; // the quote clock keeps running while the agents work
    s.now = clock;
    const p = await plan(s, 2, ["fund the shortfall"]);
    const proposal = { id: ledger.id("prop"), intentId, round: r + 1, author: "planner" as const, summary: p.summary, actions: p.actions, createdAt: clock };
    ledger.proposals.push(proposal);
    const findings = await review(s, p.actions);
    for (const f of findings) ledger.objections.push({ id: ledger.id("obj"), proposalId: proposal.id, author: "wringer", createdAt: clock, ...f });
    const decision = decide(ledger, proposal, findings, s.approvalThresholdUsd, clock);
    rounds.push({ proposal, findings, decision, quote: s.quote });
    if (decision.status === "blocked") continue;
    if (decision.status === "awaiting_human") {
      if (!opts.approver) return { awx, ledger, rounds, executions: [], receipt: null };
      approve(ledger, decision.id, opts.approver, clock);
    }
    const executions = await execute(ledger, awx, decision, proposal, clock, new Set());
    return { awx, ledger, rounds, executions, receipt: buildReceipt(ledger, intentId, clock) };
  }
  return { awx, ledger, rounds, executions: [], receipt: buildReceipt(ledger, intentId, clock) };
}

/** Scenario (b): a $25k payout clears both agents but is over the approval threshold, so it waits.
 *  The executor checks every `pollMs`. If the tap lands before `timeoutMs` the payout runs once;
 *  otherwise the decision expires and nothing moves. A tap after expiry is refused. */
export async function runApprovalDemo(opts: { approveAfterMs?: number | null; approver?: string; timeoutMs?: number; pollMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? fx.APPROVAL_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? 30 * 60_000;
  let clock = fx.T0;
  const awx = createMockClient({ now: () => clock, transfers: [fx.largeTransfer], balances: fx.largeBalances });
  const ledger = new MemoryLedger();
  const intentId = "intent_inv3307";
  ledger.intents.push({ id: intentId, title: "Pay Halvorsen Freight INV-3307 (USD 25,000) once", createdAt: clock, status: "open" });
  const s = await situationFor(awx, intentId, clock, fx.LARGE_TRANSFER_ID, fx.largeWebhookDeliveries, [], 10000);
  const p = await plan(s, 2, ["single retry"]);
  const proposal = { id: ledger.id("prop"), intentId, round: 1, author: "planner" as const, summary: p.summary, actions: p.actions, createdAt: clock };
  ledger.proposals.push(proposal);
  const findings = await review(s, p.actions);
  for (const f of findings) ledger.objections.push({ id: ledger.id("obj"), proposalId: proposal.id, author: "wringer", createdAt: clock, ...f });
  const decision = decide(ledger, proposal, findings, s.approvalThresholdUsd, clock);
  const waits: { at: number; status: string; transfersCreated: number }[] = [];
  const approveAt = opts.approveAfterMs == null ? null : fx.T0 + opts.approveAfterMs;
  let lateTapError: string | null = null;
  const tap = (at: number) => {
    try {
      approve(ledger, decision.id, opts.approver ?? "joe", at, timeoutMs);
    } catch (e) {
      lateTapError = (e as Error).message;
    }
  };
  while (decision.status === "awaiting_human") {
    clock += pollMs;
    if (approveAt !== null && clock >= approveAt) {
      tap(clock);
      if (decision.status !== "awaiting_human") break;
    }
    expireIfStale(ledger, decision.id, clock, timeoutMs);
    waits.push({ at: clock, status: decision.status, transfersCreated: awx.calls.createTransfer });
  }
  // A tap that shows up after the window closed is refused, not queued.
  if (decision.status === "expired" && approveAt !== null && lateTapError === null) tap(Math.max(clock, approveAt));
  const executions = decision.status === "approved" ? await execute(ledger, awx, decision, proposal, clock, new Set()) : [];
  const receipt = buildReceipt(ledger, intentId, clock);
  const mins = (ms: number) => Math.round(ms / 60_000);
  if (decision.status === "approved") receipt.lines.splice(-executions.length, 0, `  Waited ${mins(clock - fx.T0)} min for the tap. ${waits.length} checks, no money moved while waiting.`);
  if (decision.status === "expired") receipt.lines.push(`  Expired after ${mins(timeoutMs)} min with no tap. Nothing moved. Re-plan with fresh balances.`);
  return { awx, ledger, decision, findings, waits, executions, receipt, lateTapError: lateTapError as string | null };
}

export const SCENARIOS = {
  main: async () => {
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe" });
    return { awx, receipt: res.receipt };
  },
  /** Main scenario twice against the same Airwallex account, the second time with an empty ledger. */
  rerun: async () => {
    const awx = createMockClient();
    await runDemo(awx, { approver: "joe" });
    const res = await runDemo(awx, { approver: "joe" });
    return { awx, receipt: res.receipt };
  },
  "stale-quote": async () => runStaleQuoteDemo({ approver: "joe" }),
  approval: async () => runApprovalDemo({ approveAfterMs: 90 * 60_000 }),
  "approval-timeout": async () => runApprovalDemo({ approveAfterMs: null }),
} as const;
export type ScenarioName = keyof typeof SCENARIOS;
