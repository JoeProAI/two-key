import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { AirwallexClient, Transfer, WebhookEvent } from "./airwallex/types";
import * as fx from "./airwallex/fixtures";
import { createMockClient, snapshotMock } from "./airwallex/mock";
import { MemoryLedger } from "./ledger/memory";
import { WebhookInbox } from "./webhooks/inbox";
import type { Situation } from "./agents/situation";
import { plan } from "./agents/planner";
import { review } from "./agents/wringer";
import { approve, decide, execute, expireIfStale } from "./agents/executor";
import { round } from "./money";
import { evidenceDigest } from "./receipt/bind";
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
    decision.evidenceDigest = evidenceDigest({
      balances: s.balances.map((b) => ({ currency: b.currency, available: b.available_amount })),
      webhookStatus: s.webhook.statusByCreatedAt,
      quoteId: s.quote?.quote_id,
      reserve: s.reserve.amount,
      queued: s.queuedPayouts.map((p) => ({ id: p.id, amount: p.amount })),
    });
    rounds.push({ proposal, findings, decision, quote: s.quote });
    if (decision.status === "blocked") continue;
    if (decision.status === "awaiting_human") {
      if (!opts.approver) return { awx, ledger, rounds, executions: [], receipt: null };
      approve(ledger, decision.id, opts.approver, clock, Infinity, decision.evidenceDigest);
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
  decision.evidenceDigest = evidenceDigest({
    balances: s.balances.map((b) => ({ currency: b.currency, available: b.available_amount })),
    webhookStatus: s.webhook.statusByCreatedAt,
    quoteId: s.quote?.quote_id,
    reserve: s.reserve.amount,
    queued: s.queuedPayouts.map((p) => ({ id: p.id, amount: p.amount })),
  });
  const waits: { at: number; status: string; transfersCreated: number }[] = [];
  const approveAt = opts.approveAfterMs == null ? null : fx.T0 + opts.approveAfterMs;
  let lateTapError: string | null = null;
  const tap = (at: number) => {
    try {
      approve(ledger, decision.id, opts.approver ?? "joe", at, timeoutMs, decision.evidenceDigest);
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
    return { awx, receipt: res.receipt, ledger: res.ledger };
  },
  /** One isolated scenario: pay once, snapshot the mock, then a fresh process reconciles the same actions.
   *  It is not a continuation of `main`. `main` mints its own provider ids. */
  replay: async () => {
    const awx = createMockClient();
    const first = await runDemo(awx, { approver: "joe" });
    const proposal = first.rounds.at(-1)?.proposal;
    if (!proposal || !first.receipt) throw new Error("replay pass 1 did not pay");
    const dir = "artifacts/replay";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/snapshot.json`, JSON.stringify(snapshotMock(awx)));
    writeFileSync(`${dir}/actions.json`, JSON.stringify(proposal.actions));
    const child = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/replay-from-snapshot.ts", dir], { encoding: "utf8" });
    if (child.status !== 0) throw new Error(child.stderr || child.stdout || "replay child failed");
    const second = JSON.parse(readFileSync(`${dir}/result.json`, "utf8")) as {
      executions: { action: string; requestId: string; result: string; providerId: string | null; buyAmount?: number; transferAmount?: number }[];
      transferCalls: number;
      conversionCalls: number;
      quoteCalls: number;
      transfersSettled: number;
      conversionsSettled: number;
      balances: { currency: string; available_amount: number; total_amount?: number }[];
    };
    const fxFirst = first.executions.find((e) => e.actionKind === "fx_conversion" && e.result === "ok");
    const trFirst = first.executions.find((e) => e.actionKind === "retry_transfer" && e.result === "ok");
    const fxSecond = second.executions.find((e) => e.action === "fx_conversion");
    const trSecond = second.executions.find((e) => e.action === "retry_transfer");
    const fxAction = proposal.actions.find((a) => a.kind === "fx_conversion");
    const same = Boolean(
      fxFirst && trFirst && fxSecond && trSecond
      && fxSecond.result === "already_done" && trSecond.result === "already_done"
      && fxSecond.providerId === fxFirst.airwallexId && trSecond.providerId === trFirst.airwallexId
      && fxSecond.requestId === fxFirst.requestId && trSecond.requestId === trFirst.requestId
      && fxAction && fxAction.kind === "fx_conversion" && fxSecond.buyAmount === fxAction.buyAmount
      && second.transferCalls === 0 && second.conversionCalls === 0 && second.quoteCalls === 0,
    );
    if (!same) {
      throw new Error(`fresh-process replay did not keep the original provider ids: ${JSON.stringify({ fxFirst, trFirst, fxSecond, trSecond, calls: second })}`);
    }
    const lines = [
      "ISOLATED REPLAY. Pass 1 and pass 2 are this scenario only. They are not the main scenario.",
      `Pass 1 fx request_id=${fxFirst!.requestId} provider=${fxFirst!.airwallexId} buy=${fxAction && fxAction.kind === "fx_conversion" ? fxAction.buyAmount : "?"}`,
      `Pass 1 transfer request_id=${trFirst!.requestId} provider=${trFirst!.airwallexId}`,
      `Pass 2 fresh process fx request_id=${fxSecond!.requestId} provider=${fxSecond!.providerId} result=${fxSecond!.result} buy=${fxSecond!.buyAmount}`,
      `Pass 2 fresh process transfer request_id=${trSecond!.requestId} provider=${trSecond!.providerId} result=${trSecond!.result} amount=${trSecond!.transferAmount}`,
      `Pass 2 calls transfer=${second.transferCalls} conversion=${second.conversionCalls} quote=${second.quoteCalls} settled transfer=${second.transfersSettled} conversion=${second.conversionsSettled}`,
      ...first.receipt.lines,
    ];
    const identity = {
      note: "Harness output for this replay scenario only. Pass 2 is a fresh process. Provider ids match pass 1 here. They are not the main scenario's ids. A later process mints new provider ids. These request ids stay.",
      requestIds: { fx: fxFirst!.requestId, transfer: trFirst!.requestId },
      payload: { buyAmount: fxAction && fxAction.kind === "fx_conversion" ? fxAction.buyAmount : null, transferAmount: trSecond!.transferAmount ?? null },
      pass1: { fxProvider: fxFirst!.airwallexId, transferProvider: trFirst!.airwallexId, fxResult: "ok", transferResult: "ok" },
      pass2: {
        fxProvider: fxSecond!.providerId, transferProvider: trSecond!.providerId,
        fxResult: fxSecond!.result, transferResult: trSecond!.result, buyAmount: fxSecond!.buyAmount, transferAmount: trSecond!.transferAmount,
        transferCalls: second.transferCalls, conversionCalls: second.conversionCalls, quoteCalls: second.quoteCalls,
      },
    };
    writeFileSync(`${dir}/identity.json`, JSON.stringify(identity, null, 2));
    mkdirSync("docs/shots", { recursive: true });
    writeFileSync("docs/shots/replay-identity.json", JSON.stringify(identity, null, 2));
    return { awx, ledger: first.ledger, receipt: { ...first.receipt, lines }, replayProof: second };
  },
  "stale-quote": async () => runStaleQuoteDemo({ approver: "joe" }),
  approval: async () => runApprovalDemo({ approveAfterMs: 90 * 60_000 }),
  "approval-timeout": async () => runApprovalDemo({ approveAfterMs: null }),
  /** Kit 01: a deposit after the blocked round changes only the funding size. Thresholds stay in code. */
  deposit: async () => {
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe", depositUsd: 18000 });
    return { awx, receipt: res.receipt, ledger: res.ledger };
  },
} as const;
export type ScenarioName = keyof typeof SCENARIOS;
