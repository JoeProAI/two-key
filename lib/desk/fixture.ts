import "server-only";
import { createMockClient } from "../airwallex/mock";
import { AirwallexError } from "../airwallex/types";
import * as fx from "../airwallex/fixtures";
import { runDemo } from "../scenario";
import { buildPack, executionsCsv, gitSha } from "../receipt/pack";
import { presentPublic, publicIncident, renderSession } from "./session";
import type { DeskView } from "./types";

const BEATS = ["incident", "planned", "paid", "replay", "failed"] as const;
export type FixtureBeat = (typeof BEATS)[number];

export function fixtureBeat(raw: string | undefined): FixtureBeat {
  return BEATS.includes(raw as FixtureBeat) ? raw as FixtureBeat : "incident";
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
  if (beat === "failed") {
    const orig = awx.createConversion.bind(awx);
    awx.createConversion = async () => {
      awx.createConversion = orig;
      awx.calls.createConversion += 1;
      throw new AirwallexError("insufficient funds", 400, "balance_insufficient");
    };
  }
  if (beat === "replay") await runDemo(awx, { approver: "joe" });
  const res = await runDemo(awx, { approver: beat === "planned" ? undefined : "joe" });
  const failed = res.executions.some((e) => e.result === "error");
  const phase = beat === "planned" ? "review" : failed ? "failed" : "paid";
  const error = failed ? "The FX conversion failed: insufficient funds. Nothing was marked paid." : null;
  return presentPublic(renderSession({
    awx, ledger: res.ledger, phase, ledgerKind: "memory", warning: null, error, replayed: beat === "replay", now: fx.T0, balancesBefore,
  }), beat);
}

export async function fixturePack(beat: FixtureBeat = "paid") {
  const awx = createMockClient();
  const before = awx.balances.map((b) => ({ currency: b.currency, available: b.available_amount }));
  if (beat === "replay") await runDemo(awx, { approver: "joe" });
  const approver = beat === "incident" || beat === "planned" ? undefined : "joe";
  const res = beat === "incident" ? await runDemo(awx, {}) : await runDemo(awx, { approver });
  return buildPack({
    ledger: res.ledger,
    intentId: "intent_inv2291",
    mode: "MOCK",
    fixture: "northwind-inv2291",
    gitSha: gitSha(),
    runId: `fixture-${beat}`,
    balancesBefore: before,
    balancesAfter: awx.balances.map((b) => ({ currency: b.currency, available: b.available_amount })),
    reserve: { currency: "USD", amount: fx.RESERVE_USD },
    queued: [{ id: fx.queuedPayout.id, amount: fx.queuedPayout.amount, currency: fx.queuedPayout.currency, label: fx.queuedPayout.label }],
    webhooks: fx.demoWebhookDeliveries.map((e) => ({ id: e.id, name: e.name, createdAt: e.created_at, status: e.data.object.status })),
    transfersCreated: awx.calls.createTransfer,
    conversionsCreated: awx.calls.createConversion,
  });
}

export async function fixtureCsv(beat: FixtureBeat = "paid") {
  return executionsCsv(await fixturePack(beat));
}
