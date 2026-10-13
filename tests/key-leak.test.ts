import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createLiveClient } from "@/lib/airwallex/live";

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const src = ["app", "lib", "convex"].flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f));

describe("Airwallex keys stay on the server", () => {
  it("only lib/airwallex/live.ts reads the key env vars", () => {
    const readers = src.filter((f) => /AIRWALLEX_(API_KEY|CLIENT_ID)/.test(readFileSync(f, "utf8")));
    expect(readers).toEqual(["lib/airwallex/live.ts"]);
  });
  it("secret-touching modules import server-only", () => {
    for (const f of ["lib/airwallex/live.ts", "lib/airwallex/index.ts", "lib/agents/openrouter.ts"]) {
      expect(readFileSync(f, "utf8")).toMatch(/^import "server-only";/);
    }
  });
  it("no client component imports Airwallex, OpenRouter, or the agents", () => {
    for (const f of src) {
      const t = readFileSync(f, "utf8");
      if (/^["']use client["']/m.test(t)) expect(t).not.toMatch(/airwallex|openrouter|agents|scenario/i);
    }
  });
  it("no NEXT_PUBLIC_ secret names anywhere", () => {
    for (const f of src) expect(readFileSync(f, "utf8")).not.toMatch(/NEXT_PUBLIC_(AIRWALLEX|OPENROUTER|TWO_KEY)/);
  });
  it("errors and requests never echo the key", async () => {
    const seen: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push(String(url));
      const h = (init?.headers ?? {}) as Record<string, string>;
      if (String(url).endsWith("/authentication/login")) {
        expect(h["x-api-key"]).toBe("SECRET_KEY_123");
        return new Response(JSON.stringify({ token: "tok", expires_at: "2099-01-01T00:00:00+0000" }), { status: 201 });
      }
      expect(JSON.stringify(h)).not.toContain("SECRET_KEY_123");
      return new Response(JSON.stringify({ code: "boom" }), { status: 500 });
    }) as typeof fetch;
    const c = createLiveClient({ AIRWALLEX_CLIENT_ID: "cid", AIRWALLEX_API_KEY: "SECRET_KEY_123" } as unknown as NodeJS.ProcessEnv, fake);
    const err = await c.getBalances().catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("SECRET_KEY_123");
    expect(seen.every((u) => !u.includes("SECRET_KEY_123"))).toBe(true);
  });
});
