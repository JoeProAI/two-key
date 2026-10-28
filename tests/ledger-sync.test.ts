import { afterEach, describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/airwallex/mock";
import { runDemo } from "@/lib/scenario";
import { claimDecision } from "@/lib/ledger/claim";
import { MemoryLedger } from "@/lib/ledger/memory";
import { toIncidentArgs } from "@/lib/ledger/payload";
import { ledgerBackend, resetLedgerRemoteForTests, setLedgerApiForTests, setLedgerBackendForTests, syncIncident, takeRequestSlot } from "@/lib/ledger/remote";
import { stableRequestId } from "@/lib/requestId";

afterEach(() => {
  resetLedgerRemoteForTests();
});

describe("ledger backend", () => {
  it("uses memory unless both the deployment URL and the ingest secret are set", () => {
    const env = (partial: Record<string, string | undefined>) => partial as unknown as NodeJS.ProcessEnv;
    expect(ledgerBackend(env({}))).toBe("memory");
    expect(ledgerBackend(env({ CONVEX_URL: "https://example.convex.cloud" }))).toBe("memory");
    expect(ledgerBackend(env({ TWO_KEY_INGEST_SECRET: "sek" }))).toBe("memory");
    expect(ledgerBackend(env({ CONVEX_URL: "https://example.convex.cloud", TWO_KEY_INGEST_SECRET: "sek" }))).toBe("convex");
    expect(ledgerBackend(env({ NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud", TWO_KEY_INGEST_SECRET: "sek" }))).toBe("convex");
  });

  it("maps a demo ledger onto incident args without dropping the receipt", async () => {
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe" });
    const args = toIncidentArgs(res.ledger, "sek");
    expect(args.secret).toBe("sek");
    expect(args.intent.key).toBe("intent_inv2291");
    expect(args.proposals.map((p) => p.round)).toEqual([1, 2]);
    expect(args.objections.some((o) => o.check === "double_payment" && o.severity === "block")).toBe(true);
    expect(args.receipts[0].lines.join("\n")).toMatch(/approved by joe/);
    const retry = stableRequestId("intent_inv2291", "retry_transfer", "0");
    expect(args.executions.some((e) => e.requestId === retry && e.result === "ok")).toBe(true);
  });

  it("syncs through the injected client only when the backend is convex", async () => {
    const ledger = new MemoryLedger();
    ledger.intents.push({ id: "intent_inv2291", title: "Pay once", createdAt: 1, status: "open" });
    const calls: Record<string, unknown>[] = [];
    setLedgerApiForTests({
      upsert: async (args) => {
        calls.push(args);
        return {};
      },
      claim: async () => ({ claimed: true }),
      finish: async () => ({}),
      load: async () => null,
    });
    expect(await syncIncident(ledger, {} as NodeJS.ProcessEnv)).toBe("memory");
    expect(calls).toHaveLength(0);
    setLedgerBackendForTests("convex");
    expect(await syncIncident(ledger, { TWO_KEY_INGEST_SECRET: "sek" } as unknown as NodeJS.ProcessEnv)).toBe("convex");
    expect(calls[0]).toMatchObject({ secret: "sek", intent: { key: "intent_inv2291" } });
  });
});

describe("execution claim", () => {
  it("holds ok and already_done, resumes claimed, and retries error", () => {
    expect(claimDecision(null)).toEqual({ claimed: true, resume: false });
    expect(claimDecision({ result: "ok" })).toEqual({ claimed: false, resume: false });
    expect(claimDecision({ result: "already_done" })).toEqual({ claimed: false, resume: false });
    expect(claimDecision({ result: "claimed" })).toEqual({ claimed: true, resume: true });
    expect(claimDecision({ result: "error" })).toEqual({ claimed: true, resume: false });
  });

  it("a taken slot sends nothing", async () => {
    setLedgerBackendForTests("convex");
    setLedgerApiForTests({
      upsert: async () => ({}),
      claim: async () => ({ claimed: false }),
      finish: async () => ({}),
      load: async () => null,
    });
    const awx = createMockClient();
    const res = await runDemo(awx, { approver: "joe" });
    expect(awx.calls.createTransfer).toBe(0);
    expect(awx.calls.createConversion).toBe(0);
    expect(awx.calls.createQuote).toBe(1);
    expect(res.executions.every((e) => e.result === "already_done")).toBe(true);
    expect(await takeRequestSlot({ decisionId: "d", requestId: "r", actionKind: "retry_transfer" })).toBe("taken");
  });
});
