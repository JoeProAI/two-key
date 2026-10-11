import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/airwallex/mock";
import { runDemo } from "@/lib/scenario";
import { wring } from "@/lib/agents/wringer";
import { stubPlan } from "@/lib/agents/planner";
import * as fx from "@/lib/airwallex/fixtures";
import type { Situation } from "@/lib/agents/situation";

const base = (): Situation => ({
  intentId: "i", now: fx.T0, original: { ...fx.originalTransfer },
  webhook: { statusByCreatedAt: "CANCELLED", statusByArrival: "CANCELLED", sawFailedEvent: true, failedDeliveries: 1, uniqueFailedEvents: 1, duplicates: [] },
  balances: [{ currency: "USD", available_amount: 100000 }], reserve: { currency: "USD", amount: 10000 }, queuedPayouts: [], approvalThresholdUsd: 10000,
});

describe("demo scenario (mock, end to end)", () => {
  it("pays the supplier exactly once, converts EUR, defers the payout, after one approval", async () => {
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe" });
    expect(res.rounds[0].decision.status).toBe("blocked");
    expect(res.rounds[0].findings.map((f) => f.check)).toEqual(expect.arrayContaining(["double_payment", "duplicate_webhook", "out_of_order_webhook", "reserve_breach"]));
    expect(res.rounds[1].decision.humanApprovedBy).toBe("joe");
    expect(awx.calls.createTransfer).toBe(1);
    expect(awx.calls.createConversion).toBe(1);
    expect(res.executions.map((e) => [e.actionKind, e.result])).toEqual([["defer_payout", "ok"], ["fx_conversion", "ok"], ["retry_transfer", "ok"]]);
    expect(awx.balances.find((b) => b.currency === "USD")!.available_amount).toBe(10000); // reserve intact
    expect(res.receipt!.lines.join("\n")).toMatch(/approved by joe/);
  });

  it("re-running the executor makes no new Airwallex calls", async () => {
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe" });
    const again = await res.rerun!();
    expect(again.every((e) => e.result === "already_done")).toBe(true);
    expect(awx.calls.createTransfer).toBe(1);
    expect(awx.calls.createConversion).toBe(1);
  });

  it("without a human tap nothing moves", async () => {
    const awx = createMockClient();
    const res = await runDemo(awx);
    expect(res.awaiting?.status).toBe("awaiting_human");
    expect(awx.calls.createTransfer + awx.calls.createConversion).toBe(0);
  });

  it("a lost ledger still cannot pay twice: Airwallex lookup by request_id catches it", async () => {
    const awx = createMockClient();
    await runDemo(awx, { approver: "joe" });
    const second = await runDemo(awx, { approver: "joe" }); // fresh ledger, same intent
    const retry = second.executions.find((e) => e.actionKind === "retry_transfer");
    expect(retry?.result === "already_done" || second.executions.some((e) => e.result === "error")).toBe(true);
    expect([...awx.transfers.values()].filter((t) => t.reference === fx.originalTransfer.reference && t.id !== fx.ORIGINAL_TRANSFER_ID)).toHaveLength(1);
  });
});

describe("Wringer checks", () => {
  const retry = (s: Situation) => stubPlan(s, 2, ["x"]).actions.filter((a) => a.kind === "retry_transfer");
  it("blocks a retry when the original was CANCELLED without a failure", () => {
    const s = base();
    s.webhook.sawFailedEvent = false;
    expect(wring(s, retry(s)).map((f) => f.check)).toContain("cancelled_not_failed");
  });
  it("blocks a retry while the original is SENT or PAID", () => {
    for (const st of ["SENT", "PAID", "PROCESSING"] as const) {
      const s = base();
      s.original.status = st;
      expect(wring(s, retry(s)).map((f) => f.check)).toContain("original_still_live");
    }
  });
  it("blocks a stale FX quote", () => {
    const s = base();
    const a = { kind: "fx_conversion" as const, buyCurrency: "USD", sellCurrency: "EUR", buyAmount: 100, quoteId: "q", quoteValidToAt: fx.iso(fx.T0 + 10_000), requestId: "r" };
    expect(wring(s, [a]).map((f) => f.check)).toContain("stale_fx_quote");
  });
  it("blocks a reserve breach", () => {
    const s = base();
    s.balances = [{ currency: "USD", available_amount: 45000 }];
    expect(wring(s, retry(s)).map((f) => f.check)).toContain("reserve_breach");
  });
  it("passes a clean single retry", () => {
    const s = base();
    expect(wring(s, retry(s)).filter((f) => f.severity === "block")).toEqual([]);
  });
});
