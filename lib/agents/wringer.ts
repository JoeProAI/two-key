import type { Action, Objection } from "../ledger/types";
import { canonicalRetryId } from "../requestId";
import { parseAwxTime } from "../webhooks/inbox";
import type { Situation } from "./situation";
import { agentMode, chatJSON, type ChatJSON } from "./openrouter";

export type Finding = Pick<Objection, "check" | "severity" | "detail">;

export const FX_MIN_HEADROOM_MS = 60_000; // a quote must have at least 60s left when we execute

/** Deterministic checks. These always run; an LLM can add objections but never remove these. */
export function wring(s: Situation, actions: Action[]): Finding[] {
  const f: Finding[] = [];
  const retries = actions.filter((a): a is Extract<Action, { kind: "retry_transfer" }> => a.kind === "retry_transfer");

  // 1. Duplicate webhooks: count failures by unique event id, not deliveries.
  if (s.webhook.duplicates.length) {
    f.push({ check: "duplicate_webhook", severity: "note", detail: `Event(s) ${s.webhook.duplicates.map((d) => `${d.id} x${d.deliveries}`).join(", ")} delivered more than once; counted once.` });
  }
  if (retries.length > 1) {
    f.push({ check: "double_payment", severity: "block", detail: `${retries.length} retries proposed for one failed transfer (${s.webhook.uniqueFailedEvents} unique failure event). That pays the supplier ${retries.length} times.` });
  }

  // 2. Every retry must use the stable request_id for this intent so a replay is rejected by Airwallex.
  for (const r of retries) {
    if (r.requestId !== canonicalRetryId(s.intentId, s.original)) {
      f.push({ check: "unstable_request_id", severity: "block", detail: `Retry uses request_id ${r.requestId}, not the intent's stable id.` });
    }
  }

  // 3. Out-of-order webhooks: trust created_at, and the live GET, over arrival order.
  if (s.webhook.statusByArrival && s.webhook.statusByArrival !== s.webhook.statusByCreatedAt) {
    f.push({ check: "out_of_order_webhook", severity: "note", detail: `Last arrival says ${s.webhook.statusByArrival}, created_at order says ${s.webhook.statusByCreatedAt}. Using created_at and GET /api/v1/transfers/{id}.` });
  }

  // 4. CANCELLED vs FAILED. Airwallex auto-cancels FAILED transfers, so FAILED -> CANCELLED is safe to re-send once.
  //    CANCELLED with no failure event means a person stopped it: never auto-retry. SENT/PAID/PROCESSING: money may be moving.
  if (retries.length) {
    const st = s.original.status;
    if (st === "CANCELLED" && !s.webhook.sawFailedEvent) {
      f.push({ check: "cancelled_not_failed", severity: "block", detail: "Original was CANCELLED without a payout.transfer.failed event: someone stopped it on purpose. Ask a human." });
    } else if (st !== "CANCELLED" && st !== "FAILED") {
      f.push({ check: "original_still_live", severity: "block", detail: `Original transfer is ${st}. A retry now could pay twice.` });
    } else if (st === "FAILED") {
      f.push({ check: "failed_not_yet_cancelled", severity: "note", detail: "Original is FAILED; Airwallex cancels failed transfers within seconds. Re-read before executing." });
    }
  }

  // 5. Stale FX quotes.
  for (const a of actions) {
    if (a.kind !== "fx_conversion") continue;
    const left = parseAwxTime(a.quoteValidToAt) - s.now;
    if (left < FX_MIN_HEADROOM_MS) f.push({ check: "stale_fx_quote", severity: "block", detail: `Quote ${a.quoteId} has ${Math.round(left / 1000)}s left. Requote.` });
  }

  // 6. Reserve breach after all moves.
  const cur = s.reserve.currency;
  let after = s.balances.find((b) => b.currency === cur)?.available_amount ?? 0;
  for (const a of actions) {
    if (a.kind === "fx_conversion" && a.buyCurrency === cur) after += a.buyAmount;
    if (a.kind === "retry_transfer" && a.currency === cur) after -= a.amount;
  }
  const deferredIds = new Set(actions.filter((a) => a.kind === "defer_payout").map((a) => (a as Extract<Action, { kind: "defer_payout" }>).payoutId));
  const stillDue = s.queuedPayouts.filter((p) => p.currency === cur && !deferredIds.has(p.id)).reduce((n, p) => n + p.amount, 0);
  if (after - stillDue < s.reserve.amount) {
    f.push({ check: "reserve_breach", severity: "block", detail: `${cur} would end at ${after - stillDue} after queued payouts, below the ${s.reserve.amount} reserve.` });
  }
  return f;
}

export const WRINGER_SYSTEM = `You are the Wringer. Your only job is to break the proposed money moves.
Look for anything the deterministic checks missed. Reply JSON {"objections":[{"check":string,"severity":"block"|"note","detail":string}]}.
You cannot clear, downgrade, or repeat a check that is already in alreadyFound. Those stand.`;

export interface ReviewOptions {
  env?: NodeJS.ProcessEnv;
  chat?: ChatJSON;
}

/** Hard checks are copied through unchanged. An LLM objection whose `check` matches one of them is dropped.
 *  A failed or empty model call leaves the hard list as it was. */
export function mergeFindings(hard: Finding[], extra: Finding[] | undefined): Finding[] {
  const taken = new Set(hard.map((f) => f.check));
  const added: Finding[] = [];
  for (const f of extra ?? []) {
    if (!f || (f.severity !== "block" && f.severity !== "note")) continue;
    if (typeof f.check !== "string" || !f.check || typeof f.detail !== "string") continue;
    if (taken.has(f.check)) continue;
    taken.add(f.check);
    added.push({ check: f.check, severity: f.severity, detail: f.detail });
  }
  return [...hard, ...added];
}

export async function review(s: Situation, actions: Action[], opts: ReviewOptions = {}): Promise<Finding[]> {
  const hard = wring(s, actions);
  const env = opts.env ?? process.env;
  if (agentMode(env) !== "llm") return hard;
  try {
    const chat = opts.chat ?? ((role, system, user, callEnv) => chatJSON(role, system, user, callEnv));
    const extra = (await chat("wringer", WRINGER_SYSTEM, { situation: s, actions, alreadyFound: hard }, env)) as { objections?: Finding[] } | undefined;
    return mergeFindings(hard, extra?.objections);
  } catch {
    return hard;
  }
}
