import "server-only";
import { createMockClient, snapshotMock } from "../airwallex/mock";
import { AirwallexError } from "../airwallex/types";
import * as fx from "../airwallex/fixtures";
import { MemoryLedger } from "../ledger/memory";
import { reconcileSettled } from "../agents/reconcile";
import { buildReceipt, runDemo } from "../scenario";
import { buildPack, executionsCsv, gitSha } from "../receipt/pack";
import { approve } from "../agents/executor";
import { evidenceDigest } from "../receipt/bind";
import { WebhookInbox } from "../webhooks/inbox";
import { applyAvailable } from "../money";
import type { Action } from "../ledger/types";
import { presentPublic, publicIncident, renderSession } from "./session";
import type { DeskView } from "./types";

const BEATS = ["incident", "blocked", "planned", "refused", "paid", "replay", "failed"] as const;
export type FixtureBeat = (typeof BEATS)[number];

export function fixtureBeat(raw: string | undefined): FixtureBeat {
  return BEATS.includes(raw as FixtureBeat) ? raw as FixtureBeat : "incident";
}

function digestAfterChange(balances: { currency: string; available_amount: number }[], actions: Action[]): string {
  const inbox = new WebhookInbox();
  for (const event of fx.demoWebhookDeliveries) inbox.ingest(event);
  const quote = actions.find((action) => action.kind === "fx_conversion");
  return evidenceDigest({
    balances: balances.map((row) => ({ currency: row.currency, available: row.available_amount })),
    webhookStatus: inbox.status(fx.ORIGINAL_TRANSFER_ID),
    quoteId: quote?.kind === "fx_conversion" ? quote.quoteId : undefined,
    reserve: fx.RESERVE_USD,
    queued: [{ id: fx.queuedPayout.id, amount: fx.queuedPayout.amount }],
  });
}

function money(rows: { currency: string; available_amount: number }[]) {
  return rows.map((b) => ({
    currency: b.currency,
    available: new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(b.available_amount),
  }));
}

/** Isolated mock run. Never reads the ops session or Convex. */
export async function loadFixture(beat: FixtureBeat): Promise<DeskView> {
  if (beat === "incident") return publicIncident();
  const awx = createMockClient();
  const balancesBefore = money(awx.balances);
  if (beat === "blocked") {
    const blocked = await runDemo(awx, { stopOnBlock: true });
    return presentPublic(renderSession({
      awx, ledger: blocked.ledger, phase: "review", ledgerKind: "memory", warning: null, error: null, replayed: false, now: fx.T0, balancesBefore,
    }), beat);
  }
  if (beat === "refused") {
    const held = await runDemo(awx, {});
    const proposal = held.rounds.at(-1)?.proposal;
    const decision = held.awaiting;
    let error = "This beat could not show a refused tap.";
    if (proposal && decision) {
      const usd = awx.balances.find((row) => row.currency === "USD");
      if (usd) applyAvailable(usd, 1);
      try {
        approve(held.ledger, decision.id, "joe", fx.T0, Infinity, digestAfterChange(awx.balances, proposal.actions));
        error = "The tap was accepted. This beat failed to show a refusal.";
      } catch (err) {
        error = err instanceof Error ? err.message : "The tap was refused.";
      }
    }
    return presentPublic(renderSession({
      awx, ledger: held.ledger, phase: "review", ledgerKind: "memory", warning: null, error, replayed: false, now: fx.T0, balancesBefore,
    }), beat);
  }
  if (beat === "failed") {
    const orig = awx.createConversion.bind(awx);
    awx.createConversion = async () => {
      awx.createConversion = orig;
      awx.calls.createConversion += 1;
      throw new AirwallexError("insufficient funds", 400, "balance_insufficient");
    };
  }
  if (beat === "replay") {
    const replay = await replayFixture();
    return presentPublic(renderSession({
      awx: replay.awx, ledger: replay.ledger, phase: "paid", ledgerKind: "memory", warning: null, error: null, replayed: true, now: fx.T0, balancesBefore,
    }), beat);
  }
  const res = await runDemo(awx, { approver: beat === "planned" ? undefined : "joe" });
  const failed = res.executions.some((e) => e.result === "error");
  const phase = beat === "planned" ? "review" : failed ? "failed" : "paid";
  const error = failed ? "The FX conversion failed: insufficient funds. Nothing was marked paid." : null;
  return presentPublic(renderSession({
    awx, ledger: res.ledger, phase, ledgerKind: "memory", warning: null, error, replayed: false, now: fx.T0, balancesBefore,
  }), beat);
}

