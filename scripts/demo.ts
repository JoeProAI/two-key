import { createMockClient } from "../lib/airwallex/mock";
import { runDemo } from "../lib/scenario";

// Mock mode end to end. No keys, no network. `npm run demo`
const awx = createMockClient();
const res = await runDemo(awx, { approver: "joe" });
console.log((res.receipt?.lines ?? ["(no receipt)"]).join("\n"));
console.log("\nBalances after:", JSON.stringify(awx.balances));
console.log("Transfers created:", awx.calls.createTransfer, "| conversions:", awx.calls.createConversion);
