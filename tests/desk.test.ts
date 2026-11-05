import { afterEach, describe, expect, it } from "vitest";
import { stableRequestId } from "@/lib/requestId";
import { approveSession, cleanApprover, getDeskView, openPlan, replaySession, resetDeskForTests } from "@/lib/desk/session";
import { resetLedgerRemoteForTests } from "@/lib/ledger/remote";
import { AirwallexError } from "@/lib/airwallex/types";
import type { createMockClient } from "@/lib/airwallex/mock";

type DeskStore = { __twoKeyDesk?: { session: { awx: ReturnType<typeof createMockClient> } | null } };
const deskAwx = () => (globalThis as DeskStore).__twoKeyDesk!.session!.awx;

const RETRY = stableRequestId("intent_inv2291", "retry_transfer", "0");

function failNextConversion(awx: ReturnType<typeof createMockClient>) {
  const orig = awx.createConversion.bind(awx);
  awx.createConversion = async (body) => {
    awx.createConversion = orig;
    awx.calls.createConversion += 1;
    void body;
    throw new AirwallexError("insufficient funds", 400, "balance_insufficient");
  };
}

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

  it("keeps a failed send recoverable instead of marking it paid", async () => {
    await openPlan();
    failNextConversion(deskAwx());
    await approveSession("joe");
    const failed = await getDeskView();
    expect(failed.phase).toBe("failed");
    expect(failed.receipt).toBeNull();
    expect(failed.transfersCreated).toBe(0);
    expect(failed.conversionsCreated).toBe(1);
    expect(failed.error).toMatch(/FX conversion failed: insufficient funds/);
    expect(failed.error).not.toContain("\u2014");
    expect(failed.keyReason).toMatch(/Nothing is marked paid/);
    expect(failed.canApprove).toBe(true);
    expect(failed.canPlan).toBe(true);
    expect(failed.canReplay).toBe(false);

    await approveSession("joe");
    const paid = await getDeskView();
    expect(paid.phase).toBe("paid");
    expect(paid.error).toBeNull();
    expect(paid.transfersCreated).toBe(1);
    expect(paid.receipt?.join("\n")).toMatch(/retry_transfer request_id=.*: ok/);
  });

  it("can replan after a failed send", async () => {
    await openPlan();
    failNextConversion(deskAwx());
    await approveSession("joe");
    expect((await getDeskView()).phase).toBe("failed");
    await openPlan();
    const replanned = await getDeskView();
    expect(replanned.phase).toBe("review");
    expect(replanned.canApprove).toBe(true);
    expect(replanned.rounds.at(-1)?.decision).toBe("awaiting_human");
  });

  it("refuses a tap after the cash evidence changes", async () => {
    await openPlan();
    const usd = deskAwx().balances.find((b) => b.currency === "USD")!;
    usd.available_amount += 1;
    await expect(approveSession("joe")).rejects.toThrow(/Evidence changed/);
    const view = await getDeskView();
    expect(view.phase).toBe("review");
    expect(view.transfersCreated).toBe(0);
    expect(view.conversionsCreated).toBe(0);
    expect(view.receipt).toBeNull();
  });

  it("cleans the approver down to a short name", () => {
    expect(cleanApprover("  joe  ")).toBe("joe");
    expect(cleanApprover("a".repeat(80))).toHaveLength(40);
    expect(cleanApprover("!!!")).toBe("joe");
  });
});
