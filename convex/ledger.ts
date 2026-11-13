// Convex functions for the ledger. Uses the generic builders so the repo typechecks before
// `npx convex dev` generates convex/_generated. Swap to "./_generated/server" after setup.
import { internalMutationGeneric, mutationGeneric, queryGeneric } from "convex/server";
import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from "convex/server";
import type { GenericId, Value } from "convex/values";
import { v } from "convex/values";
import { CLAIM_LEASE_MS, claimDecision, finishDecision } from "../lib/ledger/claim";

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

/** Ordered by created_at, not arrival. The payload is the Airwallex notification, so this is not a public read.
 *  Same TWO_KEY_INGEST_SECRET as the other public ledger functions. A wrong secret fails before the query. */
export async function timelineHandler(ctx: GenericQueryCtx<GenericDataModel>, objectId: string) {
  return ctx.db.query("webhookEvents").withIndex("by_object_created", (q) => q.eq("objectId", objectId)).collect();
}

export const timeline = queryGeneric({
  args: { secret: v.string(), objectId: v.string() },
  handler: async (ctx, { secret, objectId }) => {
    assertIngestSecret(secret);
    return timelineHandler(ctx, objectId);
  },
});

type ExecRow = { _id: GenericId<"executions">; result?: string; requestId?: string; owner?: string; leaseUntil?: number; replays?: number };

function priorOf(row: ExecRow | null) {
  return row ? { result: String(row.result), owner: row.owner, leaseUntil: row.leaseUntil } : null;
}

async function execByRequestId(ctx: GenericMutationCtx<GenericDataModel>, requestId: string) {
  return (await ctx.db.query("executions").withIndex("by_request_id", (q) => q.eq("requestId", requestId)).first()) as ExecRow | null;
}

function assertIngestSecret(secret: string) {
  const expected = process.env.TWO_KEY_INGEST_SECRET;
  if (!expected || secret !== expected) throw new Error("unauthorized");
}

/** Reserve an execution slot by request_id for one owner. Inserts or takes over a `claimed` row with a lease.
 *  A live claim held by another owner answers `busy`, so two workers never both reach Airwallex. */
export async function claimHandler(
  ctx: GenericMutationCtx<GenericDataModel>,
  a: { decisionId: string; requestId: string; actionKind: string; owner: string },
  now: number = Date.now(),
) {
  const prior = await execByRequestId(ctx, a.requestId);
  const decision = claimDecision(priorOf(prior), a.owner, now);
  if (!decision.claimed) return { claimed: false, reason: decision.reason };
  const doc = {
    key: a.requestId,
    decisionKey: a.decisionId,
    requestId: a.requestId,
    actionKind: a.actionKind,
    result: "claimed" as const,
    owner: a.owner,
    leaseUntil: now + CLAIM_LEASE_MS,
    response: { state: "claimed" },
    createdAt: now,
  };
  if (prior) {
    await ctx.db.patch(prior._id, doc);
    return { claimed: true, resume: decision.resume };
  }
  await ctx.db.insert("executions", doc);
  return { claimed: true, resume: false };
}

export const claimExecution = internalMutationGeneric({
  args: { decisionId: v.string(), requestId: v.string(), actionKind: v.string(), owner: v.string() },
  handler: (ctx, a) => claimHandler(ctx, a),
});

/** Same claim for the Next server (ConvexHttpClient). Guarded by TWO_KEY_INGEST_SECRET. */
export const claimExecutionPublic = mutationGeneric({
  args: { secret: v.string(), decisionId: v.string(), requestId: v.string(), actionKind: v.string(), owner: v.string() },
  handler: async (ctx, { secret, ...a }) => {
    assertIngestSecret(secret);
    // `now` is the server clock. A client cannot rewind a lease by passing a timestamp.
    return claimHandler(ctx, a);
  },
});

