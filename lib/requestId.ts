import { createHash } from "node:crypto";

// Airwallex: "Payout creation requests with a request_id that has been used in the past 7 days
// are treated as duplicated payout and cannot be processed." (POST /api/v1/transfers/create)
// So the request_id must be a pure function of the *intent*, never of the attempt, the webhook,
// or the clock. Same intent + same action => same request_id, every time, on every retry.
export function stableRequestId(intentId: string, action: string, slot = "0"): string {
  const h = createHash("sha256").update(`two-key|${intentId}|${action}|${slot}`).digest("hex");
  // Format as a UUID-shaped string; the doc notes it "can be non-UUID as long as it is unique".
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export interface RetryKey {
  originalTransferId: string;
  amount: number;
  currency: string;
  beneficiaryId: string;
}

/** One retry slot plus the amount, currency, beneficiary, and original transfer. A different amount is a different key. */
export function retryRequestId(intentId: string, slot: string, parts: RetryKey): string {
  return stableRequestId(intentId, "retry_transfer", [slot, parts.originalTransferId, parts.amount, parts.currency, parts.beneficiaryId].join("|"));
}

/** The buy amount and the two currencies. The quote id is not part of the key: a requote of the same buy stays the same request_id. */
export function fxRequestId(intentId: string, buyAmount: number, buyCurrency: string, sellCurrency: string): string {
  return stableRequestId(intentId, "fx_conversion", [buyAmount, buyCurrency, sellCurrency].join("|"));
}

/** One payee correction per beneficiary and corrected names. */
export function correctionRequestId(intentId: string, beneficiaryId: string, companyName: string, accountName: string): string {
  return stableRequestId(intentId, "correct_beneficiary", [beneficiaryId, companyName, accountName].join("|"));
}

export function canonicalRetryId(intentId: string, original: { id: string; transfer_amount: number; transfer_currency: string; beneficiary_id?: string }): string {
  return retryRequestId(intentId, "0", {
    originalTransferId: original.id,
    amount: original.transfer_amount,
    currency: original.transfer_currency,
    beneficiaryId: original.beneficiary_id ?? "",
  });
}
