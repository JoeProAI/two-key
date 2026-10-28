/** Pure claim rule shared by the Convex mutation and the tests.
 *  `ok` and `already_done` hold the slot. `error` can be retried. `claimed` is an in-flight lock
 *  the same request_id may resume (the Airwallex lookup still runs before any create). */
export interface ClaimPrior {
  result: string;
}

export interface ClaimDecision {
  claimed: boolean;
  resume: boolean;
}

export function claimDecision(prior: ClaimPrior | null): ClaimDecision {
  if (!prior) return { claimed: true, resume: false };
  if (prior.result === "error") return { claimed: true, resume: false };
  if (prior.result === "claimed") return { claimed: true, resume: true };
  return { claimed: false, resume: false };
}
