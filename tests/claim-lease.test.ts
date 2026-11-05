import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenericDataModel, GenericMutationCtx } from "convex/server";
import { claimHandler, finishHandler } from "@/convex/ledger";
import { CLAIM_LEASE_MS, finishDecision } from "@/lib/ledger/claim";
import { createMockClient } from "@/lib/airwallex/mock";
import { resetLedgerRemoteForTests, setLedgerApiForTests, setLedgerBackendForTests } from "@/lib/ledger/remote";
import { runDemo } from "@/lib/scenario";
import { stableRequestId } from "@/lib/requestId";
import { approveSession, openPlan, replaySession, resetDeskForTests } from "@/lib/desk/session";

type Row = Record<string, unknown> & { _id: string };

/** Just enough of ctx.db for the executions table: one eq() per index lookup. */
function fakeCtx() {
  const rows: Row[] = [];
  let n = 0;
  const db = {
    query: () => ({
      withIndex: (_index: string, build: (q: { eq: (k: string, v: unknown) => unknown }) => unknown) => {
        const where: [string, unknown][] = [];
        const q = { eq: (k: string, v: unknown) => (where.push([k, v]), q) };
        build(q);
        const match = () => rows.filter((r) => where.every(([k, v]) => r[k] === v));
        return { first: async () => match()[0] ?? null, unique: async () => match()[0] ?? null, collect: async () => match() };
      },
    }),
    insert: async (_table: string, doc: Record<string, unknown>) => {
      const _id = `row_${++n}`;
      rows.push({ ...doc, _id });
      return _id;
    },
    patch: async (id: string, doc: Record<string, unknown>) => {
      Object.assign(rows.find((r) => r._id === id)!, doc);
    },
  };
  return { ctx: { db } as unknown as GenericMutationCtx<GenericDataModel>, rows };
}

const slot = { decisionId: "dec_1", requestId: "req_retry", actionKind: "retry_transfer" };
const finish = (result: "ok" | "error" | "already_done", owner: string, extra: Record<string, unknown> = {}) => ({
  key: "exe_1", decisionKey: "dec_1", requestId: "req_retry", actionKind: "retry_transfer", result, owner, response: { result }, createdAt: 1, ...extra,
});

const OPEN = { unlocked: true };

