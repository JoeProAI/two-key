import { createHash } from "node:crypto";
import type { Action } from "../ledger/types";

/** Canonical plan fingerprint. Approval and execution both check this, so a changed action list cannot ride an old tap. */
export function planDigest(actions: Action[]): string {
  return createHash("sha256").update(JSON.stringify(actions)).digest("hex");
}

export interface EvidenceSnap {
  balances: { currency: string; available: number }[];
  webhookStatus: string | null;
  quoteId?: string;
  reserve: number;
  queued: { id: string; amount: number }[];
}

/** Facts the plan was allowed to use. A later tap must present the same snapshot. */
export function evidenceDigest(snap: EvidenceSnap): string {
  const body = {
    balances: [...snap.balances].sort((a, b) => a.currency.localeCompare(b.currency)),
    webhookStatus: snap.webhookStatus,
    quoteId: snap.quoteId ?? null,
    reserve: snap.reserve,
    queued: [...snap.queued].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
