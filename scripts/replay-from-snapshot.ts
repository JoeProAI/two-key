import { readFileSync, writeFileSync } from "node:fs";
import { createMockClient, type MockSnapshot } from "../lib/airwallex/mock";
import { MemoryLedger } from "../lib/ledger/memory";
import { reconcileSettled } from "../lib/agents/reconcile";
import type { Action } from "../lib/ledger/types";
import * as fx from "../lib/airwallex/fixtures";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: replay-from-snapshot.ts <dir>");
  process.exit(1);
}
const snap = JSON.parse(readFileSync(`${dir}/snapshot.json`, "utf8")) as MockSnapshot;
const actions = JSON.parse(readFileSync(`${dir}/actions.json`, "utf8")) as Action[];
const awx = createMockClient({
  balances: snap.balances,
  transfers: snap.transfers,
  conversions: snap.conversions,
  quotes: snap.quotes,
});
const ledger = new MemoryLedger();
const executions = await reconcileSettled(awx, "intent_inv2291", actions, ledger, ledger.id("dec"), fx.T0);
const result = {
  executions: executions.map((e) => ({
    action: e.actionKind,
    requestId: e.requestId,
    result: e.result,
    providerId: e.airwallexId ?? null,
    buyAmount: (e.response as { buy_amount?: number } | null)?.buy_amount,
    transferAmount: (e.response as { transfer_amount?: number } | null)?.transfer_amount,
  })),
  transferCalls: awx.calls.createTransfer,
  conversionCalls: awx.calls.createConversion,
  quoteCalls: awx.calls.createQuote,
  transfersSettled: awx.settled.transfers,
  conversionsSettled: awx.settled.conversions,
  balances: awx.balances,
};
writeFileSync(`${dir}/result.json`, JSON.stringify(result, null, 2));