beforeEach(() => {
  vi.stubEnv("DESK_APPROVE_SECRET", "test-desk-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetLedgerRemoteForTests();
  resetDeskForTests();
});

describe("execution claim with an owner and a lease", () => {
  it("gives a second worker busy while the first holds a live claim", async () => {
    const { ctx, rows } = fakeCtx();
    expect(await claimHandler(ctx, { ...slot, owner: "A" }, 1_000)).toEqual({ claimed: true, resume: false });
    expect(await claimHandler(ctx, { ...slot, owner: "B" }, 1_500)).toEqual({ claimed: false, reason: "busy" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: "claimed", owner: "A", leaseUntil: 1_000 + CLAIM_LEASE_MS });
  });

  it("does not let the loser overwrite the winner's claim or success with an error", async () => {
    const { ctx, rows } = fakeCtx();
    await claimHandler(ctx, { ...slot, owner: "A" }, 1_000);
    expect(await finishHandler(ctx, finish("error", "B"))).toEqual({ wrote: "kept" });
    expect(rows[0]).toMatchObject({ result: "claimed", owner: "A" });
    expect(await finishHandler(ctx, finish("ok", "A", { airwallexId: "tr_1" }))).toEqual({ wrote: "patch" });
    expect(await finishHandler(ctx, finish("error", "B"))).toEqual({ wrote: "kept" });
    expect(rows[0]).toMatchObject({ result: "ok", airwallexId: "tr_1" });
  });

  it("lets the owner record its own error, and a new claim retry it", async () => {
    const { ctx, rows } = fakeCtx();
    await claimHandler(ctx, { ...slot, owner: "A" }, 1_000);
    expect(await finishHandler(ctx, finish("error", "A"))).toEqual({ wrote: "patch" });
    expect(await claimHandler(ctx, { ...slot, owner: "B" }, 1_100)).toEqual({ claimed: true, resume: false });
    expect(rows[0]).toMatchObject({ result: "claimed", owner: "B" });
  });

  it("takes over an expired claim only after the lease runs out", async () => {
    const { ctx, rows } = fakeCtx();
    await claimHandler(ctx, { ...slot, owner: "A" }, 1_000);
    expect(await claimHandler(ctx, { ...slot, owner: "B" }, 1_000 + CLAIM_LEASE_MS - 1)).toMatchObject({ claimed: false });
    expect(await claimHandler(ctx, { ...slot, owner: "B" }, 1_000 + CLAIM_LEASE_MS)).toEqual({ claimed: true, resume: true });
    expect(rows[0]).toMatchObject({ owner: "B", leaseUntil: 1_000 + 2 * CLAIM_LEASE_MS });
    expect(await finishHandler(ctx, finish("error", "A"))).toEqual({ wrote: "kept" });
  });

  it("never downgrades a finished success", () => {
    expect(finishDecision({ result: "ok" }, { result: "error", owner: "A" })).toBe("keep");
    expect(finishDecision({ result: "ok", owner: "A" }, { result: "ok", owner: "B" })).toBe("keep");
    expect(finishDecision({ result: "already_done" }, { result: "claimed", owner: "A" })).toBe("keep");
    expect(finishDecision({ result: "already_done", owner: "A" }, { result: "ok", owner: "A" })).toBe("keep");
    expect(finishDecision({ result: "claimed", owner: "A" }, { result: "error" })).toBe("keep");
    expect(finishDecision({ result: "claimed", owner: "B" }, { result: "ok", owner: "A" })).toBe("keep");
    expect(finishDecision(null, { result: "ok" })).toBe("insert");
  });

  it("renews the same owner's lease, and that owner can finish after the old lease time", async () => {
    const { ctx, rows } = fakeCtx();
    const t0 = 1_000;
    expect(await claimHandler(ctx, { ...slot, owner: "A" }, t0)).toEqual({ claimed: true, resume: false });
    expect(await claimHandler(ctx, { ...slot, owner: "A" }, t0 + 1_000)).toEqual({ claimed: true, resume: true });
    expect(rows[0]).toMatchObject({ owner: "A", leaseUntil: t0 + 1_000 + CLAIM_LEASE_MS });
    expect(await claimHandler(ctx, { ...slot, owner: "B" }, t0 + 1_000 + CLAIM_LEASE_MS - 1)).toEqual({ claimed: false, reason: "busy" });
    expect(await finishHandler(ctx, finish("ok", "A", { airwallexId: "tr_renewed", createdAt: t0 + CLAIM_LEASE_MS + 5 }))).toEqual({ wrote: "patch" });
    expect(rows[0]).toMatchObject({ result: "ok", owner: "A", airwallexId: "tr_renewed" });
  });

  it("lets the current owner finish after expiry when nobody has taken the row", async () => {
    const { ctx, rows } = fakeCtx();
    const t0 = 1_000;
    await claimHandler(ctx, { ...slot, owner: "A" }, t0);
    expect(await finishHandler(ctx, finish("ok", "A", { airwallexId: "tr_late_owner", createdAt: t0 + CLAIM_LEASE_MS + 1 }))).toEqual({ wrote: "patch" });
    expect(rows[0]).toMatchObject({ result: "ok", owner: "A", airwallexId: "tr_late_owner" });
  });

  it("drops a paused owner's late ok and error after takeover, then keeps the new owner's success", async () => {
    const { ctx, rows } = fakeCtx();
    const t0 = 1_000;
    expect(await claimHandler(ctx, { ...slot, owner: "A" }, t0)).toEqual({ claimed: true, resume: false });
    const expired = t0 + CLAIM_LEASE_MS;
    expect(await claimHandler(ctx, { ...slot, owner: "B" }, expired)).toEqual({ claimed: true, resume: true });
    expect(rows[0]).toMatchObject({ result: "claimed", owner: "B", leaseUntil: expired + CLAIM_LEASE_MS });

    expect(await finishHandler(ctx, finish("ok", "A", { airwallexId: "tr_stale", response: { id: "tr_stale" }, createdAt: expired + 10 }))).toEqual({ wrote: "kept" });
    expect(await finishHandler(ctx, finish("error", "A", { response: { message: "stale failure" }, createdAt: expired + 11 }))).toEqual({ wrote: "kept" });
    expect(rows[0]).toMatchObject({ result: "claimed", owner: "B", response: { state: "claimed" } });
    expect(rows[0].airwallexId).toBeUndefined();

    expect(await finishHandler(ctx, finish("ok", "B", { airwallexId: "tr_owner", response: { id: "tr_owner", status: "PROCESSING" }, createdAt: expired + 20 }))).toEqual({ wrote: "patch" });
    expect(await finishHandler(ctx, finish("error", "A", { createdAt: expired + 21 }))).toEqual({ wrote: "kept" });
    expect(await finishHandler(ctx, finish("ok", "C", { airwallexId: "tr_other", response: { id: "tr_other" }, createdAt: expired + 22 }))).toEqual({ wrote: "kept" });
    expect(await finishHandler(ctx, finish("already_done", "A", { airwallexId: "tr_replay", response: { ledger: "request_id already claimed" }, createdAt: expired + 30 }))).toEqual({ wrote: "replay" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      result: "ok",
      owner: "B",
      airwallexId: "tr_owner",
      response: { id: "tr_owner", status: "PROCESSING" },
      replays: 1,
      lastReplayAt: expired + 30,
    });
    expect(await claimHandler(ctx, { ...slot, owner: "C" }, expired + 40)).toEqual({ claimed: false, reason: "done" });
  });

  it("does not mark a send paid when the shared ledger keeps another outcome", async () => {
    setLedgerBackendForTests("convex");
    setLedgerApiForTests({
      upsert: async () => ({}),
      claim: async () => ({ claimed: true }),
      finish: async (args) => ({ wrote: args.actionKind === "retry_transfer" ? "kept" : "patch" }),
      load: async () => null,
    });
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe" });
    const transfer = res.executions.find((e) => e.actionKind === "retry_transfer");
    expect(awx.calls.createTransfer).toBe(1);
    expect(transfer?.result).toBe("error");
    expect(transfer?.airwallexId).toBeUndefined();
    expect(transfer?.response).toMatchObject({ message: expect.stringMatching(/another worker/i) });
    expect(res.executions.some((e) => e.actionKind === "retry_transfer" && e.result === "ok")).toBe(false);
  });

  it("a busy slot sends nothing and writes nothing back", async () => {
    const finished: Record<string, unknown>[] = [];
    const claims: Record<string, unknown>[] = [];
    setLedgerBackendForTests("convex");
    setLedgerApiForTests({
      upsert: async () => ({}),
      claim: async (args) => (claims.push(args), { claimed: false, reason: "busy" }),
      finish: async (args) => (finished.push(args), {}),
      load: async () => null,
    });
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe" });
    expect(awx.calls.createTransfer).toBe(0);
    expect(awx.calls.createConversion).toBe(0);
    expect(finished).toHaveLength(0);
    expect(claims[0]).toMatchObject({ owner: expect.any(String) });
    expect(res.executions).toHaveLength(1);
    expect(res.executions[0].result).toBe("error");
  });
});

describe("replay keeps the original successful execution", () => {
  it("does not replace ok with already_done", async () => {
    const { ctx, rows } = fakeCtx();
    await claimHandler(ctx, { ...slot, owner: "A" }, 1_000);
    await finishHandler(ctx, finish("ok", "A", { airwallexId: "tr_1", response: { id: "tr_1", status: "PROCESSING" } }));
    expect(await finishHandler(ctx, finish("already_done", "B", { response: { ledger: "request_id already claimed" } }))).toEqual({ wrote: "replay" });
    expect(await finishHandler(ctx, finish("ok", "C", { airwallexId: "tr_other" }))).toEqual({ wrote: "kept" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: "ok", airwallexId: "tr_1", response: { id: "tr_1", status: "PROCESSING" }, replays: 1 });
  });

  it("desk replay synced through Convex keeps both Airwallex ids", async () => {
    const { ctx, rows } = fakeCtx();
    const strip = (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).filter(([k]) => k !== "secret"));
    setLedgerBackendForTests("convex");
    setLedgerApiForTests({
      upsert: async (args) => {
        for (const ex of (args.executions as Record<string, unknown>[])) await finishHandler(ctx, ex as Parameters<typeof finishHandler>[1]);
        return {};
      },
      claim: async (args) => claimHandler(ctx, strip(args) as Parameters<typeof claimHandler>[1]),
      finish: async (args) => finishHandler(ctx, strip(args) as Parameters<typeof finishHandler>[1]),
      load: async () => null,
    });
    await openPlan(OPEN);
    await approveSession("joe", OPEN);
    const retry = stableRequestId("intent_inv2291", "retry_transfer", "0");
    const conversion = stableRequestId("intent_inv2291", "fx_conversion");
    const before = rows.filter((r) => r.result === "ok").map((r) => [r.requestId, r.airwallexId]);
    expect(before.map(([id]) => id)).toEqual(expect.arrayContaining([retry, conversion]));
    await replaySession("joe", OPEN);
    const after = rows.filter((r) => r.result === "ok").map((r) => [r.requestId, r.airwallexId]);
    expect(after).toEqual(before);
    expect(rows.find((r) => r.requestId === retry)).toMatchObject({ result: "ok", replays: expect.any(Number) });
  });
});
