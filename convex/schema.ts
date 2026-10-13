import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Two-Key ledger. Every proposal, objection, decision, Airwallex response and webhook is stored.
const action = v.union(
  v.object({ kind: v.literal("retry_transfer"), originalTransferId: v.string(), amount: v.number(), currency: v.string(), beneficiaryId: v.string(), reference: v.string(), requestId: v.string() }),
  v.object({ kind: v.literal("fx_conversion"), buyCurrency: v.string(), sellCurrency: v.string(), buyAmount: v.number(), quoteId: v.string(), quoteValidToAt: v.string(), requestId: v.string() }),
  v.object({ kind: v.literal("defer_payout"), payoutId: v.string(), amount: v.number(), currency: v.string(), until: v.string() }),
);

export default defineSchema({
  intents: defineTable({
    title: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved"), v.literal("blocked")),
  }),
  proposals: defineTable({
    intentId: v.id("intents"),
    round: v.number(),
    author: v.literal("planner"),
    summary: v.string(),
    actions: v.array(action),
  }).index("by_intent", ["intentId", "round"]),
  objections: defineTable({
    proposalId: v.id("proposals"),
    author: v.literal("wringer"),
    check: v.string(),
    severity: v.union(v.literal("block"), v.literal("note")),
    detail: v.string(),
  }).index("by_proposal", ["proposalId"]),
  decisions: defineTable({
    proposalId: v.id("proposals"),
    plannerAgrees: v.boolean(),
    wringerAgrees: v.boolean(),
    needsHuman: v.boolean(),
    humanApprovedBy: v.optional(v.string()),
    humanApprovedAt: v.optional(v.number()),
    expiredAt: v.optional(v.number()),
    status: v.union(v.literal("blocked"), v.literal("awaiting_human"), v.literal("approved"), v.literal("expired")),
  }).index("by_proposal", ["proposalId"]),
  executions: defineTable({
    decisionId: v.id("decisions"),
    requestId: v.string(), // stable per intent+action; unique
    actionKind: v.string(),
    result: v.union(v.literal("ok"), v.literal("already_done"), v.literal("error")),
    airwallexId: v.optional(v.string()),
    response: v.any(),
  }).index("by_request_id", ["requestId"]),
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
    intentId: v.id("intents"),
    lines: v.array(v.string()),
  }).index("by_intent", ["intentId"]),
});
