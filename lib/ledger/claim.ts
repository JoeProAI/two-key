/** Pure claim rules shared by the Convex mutations and the tests.
 *  `ok` and `already_done` hold the slot. `error` can be retried. `claimed` is an in-flight lock held by
 *  one owner until `leaseUntil`. Another worker gets `busy` while the lease is live, and may take the slot
 *  over only after it expires. The executor still looks the request_id up on Airwallex before any create. */
export const CLAIM_LEASE_MS = 120_000;

export interface ClaimPrior {
  result: string;
  owner?: string;
  leaseUntil?: number;
}

export type ClaimDecision =
  | { claimed: true; resume: boolean }
  | { claimed: false; reason: "done" | "busy" };

export function claimDecision(prior: ClaimPrior | null, owner: string, now: number): ClaimDecision {
  if (!prior) return { claimed: true, resume: false };
  if (prior.result === "error") return { claimed: true, resume: false };
  if (prior.result === "claimed") {
    if (prior.owner && prior.owner === owner) return { claimed: true, resume: true };
    if ((prior.leaseUntil ?? 0) > now) return { claimed: false, reason: "busy" };
    return { claimed: true, resume: true };
  }
  return { claimed: false, reason: "done" };
}

export interface FinishIncoming {
  result: string;
  owner?: string;
}

/** How an outcome lands on the stored row for its request_id.
 *  `keep` leaves the stored row alone: a finished success is never downgraded, and a worker that does
 *  not own a live claim cannot overwrite it with an error. */
export type FinishVerdict = "insert" | "patch" | "keep";

export function finishDecision(prior: ClaimPrior | null, incoming: FinishIncoming): FinishVerdict {
  if (!prior) return "insert";
  const failing = incoming.result === "error" || incoming.result === "claimed";
  if ((prior.result === "ok" || prior.result === "already_done") && failing) return "keep";
  if (prior.result === "claimed" && failing && incoming.owner !== prior.owner) return "keep";
  return "patch";
}
