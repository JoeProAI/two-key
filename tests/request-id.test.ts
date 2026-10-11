import { describe, expect, it } from "vitest";
import { stableRequestId } from "@/lib/requestId";
import { createMockClient } from "@/lib/airwallex/mock";

describe("idempotent request_id", () => {
  it("is a pure function of intent + action", () => {
    expect(stableRequestId("i1", "retry_transfer")).toBe(stableRequestId("i1", "retry_transfer"));
    expect(stableRequestId("i1", "retry_transfer")).not.toBe(stableRequestId("i2", "retry_transfer"));
    expect(stableRequestId("i1", "retry_transfer")).not.toBe(stableRequestId("i1", "fx_conversion"));
  });
  it("a reused request_id is rejected like Airwallex does", async () => {
    const awx = createMockClient();
    const body = { request_id: stableRequestId("i1", "retry_transfer"), beneficiary_id: "b", transfer_amount: "100.00", transfer_currency: "USD", transfer_method: "LOCAL" as const, reference: "r", reason: "x" };
    await awx.createTransfer(body);
    await expect(awx.createTransfer(body)).rejects.toThrow(/duplicate/);
    expect(await awx.findTransferByRequestId(body.request_id)).not.toBeNull();
  });
});
