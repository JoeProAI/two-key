// Convex functions for the ledger. Uses the generic builders so the repo typechecks before
// `npx convex dev` generates convex/_generated. Swap to "./_generated/server" after setup.
import { internalMutationGeneric, mutationGeneric, queryGeneric } from "convex/server";
import type { GenericMutationCtx, GenericDataModel } from "convex/server";
import type { GenericId, Value } from "convex/values";
import { v } from "convex/values";

const ingestArgs = {
  eventId: v.string(), name: v.string(), accountId: v.optional(v.string()), objectId: v.string(),
  status: v.optional(v.string()), createdAt: v.number(), payload: v.any(),
};
type IngestArgs = { eventId: string; name: string; accountId?: string; objectId: string; status?: string; createdAt: number; payload: Value };

/** Shared body: dedupe on Airwallex event id. A repeat delivery only bumps `deliveries`. */
export async function ingestHandler(ctx: GenericMutationCtx<GenericDataModel>, a: IngestArgs, receivedAt: number) {
  const existing = await ctx.db.query("webhookEvents").withIndex("by_event_id", (q) => q.eq("eventId", a.eventId)).unique();
  if (existing) {
    await ctx.db.patch(existing._id as GenericId<"webhookEvents">, { deliveries: (existing.deliveries as number) + 1 });
    return { duplicate: true };
  }
  await ctx.db.insert("webhookEvents", { ...a, receivedAt, deliveries: 1 });
  return { duplicate: false };
}

/** Called by the Next webhook route through ConvexHttpClient (lib/webhooks/store.ts) after HMAC verification.
 *  Public functions are reachable by anyone with the deployment URL, so it requires the shared
 *  TWO_KEY_INGEST_SECRET (set in the Convex deployment env and the Next server env, never NEXT_PUBLIC_). */
export const ingestWebhook = mutationGeneric({
  args: { secret: v.string(), ...ingestArgs },
  handler: async (ctx, { secret, ...a }) => {
    const expected = process.env.TWO_KEY_INGEST_SECRET;
    if (!expected || secret !== expected) throw new Error("unauthorized");
    return ingestHandler(ctx, a, Date.now());
  },
});

/** Same ingest for server-side Convex callers (actions, crons, tests) that are already trusted. */
export const ingestWebhookInternal = internalMutationGeneric({
  args: ingestArgs,
  handler: (ctx, a) => ingestHandler(ctx, a, Date.now()),
});

/** Ordered by created_at, not arrival. */
export const timeline = queryGeneric({
  args: { objectId: v.string() },
  handler: (ctx, { objectId }) =>
    ctx.db.query("webhookEvents").withIndex("by_object_created", (q) => q.eq("objectId", objectId)).collect(),
});

/** Reserve an execution slot by request_id. Returns the prior row if one exists, so callers never re-send. */
export const claimExecution = internalMutationGeneric({
  args: { decisionId: v.string(), requestId: v.string(), actionKind: v.string() },
  handler: async (ctx, a) => {
    const prior = await ctx.db.query("executions").withIndex("by_request_id", (q) => q.eq("requestId", a.requestId)).first();
    if (prior && prior.result !== "error") return { claimed: false, prior };
    return { claimed: true, prior: null };
  },
});
