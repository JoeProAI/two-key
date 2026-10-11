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
