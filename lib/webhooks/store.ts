import type { Transfer, WebhookEvent } from "../airwallex/types";
import { WebhookInbox, parseAwxTime } from "./inbox";

/** Where verified webhook events land. The route depends only on this interface.
 *  - MemoryWebhookStore: process-local, for mock mode and tests.
 *  - ConvexWebhookStore: calls the Convex `ledger:ingestWebhook` mutation (dedupe on event id, ordered by created_at). */
export interface WebhookStore {
  readonly kind: "memory" | "convex";
  ingest(event: WebhookEvent<Transfer>): Promise<{ duplicate: boolean }>;
}

export class MemoryWebhookStore implements WebhookStore {
  readonly kind = "memory" as const;
  constructor(readonly inbox: WebhookInbox = new WebhookInbox()) {}
  async ingest(event: WebhookEvent<Transfer>) {
    return { duplicate: !this.inbox.ingest(event) };
  }
}

/** The one ConvexHttpClient method we use, so tests can pass a fake. */
export interface ConvexMutationClient {
  mutation(ref: unknown, args: Record<string, unknown>): Promise<unknown>;
}

/** Args for convex/ledger.ts `ingestWebhook`. Kept as a pure function so the mapping is tested without a deployment. */
export function toIngestArgs(event: WebhookEvent<Transfer>, secret: string) {
  return {
    secret,
    eventId: event.id,
    name: event.name,
    accountId: event.account_id,
    objectId: event.data.object.id,
    status: event.data.object.status,
    createdAt: parseAwxTime(event.created_at),
    payload: event,
  };
}

export class ConvexWebhookStore implements WebhookStore {
  readonly kind = "convex" as const;
  constructor(
    private client: ConvexMutationClient,
    private ref: unknown,
    private secret: string,
  ) {}
  async ingest(event: WebhookEvent<Transfer>) {
    const r = (await this.client.mutation(this.ref, toIngestArgs(event, this.secret))) as { duplicate: boolean };
    return { duplicate: r.duplicate };
  }
}

/** Convex when CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) and TWO_KEY_INGEST_SECRET are set on the server; memory otherwise. */
export async function createWebhookStore(env: NodeJS.ProcessEnv = process.env): Promise<WebhookStore> {
  const url = env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
  const secret = env.TWO_KEY_INGEST_SECRET;
  if (!url || !secret) return new MemoryWebhookStore();
  const [{ ConvexHttpClient }, { anyApi }] = await Promise.all([import("convex/browser"), import("convex/server")]);
  return new ConvexWebhookStore(new ConvexHttpClient(url), anyApi.ledger.ingestWebhook, secret);
}

let current: Promise<WebhookStore> | null = null;
/** Process-wide store used by the webhook route. Created on first use. */
export function getWebhookStore(): Promise<WebhookStore> {
  return (current ??= createWebhookStore());
}
/** Tests swap in a fake or fresh store; pass null to go back to env-based selection. */
export function setWebhookStore(s: WebhookStore | null) {
  current = s ? Promise.resolve(s) : null;
}
