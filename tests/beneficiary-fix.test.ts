import { describe, expect, it } from "vitest";
import * as fx from "@/lib/airwallex/fixtures";
import { createMockClient } from "@/lib/airwallex/mock";
import { createLiveClient } from "@/lib/airwallex/live";
import { stubPlan } from "@/lib/agents/planner";
import { review, wring } from "@/lib/agents/wringer";
import type { Situation } from "@/lib/agents/situation";
import { MemoryLedger } from "@/lib/ledger/memory";
import { payeeFacts, runDemo } from "@/lib/scenario";
import type { Action } from "@/lib/ledger/types";

async function northwind(awx = createMockClient()): Promise<Situation> {
  const balances = await awx.getBalances();
  return {
    intentId: "intent_inv2291", now: fx.T0, original: { ...fx.originalTransfer },
    webhook: { statusByCreatedAt: "CANCELLED", statusByArrival: "CANCELLED", sawFailedEvent: true, failedDeliveries: 1, uniqueFailedEvents: 1, duplicates: [] },
    balances, reserve: { currency: "USD", amount: 10000 }, queuedPayouts: [], approvalThresholdUsd: 10000,
    ...(await payeeFacts(awx, fx.originalTransfer, balances)),
  };
}
const blocks = (s: Situation, a: Action[]) => wring(s, a).filter((f) => f.severity === "block").map((f) => f.check);
const withoutFix = (a: Action[]) => a.filter((x) => x.kind !== "correct_beneficiary");

describe("payee correction after a name/account mismatch", () => {
  it("blocks a retry to the unchanged beneficiary (hard check)", async () => {
    const s = await northwind();
    expect(blocks(s, withoutFix(stubPlan(s, 2, ["x"]).actions))).toContain("beneficiary_unchanged_after_mismatch");
  });

  it("a model reply that clears everything cannot lift the block", async () => {
    const s = await northwind();
    const env = { AGENT_MODE: "llm", OPENROUTER_API_KEY: "k", OPENROUTER_MODEL_PLANNER: "m", OPENROUTER_MODEL_WRINGER: "m" } as unknown as NodeJS.ProcessEnv;
    const chat = async () => ({ objections: [{ check: "beneficiary_unchanged_after_mismatch", severity: "note", detail: "cleared" }] });
    const f = await review(s, withoutFix(stubPlan(s, 2, ["x"]).actions), { env, chat });
    expect(f.find((x) => x.check === "beneficiary_unchanged_after_mismatch")?.severity).toBe("block");
  });

  it("round 2 corrects the payee to the supplier-confirmed names and passes the payee checks", async () => {
    const s = await northwind();
    const actions = stubPlan(s, 2, ["x"]).actions;
    const fix = actions.find((a) => a.kind === "correct_beneficiary");
    expect(fix).toMatchObject({ beneficiaryId: fx.SUPPLIER_BENEFICIARY_ID, companyName: fx.supplierCorrection.companyName, accountName: fx.supplierCorrection.accountName });
    expect(blocks(s, actions).filter((c) => c.startsWith("beneficiary_"))).toEqual([]);
  });

  it("a correction to names the supplier did not confirm is blocked", async () => {
    const s = await northwind();
    const actions = stubPlan(s, 2, ["x"]).actions.map((a) => (a.kind === "correct_beneficiary" ? { ...a, accountName: "Someone Else Ltd" } : a));
    expect(blocks(s, actions)).toContain("beneficiary_correction_unverified");
  });

  it("no supplier confirmation means no correction and no retry", async () => {
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe", correction: null });
    expect(res.rounds.every((r) => r.decision.status === "blocked")).toBe(true);
    expect(awx.calls.createTransfer).toBe(0);
    expect(awx.calls.updateBeneficiary).toBe(0);
  });

  it("updates the payee before the transfer, once, and the rerun does not update again", async () => {
    const awx = createMockClient();
    const ledger = new MemoryLedger();
    const res = await runDemo(awx, { approver: "joe", ledger });
    expect(res.executions.map((e) => e.actionKind)).toEqual(["defer_payout", "correct_beneficiary", "fx_conversion", "retry_transfer"]);
    expect(awx.calls.updateBeneficiary).toBe(1);
    expect(awx.beneficiaries.get(fx.SUPPLIER_BENEFICIARY_ID)?.accountName).toBe(fx.supplierCorrection.accountName);
    await runDemo(awx, { approver: "joe", ledger });
    expect(awx.calls.updateBeneficiary).toBe(1);
    expect(awx.calls.createTransfer).toBe(1);
  });

  it("a payee that already carries the corrected names gets no second update", async () => {
    const awx = createMockClient({ beneficiaries: [{ ...fx.supplierBeneficiary, companyName: fx.supplierCorrection.companyName, accountName: fx.supplierCorrection.accountName }] });
    const res = await runDemo(awx, { approver: "joe" });
    expect(res.executions.some((e) => e.actionKind === "correct_beneficiary")).toBe(false);
    expect(awx.calls.updateBeneficiary).toBe(0);
    expect(awx.calls.createTransfer).toBe(1);
  });

  it("blocks the retry while the original could still hold cash", async () => {
    const s = await northwind();
    s.readBack = { ...s.readBack!, pending: 40000 };
    expect(blocks(s, stubPlan(s, 2, ["x"]).actions)).toContain("original_debit_not_returned");
  });

  it("the receipt states the read-back and the supplier confirmation as New information", async () => {
    const res = await runDemo(createMockClient(), { approver: "joe" });
    const info = res.receipt!.lines.find((l) => l.startsWith("New information:"))!;
    expect(info).toMatch(/GET \/api\/v1\/transfers\/\S+ is CANCELLED/);
    expect(info).toMatch(/pending 0 and reserved 0, so the original holds no money/);
    expect(info).toContain(`Supplier confirmed the legal account name "${fx.supplierCorrection.accountName}"`);
  });
});