async function replayFixture() {
  const awx = createMockClient();
  const first = await runDemo(awx, { approver: "joe" });
  const proposal = first.rounds.at(-1)?.proposal;
  if (!proposal) throw new Error("fixture replay had no plan");
  const snap = snapshotMock(awx);
  const fresh = createMockClient({ balances: snap.balances, transfers: snap.transfers, conversions: snap.conversions, beneficiaries: snap.beneficiaries, quotes: snap.quotes });
  const ledger = new MemoryLedger();
  ledger.intents.push(...first.ledger.intents);
  ledger.proposals.push(...first.ledger.proposals);
  ledger.decisions.push(...first.ledger.decisions);
  ledger.objections.push(...first.ledger.objections);
  ledger.executions.push(...first.ledger.executions);
  await reconcileSettled(fresh, "intent_inv2291", proposal.actions, ledger, proposal.id, fx.T0);
  buildReceipt(ledger, "intent_inv2291", fx.T0);
  return { awx: fresh, ledger };
}

export async function fixturePack(beat: FixtureBeat = "paid") {
  if (beat === "replay") {
    const replay = await replayFixture();
    const awx = replay.awx;
    return buildPack({
      ledger: replay.ledger,
      intentId: "intent_inv2291",
      mode: "MOCK",
      fixture: "northwind-inv2291",
      gitSha: gitSha(),
      runId: "fixture-replay",
      balancesBefore: fx.balances.map((b) => ({ currency: b.currency, available: b.available_amount })),
      balancesAfter: awx.balances.map((b) => ({
        currency: b.currency, available: b.available_amount, pending: b.pending_amount ?? 0, reserved: b.reserved_amount ?? 0, total: b.total_amount ?? b.available_amount,
      })),
      reserve: { currency: "USD", amount: fx.RESERVE_USD },
      queued: [{ id: fx.queuedPayout.id, amount: fx.queuedPayout.amount, currency: fx.queuedPayout.currency, label: fx.queuedPayout.label }],
      webhooks: fx.demoWebhookDeliveries.map((e) => ({ id: e.id, name: e.name, createdAt: e.created_at, status: e.data.object.status })),
      transferCalls: awx.calls.createTransfer,
      transfersSettled: awx.settled.transfers,
      conversionCalls: awx.calls.createConversion,
      conversionsSettled: awx.settled.conversions,
    });
  }
  const awx = createMockClient();
  const before = awx.balances.map((b) => ({ currency: b.currency, available: b.available_amount }));
  const approver = beat === "incident" || beat === "planned" || beat === "blocked" || beat === "refused" ? undefined : "joe";
  const res = beat === "incident" ? await runDemo(awx, {}) : await runDemo(awx, { approver });
  return buildPack({
    ledger: res.ledger,
    intentId: "intent_inv2291",
    mode: "MOCK",
    fixture: "northwind-inv2291",
    gitSha: gitSha(),
    runId: `fixture-${beat}`,
    balancesBefore: before,
    balancesAfter: awx.balances.map((b) => ({
      currency: b.currency, available: b.available_amount, pending: b.pending_amount ?? 0, reserved: b.reserved_amount ?? 0, total: b.total_amount ?? b.available_amount,
    })),
    reserve: { currency: "USD", amount: fx.RESERVE_USD },
    queued: [{ id: fx.queuedPayout.id, amount: fx.queuedPayout.amount, currency: fx.queuedPayout.currency, label: fx.queuedPayout.label }],
    webhooks: fx.demoWebhookDeliveries.map((e) => ({ id: e.id, name: e.name, createdAt: e.created_at, status: e.data.object.status })),
    transferCalls: awx.calls.createTransfer,
    transfersSettled: awx.settled.transfers,
    conversionCalls: awx.calls.createConversion,
    conversionsSettled: awx.settled.conversions,
  });
}

export async function fixtureCsv(beat: FixtureBeat = "paid") {
  return executionsCsv(await fixturePack(beat));
}
