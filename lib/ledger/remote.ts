import "server-only";
import { claimDecision } from "./claim";
import type { MemoryLedger } from "./memory";
import { toIncidentArgs, type RemoteIncident } from "./payload";

/** Convex when CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) and TWO_KEY_INGEST_SECRET are set. Memory otherwise.
 *  Same gate as the webhook store. No secret is invented here. */
export function ledgerBackend(env: NodeJS.ProcessEnv = process.env): "memory" | "convex" {
  if (backendOverride) return backendOverride;
  const url = env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
  const secret = env.TWO_KEY_INGEST_SECRET;
  if (!url || !secret) return "memory";
  return "convex";
}

export interface LedgerApi {
  upsert(args: Record<string, unknown>): Promise<unknown>;
  claim(args: Record<string, unknown>): Promise<{ claimed: boolean; reason?: string }>;
  finish(args: Record<string, unknown>): Promise<unknown>;
  load(args: Record<string, unknown>): Promise<RemoteIncident | null>;
}

let backendOverride: "memory" | "convex" | null = null;
let apiOverride: LedgerApi | null = null;

/** Tests inject a fake. Production builds a ConvexHttpClient the first time the backend is convex. */
export function setLedgerBackendForTests(backend: "memory" | "convex" | null) {
  backendOverride = backend;
}

export function setLedgerApiForTests(api: LedgerApi | null) {
  apiOverride = api;
}

export function resetLedgerRemoteForTests() {
  backendOverride = null;
  apiOverride = null;
}

async function apiFor(env: NodeJS.ProcessEnv): Promise<LedgerApi> {
  if (apiOverride) return apiOverride;
  const url = env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("ledger backend is convex but no deployment URL is set");
  const [{ ConvexHttpClient }, { anyApi }] = await Promise.all([import("convex/browser"), import("convex/server")]);
  const client = new ConvexHttpClient(url);
  return {
    upsert: (args) => client.mutation(anyApi.ledger.upsertIncident, args),
    claim: async (args) => (await client.mutation(anyApi.ledger.claimExecutionPublic, args)) as { claimed: boolean; reason?: string },
    finish: (args) => client.mutation(anyApi.ledger.finishExecution, args),
    load: async (args) => (await client.query(anyApi.ledger.getIncident, args)) as RemoteIncident | null,
  };
}

export async function syncIncident(ledger: MemoryLedger, env: NodeJS.ProcessEnv = process.env): Promise<"memory" | "convex"> {
  if (ledgerBackend(env) !== "convex") return "memory";
  const api = await apiFor(env);
  await api.upsert(toIncidentArgs(ledger, env.TWO_KEY_INGEST_SECRET ?? ""));
  return "convex";
}

export async function loadIncident(intentKey: string, env: NodeJS.ProcessEnv = process.env): Promise<RemoteIncident | null> {
  if (ledgerBackend(env) !== "convex") return null;
  const api = await apiFor(env);
  return api.load({ secret: env.TWO_KEY_INGEST_SECRET ?? "", intentKey });
}

/** `free` means this owner may send. `taken` means the ledger already holds a finished outcome for the request_id.
 *  `busy` means another owner holds a live claim on it: do not send and do not write over it. */
export async function takeRequestSlot(
  slot: { decisionId: string; requestId: string; actionKind: string; owner: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<"free" | "taken" | "busy"> {
  if (ledgerBackend(env) !== "convex") return "free";
  const api = await apiFor(env);
  const res = await api.claim({ secret: env.TWO_KEY_INGEST_SECRET ?? "", ...slot });
  if (res.claimed) return "free";
  return res.reason === "busy" ? "busy" : "taken";
}

export async function finishRequest(
  ex: { id: string; decisionId: string; requestId: string; actionKind: string; result: string; airwallexId?: string; owner?: string; response: unknown; createdAt: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (ledgerBackend(env) !== "convex") return;
  const api = await apiFor(env);
  await api.finish({
    secret: env.TWO_KEY_INGEST_SECRET ?? "",
    key: ex.id,
    decisionKey: ex.decisionId,
    requestId: ex.requestId,
    actionKind: ex.actionKind,
    result: ex.result,
    airwallexId: ex.airwallexId,
    owner: ex.owner,
    response: ex.response,
    createdAt: ex.createdAt,
  });
}

export { claimDecision };
