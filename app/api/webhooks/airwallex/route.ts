import { verifyWebhook } from "@/lib/webhooks/verify";
import { WebhookInbox } from "@/lib/webhooks/inbox";
import type { Transfer, WebhookEvent } from "@/lib/airwallex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Process-local inbox for mock mode. In the app this becomes the Convex `ingestWebhook`
// mutation (dedupe on event id, ordered by created_at) via a Convex HTTP client call.
const inbox = new WebhookInbox();

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
  const fresh = inbox.ingest(event);
  return Response.json({ received: true, duplicate: !fresh });
}
