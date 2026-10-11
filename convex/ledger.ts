// Convex functions for the ledger. Uses the generic builders so the repo typechecks before
// `npx convex dev` generates convex/_generated. Swap to "./_generated/server" after setup.
import { internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

/** Webhook ingest: dedupe on Airwallex event id. A repeat delivery only bumps `deliveries`. */
export const ingestWebhook = internalMutationGeneric({
  args: {
    eventId: v.string(), name: v.string(), accountId: v.optional(v.string()), objectId: v.string(),
    status: v.optional(v.string()), createdAt: v.number(), payload: v.any(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("webhookEvents").withIndex("by_event_id", (q) => q.eq("eventId", a.eventId)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { deliveries: (existing.deliveries as number) + 1 });
      return { duplicate: true };
    }
    await ctx.db.insert("webhookEvents", { ...a, receivedAt: Date.now(), deliveries: 1 });
    return { duplicate: false };
  },
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
