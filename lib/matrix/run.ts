import { createMockClient, snapshotMock } from "../airwallex/mock";
import { AirwallexError } from "../airwallex/types";
import * as fx from "../airwallex/fixtures";
import { WebhookInbox } from "../webhooks/inbox";
import { CLAIM_LEASE_MS, claimDecision } from "../ledger/claim";
import { resetLedgerRemoteForTests, setLedgerApiForTests, setLedgerBackendForTests } from "../ledger/remote";
import { plan } from "../agents/planner";
import { wring } from "../agents/wringer";
import { approve, execute } from "../agents/executor";
import { evidenceDigest, planDigest } from "../receipt/bind";
import { reconcileSettled } from "../agents/reconcile";
import { applyAvailable } from "../money";
import { MemoryLedger } from "../ledger/memory";
import { runDemo } from "../scenario";
import { runApprovalDemo, runStaleQuoteDemo } from "../scenarios";
import { anonymousDeskRejected } from "../desk/gate";
import type { Situation } from "../agents/situation";

export interface MatrixRow {
  id: string;
  pass: boolean;
  detail: string;
  balancesBefore: { currency: string; available: number; pending: number; reserved: number; total: number }[];
  balancesAfter: { currency: string; available: number; pending: number; reserved: number; total: number }[];
  transfersBefore: number;
  transfersAfter: number;
  conversionsBefore: number;
  conversionsAfter: number;
  transferCalls: number;
  transfersSettled: number;
  conversionCalls: number;
  conversionsSettled: number;
}

const money = (rows: { currency: string; available_amount: number; pending_amount?: number; reserved_amount?: number; total_amount?: number }[]) =>
  rows.map((b) => ({
    currency: b.currency,
    available: b.available_amount,
    pending: b.pending_amount ?? 0,
    reserved: b.reserved_amount ?? 0,
    total: b.total_amount ?? b.available_amount,
  }));

function row(id: string, pass: boolean, detail: string, before: ReturnType<typeof createMockClient>, after: ReturnType<typeof createMockClient> = before): MatrixRow {
  return {
    id, pass, detail,
    balancesBefore: money(before.balances),
    balancesAfter: money(after.balances),
    transfersBefore: 0,
    transfersAfter: after.settled.transfers,
    conversionsBefore: 0,
    conversionsAfter: after.settled.conversions,
    transferCalls: after.calls.createTransfer,
    transfersSettled: after.settled.transfers,
    conversionCalls: after.calls.createConversion,
    conversionsSettled: after.settled.conversions,
  };
}

async function northwindSituation(awx: ReturnType<typeof createMockClient>): Promise<Situation> {
  const inbox = new WebhookInbox();
  for (const e of fx.demoWebhookDeliveries) inbox.ingest(e);
  const original = await awx.getTransfer(fx.ORIGINAL_TRANSFER_ID);
  const failed = fx.demoWebhookDeliveries.filter((e) => e.name === "payout.transfer.failed");
  return {
    intentId: "intent_inv2291", now: fx.T0, original,
    webhook: {
      statusByCreatedAt: inbox.status(original.id), statusByArrival: inbox.statusByArrival(original.id),
      sawFailedEvent: true, failedDeliveries: failed.length, uniqueFailedEvents: new Set(failed.map((e) => e.id)).size, duplicates: inbox.duplicates(),
    },
    balances: await awx.getBalances(),
    reserve: { currency: "USD", amount: fx.RESERVE_USD },
    queuedPayouts: [{ ...fx.queuedPayout }],
    approvalThresholdUsd: 10000,
  };
}

