import { afterEach, describe, expect, it } from "vitest";
import { stableRequestId } from "@/lib/requestId";
import { approveSession, cleanApprover, getDeskView, openPlan, replaySession, resetDeskForTests } from "@/lib/desk/session";
import { resetLedgerRemoteForTests } from "@/lib/ledger/remote";

const RETRY = stableRequestId("intent_inv2291", "retry_transfer", "0");

afterEach(() => {
  resetDeskForTests();
  resetLedgerRemoteForTests();
});

describe("demo desk", () => {
  it("opens on the failed transfer, then plans, pays once, and replays without a second send", async () => {
    const opened = await getDeskView();
    expect(opened.phase).toBe("incident");
    expect(opened.canPlan).toBe(true);
    expect(opened.canApprove).toBe(false);
    expect(opened.status).toBe("CANCELLED");
    expect(opened.amount).toBe("40,000.00");
    expect(opened.webhooks.map((w) => w.flag)).toEqual(["", "Duplicate", "", "Late arrival"]);
    expect(opened.requestId).toBe(RETRY);
    expect(opened.receipt).toBeNull();

    await openPlan();
    const planned = await getDeskView();
    expect(planned.phase).toBe("review");
    expect(planned.plannerSeated).toBe(true);
    expect(planned.wringerSeated).toBe(true);
    expect(planned.canApprove).toBe(true);
    expect(planned.rounds[0].findings.filter((f) => f.severity === "block").map((f) => f.check)).toEqual(
      expect.arrayContaining(["double_payment", "unstable_request_id", "reserve_breach"]),
    );
    expect(planned.rounds[0].decision).toBe("blocked");
    expect(planned.rounds[1].decision).toBe("awaiting_human");
    expect(planned.rounds[1].actions.find((a) => a.kind === "Retry transfer")?.requestId).toBe(RETRY);
    expect(planned.transfersCreated).toBe(0);

    await approveSession("joe");
    const paid = await getDeskView();
    expect(paid.phase).toBe("paid");
    expect(paid.canApprove).toBe(false);
    expect(paid.canReplay).toBe(true);
    expect(paid.transfersCreated).toBe(1);
    expect(paid.conversionsCreated).toBe(1);
    expect(paid.balances.find((b) => b.currency === "USD")?.available).toBe("10,000.00");
    expect(paid.receipt?.join("\n")).toMatch(/approved by joe/);
    expect(paid.receipt?.join("\n")).toContain(RETRY);
    expect(paid.receipt?.join("\n")).toMatch(/BLOCK \[double_payment\]/);

    await approveSession("joe");
    expect((await getDeskView()).transfersCreated).toBe(1);

    await replaySession("joe");
    const replayed = await getDeskView();
    expect(replayed.replayed).toBe(true);
    expect(replayed.transfersCreated).toBe(1);
    expect(replayed.conversionsCreated).toBe(1);
    expect(replayed.receipt?.join("\n")).toMatch(/retry_transfer request_id=.*already_done/);
    expect(replayed.receipt?.join("\n")).toContain(RETRY);
  });

  it("cleans the approver down to a short name", () => {
    expect(cleanApprover("  joe  ")).toBe("joe");
    expect(cleanApprover("a".repeat(80))).toHaveLength(40);
    expect(cleanApprover("!!!")).toBe("joe");
  });
});
