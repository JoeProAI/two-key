import { SCENARIOS, type ScenarioName } from "../lib/scenarios";

// Mock mode end to end. No keys, no network.
// npm run demo [-- main | rerun | stale-quote | approval | approval-timeout]
const name = (process.argv[2] ?? "main") as ScenarioName;
if (!(name in SCENARIOS)) {
  console.error(`Unknown scenario "${name}". Pick one of: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}
const { awx, receipt } = await SCENARIOS[name]();
console.log(`Scenario: ${name}\n`);
console.log((receipt?.lines ?? ["(no receipt)"]).join("\n"));
console.log("\nBalances after:", JSON.stringify(awx.balances));
console.log("Transfers created:", awx.calls.createTransfer, "| conversions:", awx.calls.createConversion, "| quotes:", awx.calls.createQuote);