export async function runMatrix(): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];

  {
    const inbox = new WebhookInbox();
    for (const e of fx.demoWebhookDeliveries) inbox.ingest(e);
    const failed = fx.demoWebhookDeliveries.filter((e) => e.name === "payout.transfer.failed");
    const unique = new Set(failed.map((e) => e.id)).size;
    const dup = inbox.duplicates().find((d) => d.id === "evt_failed_01");
    const awx = createMockClient();
    rows.push(row(
      "duplicate webhook",
      unique === 1 && dup?.deliveries === 2,
      `unique failures ${unique}, evt_failed_01 deliveries ${dup?.deliveries ?? 0}`,
      awx,
    ));
  }

  {
    const inbox = new WebhookInbox();
    for (const e of fx.demoWebhookDeliveries) inbox.ingest(e);
    const byCreated = inbox.status(fx.ORIGINAL_TRANSFER_ID);
    const byArrival = inbox.statusByArrival(fx.ORIGINAL_TRANSFER_ID);
    const awx = createMockClient();
    rows.push(row(
      "out-of-order webhook",
      byCreated === "CANCELLED" && byArrival === "PROCESSING",
      `created_at ${byCreated}, arrival ${byArrival}`,
      awx,
    ));
  }

  {
    const awx = createMockClient();
    const before = money(awx.balances);
    const res = await runDemo(awx, { approver: "joe" });
    const retry = res.executions.find((e) => e.actionKind === "retry_transfer");
    const pass = awx.calls.createTransfer === 1
      && retry?.result === "ok"
      && retry.requestId !== fx.ORIGINAL_REQUEST_ID
      && res.rounds[0].findings.some((f) => f.check === "double_payment");
    rows.push({
      ...row("FAILED then CANCELLED", pass, `transfers ${awx.calls.createTransfer}, retry ${retry?.requestId ?? "missing"} ${retry?.result ?? ""}`, awx),
      balancesBefore: before,
    });
  }

  {
    const res = await runStaleQuoteDemo({ approver: "joe" });
    const blocked = res.rounds[0].findings.some((f) => f.check === "stale_fx_quote" && f.severity === "block");
    const cleared = res.rounds.at(-1)?.decision.status === "approved";
    rows.push(row(
      "stale FX quote",
      blocked && cleared && res.awx.calls.createConversion === 1,
      `round 1 blocked ${blocked}, conversions ${res.awx.calls.createConversion}`,
      res.awx,
    ));
  }

  {
    const awx = createMockClient();
    const before = money(awx.balances);
    const situation = await northwindSituation(awx);
    const naive = await plan(situation, 1, []);
    const findings = wring(situation, naive.actions);
    const blocked = findings.some((f) => f.check === "reserve_breach" && f.severity === "block");
    rows.push({
      ...row("reserve breach", blocked && awx.calls.createTransfer === 0, `reserve_breach ${blocked}, transfers ${awx.calls.createTransfer}`, awx),
      balancesBefore: before,
      balancesAfter: before,
    });
  }

  {
    const t0 = 1_000_000;
    const busy = claimDecision({ result: "claimed", owner: "A", leaseUntil: t0 + CLAIM_LEASE_MS }, "B", t0 + 1_000);
    const reason = busy.claimed ? "claimed" : busy.reason;
    const awx = createMockClient();
    rows.push(row(
      "claim lease busy",
      reason === "busy" && awx.calls.createTransfer === 0,
      `second worker ${reason}, transfers ${awx.calls.createTransfer}`,
      awx,
    ));
  }

  {
    const awx = createMockClient();
    const before = money(awx.balances);
    const first = await runDemo(awx, { approver: "joe" });
    const stored = first.ledger.executions.find((e) => e.actionKind === "retry_transfer" && e.result === "ok");
    const providerId = stored?.airwallexId;
    await first.rerun?.();
    const usd = awx.balances.find((b) => b.currency === "USD")?.available_amount;
    const pass = stored?.replays === 1 && stored.airwallexId === providerId && awx.calls.createTransfer === 1 && usd === 10000;
    rows.push({
      ...row("replay after success", Boolean(pass), `replays ${stored?.replays ?? 0}, provider ${providerId ?? "missing"}, transfers ${awx.calls.createTransfer}`, awx),
      balancesBefore: before,
    });
  }

  {
    const rejected = anonymousDeskRejected();
    const awx = createMockClient();
    rows.push(row(
      "approve without desk key",
      rejected && awx.calls.createTransfer === 0,
      `rejected ${rejected}, transfers ${awx.calls.createTransfer}`,
      awx,
    ));
  }

  {
    const awx = createMockClient();
    const before = money(awx.balances);
    const orig = awx.createConversion.bind(awx);
    awx.createConversion = async () => {
      awx.createConversion = orig;
      awx.calls.createConversion += 1;
      throw new AirwallexError("insufficient funds", 400, "balance_insufficient");
    };
    const res = await runDemo(awx, { approver: "joe" });
    const fxRow = res.executions.find((e) => e.actionKind === "fx_conversion");
    const paid = res.executions.some((e) => e.result === "ok" && e.actionKind === "retry_transfer");
    const unchanged = awx.balances.every((b, i) => b.available_amount === before[i]?.available);
    rows.push({
      ...row("failed provider send", fxRow?.result === "error" && !paid && res.receipt === null && unchanged && awx.calls.createTransfer === 0, `fx ${fxRow?.result ?? "missing"}, transfers ${awx.calls.createTransfer}`, awx),
      balancesBefore: before,
      balancesAfter: money(awx.balances),
    });
  }

  {
    const res = await runApprovalDemo({ approveAfterMs: null });
    const usd = res.awx.balances.find((b) => b.currency === "USD")?.available_amount;
    const pass = res.decision.status === "expired" && res.awx.calls.createTransfer === 0 && usd === 80000;
    rows.push(row(
      "approval timeout",
      pass,
      `status ${res.decision.status}, transfers ${res.awx.calls.createTransfer}, usd ${usd}`,
      res.awx,
    ));
  }

  {
    const res = await runApprovalDemo({ approveAfterMs: 5 * 3_600_000 });
    const pass = res.decision.status === "expired" && res.lateTapError !== null && res.awx.calls.createTransfer === 0;
    rows.push(row(
      "late approve",
      pass,
      `status ${res.decision.status}, late tap ${res.lateTapError ? "refused" : "accepted"}, transfers ${res.awx.calls.createTransfer}`,
      res.awx,
    ));
  }

  {
    const awx = createMockClient();
    const before = money(awx.balances);
    const planned = await runDemo(awx, {});
    const waiting = planned.awaiting;
    const proposal = planned.ledger.proposals.find((p) => p.id === waiting?.proposalId);
    if (waiting && proposal) {
      const usd = awx.balances.find((b) => b.currency === "USD");
      if (usd) usd.available_amount += 1;
      let refused = false;
      try {
        const quote = proposal.actions.find((a) => a.kind === "fx_conversion");
        const nowDigest = evidenceDigest({
          balances: awx.balances.map((b) => ({ currency: b.currency, available: b.available_amount })),
          webhookStatus: "CANCELLED",
          quoteId: quote?.kind === "fx_conversion" ? quote.quoteId : undefined,
          reserve: fx.RESERVE_USD,
          queued: [{ id: fx.queuedPayout.id, amount: fx.queuedPayout.amount }],
        });
        approve(planned.ledger, waiting.id, "joe", fx.T0, Infinity, nowDigest);
      } catch (e) {
        refused = /Evidence changed/.test((e as Error).message);
      }
      if (usd) usd.available_amount -= 1;
      rows.push({
        ...row("stale approval", refused && waiting.status === "awaiting_human" && awx.calls.createTransfer === 0, `refused ${refused}, status ${waiting.status}`, awx),
        balancesBefore: before,
        balancesAfter: money(awx.balances),
      });
    }
  }

  {
    const awx = createMockClient();
    const before = money(awx.balances);
    const planned = await runDemo(awx, {});
    const waiting = planned.awaiting;
    const proposal = planned.ledger.proposals.find((p) => p.id === waiting?.proposalId);
    let refused = false;
    if (waiting && proposal) {
      approve(planned.ledger, waiting.id, "joe", fx.T0, Infinity, waiting.evidenceDigest);
      const action = proposal.actions.find((a) => a.kind === "retry_transfer");
      if (action && action.kind === "retry_transfer") action.amount += 1;
      try {
        await execute(planned.ledger, awx, waiting, proposal, fx.T0, new Set());
      } catch (e) {
        refused = /bound actions/.test((e as Error).message);
      }
    }
    const pass = refused && awx.calls.createTransfer === 0 && awx.calls.createConversion === 0 && awx.settled.transfers === 0 && awx.settled.conversions === 0;
    rows.push({
      ...row("changed plan before send", pass, `refused ${refused}, transfer calls ${awx.calls.createTransfer}, settled ${awx.settled.transfers}`, awx),
      balancesBefore: before,
      balancesAfter: money(awx.balances),
    });
  }

  {
    const awx = createMockClient();
    const first = await runDemo(awx, { approver: "joe" });
    const proposal = first.ledger.proposals.at(-1);
    const decision = first.ledger.decisions.find((d) => d.status === "approved");
    const original = first.executions.find((e) => e.actionKind === "fx_conversion" && e.result === "ok");
    let mismatch = false;
    if (proposal && decision && original) {
      const actions = JSON.parse(JSON.stringify(proposal.actions)) as typeof proposal.actions;
      const fxAction = actions.find((a) => a.kind === "fx_conversion");
      if (fxAction && fxAction.kind === "fx_conversion") fxAction.buyAmount = 40000;
      decision.boundDigest = planDigest(actions);
      const calls = awx.calls.createConversion;
      const settled = awx.settled.conversions;
      const out = await execute(first.ledger, awx, decision, { ...proposal, actions }, fx.T0, new Set());
      const rowFx = out.find((e) => e.actionKind === "fx_conversion");
      const message = (rowFx?.response as { message?: string } | undefined)?.message ?? "";
      mismatch = rowFx?.result === "error" && /does not match the action payload/.test(message)
        && awx.calls.createConversion === calls && awx.settled.conversions === settled
        && awx.conversions.get(original.requestId)?.conversion_id === original.airwallexId;
    }
    rows.push(row(
      "payload mismatch after success",
      mismatch,
      `mismatch ${mismatch}, conversion calls ${awx.calls.createConversion}, settled ${awx.settled.conversions}`,
      awx,
    ));
  }

  {
    const awx = createMockClient();
    const first = await runDemo(awx, { approver: "joe" });
    const usd = awx.balances.find((b) => b.currency === "USD");
    if (usd) applyAvailable(usd, 5000);
    const again = await first.rerun!();
    const fxRow = again.find((e) => e.actionKind === "fx_conversion");
    const kept = first.executions.find((e) => e.actionKind === "fx_conversion")?.airwallexId;
    const pass = again.every((e) => e.result === "already_done")
      && fxRow?.airwallexId === kept
      && awx.calls.createConversion === 1 && awx.calls.createQuote === 1 && awx.calls.createTransfer === 1
      && (fxRow?.response as { buy_amount?: number } | undefined)?.buy_amount === 28000;
    rows.push(row("replay after changed balances", pass, `provider ${fxRow?.airwallexId ?? "missing"}, quotes ${awx.calls.createQuote}`, awx));
  }

  {
    const awx = createMockClient();
    let thrown = false;
    const orig = awx.createTransfer.bind(awx);
    awx.createTransfer = async (body) => {
      if (!thrown) {
        thrown = true;
        awx.calls.createTransfer += 1;
        throw new AirwallexError("beneficiary mismatch", 400, "validation_failed");
      }
      return orig(body);
    };
    const first = await runDemo(awx, { approver: "joe" });
    const fxId = first.executions.find((e) => e.actionKind === "fx_conversion")?.airwallexId;
    const decision = first.ledger.decisions.find((d) => d.status === "approved");
    const proposal = first.ledger.proposals.at(-1);
    const again = decision && proposal ? await execute(first.ledger, awx, decision, proposal, fx.T0, new Set()) : [];
    const fxAgain = again.find((e) => e.actionKind === "fx_conversion");
    const transfer = again.find((e) => e.actionKind === "retry_transfer");
    const pass = fxAgain?.result === "already_done" && fxAgain.airwallexId === fxId
      && transfer?.result === "ok" && awx.calls.createConversion === 1 && awx.settled.conversions === 1
      && awx.calls.createTransfer === 2 && awx.settled.transfers === 1;
    rows.push(row(
      "partial then retry",
      pass,
      `fx ${fxAgain?.result ?? "missing"} provider ${fxAgain?.airwallexId ?? "missing"}, transfer calls ${awx.calls.createTransfer} settled ${awx.settled.transfers}`,
      awx,
    ));
  }

  {
    const awx = createMockClient();
    const first = await runDemo(awx, { approver: "joe" });
    const snap = snapshotMock(awx);
    const fresh = createMockClient({ balances: snap.balances, transfers: snap.transfers, conversions: snap.conversions, quotes: snap.quotes });
    const actions = first.rounds.at(-1)!.proposal.actions;
    const ledger = new MemoryLedger();
    const out = await reconcileSettled(fresh, "intent_inv2291", actions, ledger, "dec_snap", fx.T0);
    const fxFirst = first.executions.find((e) => e.actionKind === "fx_conversion");
    const trFirst = first.executions.find((e) => e.actionKind === "retry_transfer");
    const fxSecond = out.find((e) => e.actionKind === "fx_conversion");
    const trSecond = out.find((e) => e.actionKind === "retry_transfer");
    const pass = fxSecond?.result === "already_done" && trSecond?.result === "already_done"
      && fxSecond.airwallexId === fxFirst?.airwallexId && trSecond.airwallexId === trFirst?.airwallexId
      && fxSecond.requestId === fxFirst?.requestId && trSecond.requestId === trFirst?.requestId
      && fresh.calls.createTransfer === 0 && fresh.calls.createConversion === 0 && fresh.calls.createQuote === 0;
    rows.push(row(
      "snapshot keeps provider id",
      pass,
      `fx ${fxSecond?.airwallexId ?? "missing"} transfer ${trSecond?.airwallexId ?? "missing"}, fresh calls ${fresh.calls.createTransfer}/${fresh.calls.createConversion}`,
      fresh,
    ));
  }

  {
    const awx = createMockClient();
    const before = money(awx.balances);
    const res = await runDemo(awx, { approver: "joe", depositUsd: 18000 });
    const fxAction = res.rounds.at(-1)?.proposal.actions.find((a) => a.kind === "fx_conversion");
    const buy = fxAction && fxAction.kind === "fx_conversion" ? fxAction.buyAmount : null;
    const pass = Boolean(res.depositLine) && buy === 10000 && awx.calls.createTransfer === 1;
    rows.push({
      ...row("deposit revises funding", pass, `fx buy ${buy}, transfers ${awx.calls.createTransfer}`, awx),
      balancesBefore: before,
    });
  }

  {
    const awx = createMockClient();
    const before = money(awx.balances);
    awx.createTransfer = async () => {
      awx.calls.createTransfer += 1;
      throw new AirwallexError("beneficiary mismatch", 400, "validation_failed");
    };
    const res = await runDemo(awx, { approver: "joe" });
    const fxRow = res.executions.find((e) => e.actionKind === "fx_conversion");
    const transfer = res.executions.find((e) => e.actionKind === "retry_transfer");
    const usd = awx.balances.find((b) => b.currency === "USD")?.available_amount;
    const pass = fxRow?.result === "ok" && transfer?.result === "error" && res.receipt === null && usd !== before.find((b) => b.currency === "USD")?.available;
    rows.push({
      ...row("partial completion", pass, `fx ${fxRow?.result ?? "missing"}, transfer ${transfer?.result ?? "missing"}, transfer calls ${awx.calls.createTransfer} settled ${awx.settled.transfers}, usd ${usd}`, awx),
      balancesBefore: before,
      balancesAfter: money(awx.balances),
    });
  }

  {
    const awx = createMockClient();
    setLedgerBackendForTests("convex");
    setLedgerApiForTests({
      upsert: async () => ({}),
      claim: async () => ({ claimed: true }),
      finish: async () => ({ wrote: "kept" }),
      load: async () => null,
    });
    try {
      const res = await runDemo(awx, { approver: "joe" });
      const ex = res.executions[0];
      const message = (ex?.response as { message?: string; providerCall?: string } | undefined)?.message ?? "";
      const call = (ex?.response as { providerCall?: string } | undefined)?.providerCall;
      const pass = ex?.result === "error"
        && call === "issued_outcome_unknown"
        && /unknown/.test(message)
        && !/no money moved|nothing moved|call was undone/i.test(message)
        && awx.calls.createTransfer === 0;
      rows.push(row(
        "stale finish unknown",
        pass,
        message.slice(0, 120),
        awx,
      ));
    } finally {
      resetLedgerRemoteForTests();
    }
  }

  return rows;
}

export function matrixText(rows: MatrixRow[]): string {
  const lines = ["CASE | PASS | TRANSFER_CALLS | TRANSFERS_SETTLED | CONVERSION_CALLS | CONVERSIONS_SETTLED | DETAIL"];
  for (const r of rows) {
    lines.push(`${r.id} | ${r.pass ? "pass" : "FAIL"} | ${r.transferCalls} | ${r.transfersSettled} | ${r.conversionCalls} | ${r.conversionsSettled} | ${r.detail}`);
  }
  const failed = rows.filter((r) => !r.pass).length;
  lines.push(`${rows.length - failed} pass, ${failed} fail`);
  return lines.join("\n");
}
