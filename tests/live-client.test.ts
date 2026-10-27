import { describe, expect, it } from "vitest";
import { createLiveClient } from "@/lib/airwallex/live";
import { AirwallexError } from "@/lib/airwallex/types";

function fakeFetch(expiresAt: string) {
  const log: { url: string; method: string; body?: string }[] = [];
  let logins = 0;
  const f = (async (url: string, init?: RequestInit) => {
    log.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined });
    if (String(url).endsWith("/api/v1/authentication/login")) {
      logins++;
      return new Response(JSON.stringify({ token: `t${logins}`, expires_at: expiresAt }), { status: 201 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
  return { f, log, logins: () => logins };
}

describe("live client", () => {
  const env = { AIRWALLEX_CLIENT_ID: "c", AIRWALLEX_API_KEY: "k" } as unknown as NodeJS.ProcessEnv;
  it("reuses the token until near expires_at", async () => {
    const ff = fakeFetch("2099-01-01T00:00:00+0000");
    const c = createLiveClient(env, ff.f);
    await c.getBalances();
    await c.getBalances();
    expect(ff.logins()).toBe(1);
    expect(ff.log[1].url).toBe("https://api.sandbox.airwallex.com/api/v1/balances/current");
  });
  it("refreshes an expired token", async () => {
    const ff = fakeFetch("2000-01-01T00:00:00+0000");
    const c = createLiveClient(env, ff.f);
    await c.getBalances();
    await c.getBalances();
    expect(ff.logins()).toBe(2);
  });
  it("sends amounts as major-unit strings", async () => {
    const ff = fakeFetch("2099-01-01T00:00:00+0000");
    const c = createLiveClient(env, ff.f);
    await c.createTransfer({ request_id: "r", beneficiary_id: "b", transfer_amount: "40000.00", transfer_currency: "USD", transfer_method: "LOCAL", reference: "x", reason: "y" }).catch(() => null);
    const create = ff.log.find((l) => l.url.endsWith("/api/v1/transfers/create"))!;
    expect(JSON.parse(create.body!).transfer_amount).toBe("40000.00");
  });
  it("refuses live mode without keys", () => {
    expect(() => createLiveClient({} as unknown as NodeJS.ProcessEnv)).toThrow(/AIRWALLEX_CLIENT_ID/);
  });
  it("keeps API error code and field paths off the secret and off Error.message", async () => {
    const f = (async (url: string) => {
      if (String(url).endsWith("/api/v1/authentication/login")) {
        return new Response(JSON.stringify({ token: "t", expires_at: "2099-01-01T00:00:00+0000" }), { status: 201 });
      }
      return new Response(JSON.stringify({
        code: "invalid_argument",
        message: "account_number is invalid",
        source: "beneficiary.bank_details.account_number",
        details: { errors: [{ source: "beneficiary.bank_details.account_number" }] },
      }), { status: 400 });
    }) as typeof fetch;
    const c = createLiveClient(env, f);
    const err = await c.getBalances().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AirwallexError);
    const awx = err as AirwallexError;
    expect(awx.status).toBe(400);
    expect(awx.code).toBe("invalid_argument");
    expect(awx.apiMessage).toBe("account_number is invalid");
    expect(awx.source).toBe("beneficiary.bank_details.account_number");
    expect(awx.fields).toContain("beneficiary.bank_details.account_number");
    expect(awx.message).toBe("Airwallex GET /api/v1/balances/current failed");
    expect(awx.message).not.toContain("account_number is invalid");
  });
  it("authenticate reports login status and does not return a token", async () => {
    const ff = fakeFetch("2099-01-01T00:00:00+0000");
    const c = createLiveClient(env, ff.f);
    const auth = await c.authenticate();
    expect(auth).toEqual({ httpStatus: 201 });
    expect(Object.keys(auth)).toEqual(["httpStatus"]);
    expect(ff.logins()).toBe(1);
  });
  it("posts a deposit simulation in major units", async () => {
    const ff = fakeFetch("2099-01-01T00:00:00+0000");
    const c = createLiveClient(env, ff.f);
    await c.simulateDeposit({ amount: 100, global_account_id: "ga-1", payer_name: "Seed", reference: "two-key", status: "SETTLED" });
    const post = ff.log.find((l) => l.url.endsWith("/api/v1/simulation/deposit/create"))!;
    expect(post.method).toBe("POST");
    const body = JSON.parse(post.body!);
    expect(body).toEqual({ amount: 100, global_account_id: "ga-1", payer_name: "Seed", reference: "two-key", status: "SETTLED" });
    expect(typeof body.amount).toBe("number");
  });
  it("lists beneficiaries by nickname without sending bank details back", async () => {
    const ff = fakeFetch("2099-01-01T00:00:00+0000");
    const orig = ff.f;
    const f = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/v1/beneficiaries?")) {
        return new Response(JSON.stringify({
          items: [{ id: "ben-1", nickname: "two-key-smoke-supplier", transfer_methods: ["LOCAL"], beneficiary: { bank_details: { account_number: "SHOULD_NOT_LEAK" } } }],
        }), { status: 200 });
      }
      return orig(url, init);
    }) as typeof fetch;
    const c = createLiveClient(env, f);
    const rows = await c.listBeneficiaries("two-key-smoke-supplier");
    expect(rows).toEqual([{ id: "ben-1", nickname: "two-key-smoke-supplier", transfer_methods: ["LOCAL"] }]);
    expect(JSON.stringify(rows)).not.toContain("SHOULD_NOT_LEAK");
  });
});
