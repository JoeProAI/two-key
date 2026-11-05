import { describe, expect, it, vi } from "vitest";
import { corridorStatus } from "@/lib/airwallex/corridor";
import { sandboxOrigin } from "@/lib/airwallex/live";

describe("sandbox corridor", () => {
  it("does not call the network and names the missing env when keys are absent", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const status = corridorStatus({} as unknown as NodeJS.ProcessEnv);
    expect(status.ran).toBe(false);
    expect(status.missing.length).toBeGreaterThan(0);
    expect(status.reason).toMatch(/No provider call/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refuses a production host", () => {
    expect(() => sandboxOrigin("https://api.airwallex.com")).toThrow(/Sandbox only/);
    const status = corridorStatus({ AIRWALLEX_BASE_URL: "https://api.airwallex.com" } as unknown as NodeJS.ProcessEnv);
    expect(status.ran).toBe(false);
    expect(status.host).toBeNull();
  });
});