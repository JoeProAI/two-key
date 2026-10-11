import { describe, expect, it } from "vitest";
import { createLiveClient } from "@/lib/airwallex/live";

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
  const env = { AIRWALLEX_CLIENT_ID: "c", AIRWALLEX_API_KEY: "k" } as NodeJS.ProcessEnv;
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
    expect(() => createLiveClient({} as NodeJS.ProcessEnv)).toThrow(/AIRWALLEX_CLIENT_ID/);
  });
});
