import { describe, expect, it } from "vitest";
import { canonicalRetryId, fxRequestId, stableRequestId } from "@/lib/requestId";
import * as fx from "@/lib/airwallex/fixtures";
import { createMockClient } from "@/lib/airwallex/mock";

describe("idempotent request_id", () => {
  it("is a pure function of intent + action", () => {
    expect(stableRequestId("i1", "retry_transfer")).toBe(stableRequestId("i1", "retry_transfer"));
    expect(stableRequestId("i1", "retry_transfer")).not.toBe(stableRequestId("i2", "retry_transfer"));
    expect(stableRequestId("i1", "retry_transfer")).not.toBe(stableRequestId("i1", "fx_conversion"));
    expect(fxRequestId("intent_inv2291", 28000, "USD", "EUR")).toBe(fxRequestId("intent_inv2291", 28000, "USD", "EUR"));
    expect(fxRequestId("intent_inv2291", 28000, "USD", "EUR")).not.toBe(fxRequestId("intent_inv2291", 40000, "USD", "EUR"));
    expect(canonicalRetryId("intent_inv2291", fx.originalTransfer)).not.toBe(stableRequestId("intent_inv2291", "retry_transfer", "0"));
  });
  it("a reused request_id is rejected like Airwallex does", async () => {
    const awx = createMockClient();
    const body = { request_id: stableRequestId("i1", "retry_transfer"), beneficiary_id: "b", transfer_amount: "100.00", transfer_currency: "USD", transfer_method: "LOCAL" as const, reference: "r", reason: "x" };
    await awx.createTransfer(body);
    await expect(awx.createTransfer(body)).rejects.toThrow(/duplicate/);
    expect(await awx.findTransferByRequestId(body.request_id)).not.toBeNull();
  });
});
