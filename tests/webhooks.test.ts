import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "@/lib/webhooks/verify";
import { WebhookInbox } from "@/lib/webhooks/inbox";
import { demoWebhookDeliveries, ORIGINAL_TRANSFER_ID } from "@/lib/airwallex/fixtures";
import * as webhookRoute from "@/app/api/webhooks/airwallex/route";
import { POST } from "@/app/api/webhooks/airwallex/route";
import { MemoryWebhookStore, setWebhookStore } from "@/lib/webhooks/store";

const secret = "whsec_test";
describe("HMAC verification", () => {
  const body = JSON.stringify(demoWebhookDeliveries[0]);
  const ts = "1700000000000";
  it("accepts a correct signature (hex HMAC-SHA256 of timestamp+body)", () => {
    expect(verifyWebhook({ secret, rawBody: body, timestamp: ts, signature: signWebhook(secret, ts, body), now: 1700000000000 })).toEqual({ ok: true });
  });
  it("rejects tampered body, wrong secret, missing headers, stale timestamp", () => {
    const sig = signWebhook(secret, ts, body);
    expect(verifyWebhook({ secret, rawBody: body + " ", timestamp: ts, signature: sig, now: 1700000000000 }).ok).toBe(false);
    expect(verifyWebhook({ secret: "x", rawBody: body, timestamp: ts, signature: sig, now: 1700000000000 }).ok).toBe(false);
    expect(verifyWebhook({ secret, rawBody: body, timestamp: null, signature: sig })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifyWebhook({ secret, rawBody: body, timestamp: ts, signature: sig, now: 1700000000000 + 600_000 })).toEqual({ ok: false, reason: "stale_timestamp" });
  });
});

describe("dedupe and ordering", () => {
  it("counts a re-delivered event once and orders by created_at, not arrival", () => {
    const inbox = new WebhookInbox();
    const fresh = demoWebhookDeliveries.map((e) => inbox.ingest(e));
    expect(fresh).toEqual([true, false, true, true]);
    expect(inbox.duplicates()).toEqual([{ id: "evt_failed_01", deliveries: 2 }]);
    expect(inbox.timeline(ORIGINAL_TRANSFER_ID).map((e) => e.id)).toEqual(["evt_proc_00", "evt_failed_01", "evt_cancel_02"]);
    expect(inbox.statusByArrival(ORIGINAL_TRANSFER_ID)).toBe("PROCESSING");
    expect(inbox.status(ORIGINAL_TRANSFER_ID)).toBe("CANCELLED");
    expect(inbox.outOfOrder(ORIGINAL_TRANSFER_ID)).toBe(true);
  });
});

describe("webhook route", () => {
  it("does not export a reader", () => {
    expect(Object.keys(webhookRoute)).not.toContain("GET");
    expect(webhookRoute).not.toHaveProperty("GET");
  });

  it("verifies, then flags duplicates", async () => {
    process.env.AIRWALLEX_WEBHOOK_SECRET = secret;
    setWebhookStore(new MemoryWebhookStore());
    const body = JSON.stringify(demoWebhookDeliveries[2]);
    const ts = String(Date.now());
    const mk = (sig: string) => new Request("http://x/api/webhooks/airwallex", { method: "POST", body, headers: { "x-timestamp": ts, "x-signature": sig } });
    expect((await POST(mk("00"))).status).toBe(400);
    const a = await (await POST(mk(signWebhook(secret, ts, body)))).json();
    const b = await (await POST(mk(signWebhook(secret, ts, body)))).json();
    expect(a).toEqual({ received: true, duplicate: false });
    expect(b).toEqual({ received: true, duplicate: true });
  });
});
