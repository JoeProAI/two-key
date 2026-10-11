import { createHmac, timingSafeEqual } from "node:crypto";

// Source: https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events
// x-timestamp: Unix ms. x-signature: HMAC-SHA256 hex digest of `${x-timestamp}${rawBody}`,
// keyed with the notification URL's secret. Verify on the RAW body before parsing JSON,
// then check the timestamp against a tolerance.
export const DEFAULT_TOLERANCE_MS = 5 * 60_000;

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${rawBody}`).digest("hex");
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing_headers" | "bad_signature" | "stale_timestamp" };

export function verifyWebhook(args: {
  secret: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  now?: number;
  toleranceMs?: number;
}): VerifyResult {
  const { secret, rawBody, timestamp, signature } = args;
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody), "hex");
  const got = Buffer.from(signature, "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: "bad_signature" };
  const now = args.now ?? Date.now();
  if (Math.abs(now - Number(timestamp)) > (args.toleranceMs ?? DEFAULT_TOLERANCE_MS)) return { ok: false, reason: "stale_timestamp" };
  return { ok: true };
}
