import type { AirwallexClient } from "./airwallex/types";
import * as fx from "./airwallex/fixtures";
import { MemoryLedger } from "./ledger/memory";
import { WebhookInbox } from "./webhooks/inbox";
import type { Situation } from "./agents/situation";
import type { Finding } from "./agents/wringer";
import type { Decision, Proposal } from "./ledger/types";
import { plan } from "./agents/planner";
import { review } from "./agents/wringer";
import { approve, decide, execute } from "./agents/executor";
import { applyAvailable, round } from "./money";
import { canonicalRetryId } from "./requestId";
import { evidenceDigest } from "./receipt/bind";

export function snapEvidence(situation: Situation): string {
  return evidenceDigest({
    balances: situation.balances.map((b) => ({ currency: b.currency, available: b.available_amount })),
    webhookStatus: situation.webhook.statusByCreatedAt,
    quoteId: situation.quote?.quote_id,
    reserve: situation.reserve.amount,
    queued: situation.queuedPayouts.map((p) => ({ id: p.id, amount: p.amount })),
  });
}

/** Scripted demo: $40k supplier transfer failed, duplicate + out-of-order webhooks, EUR shortfall, deferred payout, one tap. */
export async function runDemo(awx: AirwallexClient, opts: { approver?: string; now?: number; thresholdUsd?: number; ledger?: MemoryLedger; depositUsd?: number; stopOnBlock?: boolean } = {}) {
  const now = opts.now ?? fx.T0;
  const ledger = opts.ledger ?? new MemoryLedger();
  const inbox = new WebhookInbox();
  const deferred = new Set<string>();
  for (const e of fx.demoWebhookDeliveries) inbox.ingest(e);

  const intent = { id: "intent_inv2291", title: "Pay Northwind Steel INV-2291 (USD 40,000) once", createdAt: now, status: "open" as const };
  ledger.intents.push({ ...intent });
  const original = await awx.getTransfer(fx.ORIGINAL_TRANSFER_ID); // GET /api/v1/transfers/{id}
  const failed = fx.demoWebhookDeliveries.filter((e) => e.name === "payout.transfer.failed");

  const situation: Situation = {
    intentId: intent.id, now, original,
    webhook: {
      statusByCreatedAt: inbox.status(original.id), statusByArrival: inbox.statusByArrival(original.id),
      sawFailedEvent: inbox.timeline(original.id).some((e) => e.name === "payout.transfer.failed"),
      failedDeliveries: failed.length, uniqueFailedEvents: new Set(failed.map((e) => e.id)).size, duplicates: inbox.duplicates(),
    },
    balances: await awx.getBalances(), // GET /api/v1/balances/current
    reserve: { currency: "USD", amount: fx.RESERVE_USD },
    queuedPayouts: [{ ...fx.queuedPayout }],
    approvalThresholdUsd: opts.thresholdUsd ?? 10000,
  };

  const rounds: { proposal: Proposal; findings: Finding[]; decision: Decision }[] = [];
  let objections: string[] = [];
  let depositLine: string | null = null;
  const liveRetry = await awx.findTransferByRequestId(canonicalRetryId(intent.id, original));
  if (liveRetry && liveRetry.status !== "FAILED" && liveRetry.status !== "CANCELLED") {
    return {
      ledger, rounds, executions: [], receipt: null, awaiting: null, depositLine,
      refusedReplan: "This intent already has a live retry transfer. Reconcile the original receipt. This run did not replan or pay.",
    };
  }
  for (let r = 1; r <= 3; r++) {
    if (r > 1) {
      // Fund the shortfall: transfer + reserve - available USD (low-priority payouts deferred).
      const usd = situation.balances.find((b) => b.currency === "USD")!.available_amount;
      const short = round(original.transfer_amount + situation.reserve.amount - usd, "USD");
      if (short > 0) situation.quote = await awx.createQuote({ buy_currency: "USD", sell_currency: "EUR", buy_amount: short, validity: "MIN_15" }); // POST /api/v1/fx/quotes/create
    }
    const p = await plan(situation, r, objections);
    const proposal = { id: ledger.id("prop"), intentId: intent.id, round: r, author: "planner" as const, summary: p.summary, actions: p.actions, createdAt: now };
    ledger.proposals.push(proposal);
    const findings = await review(situation, p.actions);
    for (const f of findings) ledger.objections.push({ id: ledger.id("obj"), proposalId: proposal.id, author: "wringer", createdAt: now, ...f });
    const decision = decide(ledger, proposal, findings, situation.approvalThresholdUsd, now);
    decision.evidenceDigest = snapEvidence(situation);
    rounds.push({ proposal, findings, decision });
    if (decision.status === "blocked") {
      if (opts.stopOnBlock) return { ledger, rounds, executions: [], receipt: null, awaiting: null, depositLine };
      if (r === 1 && opts.depositUsd && opts.depositUsd > 0) {
        const credit = (rows: { currency: string; available_amount: number; total_amount?: number }[] | undefined) => {
          const usd = rows?.find((b) => b.currency === "USD");
          if (!usd) return;
          applyAvailable(usd, opts.depositUsd!);
        };
        credit(situation.balances);
        credit((awx as { balances?: { currency: string; available_amount: number; total_amount?: number }[] }).balances);
        depositLine = `Evidence: a USD ${opts.depositUsd} deposit arrived after round 1. The next plan uses the new balance. The blocked plan was not approved.`;
      }
      objections = findings.filter((f) => f.severity === "block").map((f) => f.check);
      continue;
    }
    if (decision.status === "awaiting_human") {
      if (!opts.approver) return { ledger, rounds, executions: [], receipt: null, awaiting: decision, depositLine };
      approve(ledger, decision.id, opts.approver, now, Infinity, decision.evidenceDigest);
    }
    const executions = await execute(ledger, awx, decision, proposal, now, deferred);
    if (executions.some((e) => e.result === "error")) {
      return { ledger, rounds, executions, receipt: null, awaiting: null, depositLine };
    }
    const receipt = buildReceipt(ledger, intent.id, now);
    if (depositLine) {
      const at = receipt.lines.findIndex((line) => line.startsWith("Round 2"));
      receipt.lines.splice(at < 0 ? receipt.lines.length : at, 0, `  ${depositLine}`);
    }
    return { ledger, rounds, executions, receipt, awaiting: null, depositLine, rerun: () => execute(ledger, awx, decision, proposal, now, deferred) };
  }
  return { ledger, rounds, executions: [], receipt: null, awaiting: null, depositLine };
}

export function buildReceipt(ledger: MemoryLedger, intentId: string, now: number) {
  const lines: string[] = [];
  for (const p of ledger.proposals.filter((x) => x.intentId === intentId)) {
    lines.push(`Round ${p.round}. Planner: ${p.summary}`);
    for (const o of ledger.objections.filter((x) => x.proposalId === p.id)) lines.push(`  Wringer ${o.severity === "block" ? "BLOCK" : "note"} [${o.check}]: ${o.detail}`);
    const d = ledger.decisions.find((x) => x.proposalId === p.id);
    if (d) lines.push(`  Decision: ${d.status}${d.humanApprovedBy ? `, approved by ${d.humanApprovedBy}` : ""}`);
    for (const e of ledger.executions.filter((x) => x.decisionId === d?.id)) lines.push(`  Executed ${e.actionKind} request_id=${e.requestId}: ${e.result}${e.airwallexId ? ` (${e.airwallexId})` : ""}`);
  }
  const r = { id: ledger.id("rcpt"), intentId, lines, createdAt: now };
  ledger.receipts.push(r);
  return r;
}
