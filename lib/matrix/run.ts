import { createMockClient } from "../airwallex/mock";
import { AirwallexError } from "../airwallex/types";
import * as fx from "../airwallex/fixtures";
import { WebhookInbox } from "../webhooks/inbox";
import { CLAIM_LEASE_MS, claimDecision } from "../ledger/claim";
import { resetLedgerRemoteForTests, setLedgerApiForTests, setLedgerBackendForTests } from "../ledger/remote";
import { plan } from "../agents/planner";
import { wring } from "../agents/wringer";
import { approve, execute } from "../agents/executor";
import { evidenceDigest } from "../receipt/bind";
import { runDemo } from "../scenario";
import { runApprovalDemo, runStaleQuoteDemo } from "../scenarios";
import { anonymousDeskRejected } from "../desk/gate";
import type { Situation } from "../agents/situation";

export interface MatrixRow {
  id: string;
  pass: boolean;
  detail: string;
  balancesBefore: { currency: string; available: number }[];
  balancesAfter: { currency: string; available: number }[];
  transfersBefore: number;
  transfersAfter: number;
  conversionsBefore: number;
  conversionsAfter: number;
}

const money = (rows: { currency: string; available_amount: number }[]) =>
  rows.map((b) => ({ currency: b.currency, available: b.available_amount }));

function row(id: string, pass: boolean, detail: string, before: ReturnType<typeof createMockClient>, after: ReturnType<typeof createMockClient> = before): MatrixRow {
  return {
    id, pass, detail,
    balancesBefore: money(before.balances),
    balancesAfter: money(after.balances),
    transfersBefore: 0,
    transfersAfter: after.calls.createTransfer,
    conversionsBefore: 0,
    conversionsAfter: after.calls.createConversion,
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
    const first = await runDemo(awx, { approver: "joe" });
    const proposal = first.ledger.proposals.at(-1);
    const decision = first.ledger.decisions.find((d) => d.status === "approved");
    if (proposal && decision) {
      const action = proposal.actions.find((a) => a.kind === "retry_transfer");
      if (action && action.kind === "retry_transfer") action.amount += 1;
      let refused = false;
      try {
        await execute(first.ledger, awx, decision, proposal, fx.T0, new Set());
      } catch (e) {
        refused = /bound actions/.test((e as Error).message);
      }
      rows.push({
        ...row("changed plan", refused && awx.calls.createTransfer === 1, `refused ${refused}, transfers stayed ${awx.calls.createTransfer}`, awx),
        balancesBefore: before,
      });
    }
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
      ...row("partial completion", pass, `fx ${fxRow?.result ?? "missing"}, transfer ${transfer?.result ?? "missing"}, usd ${usd}`, awx),
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
  const lines = ["CASE | PASS | TRANSFERS | CONVERSIONS | DETAIL"];
  for (const r of rows) {
    lines.push(`${r.id} | ${r.pass ? "pass" : "FAIL"} | ${r.transfersAfter} | ${r.conversionsAfter} | ${r.detail}`);
  }
  const failed = rows.filter((r) => !r.pass).length;
  lines.push(`${rows.length - failed} pass, ${failed} fail`);
  return lines.join("\n");
}
