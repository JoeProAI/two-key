import { afterEach, describe, expect, it } from "vitest";
import type { GenericDataModel, GenericMutationCtx } from "convex/server";
import { claimHandler, finishHandler } from "@/convex/ledger";
import { CLAIM_LEASE_MS, finishDecision } from "@/lib/ledger/claim";
import { createMockClient } from "@/lib/airwallex/mock";
import { resetLedgerRemoteForTests, setLedgerApiForTests, setLedgerBackendForTests } from "@/lib/ledger/remote";
import { runDemo } from "@/lib/scenario";

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

afterEach(() => resetLedgerRemoteForTests());

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
    expect(finishDecision({ result: "already_done" }, { result: "claimed", owner: "A" })).toBe("keep");
    expect(finishDecision({ result: "claimed", owner: "A" }, { result: "error" })).toBe("keep");
    expect(finishDecision(null, { result: "ok" })).toBe("insert");
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
