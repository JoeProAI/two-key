import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Desk } from "@/app/desk";
import { getDeskView, openPlan, resetDeskForTests } from "@/lib/desk/session";
import { resetLedgerRemoteForTests } from "@/lib/ledger/remote";

afterEach(() => {
  resetDeskForTests();
  resetLedgerRemoteForTests();
});

describe("desk order", () => {
  it("approval control follows the bound terms in DOM order", async () => {
    await openPlan();
    const html = renderToStaticMarkup(createElement(Desk, { view: await getDeskView() }));
    const terms = html.indexOf('id="authorization"');
    const amount = html.indexOf('class="figures"');
    const approve = html.search(/name="approver"/);
    const plate = html.indexOf('class="plate"');
    expect(amount).toBeGreaterThan(-1);
    expect(amount).toBeLessThan(plate);
    expect(terms).toBeGreaterThan(-1);
    expect(approve).toBeGreaterThan(terms);
    for (const label of ["Plan round", "Destination", "Amount"]) {
      const at = html.indexOf(label);
      if (at > -1) expect(at).toBeLessThan(approve);
    }
    expect(html).toContain("MOCK");
    expect(html).toContain('id="airwallex"');
    expect(html).toContain("did not call Airwallex");
  });
});
