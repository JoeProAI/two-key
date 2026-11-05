import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/airwallex/mock";
import * as fx from "@/lib/airwallex/fixtures";
import { runDemo } from "@/lib/scenario";
import { buildPack } from "@/lib/receipt/pack";
import { redact } from "@/lib/receipt/redact";
import { stableRequestId } from "@/lib/requestId";

describe("receipt pack", () => {
  it("keeps provider ids and strips secrets", async () => {
    const awx = createMockClient();
    const before = awx.balances.map((b) => ({ currency: b.currency, available: b.available_amount }));
    const res = await runDemo(awx, { approver: "joe" });
    const pack = buildPack({
      ledger: res.ledger,
      intentId: "intent_inv2291",
      mode: "MOCK",
      fixture: "northwind-inv2291",
      gitSha: "abc",
      runId: "test",
      balancesBefore: before,
      balancesAfter: awx.balances.map((b) => ({ currency: b.currency, available: b.available_amount })),
      reserve: { currency: "USD", amount: fx.RESERVE_USD },
      queued: [],
      webhooks: [],
      transfersCreated: awx.calls.createTransfer,
      conversionsCreated: awx.calls.createConversion,
    });
    const retry = stableRequestId("intent_inv2291", "retry_transfer", "0");
    expect(pack.mode).toBe("MOCK");
    expect(pack.note).toMatch(/MOCK FIXTURE/);
    expect(pack.executions.some((e) => e.requestId === retry && e.result === "ok" && e.providerId)).toBe(true);
    expect(pack.resulting.transfersCreated).toBe(1);
    expect(pack.resulting.balancesAfter.find((b) => b.currency === "USD")?.available).toBe(10000);
    const dirty = redact({ apiKey: "secret-value", note: "mail ops@example.com about 123456789012", requestId: retry });
    expect(JSON.stringify(dirty)).not.toContain("secret-value");
    expect(JSON.stringify(dirty)).not.toContain("ops@example.com");
    expect(JSON.stringify(dirty)).not.toContain("123456789012");
    expect(dirty.requestId).toBe(retry);
  });
});
