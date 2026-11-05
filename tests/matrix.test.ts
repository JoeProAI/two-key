import { describe, expect, it } from "vitest";
import { matrixText, runMatrix } from "@/lib/matrix/run";

describe("failure matrix", () => {
  it("passes every deterministic case and keeps the transfer counts honest", async () => {
    const rows = await runMatrix();
    expect(rows.filter((r) => !r.pass).map((r) => r.id)).toEqual([]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["FAILED then CANCELLED"].transfersAfter).toBe(1);
    expect(byId["FAILED then CANCELLED"].conversionsAfter).toBe(1);
    expect(byId["replay after success"].transfersAfter).toBe(1);
    expect(byId["failed provider send"].transfersAfter).toBe(0);
    expect(byId["failed provider send"].balancesBefore).toEqual(byId["failed provider send"].balancesAfter);
    expect(byId["approval timeout"].transfersAfter).toBe(0);
    expect(byId["stale approval"].transfersAfter).toBe(0);
    expect(byId["partial completion"].balancesBefore).not.toEqual(byId["partial completion"].balancesAfter);
    expect(byId["deposit revises funding"].detail).toContain("fx buy 10000");
    expect(matrixText(rows)).toContain(`${rows.length} pass, 0 fail`);
  });
});
