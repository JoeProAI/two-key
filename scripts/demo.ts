import { mkdirSync, writeFileSync } from "node:fs";
import { SCENARIOS, type ScenarioName } from "../lib/scenarios";
import { buildPack, executionsCsv, gitSha } from "../lib/receipt/pack";
import * as fx from "../lib/airwallex/fixtures";
import type { MemoryLedger } from "../lib/ledger/memory";

// Mock mode end to end. No keys, no network.
// npm run demo [-- main | replay | stale-quote | approval | approval-timeout | deposit]
// main is an independent run. replay is a separate scenario: pay once, then a fresh process reconciles.
const name = (process.argv[2] ?? "main") as ScenarioName;
if (!(name in SCENARIOS)) {
  console.error(`Unknown scenario "${name}". Pick one of: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}
const result = await SCENARIOS[name]();
console.log(`Scenario: ${name}`);
console.log("Mode: MOCK FIXTURE\n");
console.log((result.receipt?.lines ?? ["(no receipt)"]).join("\n"));
const fullBalance = (b: { currency: string; available_amount: number; pending_amount?: number; reserved_amount?: number; total_amount?: number }) => ({
  currency: b.currency, available: b.available_amount, pending: b.pending_amount ?? 0, reserved: b.reserved_amount ?? 0, total: b.total_amount ?? b.available_amount,
});
console.log("\nBalances after:", JSON.stringify(result.awx.balances.map(fullBalance)));
console.log(
  "Transfer calls:", result.awx.calls.createTransfer, "settled:", result.awx.settled.transfers,
  "| conversion calls:", result.awx.calls.createConversion, "settled:", result.awx.settled.conversions,
  "| quotes:", result.awx.calls.createQuote,
);
if (name === "main") console.log("This main run is independent. Its provider ids are not the replay scenario's ids.");
if (name === "replay") console.log("Replay pass 2 is a fresh process. Its provider ids match pass 1 of this scenario only.");

const ledger = "ledger" in result ? result.ledger as MemoryLedger | undefined : undefined;
if (ledger) {
  const intentId = ledger.intents[0]?.id ?? "intent_inv2291";
  const pack = buildPack({
    ledger,
    intentId,
    mode: "MOCK",
    fixture: name,
    gitSha: gitSha(),
    runId: `demo-${name}`,
    balancesBefore: (name === "approval" || name === "approval-timeout" ? fx.largeBalances : fx.balances).map((b) => ({ currency: b.currency, available: b.available_amount })),
    balancesAfter: result.awx.balances.map(fullBalance),
    reserve: { currency: "USD", amount: fx.RESERVE_USD },
    queued: name === "approval" || name === "approval-timeout" ? [] : [{ id: fx.queuedPayout.id, amount: fx.queuedPayout.amount, currency: fx.queuedPayout.currency, label: fx.queuedPayout.label }],
    webhooks: (name === "approval" || name === "approval-timeout" ? fx.largeWebhookDeliveries : name === "stale-quote" ? fx.cleanWebhookDeliveries : fx.demoWebhookDeliveries)
      .map((e) => ({ id: e.id, name: e.name, createdAt: e.created_at, status: e.data.object.status })),
    transferCalls: result.awx.calls.createTransfer,
    transfersSettled: result.awx.settled.transfers,
    conversionCalls: result.awx.calls.createConversion,
    conversionsSettled: result.awx.settled.conversions,
  });
  mkdirSync("artifacts/receipts", { recursive: true });
  const file = name === "main" ? "artifacts/receipts/northwind-latest.json" : `artifacts/receipts/${name}.json`;
  writeFileSync(file, JSON.stringify(pack, null, 2));
  writeFileSync(file.replace(/\.json$/, ".csv"), executionsCsv(pack));
  if (name === "main") {
    mkdirSync("docs/shots", { recursive: true });
    writeFileSync("docs/shots/northwind-receipt.json", JSON.stringify(pack, null, 2));
  }
  console.log("Receipt pack:", file);
}
