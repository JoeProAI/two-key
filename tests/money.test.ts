import { describe, expect, it } from "vitest";
import { toMajorString } from "@/lib/money";
describe("major units", () => {
  it("formats", () => {
    expect(toMajorString(40000, "USD")).toBe("40000.00");
    expect(toMajorString(5000, "JPY")).toBe("5000");
  });
  it("rejects minor-unit precision and bad amounts", () => {
    expect(() => toMajorString(1.005, "USD")).toThrow();
    expect(() => toMajorString(-1, "USD")).toThrow();
    expect(() => toMajorString(NaN, "USD")).toThrow();
  });
});