describe("live client payee calls", () => {
  const env = { AIRWALLEX_CLIENT_ID: "c", AIRWALLEX_API_KEY: "k" } as unknown as NodeJS.ProcessEnv;
  it("GETs the beneficiary, then POSTs /api/v1/beneficiaries/{id}/update with only the names changed, and projects away the account number", async () => {
    const log: { url: string; method: string; body?: string }[] = [];
    const stored = { id: "b1", nickname: "n", transfer_methods: ["LOCAL"], beneficiary: { company_name: "Old", entity_type: "COMPANY", bank_details: { account_name: "Old", account_number: "000123454417", bank_country_code: "US", account_currency: "USD" } } };
    const f = (async (url: string, init?: RequestInit) => {
      log.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (String(url).endsWith("/login")) return new Response(JSON.stringify({ token: "t", expires_at: "2099-01-01T00:00:00+0000" }), { status: 201 });
      if (init?.method === "POST") return new Response(init.body as string, { status: 200 });
      return new Response(JSON.stringify(stored), { status: 200 });
    }) as typeof fetch;
    const c = createLiveClient(env, f);
    const out = await c.updateBeneficiary("b1", { companyName: "New LLC", accountName: "New LLC" });
    const post = log.find((l) => l.method === "POST" && !l.url.endsWith("/login"))!;
    expect(post.url).toBe("https://api.sandbox.airwallex.com/api/v1/beneficiaries/b1/update");
    const body = JSON.parse(post.body!);
    expect(body.transfer_methods).toEqual(["LOCAL"]);
    expect(body.beneficiary.company_name).toBe("New LLC");
    expect(body.beneficiary.bank_details).toMatchObject({ account_name: "New LLC", account_number: "000123454417", bank_country_code: "US" });
    expect(out).toEqual({ id: "b1", companyName: "New LLC", accountName: "New LLC", accountLast4: "4417", nickname: "n" });
  });
});
