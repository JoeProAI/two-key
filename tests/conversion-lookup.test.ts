import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/airwallex/mock";
import { createLiveClient } from "@/lib/airwallex/live";
import { runDemo } from "@/lib/scenario";
import { execute, decide, approve } from "@/lib/agents/executor";
import { MemoryLedger } from "@/lib/ledger/memory";
import * as fx from "@/lib/airwallex/fixtures";

describe("conversion lookup by request_id", () => {
  it("a second run with an empty ledger finishes cleanly with no double conversion or payment", async () => {
    const awx = createMockClient();
    const first = await runDemo(awx, { approver: "joe" });
    expect(first.executions.every((e) => e.result === "ok")).toBe(true);
    const second = await runDemo(awx, { approver: "joe" }); // fresh MemoryLedger, same intent
    expect(second.executions.map((e) => [e.actionKind, e.result])).toEqual([["defer_payout", "ok"], ["fx_conversion", "already_done"], ["retry_transfer", "already_done"]]);
    expect(second.executions.some((e) => e.result === "error")).toBe(false);
    expect(awx.calls.createConversion).toBe(1);
    expect(awx.calls.createTransfer).toBe(1);
    expect(awx.conversions.size).toBe(1);
    const fxRow = second.executions.find((e) => e.actionKind === "fx_conversion")!;
    expect(fxRow.airwallexId).toBe(first.executions.find((e) => e.actionKind === "fx_conversion")!.airwallexId);
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
