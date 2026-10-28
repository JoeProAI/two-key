import { describe, expect, it } from "vitest";
import {
  fundingReady,
  sandboxBaseUrl,
  smokeBeneficiaryId,
  smokePassed,
  transferProofOk,
} from "@/scripts/live-smoke";

describe("live smoke pass rules", () => {
  it("requires the quote, the conversion, and the transfer", () => {
    expect(smokePassed({ quoteOk: true, conversionOk: true, transferOk: true })).toBe(true);
    expect(smokePassed({ quoteOk: true, conversionOk: true, transferOk: false })).toBe(false);
    expect(smokePassed({ quoteOk: true, conversionOk: false, transferOk: true })).toBe(false);
    expect(smokePassed({ quoteOk: false, conversionOk: true, transferOk: true })).toBe(false);
  });

  it("accepts only a CANCELLED transfer, including the auto-cancel read-back", () => {
    expect(transferProofOk("CANCELLED")).toBe(true);
    expect(transferProofOk("FAILED")).toBe(false);
    expect(transferProofOk("SENT")).toBe(false);
    expect(transferProofOk("PAID")).toBe(false);
  });

  it("reuses a beneficiary only when the smoke nickname matches", () => {
    const rows = [
      { id: "other", nickname: "payroll" },
      { id: "smoke", nickname: "two-key-smoke-supplier" },
    ];
    expect(smokeBeneficiaryId(rows, "two-key-smoke-supplier")).toBe("smoke");
    expect(smokeBeneficiaryId([{ id: "other", nickname: "payroll" }], "two-key-smoke-supplier")).toBeNull();
    expect(smokeBeneficiaryId([{ id: "bare" }], "two-key-smoke-supplier")).toBeNull();
  });

  it("stops when funding is blocked or short", () => {
    expect(fundingReady("sufficient")).toBe(true);
    expect(fundingReady("deposited")).toBe(true);
    expect(fundingReady("blocked deposit")).toBe(false);
    expect(fundingReady("blocked no global account")).toBe(false);
    expect(fundingReady("short after deposit (0)")).toBe(false);
  });

  it("allows only the sandbox origin", () => {
    expect(sandboxBaseUrl(undefined)).toBe("https://api.sandbox.airwallex.com");
    expect(sandboxBaseUrl("")).toBe("https://api.sandbox.airwallex.com");
    expect(sandboxBaseUrl("https://api.sandbox.airwallex.com/")).toBe("https://api.sandbox.airwallex.com");
    expect(() => sandboxBaseUrl("https://api.airwallex.com")).toThrow(/Sandbox only/);
    expect(() => sandboxBaseUrl("https://api.sandbox.airwallex.com.evil.example")).toThrow(/Sandbox only/);
    expect(() => sandboxBaseUrl("http://api.sandbox.airwallex.com")).toThrow(/Sandbox only/);
    expect(() => sandboxBaseUrl("https://user:secret@api.sandbox.airwallex.com")).toThrow(/Sandbox only/);
  });
});
