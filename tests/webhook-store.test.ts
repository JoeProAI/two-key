import { describe, expect, it } from "vitest";
import { ConvexWebhookStore, MemoryWebhookStore, createWebhookStore, setWebhookStore, toIngestArgs } from "@/lib/webhooks/store";
import { signWebhook } from "@/lib/webhooks/verify";
import { demoWebhookDeliveries } from "@/lib/airwallex/fixtures";
import { POST } from "@/app/api/webhooks/airwallex/route";

describe("webhook store", () => {
  it("memory adapter dedupes on event id", async () => {
    const s = new MemoryWebhookStore();
    const out = [];
    for (const e of demoWebhookDeliveries) out.push((await s.ingest(e)).duplicate);
    expect(out).toEqual([false, true, false, false]);
  });
  it("picks memory without Convex env, convex with it", async () => {
    expect((await createWebhookStore({} as unknown as NodeJS.ProcessEnv)).kind).toBe("memory");
    expect((await createWebhookStore({ CONVEX_URL: "https://example.convex.cloud", TWO_KEY_INGEST_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).kind).toBe("convex");
  });
  it("convex adapter sends the mapped args to ledger:ingestWebhook", async () => {
    const calls: { ref: unknown; args: Record<string, unknown> }[] = [];
    const seen = new Set<string>();
    const client = { mutation: async (ref: unknown, args: Record<string, unknown>) => {
      calls.push({ ref, args });
      const dup = seen.has(args.eventId as string);
      seen.add(args.eventId as string);
      return { duplicate: dup };
    } };
    const s = new ConvexWebhookStore(client, "ledger:ingestWebhook", "sek");
    expect(await s.ingest(demoWebhookDeliveries[0])).toEqual({ duplicate: false });
    expect(await s.ingest(demoWebhookDeliveries[1])).toEqual({ duplicate: true });
    expect(calls[0].args).toEqual(toIngestArgs(demoWebhookDeliveries[0], "sek"));
    expect(calls[0].args).toMatchObject({ eventId: "evt_failed_01", objectId: demoWebhookDeliveries[0].data.object.id, status: "FAILED", secret: "sek" });
    expect(typeof calls[0].args.createdAt).toBe("number");
  });
  it("route returns 503 when the store fails, so Airwallex retries", async () => {
    process.env.AIRWALLEX_WEBHOOK_SECRET = "whsec_test";
    setWebhookStore({ kind: "convex", ingest: async () => { throw new Error("down"); } });
    const body = JSON.stringify(demoWebhookDeliveries[0]);
    const ts = String(Date.now());
    const res = await POST(new Request("http://x", { method: "POST", body, headers: { "x-timestamp": ts, "x-signature": signWebhook("whsec_test", ts, body) } }));
    expect(res.status).toBe(503);
    setWebhookStore(null);
  });
});
