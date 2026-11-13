import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Two-Key ledger. Every proposal, objection, decision, Airwallex response and webhook is stored.
// App ids are strings (`key`, `intentKey`, ...) so the Next server can upsert the in-memory ledger
// without a generated Convex id. Nothing here has been deployed yet; `npx convex dev` pushes this shape.
const action = v.union(
  v.object({ kind: v.literal("retry_transfer"), originalTransferId: v.string(), amount: v.number(), currency: v.string(), beneficiaryId: v.string(), reference: v.string(), requestId: v.string() }),
  v.object({ kind: v.literal("fx_conversion"), buyCurrency: v.string(), sellCurrency: v.string(), buyAmount: v.number(), quoteId: v.string(), quoteValidToAt: v.string(), requestId: v.string() }),
  v.object({ kind: v.literal("defer_payout"), payoutId: v.string(), amount: v.number(), currency: v.string(), until: v.string() }),
  v.object({ kind: v.literal("correct_beneficiary"), beneficiaryId: v.string(), companyName: v.string(), accountName: v.string(), requestId: v.string() }),
);

const decisionStatus = v.union(v.literal("blocked"), v.literal("awaiting_human"), v.literal("approved"), v.literal("expired"));
const executionResult = v.union(v.literal("ok"), v.literal("already_done"), v.literal("error"), v.literal("claimed"));

export default defineSchema({
  intents: defineTable({
    key: v.string(),
    title: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved"), v.literal("blocked")),
    createdAt: v.number(),
  }).index("by_key", ["key"]),
  proposals: defineTable({
    key: v.string(),
    intentKey: v.string(),
    round: v.number(),
    author: v.literal("planner"),
    summary: v.string(),
    actions: v.array(action),
    createdAt: v.number(),
  }).index("by_key", ["key"]).index("by_intent", ["intentKey", "round"]),
  objections: defineTable({
    key: v.string(),
    proposalKey: v.string(),
    author: v.literal("wringer"),
    check: v.string(),
    severity: v.union(v.literal("block"), v.literal("note")),
    detail: v.string(),
    createdAt: v.number(),
  }).index("by_key", ["key"]).index("by_proposal", ["proposalKey"]),
  decisions: defineTable({
    key: v.string(),
    proposalKey: v.string(),
    plannerAgrees: v.boolean(),
    wringerAgrees: v.boolean(),
    needsHuman: v.boolean(),
    humanApprovedBy: v.optional(v.string()),
    humanApprovedAt: v.optional(v.number()),
    expiredAt: v.optional(v.number()),
    boundDigest: v.optional(v.string()),
    evidenceDigest: v.optional(v.string()),
    status: decisionStatus,
    createdAt: v.number(),
  }).index("by_key", ["key"]).index("by_proposal", ["proposalKey"]),
  executions: defineTable({
    key: v.string(),
    decisionKey: v.string(),
    requestId: v.string(), // stable per intent+action; unique
    actionKind: v.string(),
    result: executionResult,
    airwallexId: v.optional(v.string()),
    owner: v.optional(v.string()), // worker that holds a `claimed` row
    leaseUntil: v.optional(v.number()), // a `claimed` row older than this may be taken over after a request_id lookup
    replays: v.optional(v.number()), // replays that found this request_id already done; the original result stays
    lastReplayAt: v.optional(v.number()),
    response: v.any(),
    createdAt: v.number(),
  }).index("by_key", ["key"]).index("by_request_id", ["requestId"]),
  webhookEvents: defineTable({
    eventId: v.string(), // Airwallex event `id`; dedupe key
    name: v.string(), // e.g. payout.transfer.failed
    accountId: v.optional(v.string()),
    objectId: v.string(), // data.object.id
    status: v.optional(v.string()),
    createdAt: v.number(), // parsed event created_at; ordering key
    receivedAt: v.number(),
    deliveries: v.number(),
    payload: v.any(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_object_created", ["objectId", "createdAt"]),
  receipts: defineTable({
    key: v.string(),
    intentKey: v.string(),
    lines: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_key", ["key"]).index("by_intent", ["intentKey"]),
});
