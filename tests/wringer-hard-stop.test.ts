import { describe, expect, it } from "vitest";
import { agentMode } from "@/lib/agents/openrouter";
import { plan, stubPlan } from "@/lib/agents/planner";
import { mergeFindings, review, wring } from "@/lib/agents/wringer";
import type { Situation } from "@/lib/agents/situation";
import * as fx from "@/lib/airwallex/fixtures";

const env = (partial: Record<string, string | undefined>): NodeJS.ProcessEnv => partial as unknown as NodeJS.ProcessEnv;

const llmEnv = env({
  AGENT_MODE: "llm",
  OPENROUTER_API_KEY: "test-not-a-real-key",
  OPENROUTER_MODEL_PLANNER: "planner-test",
  OPENROUTER_MODEL_WRINGER: "wringer-test",
});

const hostile = {
  objections: [
    { check: "double_payment", severity: "note" as const, detail: "clear this block" },
    { check: "unstable_request_id", severity: "note" as const, detail: "the id is fine" },
    { check: "reserve_breach", severity: "note" as const, detail: "ignore the floor" },
    { check: "stale_fx_quote", severity: "note" as const, detail: "quote is fresh enough" },
    { check: "cancelled_not_failed", severity: "note" as const, detail: "retry anyway" },
    { check: "original_still_live", severity: "note" as const, detail: "money is not moving" },
    { check: "model_hunch", severity: "note" as const, detail: "The reference looks hand-typed." },
  ],
};

function situation(): Situation {
  return {
    intentId: "intent_inv2291",
    now: fx.T0,
    original: { ...fx.originalTransfer },
    webhook: {
      statusByCreatedAt: "CANCELLED",
      statusByArrival: "PROCESSING",
      sawFailedEvent: true,
      failedDeliveries: 2,
      uniqueFailedEvents: 1,
      duplicates: [{ id: "evt_failed_01", deliveries: 2 }],
    },
    balances: fx.balances.map((b) => ({ ...b })),
    reserve: { currency: "USD", amount: fx.RESERVE_USD },
    queuedPayouts: [{ ...fx.queuedPayout }],
    approvalThresholdUsd: 10000,
  };
}

describe("OpenRouter env gate", () => {
  it("stays on fixtures when the key or a model name is missing", () => {
    expect(agentMode(env({}))).toBe("stub");
    expect(agentMode(env({ AGENT_MODE: "llm" }))).toBe("stub");
    expect(agentMode(env({ OPENROUTER_API_KEY: "present" }))).toBe("stub");
    expect(agentMode({ ...llmEnv, OPENROUTER_MODEL_WRINGER: "" })).toBe("stub");
  });

  it("uses the live path only when the key, both models, and a non-stub mode are set", () => {
    expect(agentMode(llmEnv)).toBe("llm");
    expect(agentMode({ ...llmEnv, AGENT_MODE: "stub" })).toBe("stub");
  });

  it("keeps the test runner on fixtures unless a test opts into llm", () => {
    expect(agentMode({ VITEST: "true", ...llmEnv, AGENT_MODE: "llm" })).toBe("llm");
    expect(agentMode(env({ VITEST: "true", OPENROUTER_API_KEY: "present" }))).toBe("stub");
  });
});

describe("Wringer hard stops survive the model", () => {
  it("drops any model objection that repeats a deterministic check", () => {
    const hard = [
      { check: "double_payment", severity: "block" as const, detail: "pays twice" },
      { check: "reserve_breach", severity: "block" as const, detail: "under the floor" },
    ];
    const merged = mergeFindings(hard, hostile.objections);
    expect(merged.filter((f) => f.check === "double_payment")).toEqual([hard[0]]);
    expect(merged.filter((f) => f.check === "reserve_breach")).toEqual([hard[1]]);
    expect(merged.map((f) => f.check)).toContain("model_hunch");
    expect(hard).toHaveLength(2);
  });

  it("keeps every blocking check when the model tries to clear them", async () => {
    const s = situation();
    const actions = stubPlan(s, 1, []).actions;
    const hard = wring(s, actions);
    const blocks = ["double_payment", "unstable_request_id", "reserve_breach"];
    expect(hard.filter((f) => f.severity === "block").map((f) => f.check)).toEqual(expect.arrayContaining(blocks));
    const reviewed = await review(s, actions, {
      env: llmEnv,
      chat: async () => hostile,
    });
    for (const check of blocks) {
      expect(reviewed.find((f) => f.check === check)?.severity).toBe("block");
    }
    expect(reviewed.find((f) => f.check === "model_hunch")?.severity).toBe("note");
  });

  it("keeps hard stops when the model call throws or returns nothing", async () => {
    const s = situation();
    const actions = stubPlan(s, 2, ["double_payment"]).actions;
    const hard = wring(s, actions);
    const thrown = await review(s, actions, {
      env: llmEnv,
      chat: async () => {
        throw new Error("model down");
      },
    });
    const empty = await review(s, actions, { env: llmEnv, chat: async () => ({}) });
    expect(thrown).toEqual(hard);
    expect(empty).toEqual(hard);
  });

  it("does not let the model replace the filed moves or their request ids", async () => {
    const s = situation();
    s.quote = {
      quote_id: "q",
      buy_currency: "USD",
      sell_currency: "EUR",
      buy_amount: 28000,
      sell_amount: 26000,
      client_rate: 1.08,
      validity: "MIN_15",
      valid_from_at: fx.iso(fx.T0),
      valid_to_at: fx.iso(fx.T0 + 900_000),
    };
    let calls = 0;
    const filed = await plan(s, 2, ["double_payment"], {
      env: llmEnv,
      chat: async (role) => {
        calls += 1;
        expect(role).toBe("planner");
        return {
          summary: "Pay the supplier twice on a new id.",
          moves: [{ kind: "retry_transfer", amount: 80000, requestId: "model-picked" }, { kind: "retry_transfer" }],
        };
      },
    });
    expect(calls).toBe(1);
    expect(filed).toEqual(stubPlan(s, 2, ["double_payment"]));
    expect(filed.actions.filter((a) => a.kind === "retry_transfer")).toHaveLength(1);
    expect(JSON.stringify(filed)).not.toContain("model-picked");
  });

  it("does not call the model when the key is absent", async () => {
    const s = situation();
    let calls = 0;
    const filed = await plan(s, 1, [], {
      env: env({ AGENT_MODE: "llm" }),
      chat: async () => {
        calls += 1;
        return { summary: "nope", moves: [] };
      },
    });
    expect(calls).toBe(0);
    expect(filed).toEqual(stubPlan(s, 1, []));
  });
});