const finishArgs = {
  key: v.string(),
  decisionKey: v.string(),
  requestId: v.string(),
  actionKind: v.string(),
  result: v.union(v.literal("ok"), v.literal("already_done"), v.literal("error"), v.literal("claimed")),
  airwallexId: v.optional(v.string()),
  owner: v.optional(v.string()),
  response: v.any(),
  createdAt: v.number(),
};

type FinishArgs = {
  key: string; decisionKey: string; requestId: string; actionKind: string;
  result: "ok" | "already_done" | "error" | "claimed"; airwallexId?: string; owner?: string; response: Value; createdAt: number;
};

/** Write the outcome of a claimed slot. A finished ok / already_done row is not replaced, including by a
 *  later ok. Only the current owner of a claimed or error row may finish it. A replay bumps `replays`
 *  and leaves the stored result, response, and airwallexId. */
export async function finishHandler(ctx: GenericMutationCtx<GenericDataModel>, ex: FinishArgs) {
  const prior = await execByRequestId(ctx, ex.requestId);
  const verdict = finishDecision(priorOf(prior), ex);
  if (verdict === "keep") return { wrote: "kept" };
  if (verdict === "replay" && prior) {
    await ctx.db.patch(prior._id, { replays: (prior.replays ?? 0) + 1, lastReplayAt: ex.createdAt });
    return { wrote: "replay" };
  }
  if (verdict === "insert" || !prior) {
    await ctx.db.insert("executions", ex);
    return { wrote: "insert" };
  }
  await ctx.db.patch(prior._id, ex);
  return { wrote: "patch" };
}

export const finishExecution = mutationGeneric({
  args: { secret: v.string(), ...finishArgs },
  handler: async (ctx, { secret, ...ex }) => {
    assertIngestSecret(secret);
    return finishHandler(ctx, ex);
  },
});

const action = v.union(
  v.object({ kind: v.literal("retry_transfer"), originalTransferId: v.string(), amount: v.number(), currency: v.string(), beneficiaryId: v.string(), reference: v.string(), requestId: v.string() }),
  v.object({ kind: v.literal("fx_conversion"), buyCurrency: v.string(), sellCurrency: v.string(), buyAmount: v.number(), quoteId: v.string(), quoteValidToAt: v.string(), requestId: v.string() }),
  v.object({ kind: v.literal("defer_payout"), payoutId: v.string(), amount: v.number(), currency: v.string(), until: v.string() }),
  v.object({ kind: v.literal("correct_beneficiary"), beneficiaryId: v.string(), companyName: v.string(), accountName: v.string(), requestId: v.string() }),
);

/** Replace the narrative rows for one intent and upsert executions by request_id with the finish rules,
 *  so a replay synced as already_done never erases the original successful send. */
