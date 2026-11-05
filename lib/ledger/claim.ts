/** Pure claim rules shared by the Convex mutations and the tests.
 *  `ok` and `already_done` hold the slot. `error` can be retried. `claimed` is an in-flight lock held by
 *  one owner until `leaseUntil`. Another worker gets `busy` while the lease is live, and may take the slot
 *  over only after it expires. Finish does not read the clock: the worker named on the row can still
 *  record its outcome after the lease time if nobody has taken the row. The executor still looks the
 *  request_id up on Airwallex before any create. */
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
 *  `ok` and `already_done` are terminal: a later `ok`, `error`, or `claimed` is `keep` and cannot
 *  change the result, response, or provider id. `replay` is only an `already_done` reported against
 *  that terminal row; it bumps the replay count and leaves the evidence.
 *  An open row (`claimed` or `error`) can be finished only by its current owner. Lease expiry does
 *  not by itself block that owner. It only lets someone else `claim` the row. After that takeover,
 *  the previous owner's late `ok` or `error` is `keep`. A missing owner on either side does not match. */
export type FinishVerdict = "insert" | "patch" | "keep" | "replay";

export function finishDecision(prior: ClaimPrior | null, incoming: FinishIncoming): FinishVerdict {
  if (!prior) return "insert";
  if (prior.result === "ok" || prior.result === "already_done") {
    return incoming.result === "already_done" ? "replay" : "keep";
  }
  if (!incoming.owner || incoming.owner !== prior.owner) return "keep";
  return "patch";
}
