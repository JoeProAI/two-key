import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/airwallex/mock";
import { createLiveClient } from "@/lib/airwallex/live";
import { runDemo } from "@/lib/scenario";
import { reconcileSettled } from "@/lib/agents/reconcile";
import { execute, decide, approve } from "@/lib/agents/executor";
import { planDigest } from "@/lib/receipt/bind";
import { fxRequestId } from "@/lib/requestId";
import { MemoryLedger } from "@/lib/ledger/memory";
import * as fx from "@/lib/airwallex/fixtures";

describe("conversion lookup by request_id", () => {
  it("a finished intent is reconciled, not replanned onto the old conversion", async () => {
    const awx = createMockClient();
    const first = await runDemo(awx, { approver: "joe" });
    expect(first.executions.every((e) => e.result === "ok")).toBe(true);
    const quotes = awx.calls.createQuote;
    const second = await runDemo(awx, { approver: "joe" });
    expect(second.refusedReplan).toMatch(/did not replan or pay/);
    expect(second.executions).toEqual([]);
    expect(awx.calls.createQuote).toBe(quotes);
    expect(awx.calls.createConversion).toBe(1);
    expect(awx.calls.createTransfer).toBe(1);
    const ledger = new MemoryLedger();
    const actions = first.rounds.at(-1)!.proposal.actions;
    const reconciled = await reconcileSettled(awx, "intent_inv2291", actions, ledger, "dec_reconcile", fx.T0);
    expect(reconciled.map((e) => [e.actionKind, e.result])).toEqual([["defer_payout", "already_done"], ["correct_beneficiary", "already_done"], ["fx_conversion", "already_done"], ["retry_transfer", "already_done"]]);
    expect(awx.calls.createConversion).toBe(1);
    expect(awx.calls.createTransfer).toBe(1);
    expect(awx.conversions.size).toBe(1);
    const fxRow = reconciled.find((e) => e.actionKind === "fx_conversion")!;
    expect(fxRow.airwallexId).toBe(first.executions.find((e) => e.actionKind === "fx_conversion")!.airwallexId);
    expect(reconciled.find((e) => e.actionKind === "retry_transfer")!.airwallexId).toBe(first.executions.find((e) => e.actionKind === "retry_transfer")!.airwallexId);
  });

  it("does not send a second conversion when a new buy amount arrives after the supplier transfer is live", async () => {
    const awx = createMockClient();
    const first = await runDemo(awx, { approver: "joe" });
    const proposal = first.rounds.at(-1)!.proposal;
    const decision = first.ledger.decisions.find((d) => d.status === "approved")!;
    const actions = JSON.parse(JSON.stringify(proposal.actions)) as typeof proposal.actions;
    const fxAction = actions.find((a) => a.kind === "fx_conversion");
    if (!fxAction || fxAction.kind !== "fx_conversion") throw new Error("missing fx");
    fxAction.buyAmount = 40000;
    fxAction.requestId = fxRequestId("intent_inv2291", 40000, "USD", "EUR");
    expect(fxAction.requestId).not.toBe(first.executions.find((e) => e.actionKind === "fx_conversion")!.requestId);
    decision.boundDigest = planDigest(actions);
    const out = await execute(first.ledger, awx, decision, { ...proposal, actions }, fx.T0, new Set());
    const row = out.find((e) => e.actionKind === "fx_conversion");
    expect(row?.result).toBe("error");
    expect((row?.response as { message?: string }).message).toMatch(/already on the provider/);
    expect(awx.calls.createConversion).toBe(1);
    expect(awx.settled.conversions).toBe(1);
    expect(awx.conversions.size).toBe(1);
  });

  it("refuses to re-send when the prior conversion for the request_id was CANCELLED", async () => {
    const awx = createMockClient();
    const first = await runDemo(awx, { approver: "joe" });
    const [c] = [...awx.conversions.values()];
    c.status = "CANCELLED";
    const ledger = new MemoryLedger();
    const proposal = { ...first.rounds[1].proposal };
    const d = decide(ledger, proposal, [], 10000, fx.T0);
    approve(ledger, d.id, "joe", fx.T0);
    const out = await execute(ledger, awx, d, proposal, fx.T0, new Set());
    expect(out.find((e) => e.actionKind === "fx_conversion")?.result).toBe("error");
    expect(out.some((e) => e.actionKind === "retry_transfer")).toBe(false); // never pay after a failed funding step
    expect(awx.calls.createConversion).toBe(1);
  });

  it("live client uses the documented list and retrieve endpoints", async () => {
    const log: string[] = [];
    const f = (async (url: string) => {
      log.push(String(url));
      if (String(url).endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "t", expires_at: "2099-01-01T00:00:00+0000" }), { status: 201 });
      if (String(url).includes("/api/v1/fx/conversions?")) return new Response(JSON.stringify({ has_more: false, items: [{ conversion_id: "c1", request_id: "r 1", status: "SETTLED" }] }), { status: 200 });
      return new Response(JSON.stringify({ conversion_id: "c1", request_id: "r 1", status: "SETTLED" }), { status: 200 });
    }) as typeof fetch;
    const c = createLiveClient({ AIRWALLEX_CLIENT_ID: "c", AIRWALLEX_API_KEY: "k" } as unknown as NodeJS.ProcessEnv, f);
    expect((await c.findConversionByRequestId("r 1"))?.conversion_id).toBe("c1");
    expect(log[1]).toBe("https://api.sandbox.airwallex.com/api/v1/fx/conversions?request_id=r%201");
    await c.getConversion("c1");
    expect(log[2]).toBe("https://api.sandbox.airwallex.com/api/v1/fx/conversions/c1");
  });

  it("live createConversion falls back to the request_id lookup when create errors", async () => {
    const f = (async (url: string) => {
      if (String(url).endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "t", expires_at: "2099-01-01T00:00:00+0000" }), { status: 201 });
      if (String(url).endsWith("/fx/conversions/create")) return new Response(JSON.stringify({ code: "invalid_argument" }), { status: 400 });
      return new Response(JSON.stringify({ has_more: false, items: [{ conversion_id: "c9", request_id: "r", status: "SCHEDULED" }] }), { status: 200 });
    }) as typeof fetch;
    const c = createLiveClient({ AIRWALLEX_CLIENT_ID: "c", AIRWALLEX_API_KEY: "k" } as unknown as NodeJS.ProcessEnv, f);
    const out = await c.createConversion({ request_id: "r", buy_currency: "USD", sell_currency: "EUR", buy_amount: "1.00" });
    expect(out.conversion_id).toBe("c9");
  });

  it("mock errors use documented codes", async () => {
    const awx = createMockClient();
    await expect(awx.createTransfer({ request_id: fx.ORIGINAL_REQUEST_ID, beneficiary_id: "b", transfer_amount: "1", transfer_currency: "USD", transfer_method: "LOCAL", reference: "x", reason: "y" }))
      .rejects.toMatchObject({ status: 400, code: "request_id_duplicate" });
  });
});