export const upsertIncident = mutationGeneric({
  args: {
    secret: v.string(),
    intent: v.object({
      key: v.string(),
      title: v.string(),
      status: v.union(v.literal("open"), v.literal("resolved"), v.literal("blocked")),
      createdAt: v.number(),
    }),
    proposals: v.array(v.object({
      key: v.string(), intentKey: v.string(), round: v.number(), author: v.literal("planner"), summary: v.string(), actions: v.array(action), createdAt: v.number(),
    })),
    objections: v.array(v.object({
      key: v.string(), proposalKey: v.string(), author: v.literal("wringer"), check: v.string(), severity: v.union(v.literal("block"), v.literal("note")), detail: v.string(), createdAt: v.number(),
    })),
    decisions: v.array(v.object({
      key: v.string(), proposalKey: v.string(), plannerAgrees: v.boolean(), wringerAgrees: v.boolean(), needsHuman: v.boolean(),
      humanApprovedBy: v.optional(v.string()), humanApprovedAt: v.optional(v.number()), expiredAt: v.optional(v.number()),
      boundDigest: v.optional(v.string()), evidenceDigest: v.optional(v.string()),
      status: v.union(v.literal("blocked"), v.literal("awaiting_human"), v.literal("approved"), v.literal("expired")), createdAt: v.number(),
    })),
    executions: v.array(v.object({
      key: v.string(), decisionKey: v.string(), requestId: v.string(), actionKind: v.string(),
      result: v.union(v.literal("ok"), v.literal("already_done"), v.literal("error")),
      airwallexId: v.optional(v.string()), response: v.any(), createdAt: v.number(),
    })),
    receipts: v.array(v.object({
      key: v.string(), intentKey: v.string(), lines: v.array(v.string()), createdAt: v.number(),
    })),
  },
  handler: async (ctx, { secret, intent, proposals, objections, decisions, executions, receipts }) => {
    assertIngestSecret(secret);
    const existingIntent = await ctx.db.query("intents").withIndex("by_key", (q) => q.eq("key", intent.key)).unique();
    if (existingIntent) await ctx.db.patch(existingIntent._id as GenericId<"intents">, intent);
    else await ctx.db.insert("intents", intent);

    const oldProposals = await ctx.db.query("proposals").withIndex("by_intent", (q) => q.eq("intentKey", intent.key)).collect();
    for (const p of oldProposals) {
      const pid = (p as { key: string }).key;
      for (const row of await ctx.db.query("objections").withIndex("by_proposal", (q) => q.eq("proposalKey", pid)).collect()) {
        await ctx.db.delete(row._id as GenericId<"objections">);
      }
      for (const row of await ctx.db.query("decisions").withIndex("by_proposal", (q) => q.eq("proposalKey", pid)).collect()) {
        await ctx.db.delete(row._id as GenericId<"decisions">);
      }
      await ctx.db.delete(p._id as GenericId<"proposals">);
    }
    for (const row of await ctx.db.query("receipts").withIndex("by_intent", (q) => q.eq("intentKey", intent.key)).collect()) {
      await ctx.db.delete(row._id as GenericId<"receipts">);
    }
    for (const row of proposals) await ctx.db.insert("proposals", row);
    for (const row of objections) await ctx.db.insert("objections", row);
    for (const row of decisions) await ctx.db.insert("decisions", row);
    for (const row of receipts) await ctx.db.insert("receipts", row);
    for (const ex of executions) await finishHandler(ctx, ex);
    return { intentKey: intent.key };
  },
});

/** Read one incident back. Secret-guarded so the deployment URL is not a public dump. */
export const getIncident = queryGeneric({
  args: { secret: v.string(), intentKey: v.string() },
  handler: async (ctx, { secret, intentKey }) => {
    assertIngestSecret(secret);
    const intent = await ctx.db.query("intents").withIndex("by_key", (q) => q.eq("key", intentKey)).unique();
    const proposals = await ctx.db.query("proposals").withIndex("by_intent", (q) => q.eq("intentKey", intentKey)).collect();
    const objections = [];
    const decisions = [];
    for (const p of proposals) {
      const pid = (p as { key: string }).key;
      objections.push(...await ctx.db.query("objections").withIndex("by_proposal", (q) => q.eq("proposalKey", pid)).collect());
      decisions.push(...await ctx.db.query("decisions").withIndex("by_proposal", (q) => q.eq("proposalKey", pid)).collect());
    }
    const executions = [];
    for (const p of proposals) {
      const actions = (p as { actions?: { requestId?: string; kind?: string; payoutId?: string }[] }).actions ?? [];
      for (const a of actions) {
        const requestId = a.kind === "defer_payout" ? `defer:${a.payoutId}` : a.requestId;
        if (!requestId) continue;
        const row = await ctx.db.query("executions").withIndex("by_request_id", (q) => q.eq("requestId", requestId)).first();
        if (row) executions.push(row);
      }
    }
    const receipts = await ctx.db.query("receipts").withIndex("by_intent", (q) => q.eq("intentKey", intentKey)).collect();
    if (!intent && proposals.length === 0 && receipts.length === 0) return null;
    return { intent, proposals, objections, decisions, executions, receipts };
  },
});
