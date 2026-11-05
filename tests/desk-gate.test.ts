import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const next = vi.hoisted(() => ({ jar: new Map<string, string>(), redirects: [] as string[] }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (next.jar.has(name) ? { name, value: next.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void next.jar.set(name, value),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => void next.redirects.push(to) }));

import { approveDesk, planDesk, replayDesk, unlockDesk } from "@/app/actions";
import { DESK_COOKIE, cookieUnlocks, gateState, unlockCookieFor } from "@/lib/desk/gate";
import { getDeskView, openPlan, resetDeskForTests } from "@/lib/desk/session";
import { resetLedgerRemoteForTests, setLedgerApiForTests, setLedgerBackendForTests } from "@/lib/ledger/remote";

const KEY = "test-desk-key";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const asJoe = { unlocked: true };

beforeEach(() => {
  next.jar.clear();
  next.redirects.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDeskForTests();
  resetLedgerRemoteForTests();
});

describe("desk key gate", () => {
  it("is open only for the fixture desk with no key and no Convex", () => {
    expect(gateState({ unlocked: false }, {} as NodeJS.ProcessEnv)).toBe("open");
    expect(gateState({ unlocked: false }, { DESK_APPROVE_SECRET: KEY } as unknown as NodeJS.ProcessEnv)).toBe("locked");
    expect(gateState({ unlocked: true }, { DESK_APPROVE_SECRET: KEY } as unknown as NodeJS.ProcessEnv)).toBe("unlocked");
    setLedgerBackendForTests("convex");
    expect(gateState({ unlocked: true }, {} as NodeJS.ProcessEnv)).toBe("unconfigured");
  });

  it("the cookie is an HMAC of the key, never the key", () => {
    const env = { DESK_APPROVE_SECRET: KEY } as unknown as NodeJS.ProcessEnv;
    const cookie = unlockCookieFor(KEY, env)!;
    expect(cookie).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie).not.toContain(KEY);
    expect(cookieUnlocks(cookie, env)).toBe(true);
    expect(unlockCookieFor("wrong", env)).toBeNull();
    expect(unlockCookieFor("", env)).toBeNull();
    expect(cookieUnlocks(cookie, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(cookieUnlocks(undefined, env)).toBe(false);
  });

  it("an anonymous caller cannot plan, pay, or replay through the server actions", async () => {
    vi.stubEnv("DESK_APPROVE_SECRET", KEY);
    await planDesk();
    expect((await getDeskView(asJoe)).phase).toBe("incident");

    await openPlan(asJoe);
    await approveDesk(form({ approver: "mallory" }));
    await replayDesk(form({ approver: "mallory" }));
    const joe = await getDeskView(asJoe);
    expect(joe.phase).toBe("review");
    expect(joe.transfersCreated).toBe(0);
    expect(joe.error).toBeNull();

    const anon = await getDeskView();
    expect(anon.locked).toBe(true);
    expect(anon.canUnlock).toBe(true);
    expect(anon.canApprove).toBe(false);
    expect(anon.rounds).toEqual([]);
    expect(anon.transfersCreated).toBeNull();
  });

  it("a wrong key sets no cookie; the right key unlocks approve", async () => {
    vi.stubEnv("DESK_APPROVE_SECRET", KEY);
    await unlockDesk(form({ deskKey: "guess" }));
    expect(next.jar.size).toBe(0);
    expect(next.redirects).toEqual(["/?desk=miss"]);
    expect((await getDeskView({ unlocked: false }, { keyMissed: true })).error).toBe("That desk key did not match.");

    await unlockDesk(form({ deskKey: KEY }));
    expect(next.jar.get(DESK_COOKIE)).toMatch(/^[0-9a-f]{64}$/);
    expect(next.redirects.at(-1)).toBe("/");

    await planDesk();
    await approveDesk(form({ approver: "joe" }));
    const paid = await getDeskView(asJoe);
    expect(paid.phase).toBe("paid");
    expect(paid.transfersCreated).toBe(1);
    expect(paid.rounds.at(-1)?.approvedBy).toBe("joe");
  });

  it("a Convex desk never reads the protected incident for an anonymous visitor", async () => {
    let loads = 0;
    setLedgerBackendForTests("convex");
    setLedgerApiForTests({
      upsert: async () => ({}),
      claim: async () => ({ claimed: true }),
      finish: async () => ({}),
      load: async () => {
        loads++;
        return null;
      },
    });

    const closed = await getDeskView();
    expect(closed.locked).toBe(true);
    expect(closed.canUnlock).toBe(false);
    expect(closed.lockNote).toMatch(/no desk key set/);
    await expect(openPlan(asJoe)).rejects.toThrow(/no desk key set/);

    vi.stubEnv("DESK_APPROVE_SECRET", KEY);
    expect((await getDeskView()).locked).toBe(true);
    expect(loads).toBe(0);
    expect((await getDeskView(asJoe)).locked).toBe(false);
    expect(loads).toBe(1);
  });

  it("no lock copy names the env var or uses an em dash", async () => {
    vi.stubEnv("DESK_APPROVE_SECRET", KEY);
    const locked = await getDeskView();
    const text = JSON.stringify(locked);
    expect(text).not.toContain("DESK_APPROVE_SECRET");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("\u2014");
  });
});
