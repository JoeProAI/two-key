import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from "convex/server";
import * as ledger from "@/convex/ledger";
import {
  claimExecutionPublic,
  finishExecution,
  getIncident,
  ingestWebhook,
  timeline,
  upsertIncident,
} from "@/convex/ledger";

type AnyFn = { isPublic?: boolean; _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };

const SECRET = "boundary-test-secret";
const bomb = () => ({
  db: {
    query: () => { throw new Error("db read"); },
    insert: () => { throw new Error("db write"); },
    patch: () => { throw new Error("db write"); },
    delete: () => { throw new Error("db write"); },
  },
});

/** One table store. A read or write of the wrong shape fails the test by returning unexpected rows. */
function db() {
  const tables = new Map<string, Record<string, unknown>[]>();
  let n = 0;
  const rows = (table: string) => tables.get(table) ?? (tables.set(table, []), tables.get(table)!);
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_index: string, build: (q: { eq: (k: string, v: unknown) => unknown }) => unknown) => {
          const where: [string, unknown][] = [];
          const q = { eq: (k: string, v: unknown) => (where.push([k, v]), q) };
          build(q);
          const match = () => rows(table).filter((r) => where.every(([k, v]) => r[k] === v));
          return {
            first: async () => match()[0] ?? null,
            unique: async () => match()[0] ?? null,
            collect: async () => match(),
          };
        },
      }),
      insert: async (table: string, doc: Record<string, unknown>) => {
        const _id = `row_${++n}`;
        rows(table).push({ ...doc, _id });
        return _id;
      },
      patch: async () => { throw new Error("unexpected patch"); },
      delete: async () => { throw new Error("unexpected delete"); },
    },
  };
  return ctx as unknown as GenericMutationCtx<GenericDataModel> & GenericQueryCtx<GenericDataModel>;
}

const publicFns = {
  ingestWebhook: ingestWebhook as unknown as AnyFn,
  timeline: timeline as unknown as AnyFn,
  claimExecutionPublic: claimExecutionPublic as unknown as AnyFn,
  finishExecution: finishExecution as unknown as AnyFn,
  upsertIncident: upsertIncident as unknown as AnyFn,
  getIncident: getIncident as unknown as AnyFn,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public Convex ledger surface", () => {
  it("keeps internal callers off the public API and guards every public function", () => {
    const registered = Object.entries(ledger).filter(([, value]) => {
      const fn = value as unknown as AnyFn & { isInternal?: boolean };
      return Boolean(fn && (fn.isPublic || fn.isInternal));
    });
    const byName = Object.fromEntries(registered) as unknown as Record<string, AnyFn & { isInternal?: boolean }>;
    expect(Object.keys(byName).sort()).toEqual([
      "claimExecution",
      "claimExecutionPublic",
      "finishExecution",
      "getIncident",
      "ingestWebhook",
      "ingestWebhookInternal",
      "timeline",
      "upsertIncident",
    ]);
    expect(byName.claimExecution.isInternal).toBe(true);
    expect(byName.ingestWebhookInternal.isInternal).toBe(true);
    expect(byName.claimExecution.isPublic).toBeUndefined();
    for (const name of Object.keys(publicFns)) {
      expect(byName[name].isPublic, name).toBe(true);
      expect(byName[name].isInternal, name).toBeUndefined();
    }
  });

  it("a wrong secret fails before any database read or write", async () => {
    vi.stubEnv("TWO_KEY_INGEST_SECRET", SECRET);
    const ctx = bomb();
    const marker = "payload-must-stay-private";
    const calls: [string, Record<string, unknown>][] = [
      ["ingestWebhook", { secret: "guess", eventId: "evt_1", name: "payout.transfer.failed", objectId: "tr_guess", createdAt: 1, payload: { marker } }],
      ["timeline", { secret: "", objectId: "tr_guess" }],
      ["claimExecutionPublic", { secret: "guess", decisionId: "d", requestId: "req", actionKind: "retry_transfer", owner: "A" }],
      ["finishExecution", { secret: "guess", key: "e", decisionKey: "d", requestId: "req", actionKind: "retry_transfer", result: "ok", response: { marker }, createdAt: 1 }],
      ["upsertIncident", { secret: "guess", intent: { key: "intent_inv2291", title: "x", status: "open", createdAt: 1 } }],
      ["getIncident", { secret: "guess", intentKey: "intent_inv2291" }],
    ];
    for (const [name, args] of calls) {
      await expect(publicFns[name as keyof typeof publicFns]._handler(ctx, args), name).rejects.toThrow(/unauthorized/);
    }
  });

  it("an unset server secret also refuses, so a deployment without the secret stays closed", async () => {
    vi.stubEnv("TWO_KEY_INGEST_SECRET", "");
    await expect(publicFns.timeline._handler(bomb(), { secret: SECRET, objectId: "tr_guess" })).rejects.toThrow(/unauthorized/);
    await expect(publicFns.getIncident._handler(bomb(), { secret: SECRET, intentKey: "intent_inv2291" })).rejects.toThrow(/unauthorized/);
  });

  it("returns a webhook timeline only to the secret, and only for the requested object", async () => {
    vi.stubEnv("TWO_KEY_INGEST_SECRET", SECRET);
    const ctx = db();
    await publicFns.ingestWebhook._handler(ctx, {
      secret: SECRET,
      eventId: "evt_private",
      name: "payout.transfer.failed",
      objectId: "tr_private",
      createdAt: 20,
      payload: { beneficiary: "private-name", account: "000111" },
    });
    await publicFns.ingestWebhook._handler(ctx, {
      secret: SECRET,
      eventId: "evt_other",
      name: "payout.transfer.failed",
      objectId: "tr_other",
      createdAt: 10,
      payload: { beneficiary: "other-name" },
    });

    const rows = await publicFns.timeline._handler(ctx, { secret: SECRET, objectId: "tr_private" }) as { eventId: string; payload: { beneficiary: string } }[];
    expect(rows.map((r) => r.eventId)).toEqual(["evt_private"]);
    expect(rows[0].payload.beneficiary).toBe("private-name");
    const missed = await publicFns.timeline._handler(ctx, { secret: SECRET, objectId: "tr_guessed" }) as unknown[];
    expect(missed).toEqual([]);
    expect(JSON.stringify(missed)).not.toContain("private-name");
    expect(JSON.stringify(missed)).not.toContain("other-name");
  });
});
