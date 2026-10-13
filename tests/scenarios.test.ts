import { describe, expect, it } from "vitest";
import { runApprovalDemo, runStaleQuoteDemo, SCENARIOS } from "@/lib/scenarios";
import { APPROVAL_TIMEOUT_MS } from "@/lib/airwallex/fixtures";

describe("scenario (a): stale FX quote", () => {
  it("Wringer blocks the 40s-left quote, planner re-quotes, one conversion on the fresh quote", async () => {
    const r = await runStaleQuoteDemo({ approver: "joe" });
    expect(r.rounds).toHaveLength(2);
    expect(r.rounds[0].decision.status).toBe("blocked");
    expect(r.rounds[0].findings.filter((f) => f.severity === "block").map((f) => f.check)).toEqual(["stale_fx_quote"]);
    expect(r.rounds[1].decision.status).toBe("approved");
    expect(r.rounds[1].quote.quote_id).not.toBe(r.rounds[0].quote.quote_id);
    expect(r.awx.calls.createQuote).toBe(2);
    expect(r.awx.calls.createConversion).toBe(1);
    expect(r.awx.calls.createTransfer).toBe(1);
    const [c] = [...r.awx.conversions.values()];
    expect(c.quote_id).toBe(r.rounds[1].quote.quote_id);
    expect(r.receipt!.lines.join("\n")).toMatch(/BLOCK \[stale_fx_quote\]/);
  });
  it("with no approver it waits and moves nothing", async () => {
    const r = await runStaleQuoteDemo();
    expect(r.awx.calls.createConversion + r.awx.calls.createTransfer).toBe(0);
  });
});

describe("scenario (b): payout over the approval threshold", () => {
  it("waits with no money moving, then pays once after the tap", async () => {
    const r = await runApprovalDemo({ approveAfterMs: 90 * 60_000 });
    expect(r.findings.filter((f) => f.severity === "block")).toEqual([]);
    expect(r.decision.needsHuman).toBe(true);
    expect(r.waits.length).toBeGreaterThan(0);
    expect(r.waits.every((w) => w.status === "awaiting_human" && w.transfersCreated === 0)).toBe(true);
    expect(r.decision.status).toBe("approved");
    expect(r.executions.map((e) => [e.actionKind, e.result])).toEqual([["retry_transfer", "ok"]]);
    expect(r.awx.calls.createTransfer).toBe(1);
  });
  it("times out: expires, moves nothing, and refuses a late tap", async () => {
    const r = await runApprovalDemo({ approveAfterMs: APPROVAL_TIMEOUT_MS + 60 * 60_000 });
    expect(r.decision.status).toBe("expired");
    expect(r.executions).toEqual([]);
    expect(r.awx.calls.createTransfer).toBe(0);
    expect(r.lateTapError).toMatch(/expired/);
    expect(r.receipt.lines.join("\n")).toMatch(/Expired after 240 min/);
  });
  it("times out with no tap at all", async () => {
    const r = await runApprovalDemo({ approveAfterMs: null });
    expect(r.decision.status).toBe("expired");
    expect(r.awx.calls.createTransfer).toBe(0);
  });
});

describe("demo CLI scenarios", () => {
  it("every named scenario runs", async () => {
    for (const run of Object.values(SCENARIOS)) expect((await run()).receipt).toBeTruthy();
  });
});
