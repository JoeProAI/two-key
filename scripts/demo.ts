import { mkdirSync, writeFileSync } from "node:fs";
import { SCENARIOS, type ScenarioName } from "../lib/scenarios";
import { buildPack, executionsCsv, gitSha } from "../lib/receipt/pack";
import * as fx from "../lib/airwallex/fixtures";
import type { MemoryLedger } from "../lib/ledger/memory";

// Mock mode end to end. No keys, no network.
// npm run demo [-- main | rerun | stale-quote | approval | approval-timeout | deposit]
const name = (process.argv[2] ?? "main") as ScenarioName;
if (!(name in SCENARIOS)) {
  console.error(`Unknown scenario "${name}". Pick one of: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}
const result = await SCENARIOS[name]();
console.log(`Scenario: ${name}`);
console.log("Mode: MOCK FIXTURE\n");
console.log((result.receipt?.lines ?? ["(no receipt)"]).join("\n"));
console.log("\nBalances after:", JSON.stringify(result.awx.balances));
console.log("Transfers created:", result.awx.calls.createTransfer, "| conversions:", result.awx.calls.createConversion, "| quotes:", result.awx.calls.createQuote);

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
    balancesAfter: result.awx.balances.map((b) => ({ currency: b.currency, available: b.available_amount })),
    reserve: { currency: "USD", amount: fx.RESERVE_USD },
    queued: name === "approval" || name === "approval-timeout" ? [] : [{ id: fx.queuedPayout.id, amount: fx.queuedPayout.amount, currency: fx.queuedPayout.currency, label: fx.queuedPayout.label }],
    webhooks: (name === "approval" || name === "approval-timeout" ? fx.largeWebhookDeliveries : name === "stale-quote" ? fx.cleanWebhookDeliveries : fx.demoWebhookDeliveries)
      .map((e) => ({ id: e.id, name: e.name, createdAt: e.created_at, status: e.data.object.status })),
    transfersCreated: result.awx.calls.createTransfer,
    conversionsCreated: result.awx.calls.createConversion,
  });
  mkdirSync("artifacts/receipts", { recursive: true });
  const file = name === "main" ? "artifacts/receipts/northwind-latest.json" : `artifacts/receipts/${name}.json`;
  writeFileSync(file, JSON.stringify(pack, null, 2));
  writeFileSync(file.replace(/\.json$/, ".csv"), executionsCsv(pack));
  console.log("Receipt pack:", file);
}
