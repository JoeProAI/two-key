import { afterEach, describe, expect, it } from "vitest";
import { approveSession, getDeskView, openPlan, resetDeskForTests } from "@/lib/desk/session";
import { resetLedgerRemoteForTests, setLedgerApiForTests, setLedgerBackendForTests } from "@/lib/ledger/remote";
import type { RemoteIncident } from "@/lib/ledger/payload";

/** Stands in for Convex: keeps the last upsert and serves it back from getIncident. */
function fakeConvex() {
  let stored: RemoteIncident | null = null;
  setLedgerBackendForTests("convex");
  setLedgerApiForTests({
    upsert: async (args) => {
      const { secret: _secret, ...rest } = args as Record<string, unknown>;
      void _secret;
      stored = structuredClone(rest) as unknown as RemoteIncident;
      return {};
    },
    claim: async () => ({ claimed: true }),
    finish: async () => ({}),
    load: async () => structuredClone(stored),
  });
  return { stored: () => stored };
}

const restart = () => resetDeskForTests();

afterEach(() => {
  resetDeskForTests();
  resetLedgerRemoteForTests();
});

describe("a pending decision survives a restart", () => {
  it("hydrates the awaiting_human decision and can still pay once", async () => {
    const convex = fakeConvex();
    await openPlan();
    expect(convex.stored()?.decisions.some((d) => d.status === "awaiting_human")).toBe(true);

    restart();
    const view = await getDeskView();
    expect(view.phase).toBe("review");
    expect(view.canApprove).toBe(true);
    expect(view.warning).toMatch(/Restored from the ledger/);
    expect(view.rounds.at(-1)?.decision).toBe("awaiting_human");

    await approveSession("joe");
    const paid = await getDeskView();
    expect(paid.phase).toBe("paid");
    expect(paid.error).toBeNull();
    expect(paid.transfersCreated).toBe(1);
    expect(paid.conversionsCreated).toBe(1);
    expect(convex.stored()?.receipts).toHaveLength(1);
  });

  it("approve after a restart without a page load still finds the decision", async () => {
    fakeConvex();
    await openPlan();
    restart();
    await approveSession("joe");
    expect((await getDeskView()).phase).toBe("paid");
  });

  it("an incident with nothing pending is read only and offers a fresh plan", async () => {
    const convex = fakeConvex();
    await openPlan();
    for (const d of convex.stored()!.decisions) if (d.status === "awaiting_human") d.status = "expired";
    restart();
    const view = await getDeskView();
    expect(view.canApprove).toBe(false);
    expect(view.canPlan).toBe(true);
    expect(view.warning).toMatch(/Nothing here is waiting for a tap/);
  });
});
