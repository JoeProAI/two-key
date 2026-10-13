import { verifyWebhook } from "@/lib/webhooks/verify";
import { getWebhookStore } from "@/lib/webhooks/store";
import type { Transfer, WebhookEvent } from "@/lib/airwallex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Store: Convex `ledger:ingestWebhook` when CONVEX_URL + TWO_KEY_INGEST_SECRET are set, process-local memory otherwise.

// Airwallex POSTs JSON with x-timestamp + x-signature headers.
// Verify on the raw text BEFORE JSON.parse; reply 200 fast (including for duplicates) so it stops retrying.
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.AIRWALLEX_WEBHOOK_SECRET;
  if (!secret) return new Response("webhook secret not configured", { status: 500 });
  const raw = await req.text();
  const v = verifyWebhook({ secret, rawBody: raw, timestamp: req.headers.get("x-timestamp"), signature: req.headers.get("x-signature") });
  if (!v.ok) return new Response(v.reason, { status: 400 });
  let event: WebhookEvent<Transfer>;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  try {
    const { duplicate } = await (await getWebhookStore()).ingest(event);
    return Response.json({ received: true, duplicate });
  } catch {
    // Not stored: a 5xx makes Airwallex retry the delivery, and dedupe on event id absorbs the repeat.
    return new Response("store unavailable", { status: 503 });
  }
}
